const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const util = require('util');

const execFilePromise = util.promisify(execFile);

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

const BACKEND_ROOT = path.resolve(__dirname, '..');
const configuredUploadDir = process.env.UPLOAD_FOLDER || 'uploads';
const UPLOAD_DIR = path.isAbsolute(configuredUploadDir)
  ? configuredUploadDir
  : path.join(BACKEND_ROOT, configuredUploadDir);
const EDITS_DIR = path.join(UPLOAD_DIR, 'edits');
const PRESETS_DIR = path.join(BACKEND_ROOT, 'presets');
const RAW_FORMATS = ['.arw', '.nef', '.cr2', '.cr3', '.dng', '.raf', '.orf', '.rw2', '.srw', '.x3f'];
const GUEST_SCOPE = 'guest';
const COLOR_ZONES = [
  { key: 'red', center: 0, width: 35 },
  { key: 'orange', center: 30, width: 30 },
  { key: 'yellow', center: 55, width: 30 },
  { key: 'green', center: 120, width: 40 },
  { key: 'aqua', center: 180, width: 35 },
  { key: 'blue', center: 220, width: 35 },
  { key: 'purple', center: 275, width: 35 },
  { key: 'magenta', center: 320, width: 35 }
];

// Cache for RAW to JPG conversions (filename -> preview URL)
const RAW_CONVERSION_CACHE = new Map();

// Ensure directories exist
const ensureDirs = async () => {
  try {
    await fs.mkdir(EDITS_DIR, { recursive: true });
    await fs.mkdir(PRESETS_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
};

ensureDirs();

class ImageProcessor {
  static getUserScope(userId) {
    return userId || GUEST_SCOPE;
  }

  static isEditsEmpty(edits) {
    if (!edits || typeof edits !== 'object') return true;
    return Object.keys(edits).length === 0;
  }

  static getEditsFilePath(filename, userId) {
    const scope = this.getUserScope(userId);
    return path.join(EDITS_DIR, `${scope}__${filename}.json`);
  }

  static async getSavedEdits(filename, userId) {
    try {
      const editsFile = this.getEditsFilePath(filename, userId);
      const editsData = await fs.readFile(editsFile, 'utf-8');
      return JSON.parse(editsData);
    } catch {
      return {};
    }
  }

  static async resetGuestSession() {
    try {
      if (fsSync.existsSync(EDITS_DIR)) {
        const editFiles = await fs.readdir(EDITS_DIR);
        for (const file of editFiles) {
          if (file.startsWith(`${GUEST_SCOPE}__`) && file.endsWith('.json')) {
            await fs.unlink(path.join(EDITS_DIR, file)).catch(() => {});
          }
        }
      }

      if (fsSync.existsSync(PRESETS_DIR)) {
        const presetFiles = await fs.readdir(PRESETS_DIR);
        for (const file of presetFiles) {
          if (!file.endsWith('.json')) continue;
          const presetPath = path.join(PRESETS_DIR, file);
          try {
            const data = await fs.readFile(presetPath, 'utf-8');
            const preset = JSON.parse(data);
            if ((preset.ownerId || GUEST_SCOPE) === GUEST_SCOPE) {
              await fs.unlink(presetPath).catch(() => {});
            }
          } catch {
            // Ignore malformed preset files
          }
        }
      }

      return { success: true };
    } catch (error) {
      throw new Error(`Không reset được phiên guest: ${error.message}`);
    }
  }

  static async getEffectiveEdits(filename, edits, userId) {
    if (!this.isEditsEmpty(edits)) {
      return edits;
    }
    return this.getSavedEdits(filename, userId);
  }

  // Get image metadata
  static async getMetadata(filename) {
    try {
      const filePath = path.join(UPLOAD_DIR, filename);
      const ext = path.extname(filename).toLowerCase();
      const isRaw = RAW_FORMATS.includes(ext);
      
      console.log(`📷 Processing ${isRaw ? 'RAW' : 'Standard'} file: ${filename}`);

      let sharpMetadata = {};
      try {
        sharpMetadata = await sharp(filePath).metadata();
      } catch (sharpError) {
        console.warn(`⚠️ Sharp metadata fallback for ${ext}: ${sharpError.message}`);
      }

      let rawDetails = {};
      if (isRaw) {
        rawDetails = await this.getRawMetadataWithMagick(filePath);
      }

      const stats = await fs.stat(filePath);
      return {
        width: rawDetails.width || sharpMetadata.width || 0,
        height: rawDetails.height || sharpMetadata.height || 0,
        format: (rawDetails.format || sharpMetadata.format || ext.substring(1)).toString().toLowerCase(),
        space: sharpMetadata.space,
        hasAlpha: sharpMetadata.hasAlpha,
        orientation: sharpMetadata.orientation,
        isRaw,
        density: sharpMetadata.density,
        fileSize: stats.size,
        rawDetails
      };
    } catch (error) {
      console.error(`❌ Metadata error for ${filename}:`, error.message);
      throw new Error(`Lỗi khi lấy metadata: ${error.message}`);
    }
  }

  // Convert RAW to JPEG preview using histogram-based tone mapping (NEW - fixes black/unsupported formats)
  static async convertRawToJpgWithHistogram(filename) {
    try {
      const filePath = path.join(UPLOAD_DIR, filename);
      const ext = path.extname(filename).toLowerCase();
      
      if (!RAW_FORMATS.includes(ext)) {
        return null;
      }

      // Check cache first
      if (RAW_CONVERSION_CACHE.has(filename)) {
        console.log(`📦 RAW cached: ${filename}`);
        return RAW_CONVERSION_CACHE.get(filename);
      }

      console.log(`🎬 RAW Processing: ${filename} (${ext})`);

      // Use direct ImageMagick CLI first (most reliable on Windows + IM7)
      try {
        return await this.convertWithMagickCli(filename);
      } catch (err) {
        console.warn(`⚠️ magick CLI failed: ${err.message}`);
      }

      // Fallback: gm wrapper (may fail on Windows due convert.exe conflict)
      try {
        return await this.convertWithGM(filename);
      } catch (err) {
        console.warn(`⚠️ gm fallback failed: ${err.message}`);
      }

      // Final fallback: Sharp (limited RAW support)
      try {
        return await this.convertWithSharp(filename);
      } catch (err) {
        console.warn(`⚠️ sharp fallback failed: ${err.message}`);
      }

      // ImageMagick not available - show helpful error
      throw new Error(`
╔════════════════════════════════════════════════════════════════╗
║  RAW FILE SUPPORT REQUIRES IMAGEMAGICK                        ║
╚════════════════════════════════════════════════════════════════╝

File: ${filename}
Format: ${ext.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📥 INSTALLATION (Choose one method):

1️⃣  Windows - Official Installer (RECOMMENDED)
    ► Download: https://imagemagick.org/script/download.php#windows
    ► Double-click installer & complete setup
    ► Tick "Install ImageMagick for all users"
    ► Restart server after installation

2️⃣  Windows - Portable Version (No install needed)
    ► Download .zip from imagemagick.org
    ► Extract to: C:\\ImageMagick
    ► Add to PATH in VS Code terminal

3️⃣  Manual Chocolatey (needs admin)
    ► Open PowerShell as Admin
    ► Run: choco install imagemagick -y
    ► Wait for completion, restart server

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ GOOD NEWS: JPEG/PNG/TIFF still work perfectly!
   Your photo editor is ready for standard formats.

Questions? Check: https://imagemagick.org/script/index.php
      `);

    } catch (error) {
      console.error(`❌ RAW: ${error.message}`);
      throw error;
    }
  }

  // Try convert RAW using ImageMagick (gm library with ImageMagick mode)
  static async convertWithGM(filename) {
    return new Promise((resolve, reject) => {
      const gm = require('gm').subClass({ imageMagick: true });
      const filePath = path.join(UPLOAD_DIR, filename);
      const previewName = `raw-preview-${Date.now()}`;
      const jpgPath = path.join(EDITS_DIR, `${previewName}.jpg`);

      console.log(`  📐 ImageMagick: processing...`);

      gm(filePath)
        .autoOrient()  // Fix rotation
        .quality(95)
        .write(jpgPath, (err) => {
          if (err) {
            reject(new Error(`ImageMagick conversion failed: ${err.message}`));
            return;
          }

          try {
            const jpgStats = fsSync.statSync(jpgPath);
            console.log(`✓ ImageMagick converted: ${(jpgStats.size / 1024 / 1024).toFixed(2)}MB`);

            const previewUrl = `/uploads/edits/${previewName}.jpg`;
            RAW_CONVERSION_CACHE.set(filename, previewUrl);
            resolve(previewUrl);
          } catch (e) {
            reject(e);
          }
        });
    });
  }

  // Convert RAW using ImageMagick CLI directly
  static async convertWithMagickCli(filename) {
    const filePath = path.join(UPLOAD_DIR, filename);
    const previewName = `raw-preview-${Date.now()}`;
    const jpgPath = path.join(EDITS_DIR, `${previewName}.jpg`);

    console.log(`  📐 ImageMagick CLI: processing...`);

    try {
      await execFilePromise('magick', [
        filePath,
        '-auto-orient',
        '-quality',
        '95',
        jpgPath
      ], { windowsHide: true });
    } catch (error) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const stdout = error?.stdout ? String(error.stdout).trim() : '';
      const details = stderr || stdout || error.message;
      throw new Error(`magick conversion failed: ${details}`);
    }

    if (!fsSync.existsSync(jpgPath)) {
      throw new Error('magick conversion failed: output file not created');
    }

    const jpgStats = fsSync.statSync(jpgPath);
    if (!jpgStats.size) {
      throw new Error('magick conversion failed: output file is empty');
    }

    console.log(`✓ ImageMagick CLI converted: ${(jpgStats.size / 1024 / 1024).toFixed(2)}MB`);

    const previewUrl = `/uploads/edits/${previewName}.jpg`;
    RAW_CONVERSION_CACHE.set(filename, previewUrl);
    return previewUrl;
  }

  // Try convert RAW using Sharp's limited support
  static async convertWithSharp(filename) {
    const filePath = path.join(UPLOAD_DIR, filename);
    const previewName = `raw-preview-${Date.now()}`;
    const jpgPath = path.join(EDITS_DIR, `${previewName}.jpg`);

    console.log(`  📐 Sharp: processing...`);

    let image = sharp(filePath);
    await image
      .rotate()
      .jpeg({ quality: 95, progressive: true })
      .toFile(jpgPath);

    const jpgStats = fsSync.statSync(jpgPath);
    console.log(`✓ Sharp converted: ${(jpgStats.size / 1024 / 1024).toFixed(2)}MB`);

    const previewUrl = `/uploads/edits/${previewName}.jpg`;
    RAW_CONVERSION_CACHE.set(filename, previewUrl);
    return previewUrl;
  }

  // Deprecated: FFmpeg RAW support is unreliable, use dcraw instead
  static async convertRawToJpgWithFFmpeg(filename) {
    throw new Error(`FFmpeg RAW support removed. Using dcraw instead.`);
  }

  // Convert RAW to JPEG preview using FFmpeg (optimized) - KEPT FOR REFERENCE
  static async convertRawToJpg(filename) {
    // Now routes to the new histogram-based method
    return await this.convertRawToJpgWithHistogram(filename);
  }

  static cleanMagickValue(value = '') {
    const cleaned = String(value).trim();
    if (!cleaned || cleaned === '(null)' || cleaned.includes('%[')) {
      return '';
    }
    return cleaned;
  }

  static parseScientificNumber(value) {
    const cleaned = this.cleanMagickValue(value).replace(/[^\deE+\-.]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  static normalizeFraction(value) {
    const cleaned = this.cleanMagickValue(value);
    if (!cleaned) return '';
    const fractionMatch = cleaned.match(/^\s*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?(?:e[+\-]?\d+)?)\s*$/i);
    if (!fractionMatch) return cleaned;
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return cleaned;
    }
    return `${Math.round(numerator)}/${Math.round(denominator)}`;
  }

  static toPathFromUploadUrl(uploadUrl) {
    const relative = uploadUrl.replace('/uploads/', '').replace(/\//g, path.sep);
    return path.join(UPLOAD_DIR, relative);
  }

  static async resolvePreviewSourcePath(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (RAW_FORMATS.includes(ext)) {
      const previewUrl = await this.convertRawToJpg(filename);
      return this.toPathFromUploadUrl(previewUrl);
    }
    return path.join(UPLOAD_DIR, filename);
  }

  static hasSelectiveColorEdits(edits = {}) {
    const zones = edits?.colorZones || {};
    return Object.values(zones).some((zone) => {
      const h = Number(zone?.h || 0);
      const s = Number(zone?.s || 0);
      const l = Number(zone?.l || 0);
      return h !== 0 || s !== 0 || l !== 0;
    });
  }

  static hueDistance(a, b) {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  static rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let h = 0;
    const l = (max + min) / 2;
    let s = 0;

    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      switch (max) {
        case rn:
          h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
          break;
        case gn:
          h = ((bn - rn) / delta + 2) * 60;
          break;
        default:
          h = ((rn - gn) / delta + 4) * 60;
          break;
      }
    }

    return { h, s, l };
  }

  static hslToRgb(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hue < 60) {
      r1 = c; g1 = x;
    } else if (hue < 120) {
      r1 = x; g1 = c;
    } else if (hue < 180) {
      g1 = c; b1 = x;
    } else if (hue < 240) {
      g1 = x; b1 = c;
    } else if (hue < 300) {
      r1 = x; b1 = c;
    } else {
      r1 = c; b1 = x;
    }

    return [
      Math.round((r1 + m) * 255),
      Math.round((g1 + m) * 255),
      Math.round((b1 + m) * 255)
    ];
  }

  static async applySelectiveColorZones(image, edits = {}) {
    const mode = String(edits.colorMode || 'color').toLowerCase();
    if (mode === 'bw' || mode === 'b&w') {
      return image.grayscale();
    }

    if (!this.hasSelectiveColorEdits(edits)) {
      return image;
    }

    const zoneEdits = edits.colorZones || {};
    const activeZones = COLOR_ZONES
      .map((zone) => {
        const z = zoneEdits[zone.key] || {};
        const h = Number(z.h || 0);
        const s = Number(z.s || 0);
        const l = Number(z.l || 0);
        return { ...zone, h, s, l, active: h !== 0 || s !== 0 || l !== 0 };
      })
      .filter((zone) => zone.active);

    if (!activeZones.length) {
      return image;
    }

    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.from(data);

    for (let i = 0; i < out.length; i += info.channels) {
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];

      const hsl = this.rgbToHsl(r, g, b);
      let hueDelta = 0;
      let satDelta = 0;
      let lumDelta = 0;

      for (const zone of activeZones) {
        const dist = this.hueDistance(hsl.h, zone.center);
        if (dist > zone.width) continue;

        const weight = 1 - (dist / zone.width);
        hueDelta += zone.h * weight;
        satDelta += zone.s * weight;
        lumDelta += zone.l * weight;
      }

      if (hueDelta === 0 && satDelta === 0 && lumDelta === 0) continue;

      const nh = hsl.h + hueDelta;
      const ns = Math.min(1, Math.max(0, hsl.s * (1 + satDelta / 100)));
      const nl = Math.min(1, Math.max(0, hsl.l + (lumDelta / 100) * 0.35));
      const [nr, ng, nb] = this.hslToRgb(nh, ns, nl);

      out[i] = nr;
      out[i + 1] = ng;
      out[i + 2] = nb;
    }

    return sharp(out, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels
      }
    });
  }

  static async applyAdjustments(image, edits = {}) {
    const num = (v, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const brightness = num(edits.brightness);
    const contrast = num(edits.contrast);
    const saturation = num(edits.saturation);
    const hue = num(edits.hue);
    const temperature = num(edits.temperature);
    const tint = num(edits.tint);
    const colorH = num(edits.colorH);
    const colorS = num(edits.colorS);
    const colorL = num(edits.colorL);
    const highlights = num(edits.highlights);
    const shadows = num(edits.shadows);
    const whites = num(edits.whites);
    const blacks = num(edits.blacks);
    const clarity = num(edits.clarity);
    const dehaze = num(edits.dehaze);
    const vibrance = num(edits.vibrance);
    const blur = num(edits.blur);
    const sharpen = num(edits.sharpen);
    const rotate = num(edits.rotate);
    const gamma = num(edits.gamma, 1);

    if (temperature || tint) {
      const warm = temperature / 100;
      const tintShift = tint / 100;
      image = image.recomb([
        [1 + warm * 0.18 + tintShift * 0.03, 0, 0],
        [0, 1 - Math.abs(warm) * 0.02 + tintShift * 0.06, 0],
        [0, 0, 1 - warm * 0.18 - tintShift * 0.03]
      ]);
    }

    const brightnessScale = 1 + (brightness / 115) + (colorL / 220) + (shadows / 320) + (whites / 300) - (blacks / 340);
    const saturationScale = Math.max(0, 1 + (saturation / 105) + (vibrance / 145) + (colorS / 175));
    const hueShift = Math.round(hue + colorH + (temperature * 0.05) + (tint * 0.08));

    if (brightnessScale !== 1 || saturationScale !== 1 || hueShift !== 0) {
      image = image.modulate({
        brightness: Math.max(0.2, brightnessScale),
        saturation: Math.min(3.0, saturationScale),
        hue: hueShift
      });
    }

    if (contrast || clarity || dehaze || highlights || shadows || whites || blacks) {
      const contrastFactor = 1 + (contrast / 90) + (clarity / 320) + (dehaze / 280);
      const offset = 128 * (1 - contrastFactor) + (highlights * -0.35) + (shadows * 0.25) + (whites * 0.2) + (blacks * -0.2);
      image = image.linear(contrastFactor, offset);
    }

    if (highlights > 0) {
      image = image.gamma(1 + (highlights / 450));
    } else if (highlights < 0) {
      image = image.gamma(Math.max(0.6, 1 + (highlights / 550)));
    }

    if (blur > 0) {
      image = image.blur(Math.max(0.3, blur / 15));
    }

    if (sharpen > 0 || clarity > 0) {
      const sigma = Math.max(0.3, sharpen / 25 + clarity / 90);
      const m1 = 1 + (sharpen / 110) + (clarity / 220);
      image = image.sharpen({ sigma, m1 });
    }

    if (gamma && gamma !== 1) {
      const safeGamma = Math.min(3, Math.max(1, gamma));
      if (safeGamma !== 1) {
        image = image.gamma(safeGamma);
      }
    }

    if (rotate) {
      image = image.rotate(rotate);
    }

    if (edits.flipH) image = image.flop();
    if (edits.flipV) image = image.flip();

    if (edits.crop) {
      image = image.extract(edits.crop);
    }

    image = await this.applySelectiveColorZones(image, edits);

    return image;
  }

  static async getRawMetadataWithMagick(filePath) {
    try {
      const { stdout } = await execFilePromise('magick', ['identify', '-verbose', filePath], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
      const text = String(stdout || '');

      const getTag = (...keys) => {
        for (const key of keys) {
          const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\s*:\\s*(.+)`, 'i');
          const match = text.match(regex);
          if (match) {
            const value = this.cleanMagickValue(match[1]);
            if (value) return value;
          }
        }
        return '';
      };

      const make = getTag('dng:make', 'exif:Make');
      const model = getTag('dng:camera.model.name', 'exif:Model');
      const rawDate = getTag('dng:create.date', 'exif:DateTimeOriginal', 'date:create');
      const isoRaw = getTag('dng:iso.setting', 'exif:ISOSpeedRatings');
      const exposureRaw = getTag('dng:exposure.time', 'exif:ExposureTime');
      const focalLengthRaw = getTag('dng:focal.length.in.35mm.format', 'dng:focal.length', 'exif:FocalLength');
      const lens = getTag('dng:lens', 'exif:LensModel');
      const lensMake = getTag('dng:lens.make', 'exif:LensMake');
      const serial = getTag('dng:camera.serial.number', 'exif:BodySerialNumber');
      const width = this.parseScientificNumber(getTag('Geometry'));

      const apertureFromLens = (lens.match(/f\/(\d+(?:\.\d+)?)/i) || [])[1] || '';
      const aperture = apertureFromLens || this.cleanMagickValue(getTag('dng:max.aperture.at.min.focal', 'exif:FNumber'));
      const iso = this.parseScientificNumber(isoRaw);

      const widthHeightMatch = text.match(/\bGeometry:\s*(\d+)x(\d+)/i);
      const imageWidth = widthHeightMatch ? Number(widthHeightMatch[1]) : 0;
      const imageHeight = widthHeightMatch ? Number(widthHeightMatch[2]) : 0;

      return {
        cameraMaker: make,
        cameraModel: model,
        dateTaken: rawDate,
        iso: iso || this.cleanMagickValue(isoRaw),
        fStop: aperture ? `f/${String(aperture).replace(/^f\//i, '')}` : '',
        exposureTime: this.normalizeFraction(exposureRaw),
        exposureProgram: this.cleanMagickValue(getTag('exif:ExposureProgram')),
        exposureBias: this.cleanMagickValue(getTag('exif:ExposureBiasValue')),
        meteringMode: this.cleanMagickValue(getTag('exif:MeteringMode')),
        flashMode: this.cleanMagickValue(getTag('exif:Flash')),
        focalLength: this.cleanMagickValue(focalLengthRaw),
        lensMaker: lensMake,
        lensModel: lens,
        serialNumber: serial,
        width: imageWidth,
        height: imageHeight,
        format: this.cleanMagickValue(getTag('Format')).split(' ')[0]
      };
    } catch (error) {
      console.warn(`⚠️ RAW metadata via magick failed: ${error.message}`);
      return {};
    }
  }

  // Apply edits to image
  static async applyEdits(filename, edits = {}, userId = null) {
    try {
      const resolvedEdits = await this.getEffectiveEdits(filename, edits, userId);
      const sourcePath = await this.resolvePreviewSourcePath(filename);
      let image = sharp(sourcePath);
      image = await this.applyAdjustments(image, resolvedEdits);

      const metadata = await image.metadata();
      return {
        success: true,
        width: metadata.width,
        height: metadata.height
      };
    } catch (error) {
      throw new Error(`Lỗi khi áp dụng chỉnh sửa: ${error.message}`);
    }
  }

  // Generate preview
  static async generatePreview(filename, edits = {}, userId = null) {
    try {
      const ext = path.extname(filename).toLowerCase();
      const isRaw = RAW_FORMATS.includes(ext);

      console.log(`🎬 Generating preview for: ${filename} (${isRaw ? 'RAW' : 'Standard'})`);

      const previewName = `preview-${Date.now()}.jpg`;
      const previewPath = path.join(EDITS_DIR, previewName);
      const sourcePath = await this.resolvePreviewSourcePath(filename);
      const resolvedEdits = await this.getEffectiveEdits(filename, edits, userId);
      let image = sharp(sourcePath);
      image = await this.applyAdjustments(image, resolvedEdits);

      // NO RESIZE - Keep full resolution
      // Resize to preview size
      // image = image.resize(900, 900, { fit: 'inside', withoutEnlargement: true });

      // Convert to JPEG for preview (high quality, full resolution)
      await image.jpeg({ quality: 85 }).toFile(previewPath);
      
      console.log(`✓ Preview saved: ${previewPath}`);

      return `/uploads/edits/${previewName}`;
    } catch (error) {
      console.error(`❌ Preview generation error for ${filename}:`, error.message);
      throw new Error(`Lỗi tạo preview: ${error.message}`);
    }
  }

  // Save edits (auto-save)
  static async saveEdits(filename, edits, userId = null) {
    try {
      const editsFile = this.getEditsFilePath(filename, userId);
      await fs.writeFile(editsFile, JSON.stringify(edits, null, 2));
      return {
        success: true,
        message: 'Đã lưu thay đổi',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Lỗi khi lưu chỉnh sửa: ${error.message}`);
    }
  }

  // Export image
  static async exportImage(filename, format, quality = 90, ppi = 300, userId = null) {
    try {
      const edits = await this.getSavedEdits(filename, userId);

      const sourcePath = await this.resolvePreviewSourcePath(filename);
      let image = sharp(sourcePath);
      image = await this.applyAdjustments(image, edits);

      // Export with selected format
      const exportFileName = `export-${Date.now()}.${format.toLowerCase()}`;
      const exportPath = path.join(EDITS_DIR, exportFileName);

      if (format.toLowerCase() === 'jpeg' || format.toLowerCase() === 'jpg') {
        await image.jpeg({ quality: parseInt(quality), density: ppi }).toFile(exportPath);
      } else if (format.toLowerCase() === 'png') {
        await image.png({ density: ppi }).toFile(exportPath);
      } else if (format.toLowerCase() === 'tiff' || format.toLowerCase() === 'tif') {
        await image.tiff({ density: ppi }).toFile(exportPath);
      } else if (format.toLowerCase() === 'webp') {
        await image.webp({ quality: parseInt(quality) }).toFile(exportPath);
      }

      const stats = await fs.stat(exportPath);
      const fileSizeKB = (stats.size / 1024).toFixed(2);

      return {
        success: true,
        exportPath: `/uploads/edits/${exportFileName}`,
        fileSize: `${fileSizeKB} KB`,
        format: format.toUpperCase()
      };
    } catch (error) {
      throw new Error(`Lỗi khi xuất ảnh: ${error.message}`);
    }
  }

  // Get presets
  static async getPresets(userId = null) {
    try {
      const files = await fs.readdir(PRESETS_DIR);
      const presets = [];
      const scope = this.getUserScope(userId);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = await fs.readFile(path.join(PRESETS_DIR, file), 'utf-8');
          const preset = JSON.parse(data);
          if ((preset.ownerId || GUEST_SCOPE) === scope) {
            presets.push(preset);
          }
        }
      }

      return presets;
    } catch (error) {
      console.error('Lỗi khi lấy presets:', error);
      return [];
    }
  }

  // Save preset (new or overwrite existing)
  static async savePreset(name, settings, presetId = null, userId = null) {
    try {
      const now = new Date().toISOString();
      let preset = null;
      const scope = this.getUserScope(userId);

      if (presetId) {
        const existingFile = path.join(PRESETS_DIR, `${presetId}.json`);
        if (fsSync.existsSync(existingFile)) {
          const existingData = await fs.readFile(existingFile, 'utf-8');
          const existing = JSON.parse(existingData);
          if ((existing.ownerId || GUEST_SCOPE) !== scope) {
            throw new Error('Bạn không có quyền ghi đè preset này');
          }
          preset = {
            ...existing,
            id: existing.id || presetId,
            name: name || existing.name,
            settings,
            updatedAt: now
          };
        }
      }

      if (!preset) {
        preset = {
          id: uuidv4(),
          name,
          ownerId: scope,
          settings,
          createdAt: now,
          updatedAt: now
        };
      }

      const presetFile = path.join(PRESETS_DIR, `${preset.id}.json`);
      await fs.writeFile(presetFile, JSON.stringify(preset, null, 2));

      return preset;
    } catch (error) {
      throw new Error(`Lỗi khi lưu preset: ${error.message}`);
    }
  }

  // Estimate file size
  static estimateFileSize(width, height, quality = 90) {
    // Simple estimation (bytes)
    const pixels = width * height;
    const bytesPerPixel = 3; // RGB
    const uncompressed = pixels * bytesPerPixel;
    const compressionRatio = (100 - quality) / 50 + 0.5;
    
    return Math.round(uncompressed / compressionRatio / 1024);
  }

  // Get histogram data from image
  static async getHistogram(filename, edits = {}, userId = null) {
    try {
      const sourcePath = await this.resolvePreviewSourcePath(filename);
      const resolvedEdits = await this.getEffectiveEdits(filename, edits, userId);
      let image = sharp(sourcePath).resize(1400, 1400, { fit: 'inside', withoutEnlargement: true });
      image = await this.applyAdjustments(image, resolvedEdits);

      // Get image as raw buffer
      const pixelData = await image.raw().toBuffer({ resolveWithObject: true });
      const { data, info } = pixelData;
      const { channels } = info;

      // Compute histogram
      const histogram = new Array(256).fill(0);
      
      // Process each pixel
      for (let i = 0; i < data.length; i += channels) {
        // Calculate luminance from RGB channels
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Luminance = 0.299R + 0.587G + 0.114B
        const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        histogram[luminance]++;
      }

      // Normalize histogram
      const maxValue = Math.max(...histogram);
      const normalizedHistogram = histogram.map(v => Math.round((v / maxValue) * 100));

      return normalizedHistogram;
    } catch (error) {
      console.error(`❌ Histogram error: ${error.message}`);
      // Return default histogram on error
      return new Array(256).fill(50);
    }
  }
}

module.exports = ImageProcessor;
