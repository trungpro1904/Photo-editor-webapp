# Photo Editor Web Application

Ứng dụng web chỉnh sửa ảnh chuyên nghiệp với hỗ trợ các định dạng RAW từ các nhà máy ảnh.

## Tính năng

### 🖼️ Giao diện Preview
- Tải lên nhiều ảnh cùng một lúc
- Xem trước nhanh (thumbnail)
- Thông tin ảnh chi tiết (kích thước, định dạng, metadata)
- Xoay và lật ảnh nhanh
- Quản lý thư viện ảnh

### ✏️ Giao diện Chỉnh sửa
- **5 các loại chỉnh sửa chính:**
  - **Ảnh sáng**: Độ sáng, Độ tương phản, Gamma
  - **Màu sắc**: Độ bão hòa, Màu sắc (Hue)
  - **Hiệu ứng**: Mờ (Blur), Sắc nét (Sharpen)
  - **Chi tiết**: Điều chỉnh chi tiết ảnh
  - **Quang học**: Gamma, Rotation
- Điều chỉnh real-time với slider
- Bộ lọc sẵn có (presets)
- Lưu cài đặt hiện tại thành bộ lọc

### 💾 Auto-Save
- Tự động lưu thay đổi đến server
- Lịch sử chỉnh sửa
- Khôi phục thay đổi từ session trước

### 📤 Xuất ảnh
- Hỗ trợ định dạng: JPEG, PNG, TIFF
- Cấu hình chất lượng (50-100%)
- Cấu hình PPI (72-600)
- Dự kiến kích cỡ file
- Lựa chọn tên file và vị trí

### 🎥 Định dạng hỗ trợ
- **Thông thường**: JPG, PNG
- **RAW**: ARW (Sony), NEF (Nikon), CR2/CR3 (Canon), DNG (Adobe), TIFF

## Cấu trúc Dự án

```
photo-editor/
├── backend/
│   ├── server.js              # Server chính
│   ├── package.json           # Dependencies
│   ├── .env                   # Configuration
│   ├── routes/
│   │   └── imageRoutes.js     # API routes
│   ├── utils/
│   │   └── imageProcessor.js  # Image processing logic
│   ├── uploads/               # Uploaded images
│   └── presets/               # Saved filter presets
├── frontend/
│   ├── index.html             # Preview page
│   ├── edit.html              # Edit page
│   ├── css/
│   │   ├── style.css          # Preview styles
│   │   └── edit.css           # Edit styles
│   └── js/
│       ├── preview.js         # Preview page logic
│       └── edit.js            # Edit page logic
└── README.md
```

## Cài đặt & Chạy

### Backend Setup

1. **Cài đặt dependencies:**
```bash
cd backend
npm install
```

2. **Cấu hình environment (.env):**
```
PORT=5000
NODE_ENV=development
UPLOAD_FOLDER=./uploads
MAX_FILE_SIZE=52428800
```

3. **Chạy server:**
```bash
npm start
# hoặc (nếu dùng nodemon)
npm run dev
```

Server sẽ chạy tại: `http://localhost:5000`

### Frontend Setup

1. **Serving frontend (có 2 cách):**

   **Cách 1: Dùng HTTP Server đơn giản**
   ```bash
   cd frontend
   npx http-server
   ```

   **Cách 2: Mở trực tiếp file HTML**
   - Mở `frontend/index.html` trong trình duyệt

2. **Truy cập ứng dụng:**
   - Preview: `http://localhost:8080` (hoặc local port từ http-server)
   - Edit: Mở tự động khi bấm "Mở chỉnh sửa"

## Hướng dẫn Sử dụng

### Preview Window
1. Click "Chọn file ảnh" để chọn một hoặc nhiều ảnh
2. Click "Tải lên" để upload
3. Click ảnh trong danh sách để xem preview
4. Sử dụng các nút hành động:
   - **Mở chỉnh sửa**: Mở cửa sổ chỉnh sửa
   - **Xoay 90°**: Xoay ảnh
   - **Lật ngang**: Lật ảnh
   - **Xóa**: Xóa ảnh khỏi danh sách

### Edit Window
1. Sử dụng slider để điều chỉnh các thông số
2. Xem preview real-time ở giữa màn hình
3. Áp dụng bộ lọc sẵn từ dropdown
4. Lưu cài đặt hiện tại thành bộ lọc mới
5. Bấm "Xuất ảnh" để xuất với định dạng mong muốn

### Xuất Ảnh
1. Chọn định dạng (JPEG, PNG, TIFF)
2. Điều chỉnh chất lượng (%)
3. Điều chỉnh PPI
4. Xem dự kiến kích cỡ file
5. Nhập tên file
6. Click "Xuất"

## API Endpoints

### Upload Image
```
POST /api/upload
Content-Type: multipart/form-data
Body: file (binary)

Response:
{
  "success": true,
  "filename": "string",
  "originalName": "string",
  "path": "/uploads/filename"
}
```

### Get Metadata
```
GET /api/image/metadata/:filename

Response:
{
  "width": number,
  "height": number,
  "format": "string",
  "space": "string",
  "hasAlpha": boolean,
  "orientation": number
}
```

### Preview with Edits
```
POST /api/image/preview
Body: {
  "filename": "string",
  "edits": {
    "brightness": number,
    "contrast": number,
    "saturation": number,
    "hue": number,
    "sharpen": number,
    "blur": number,
    "gamma": number,
    "rotate": number,
    "flipH": boolean,
    "flipV": boolean
  }
}

Response:
{
  "previewPath": "/uploads/edits/preview-xxx.jpg"
}
```

### Save Edits (Auto-save)
```
POST /api/image/save-edit
Body: {
  "filename": "string",
  "edits": { ... }
}

Response:
{
  "success": true,
  "saved": boolean,
  "timestamp": "ISO string"
}
```

### Export Image
```
POST /api/image/export
Body: {
  "filename": "string",
  "format": "jpeg|png|tiff",
  "quality": 50-100,
  "ppi": 72-600
}

Response:
{
  "success": true,
  "exportPath": "/uploads/edits/export-xxx.jpg",
  "fileSize": "string",
  "format": "string"
}
```

### Get Presets
```
GET /api/image/presets

Response: [
  {
    "id": "uuid",
    "name": "string",
    "settings": { ... },
    "createdAt": "ISO string"
  }
]
```

### Save Preset
```
POST /api/image/preset/save
Body: {
  "name": "string",
  "settings": { ... }
}

Response:
{
  "success": true,
  "preset": { ... }
}
```

## Công nghệ Sử dụng

### Backend
- **Node.js** - Server runtime
- **Express.js** - Web framework
- **Sharp** - Image processing (hỗ trợ RAW, JPEG, PNG, TIFF, v.v.)
- **Multer** - File upload handling
- **CORS** - Cross-origin requests
- **Dotenv** - Environment configuration

### Frontend
- **HTML5** - Markup
- **CSS3** - Styling
- **Bootstrap 5** - UI framework
- **Vanilla JavaScript** - Interactivity
- **Fetch API** - API requests

## Lưu ý Kỹ Thuật

### Hỗ trợ RAW Format
- Sharp hỗ trợ đọc RAW files từ các nhà máy ảnh
- Output được chuyển đổi thành JPEG, PNG, hoặc TIFF
- Metadata EXIF được giữ lại

### Auto-save
- Thay đổi được lưu tự động sau 2 giây không chỉnh sửa
- Lưu vào file JSON trên server
- Khôi phục khi mở lại ảnh

### File Size Limit
- Mặc định: 50MB
- Có thể cấu hình trong `.env`

### Preview Generation
- Preview được resize về 900x900px
- Quality 80% để tiết kiệm dung lượng
- Được cache kỳ lạ trên server

## Troubleshooting

### Server không khởi động
- Kiểm tra port 5000 có được sử dụng không
- Kiểm tra file `.env` có tồn tại không
- Chạy `npm install` lại để cài đặt dependencies

### Upload thất bại
- Kiểm tra kích cỡ file (< 50MB)
- Kiểm tra định dạng file hỗ trợ
- Kiểm tra folder `uploads` có được tạo không

### Edit page không mở
- Kiểm tra trình duyệt có cho phép mở cửa sổ mới không
- Kiểm tra console có lỗi JavaScript không

### Chỉnh sửa không hiển thị
- Kiểm tra backend có đang chạy không
- Kiểm tra CORS được bật không
- Kiểm tra API endpoint có chính xác không

## Phát triển Tiếp theo

- [ ] Thêm crop tool
- [ ] Thêm color picker
- [ ] Batch processing
- [ ] Undo/Redo history
- [ ] Watermark
- [ ] Histogram viewer
- [ ] Comparison tool (before/after)
- [ ] Mobile responsive UI

## License

MIT

## Support

Nếu có vấn đề, vui lòng kiểm tra:
1. Console của trình duyệt (F12)
2. Server logs (terminal chạy server)
3. Network tab để kiểm tra API calls
