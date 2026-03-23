const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const imageRoutes = require('./routes/imageRoutes');
const authRoutes = require('./routes/authRoutes');
const authStore = require('./utils/authStore');
const { optionalAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const configuredUploadDir = process.env.UPLOAD_FOLDER || 'uploads';
const uploadDir = path.isAbsolute(configuredUploadDir)
  ? configuredUploadDir
  : path.join(__dirname, configuredUploadDir);

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(optionalAuth);

// Serve frontend files
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.use('/uploads', express.static(uploadDir));

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600 }, // 100MB default
  fileFilter: (req, file, cb) => {
    // Hỗ trợ tất cả RAW formats từ các nhà máy ảnh
    const allowedFormats = /jpeg|jpg|png|tiff|tif|arw|nef|cr2|cr3|dng|raf|orf|rw2|srw|x3f|raw/i;
    const ext = path.extname(file.originalname);
    if (allowedFormats.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Định dạng file không hỗ trợ'));
    }
  }
});

// Routes
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không có file được upload' });
  }
  
  const fileExt = path.extname(req.file.originalname).toLowerCase();
  console.log(`✓ Upload: ${req.file.originalname} (${fileExt}) - ${Math.round(req.file.size / 1024 / 1024 * 100) / 100}MB`);

  if (req.user?.id) {
    authStore.appendWorkspaceImage(req.user.id, {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: `/uploads/${req.file.filename}`,
      uploadedAt: new Date().toISOString()
    }).catch((error) => {
      console.warn(`⚠️ Workspace save failed: ${error.message}`);
    });
  }
  
  res.json({
    success: true,
    filename: req.file.filename,
    originalName: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/image', imageRoutes);

// Serve preview/edits files with no-cache headers
app.get('/uploads/edits/:filename', (req, res) => {
  const filePath = path.join(uploadDir, 'edits', req.params.filename);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`❌ Error serving ${req.params.filename}:`, err.message);
      if (!res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
    }
  });
});

// Serve index.html cho root path
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Serve index.html cho các route khác (SPA support)
app.get('/edit*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'edit.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`❌ Error: ${err.message}`);
  
  // Handle Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    const maxSizeMB = Math.round(parseInt(process.env.MAX_FILE_SIZE || 104857600) / 1024 / 1024);
    return res.status(413).json({ 
      error: `File quá lớn. Tối đa ${maxSizeMB}MB`,
      maxSize: maxSizeMB
    });
  }
  
  // Handle Multer field name error
  if (err.code === 'LIMIT_FIELD_VALUE') {
    return res.status(413).json({ error: 'Dữ liệu trường quá lớn' });
  }
  
  // Handle Multer unexpected file error
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'File không hợp lệ' });
  }
  
  // Handle file format errors from fileFilter
  if (err.message && err.message.includes('Định dạng')) {
    return res.status(400).json({ error: err.message });
  }
  
  // Generic error
  res.status(err.status || 500).json({ 
    error: err.message || 'Lỗi server',
    code: err.code
  });
});

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});
