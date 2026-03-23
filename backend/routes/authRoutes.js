const express = require('express');
const router = express.Router();
const authStore = require('../utils/authStore');
const { requireAuth } = require('../middleware/auth');
const imageProcessor = require('../utils/imageProcessor');

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const result = await authStore.registerUser({ name, email, password });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authStore.loginUser({ email, password });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ success: true, user: req.user });
});

router.get('/workspace', requireAuth, async (req, res) => {
  try {
    const workspace = await authStore.getWorkspace(req.user.id);
    res.json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/workspace', requireAuth, async (req, res) => {
  try {
    const workspace = await authStore.saveWorkspace(req.user.id, req.body || {});
    res.json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/guest/reset', async (req, res) => {
  try {
    await imageProcessor.resetGuestSession();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
