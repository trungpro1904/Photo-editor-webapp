#  Cài đặt và Chạy Photo Editor - 1 Bước Duy Nhất

##  Yêu cầu:
- Node.js 14+ cài đặt trên máy

##  Chạy Ứng dụng - 1 Lệnh:

### Bước 1: Mở Terminal tại thư mục `backend`

```bash
cd photo-editor/backend
```

### Bước 2: Cài đặt dependencies (lần đầu tiên thôi)

```bash
npm install
```

### Bước 3: Chạy server

```bash
npm start
```

**Xong!** 

Server sẽ chạy tại: **http://localhost:5000**

Mở trình duyệt và truy cập: **http://localhost:5000**

---

##  Giải thích:

- Backend (Node.js + Express) tại port **5000**
- Frontend đã tích hợp vào backend, serve từ cùng port
- Không cần chạy server frontend riêng

---

##  Các Nút Thao Tác Hiển Thị:

### Cửa sổ Preview (trang chính):
- ** Tải lên** - Upload ảnh
- ** Mở chỉnh sửa** - Mở cửa sổ edit
- ** Xoay 90°** - Xoay nhanh
- ** Lật ngang** - Lật ảnh
- ** Xóa** - Xóa ảnh

### Cửa sổ Edit (chỉnh sửa):
- Các slider điều chỉnh (Brightness, Saturation, Sharp, v.v.)
- **Xuất ảnh** - Export file
- **Đặt lại** - Reset chỉnh sửa

---

##  Tùy chỉnh Port (Nếu cần):

Sửa file `backend/.env`:
```
PORT=3000
```

Rồi nhập lại `npm start`

---

##  Lỗi thường gặp:

### "Error: listen EADDRINUSE"
Port 5000 đang được sử dụng. Hoặc:
- Thay đổi PORT trong `.env`
- Hoặc kill process đang dùng port 5000

```bash
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### "Cannot find module 'sharp'"
Chạy lại:
```bash
npm install
```

### Giao diện không hiển thị
- Kiểm tra console trình duyệt (F12)
- Kiểm tra có lỗi JavaScript không

---

##  Tính năng:

 Upload ảnh (JPG, PNG, RAW...)  
 Chỉnh sửa: Độ sáng, Saturation, Sharpen, Blur, v.v.  
 Auto-save  
 Xuất nhiều format  
 Bộ lọc presets  

**Vui lòng!** 
