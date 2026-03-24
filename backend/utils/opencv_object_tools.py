import json
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image
from simple_lama_inpainting import SimpleLama
from transformers import SamModel, SamProcessor


SAM_MODEL_ID = os.environ.get("SAM_MODEL_ID", "nielsr/slimsam-50-uniform")
SAM_DEVICE = "cpu"
USE_LAMA = os.environ.get("USE_LAMA_INPAINT", "1").strip().lower() not in {"0", "false", "no"}
_SAM_PROCESSOR = None
_SAM_MODEL = None
_LAMA_MODEL = None


def fail(message: str, code: int = 1):
    sys.stderr.write(message)
    sys.exit(code)


def read_payload():
    raw = sys.stdin.read()
    if not raw:
        fail("No payload")
    try:
        return json.loads(raw)
    except Exception as exc:
        fail(f"Invalid JSON payload: {exc}")


def clamp01(v: float) -> float:
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return v


def points_to_pixels(points, width, height):
    out = []
    for p in points:
        x = int(round(clamp01(float(p.get("x", 0.0))) * (width - 1)))
        y = int(round(clamp01(float(p.get("y", 0.0))) * (height - 1)))
        out.append([x, y])
    return np.array(out, dtype=np.int32)


def area_of_polygon(points_px):
    if len(points_px) < 3:
        return 0.0
    return float(cv2.contourArea(points_px.astype(np.float32)))


def normalize_points(points_px, width, height):
    if len(points_px) == 0:
        return []
    w = max(1, width - 1)
    h = max(1, height - 1)
    return [
        {"x": float(p[0]) / float(w), "y": float(p[1]) / float(h)}
        for p in points_px
    ]


def get_sam_components():
    global _SAM_PROCESSOR
    global _SAM_MODEL

    if _SAM_PROCESSOR is not None and _SAM_MODEL is not None:
        return _SAM_PROCESSOR, _SAM_MODEL

    _SAM_PROCESSOR = SamProcessor.from_pretrained(SAM_MODEL_ID)
    _SAM_MODEL = SamModel.from_pretrained(SAM_MODEL_ID)
    _SAM_MODEL.to(SAM_DEVICE)
    _SAM_MODEL.eval()
    return _SAM_PROCESSOR, _SAM_MODEL


def get_lama_model():
    global _LAMA_MODEL

    if _LAMA_MODEL is not None:
        return _LAMA_MODEL

    _LAMA_MODEL = SimpleLama()
    return _LAMA_MODEL


def build_sam_prompts(points_px, width, height):
    contour = points_px.reshape(-1, 1, 2).astype(np.int32)
    x, y, bw, bh = cv2.boundingRect(points_px)

    x0 = max(0, x - max(6, bw // 10))
    y0 = max(0, y - max(6, bh // 10))
    x1 = min(width - 1, x + bw + max(6, bw // 10))
    y1 = min(height - 1, y + bh + max(6, bh // 10))

    moments = cv2.moments(contour)
    if abs(moments["m00"]) > 1e-6:
        cx = int(round(moments["m10"] / moments["m00"]))
        cy = int(round(moments["m01"] / moments["m00"]))
    else:
        cx = int(round(np.mean(points_px[:, 0])))
        cy = int(round(np.mean(points_px[:, 1])))

    if cv2.pointPolygonTest(contour.astype(np.float32), (float(cx), float(cy)), False) < 0:
        cx = int(round((x + x + bw) / 2.0))
        cy = int(round((y + y + bh) / 2.0))

    positive_points = [[float(cx), float(cy)]]
    negative_points = []

    candidate_neg = [
        (x0, y0),
        (x1, y0),
        (x0, y1),
        (x1, y1),
        (x0, int(round((y0 + y1) / 2))),
        (x1, int(round((y0 + y1) / 2))),
        (int(round((x0 + x1) / 2)), y0),
        (int(round((x0 + x1) / 2)), y1),
    ]

    for nx, ny in candidate_neg:
        inside = cv2.pointPolygonTest(contour.astype(np.float32), (float(nx), float(ny)), False)
        if inside < 0:
            negative_points.append([float(nx), float(ny)])
        if len(negative_points) >= 4:
            break

    points = positive_points + negative_points
    labels = [1] + [0] * len(negative_points)

    return [float(x0), float(y0), float(x1), float(y1)], points, labels


def contour_from_mask(mask):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None, 0.0
    best = max(contours, key=cv2.contourArea)
    return best, float(cv2.contourArea(best))


def pick_component_by_overlap(binary_mask, lasso_mask):
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary_mask, connectivity=8)
    if num_labels <= 1:
        return binary_mask

    best_label = 0
    best_score = -1.0

    for label in range(1, num_labels):
        area = float(stats[label, cv2.CC_STAT_AREA])
        if area < 50:
            continue

        comp_mask = (labels == label).astype(np.uint8)
        overlap = float(np.count_nonzero((comp_mask == 1) & (lasso_mask == 255)))
        score = overlap * 2.5 + area * 0.15
        if score > best_score:
            best_score = score
            best_label = label

    if best_label == 0:
        return binary_mask

    return ((labels == best_label).astype(np.uint8) * 255).astype(np.uint8)


def sam_refine_mask(image_bgr, points_px):
    h, w = image_bgr.shape[:2]
    processor, model = get_sam_components()

    lasso_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(lasso_mask, [points_px], 255)

    bbox, prompt_points, prompt_labels = build_sam_prompts(points_px, w, h)
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    image_pil = Image.fromarray(image_rgb)

    inputs = processor(
        images=image_pil,
        input_boxes=[[bbox]],
        input_points=[[prompt_points]],
        input_labels=[[prompt_labels]],
        return_tensors="pt"
    )

    for key, value in inputs.items():
        if hasattr(value, "to"):
            inputs[key] = value.to(SAM_DEVICE)

    with torch.no_grad():
        outputs = model(**inputs)

    masks = processor.image_processor.post_process_masks(
        outputs.pred_masks.cpu(),
        inputs["original_sizes"].cpu(),
        inputs["reshaped_input_sizes"].cpu(),
    )
    iou_scores = outputs.iou_scores[0, 0].detach().cpu().numpy()
    candidate_masks = masks[0][0].detach().cpu().numpy()

    best_mask = None
    best_score = -1e9

    for idx in range(candidate_masks.shape[0]):
        mask = (candidate_masks[idx] > 0).astype(np.uint8) * 255
        mask = pick_component_by_overlap(mask, lasso_mask)
        if np.count_nonzero(mask) == 0:
            continue

        overlap = float(np.count_nonzero((mask == 255) & (lasso_mask == 255)))
        area = float(np.count_nonzero(mask == 255))
        overlap_ratio = overlap / max(1.0, area)
        score = float(iou_scores[idx]) * 1.8 + overlap_ratio * 1.1

        if score > best_score:
            best_score = score
            best_mask = mask

    if best_mask is None:
        return None

    best_mask = cv2.morphologyEx(best_mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    best_mask = cv2.morphologyEx(best_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    return best_mask


def refine_polygon(image_bgr, lasso_points):
    h, w = image_bgr.shape[:2]
    points_px = points_to_pixels(lasso_points, w, h)
    if len(points_px) < 3:
        return {"mode": "lasso", "points": lasso_points, "pixelArea": 0}

    pixel_area = area_of_polygon(points_px)
    # Keep lasso for tiny objects (dust/specks)
    if pixel_area < 1000:
        return {
            "mode": "lasso",
            "points": normalize_points(points_px, w, h),
            "pixelArea": pixel_area,
        }

    try:
        sam_mask = sam_refine_mask(image_bgr, points_px)
    except Exception as exc:
        raise RuntimeError(f"SAM refine failed ({SAM_MODEL_ID}): {exc}")

    if sam_mask is None:
        return {
            "mode": "lasso",
            "points": normalize_points(points_px, w, h),
            "pixelArea": pixel_area,
        }

    contour, best_area = contour_from_mask(sam_mask)
    if contour is None or best_area < 500:
        return {
            "mode": "lasso",
            "points": normalize_points(points_px, w, h),
            "pixelArea": pixel_area,
        }

    eps = 0.004 * cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, eps, True)

    if len(approx) > 260:
        step = int(np.ceil(len(approx) / 220.0))
        approx = approx[::step]

    refined_points_px = np.squeeze(approx, axis=1)
    if refined_points_px.ndim != 2 or len(refined_points_px) < 3:
        return {
            "mode": "lasso",
            "points": normalize_points(points_px, w, h),
            "pixelArea": pixel_area,
        }

    return {
        "mode": "refined",
        "points": normalize_points(refined_points_px, w, h),
        "pixelArea": best_area,
    }


def remove_object(image_bgr, refined_points):
    h, w = image_bgr.shape[:2]
    pts = points_to_pixels(refined_points, w, h)
    if len(pts) < 3:
        return image_bgr, "none"

    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 255)

    # Expand mask for better seam removal around the object boundary.
    area = float(cv2.contourArea(pts.astype(np.float32)))
    if area > 12000:
        dilate_k, dilate_i, radius = 9, 2, 8
    elif area > 4500:
        dilate_k, dilate_i, radius = 7, 2, 6
    else:
        dilate_k, dilate_i, radius = 5, 1, 4

    mask = cv2.dilate(mask, np.ones((dilate_k, dilate_k), np.uint8), iterations=dilate_i)

    if USE_LAMA:
        try:
            lama = get_lama_model()
            image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            image_pil = Image.fromarray(image_rgb)
            mask_pil = Image.fromarray(mask).convert("L")
            lama_result = lama(image_pil, mask_pil)
            lama_np = np.array(lama_result)
            if lama_np.ndim == 3 and lama_np.shape[2] == 3:
                return cv2.cvtColor(lama_np, cv2.COLOR_RGB2BGR), "lama"
        except Exception:
            # Fall back to OpenCV methods when LaMa is unavailable/fails at runtime.
            pass

    # Exemplar-style fallback: FSR from OpenCV xphoto (contrib).
    # Final fallback: NS + Telea.
    try:
        if hasattr(cv2, "xphoto") and hasattr(cv2.xphoto, "INPAINT_FSR_BEST"):
            fsr_mask = (mask > 0).astype(np.uint8)
            fsr_out = np.empty_like(image_bgr)
            cv2.xphoto.inpaint(image_bgr, fsr_mask, fsr_out, cv2.xphoto.INPAINT_FSR_BEST)

            # Blend the inpainted region with a narrow feather to reduce seams.
            feather = cv2.GaussianBlur(mask, (0, 0), sigmaX=2.2, sigmaY=2.2)
            alpha = (feather.astype(np.float32) / 255.0)[..., None]
            blended = (image_bgr.astype(np.float32) * (1.0 - alpha)) + (fsr_out.astype(np.float32) * alpha)
            return np.clip(blended, 0, 255).astype(np.uint8), "fsr"
    except Exception:
        pass

    removed = cv2.inpaint(image_bgr, mask, radius, cv2.INPAINT_NS)
    removed = cv2.inpaint(removed, mask, max(3, radius - 1), cv2.INPAINT_TELEA)
    return removed, "opencv"


def main():
    payload = read_payload()
    action = (payload.get("action") or "").strip().lower()
    image_path = payload.get("imagePath")

    if not image_path or not os.path.exists(image_path):
        fail("imagePath does not exist")

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        fail("Cannot read image")

    points = payload.get("points") or []
    if not isinstance(points, list):
        fail("points must be an array")

    refined = refine_polygon(image, points)

    if action == "refine":
        print(json.dumps(refined))
        return

    if action == "remove":
        output_path = payload.get("outputPath")
        if not output_path:
            fail("outputPath is required for remove")
        removed, inpaint_engine = remove_object(image, refined.get("points") or points)
        ok = cv2.imwrite(output_path, removed)
        if not ok:
            fail("Failed to write output image")
        print(json.dumps({
            "success": True,
            "mode": refined.get("mode", "lasso"),
            "points": refined.get("points", points),
            "outputPath": output_path,
            "pixelArea": refined.get("pixelArea", 0),
            "inpaintEngine": inpaint_engine
        }))
        return

    fail("Unknown action")


if __name__ == "__main__":
    main()
