const express = require('express');
const router = express.Router();
const imageProcessor = require('../utils/imageProcessor');

// Get image metadata
router.get('/metadata/:filename', async (req, res) => {
  try {
    const metadata = await imageProcessor.getMetadata(req.params.filename);
    res.json(metadata);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply edits to image
router.post('/edit', async (req, res) => {
  try {
    const { filename, edits } = req.body;
    const result = await imageProcessor.applyEdits(filename, edits, req.user?.id);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get preview of edited image
router.post('/preview', async (req, res) => {
  try {
    const { filename, edits } = req.body;
    console.log(`📸 Preview request for: ${filename}`);
    
    const previewPath = await imageProcessor.generatePreview(filename, edits, req.user?.id);
    console.log(`✓ Returning preview: ${previewPath}`);
    
    res.json({ previewPath });
  } catch (error) {
    console.error(`❌ Preview error: ${error.message}`);
    const { filename } = req.body;
    // Fallback: return original file path if it's a standard format
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    const standardFormats = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif'];
    
    if (standardFormats.includes(ext)) {
      console.log(`⚠️ Fallback to original: ${filename}`);
      return res.json({ previewPath: `/uploads/${filename}` });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Save edits
router.post('/save-edit', async (req, res) => {
  try {
    const { filename, edits } = req.body;
    const saved = await imageProcessor.saveEdits(filename, edits, req.user?.id);
    res.json({ success: true, saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get saved edits by filename
router.get('/edit/:filename', async (req, res) => {
  try {
    const edits = await imageProcessor.getSavedEdits(req.params.filename, req.user?.id);
    res.json({ success: true, edits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export image
router.post('/export', async (req, res) => {
  try {
    const { filename, format, quality, ppi } = req.body;
    const result = await imageProcessor.exportImage(filename, format, quality, ppi, req.user?.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get preset filters
router.get('/presets', async (req, res) => {
  try {
    const presets = await imageProcessor.getPresets(req.user?.id);
    res.json(presets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get histogram data
router.get('/histogram/:filename', async (req, res) => {
  try {
    const histogram = await imageProcessor.getHistogram(req.params.filename, {}, req.user?.id);
    res.json({ histogram });
  } catch (error) {
    console.warn(`⚠️ Histogram generation failed:`, error.message);
    res.json({ histogram: new Array(256).fill(50) }); // Return placeholder on error
  }
});

// Get histogram data with live edits
router.post('/histogram', async (req, res) => {
  try {
    const { filename, edits } = req.body;
    const histogram = await imageProcessor.getHistogram(filename, edits || {}, req.user?.id);
    res.json({ histogram });
  } catch (error) {
    console.warn(`⚠️ Histogram generation failed:`, error.message);
    res.json({ histogram: new Array(256).fill(50) });
  }
});

// Save new preset
router.post('/preset/save', async (req, res) => {
  try {
    const { name, settings, presetId } = req.body;
    const preset = await imageProcessor.savePreset(name, settings, presetId, req.user?.id);
    res.json({ success: true, preset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
