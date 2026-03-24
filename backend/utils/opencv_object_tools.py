import json
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import SamModel, SamProcessor


SAM_MODEL_ID = os.environ.get("SAM_MODEL_ID", "nielsr/slimsam-50-uniform")
SAM_DEVICE = "cpu"
_SAM_PROCESSOR = None
_SAM_MODEL = None


def _compute_mask_bbox(mask, padding=0):
    ys, xs = np.where(mask > 0)
    if xs.size == 0 or ys.size == 0:
        return None

    x0 = max(0, int(xs.min()) - int(padding))
    y0 = max(0, int(ys.min()) - int(padding))
    x1 = min(mask.shape[1], int(xs.max()) + 1 + int(padding))
    y1 = min(mask.shape[0], int(ys.max()) + 1 + int(padding))
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def _create_feature_detector(method):
    m = (method or "").strip().lower()
    if m == "surf":
        if hasattr(cv2, "xfeatures2d") and hasattr(cv2.xfeatures2d, "SURF_create"):
            return cv2.xfeatures2d.SURF_create(hessianThreshold=350)
        return None
    if m == "sift":
        if hasattr(cv2, "SIFT_create"):
            return cv2.SIFT_create(nfeatures=1800)
        return None
    if m == "orb":
        if hasattr(cv2, "ORB_create"):
            return cv2.ORB_create(nfeatures=2200, scaleFactor=1.2, nlevels=8)
        return None
    return None


def _compute_context_mask(mask):
    outer = cv2.dilate(mask, np.ones((17, 17), np.uint8), iterations=1)
    inner = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=1)
    ring = cv2.subtract(outer, inner)
    return (ring > 0).astype(np.uint8) * 255


def _clip_bbox(x0, y0, x1, y1, w, h):
    x0 = max(0, min(w, int(x0)))
    y0 = max(0, min(h, int(y0)))
    x1 = max(0, min(w, int(x1)))
    y1 = max(0, min(h, int(y1)))
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def _estimate_translation_from_matches(matches, kps_ctx, kps_src):
    if len(matches) < 6:
        return None

    deltas = []
    for m in matches:
        p_ctx = kps_ctx[m.queryIdx].pt
        p_src = kps_src[m.trainIdx].pt
        deltas.append((p_src[0] - p_ctx[0], p_src[1] - p_ctx[1]))

    if not deltas:
        return None

    dx = float(np.median([d[0] for d in deltas]))
    dy = float(np.median([d[1] for d in deltas]))
    return dx, dy


def _pick_nearest_valid_source_bbox(matches, kps_ctx, kps_src, mask, target_bbox, w, h):
    x0, y0, x1, y1 = target_bbox
    bw = x1 - x0
    bh = y1 - y0
    if bw <= 0 or bh <= 0:
        return None

    max_search_dist = float(max(24, int(max(bw, bh) * 2.2)))
    candidates = []

    for m in matches:
        try:
            p_ctx = kps_ctx[m.queryIdx].pt
            p_src = kps_src[m.trainIdx].pt
        except Exception:
            continue

        dx = float(p_src[0] - p_ctx[0])
        dy = float(p_src[1] - p_ctx[1])
        dist = float(np.hypot(dx, dy))
        if dist > max_search_dist:
            continue

        src_bbox = _clip_bbox(x0 + dx, y0 + dy, x1 + dx, y1 + dy, w, h)
        if src_bbox is None:
            continue

        sx0, sy0, sx1, sy1 = src_bbox
        if (sx1 - sx0) != bw or (sy1 - sy0) != bh:
            continue

        overlap = np.count_nonzero(mask[sy0:sy1, sx0:sx1] > 0)
        overlap_ratio = float(overlap) / float(max(1, bw * bh))
        if overlap_ratio > 0.02:
            continue

        quality = float(getattr(m, "distance", 1.0))
        candidates.append((dist, overlap_ratio, quality, src_bbox))

    if not candidates:
        return None

    # Prefer spatially nearest region first; then lower overlap and better descriptor score.
    candidates.sort(key=lambda c: (c[0], c[1], c[2]))
    return candidates[0][3]


def _feature_copy_fill(image_bgr, mask, method):
    h, w = image_bgr.shape[:2]
    bbox = _compute_mask_bbox(mask, padding=0)
    if bbox is None:
        return None

    detector = _create_feature_detector(method)
    if detector is None:
        return None

    x0, y0, x1, y1 = bbox
    bw = x1 - x0
    bh = y1 - y0
    if bw < 6 or bh < 6:
        return None

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    context_mask = _compute_context_mask(mask)
    source_mask = (mask == 0).astype(np.uint8) * 255

    kps_ctx, desc_ctx = detector.detectAndCompute(gray, context_mask)
    kps_src, desc_src = detector.detectAndCompute(gray, source_mask)

    if desc_ctx is None or desc_src is None or len(kps_ctx) < 8 or len(kps_src) < 20:
        return None

    if method == "orb":
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        raw_matches = matcher.match(desc_ctx, desc_src)
        raw_matches = sorted(raw_matches, key=lambda m: m.distance)
        good_matches = raw_matches[: min(120, len(raw_matches))]
    else:
        matcher = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
        knn = matcher.knnMatch(desc_ctx, desc_src, k=2)
        good_matches = []
        for pair in knn:
            if len(pair) < 2:
                continue
            m, n = pair
            if m.distance < 0.76 * n.distance:
                good_matches.append(m)
        good_matches = sorted(good_matches, key=lambda m: m.distance)[:120]

    src_bbox = _pick_nearest_valid_source_bbox(good_matches, kps_ctx, kps_src, mask, (x0, y0, x1, y1), w, h)
    if src_bbox is None:
        shift = _estimate_translation_from_matches(good_matches, kps_ctx, kps_src)
        if shift is None:
            return None
        dx, dy = shift
        src_bbox = _clip_bbox(x0 + dx, y0 + dy, x1 + dx, y1 + dy, w, h)
        if src_bbox is None:
            return None

    sx0, sy0, sx1, sy1 = src_bbox
    if (sx1 - sx0) != bw or (sy1 - sy0) != bh:
        return None

    source_overlap = np.count_nonzero(mask[sy0:sy1, sx0:sx1] > 0)
    if source_overlap > int(0.02 * bw * bh):
        return None

    out = image_bgr.copy()
    source_patch = image_bgr[sy0:sy1, sx0:sx1]
    target_mask = mask[y0:y1, x0:x1]

    feather = cv2.GaussianBlur(target_mask, (0, 0), sigmaX=2.0, sigmaY=2.0)
    alpha = (feather.astype(np.float32) / 255.0)[..., None]
    target_patch = out[y0:y1, x0:x1].astype(np.float32)
    source_patch_f = source_patch.astype(np.float32)
    blended = target_patch * (1.0 - alpha) + source_patch_f * alpha
    out[y0:y1, x0:x1] = np.clip(blended, 0, 255).astype(np.uint8)
    return out


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


def parse_payload(raw):
    if not raw:
        raise ValueError("No payload")
    try:
        return json.loads(raw)
    except Exception as exc:
        raise ValueError(f"Invalid JSON payload: {exc}")


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

    # Fast local-feature fill (SURF/SIFT/ORB) before OpenCV inpaint fallback.
    for method in ("surf", "sift", "orb"):
        try:
            feature_out = _feature_copy_fill(image_bgr, mask, method)
            if feature_out is not None:
                return feature_out, f"feature-{method}"
        except Exception:
            continue

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
    result = process_payload(payload)
    print(json.dumps(result))


def process_payload(payload):
    action = (payload.get("action") or "").strip().lower()
    image_path = payload.get("imagePath")

    if not image_path or not os.path.exists(image_path):
        raise ValueError("imagePath does not exist")

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Cannot read image")

    points = payload.get("points") or []
    if not isinstance(points, list):
        raise ValueError("points must be an array")

    if action == "refine":
        refined = refine_polygon(image, points)
        return refined

    if action == "remove":
        output_path = payload.get("outputPath")
        if not output_path:
            raise ValueError("outputPath is required for remove")

        # Performance: do not run SAM refine again in remove step.
        # Frontend already sends refined points when available.
        remove_points = points
        removed, inpaint_engine = remove_object(image, remove_points)
        points_px = points_to_pixels(remove_points, image.shape[1], image.shape[0]) if isinstance(remove_points, list) else np.array([], dtype=np.int32)
        pixel_area = area_of_polygon(points_px) if len(points_px) >= 3 else 0.0
        mode = (payload.get("mode") or "lasso").strip().lower()
        if mode not in {"lasso", "refined"}:
            mode = "lasso"

        ok = cv2.imwrite(output_path, removed)
        if not ok:
            raise RuntimeError("Failed to write output image")
        return {
            "success": True,
            "mode": mode,
            "points": remove_points,
            "outputPath": output_path,
            "pixelArea": pixel_area,
            "inpaintEngine": inpaint_engine
        }

    raise ValueError("Unknown action")


def run_stdio_server():
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue

        try:
            payload = parse_payload(line)
            result = process_payload(payload)
            print(json.dumps(result), flush=True)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}), flush=True)

if __name__ == "__main__":
    if "--stdio-server" in sys.argv:
        run_stdio_server()
    else:
        main()
