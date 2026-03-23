# Quick Start Guide

## 🚀 Hướng dẫn Cài đặt và Chạy Nhanh

### 1. Cài đặt Backend

```bash
# Vào thư mục backend
cd photo-editor/backend

# Cài đặt dependencies
npm install

# Chạy server
npm start
```

Server sẽ chạy tại `http://localhost:5000`

### 2. Chạy Frontend

Có 2 cách:

#### Cách A: Sử dụng HTTP Server
```bash
# Vào thư mục frontend
cd photo-editor/frontend

# Chạy HTTP server (cần Node.js)
npx http-server
```

Mở `http://localhost:8080` trong trình duyệt

#### Cách B: Mở trực tiếp
- Mở file `photo-editor/frontend/index.html` trong trình duyệt
- (Một số tính năng có thể bị hạn chế vì CORS)

### 3. Sử dụng Ứng dụng

1. **Preview Window:**
   - Tải lên ảnh
   - Chọn ảnh để xem preview
   - Bấm "Mở chỉnh sửa" để chỉnh sửa

2. **Edit Window:**
   - Sử dụng các slider để chỉnh sửa
   - Thay đổi được lưu tự động
   - Bấm "Xuất ảnh" để xuất

## 📋 Yêu cầu Hệ thống

- Node.js 14+
- npm hoặc yarn
- Trình duyệt hiện đại (Chrome, Firefox, Safari, Edge)
- Ổ cứng: ≥100MB để cài đặt dependencies

## 🛠️ Cấu hình (Optional)

Chỉnh sửa file `backend/.env`:

```env
PORT=5000                  # Port của server
NODE_ENV=development       # development hoặc production
UPLOAD_FOLDER=./uploads    # Thư mục lưu upload
MAX_FILE_SIZE=52428800     # Max file size (50MB)
```

## ⚡ Tính năng Chính

✅ Hỗ trợ RAW format (ARW, NEF, CR2, CR3, DNG)  
✅ Chỉnh sửa ảnh real-time  
✅ Tự động lưu thay đổi  
✅ Bộ lọc tùy chỉnh  
✅ Xuất nhiều định dạng  
✅ Giao diện đơn giản, dễ sử dụng  

## 🔧 Troubleshooting

### Lỗi: "Cannot find module 'sharp'"
```bash
npm install --save sharp
```

### Lỗi: "Port 5000 đã được sử dụng"
Thay đổi PORT trong `.env` hoặc kill process:
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :5000
kill -9 <PID>
```

### Upload không hoạt động
Kiểm tra:
- Folder `backend/uploads` tồn tại
- File size < 50MB
- Định dạng được hỗ trợ

### Chỉnh sửa không hiển thị
- Kiểm tra backend đang chạy
- Mở DevTools (F12) để xem lỗi
- Kiểm tra network tab

## 📚 Tài liệu

- [README.md](README.md) - Tài liệu chi tiết
- API Docs trong README.md
- Code comments trong các file

## 💡 Tips

- Tải lên ảnh chất lượng cao để có kết quả tốt nhất
- Sử dụng bộ lọc sẵn có để xử lý nhanh
- Lưu các cài đặt yêu thích thành bộ lọc
- Kiểm tra dự kiến kích cỡ trước khi xuất

## 🤝 Hỗ trợ

Nếu gặp vấn đề:
1. Kiểm tra console trình duyệt (F12)
2. Kiểm tra server logs
3. Kiểm tra file `.env`
4. Xem README.md phần Troubleshooting
