// Photo Editor - Preview Page
const API_BASE_URL = 'http://localhost:5000/api';
let selectedImage = null;
let uploadedImages = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM đã load');
    setupEventListeners();
    loadInitialUI();
});

function loadInitialUI() {
    // Ensure UI elements are visible
    const filePanel = document.getElementById('filePanel');
    const previewArea = document.getElementById('previewArea');
    const sidebarPanel = document.querySelector('.col-md-3.bg-light.border-left');
    
    if (filePanel) console.log('File panel found');
    if (previewArea) console.log('Preview area found');
    if (sidebarPanel) console.log('Sidebar panel found');
}

function setupEventListeners() {
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const editBtn = document.getElementById('editBtn');
    const rotateBtn = document.getElementById('rotateBtn');
    const flipBtn = document.getElementById('flipBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    uploadBtn.addEventListener('click', handleUpload);
    editBtn.addEventListener('click', openEditWindow);
    rotateBtn.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('rotateModal'));
        modal.show();
    });
    flipBtn.addEventListener('click', () => handleQuickFlip());
    deleteBtn.addEventListener('click', () => handleDelete());

    // Handle file selection
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        console.log(`Đã chọn ${files.length} file`);
    });

    // Rotate options
    document.querySelectorAll('.rotate-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const angle = parseInt(e.target.dataset.angle);
            handleQuickRotate(angle);
            bootstrap.Modal.getInstance(document.getElementById('rotateModal')).hide();
        });
    });
}

async function handleUpload() {
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;

    if (files.length === 0) {
        alert('Vui lòng chọn ít nhất một file');
        return;
    }

    showLoading(true);

    for (let file of files) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${API_BASE_URL}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload thất bại');
            }

            const data = await response.json();
            uploadedImages.push({
                filename: data.filename,
                originalName: data.originalName,
                path: data.path,
                size: data.size
            });

            const sizeInfo = data.size ? ` (${(data.size / 1024 / 1024).toFixed(2)}MB)` : '';
            const ext = file.name.split('.').pop().toUpperCase();
            const rawFormats = ['ARW', 'NEF', 'CR2', 'CR3', 'DNG', 'RAF', 'ORF', 'RW2', 'SRW', 'X3F'];
            const typeLabel = rawFormats.includes(ext) ? `🎬 ${ext} RAW` : `📷 ${ext}`;
            
            console.log(`✓ ${typeLabel}: ${data.originalName}${sizeInfo}`);
        } catch (error) {
            console.error(`Lỗi upload: ${error.message}`);
            alert(`Lỗi upload file ${file.name}: ${error.message}`);
        }
    }

    showLoading(false);
    fileInput.value = '';
    updateImageList();
}

function updateImageList() {
    const imageList = document.getElementById('imageList');

    if (uploadedImages.length === 0) {
        imageList.innerHTML = '<p class="text-muted small">Chưa có ảnh nào</p>';
        return;
    }

    imageList.innerHTML = uploadedImages
        .map((img, idx) => `
            <div class="image-item ${selectedImage === idx ? 'active' : ''}" 
                 onclick="selectImage(${idx})">
                <img src="${img.path}?t=${Date.now()}" alt="thumb" class="image-item-thumbnail">
                <span class="image-item-name" title="${img.originalName}">
                    ${img.originalName}
                </span>
            </div>
        `)
        .join('');
}

async function selectImage(index) {
    selectedImage = index;
    const image = uploadedImages[index];

    updateImageList();

    // Load preview
    const previewArea = document.getElementById('previewArea');
    const previewImage = document.getElementById('previewImage');
    const previewPlaceholder = document.getElementById('previewPlaceholder');

    previewImage.src = `${image.path}?t=${Date.now()}`;
    previewImage.style.display = 'block';
    previewPlaceholder.style.display = 'none';

    // Load metadata
    try {
        const metadata = await fetch(`${API_BASE_URL}/image/metadata/${image.filename}`);
        const data = await metadata.json();

        document.getElementById('previewInfo').innerHTML = `
            <strong>${image.originalName}</strong><br>
            ${data.width}x${data.height} px | ${data.format?.toUpperCase() || 'Unknown'}
        `;

        // Update details
        document.getElementById('imageDetails').innerHTML = `
            <dt>Tên file:</dt>
            <dd>${image.originalName}</dd>
            <dt>Kích thước:</dt>
            <dd>${data.width}x${data.height} pixel</dd>
            <dt>Định dạng:</dt>
            <dd>${data.format?.toUpperCase() || 'Unknown'}</dd>
            <dt>Màu sắc:</dt>
            <dd>${data.space || 'Unknown'}</dd>
        `;

        document.getElementById('selectedImageInfo').classList.remove('d-none');
        document.getElementById('selectedImageText').textContent = `Đã chọn: ${image.originalName}`;
    } catch (error) {
        console.error('Lỗi khi lấy metadata:', error);
    }

    // Enable action buttons
    document.getElementById('editBtn').disabled = false;
    document.getElementById('rotateBtn').disabled = false;
    document.getElementById('flipBtn').disabled = false;
    document.getElementById('deleteBtn').disabled = false;
}

function openEditWindow() {
    if (selectedImage === null) return;

    const image = uploadedImages[selectedImage];
    // Open edit window passing the filename
    sessionStorage.setItem('currentEditImage', image.filename);
    window.open('edit.html', '_blank', 'width=1400,height=800');
}

async function handleQuickRotate(angle) {
    if (selectedImage === null) return;

    const image = uploadedImages[selectedImage];
    showLoading(true);

    try {
        const response = await fetch(`${API_BASE_URL}/image/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: image.filename,
                edits: { rotate: angle }
            })
        });

        if (!response.ok) throw new Error('Xoay ảnh thất bại');

        const data = await response.json();
        console.log('Xoay ảnh thành công');
        
        // Reload preview
        const previewImage = document.getElementById('previewImage');
        previewImage.src = `${image.path}?t=${Date.now()}`;

    } catch (error) {
        console.error('Lỗi:', error);
        alert(`Lỗi xoay ảnh: ${error.message}`);
    }

    showLoading(false);
}

async function handleQuickFlip() {
    if (selectedImage === null) return;

    const image = uploadedImages[selectedImage];
    showLoading(true);

    try {
        const response = await fetch(`${API_BASE_URL}/image/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: image.filename,
                edits: { flipH: true }
            })
        });

        if (!response.ok) throw new Error('Lật ảnh thất bại');

        console.log('Lật ảnh thành công');
        
        // Reload preview
        const previewImage = document.getElementById('previewImage');
        previewImage.src = `${image.path}?t=${Date.now()}`;

    } catch (error) {
        console.error('Lỗi:', error);
        alert(`Lỗi lật ảnh: ${error.message}`);
    }

    showLoading(false);
}

function handleDelete() {
    if (selectedImage === null) return;

    if (!confirm('Bạn chắc chắn muốn xóa ảnh này?')) return;

    uploadedImages.splice(selectedImage, 1);
    selectedImage = null;

    document.getElementById('previewImage').style.display = 'none';
    document.getElementById('previewPlaceholder').style.display = 'block';
    document.getElementById('previewInfo').innerHTML = '';
    document.getElementById('imageDetails').innerHTML = '<p class="text-muted">Chọn ảnh để xem thông tin</p>';
    document.getElementById('selectedImageInfo').classList.add('d-none');

    document.getElementById('editBtn').disabled = true;
    document.getElementById('rotateBtn').disabled = true;
    document.getElementById('flipBtn').disabled = true;
    document.getElementById('deleteBtn').disabled = true;

    updateImageList();
}

function showLoading(show) {
    const indicator = document.getElementById('loadingIndicator');
    if (show) {
        indicator.classList.remove('d-none');
    } else {
        indicator.classList.add('d-none');
    }
}
