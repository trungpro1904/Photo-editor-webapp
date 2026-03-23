// Photo Editor - Edit Page
const API_BASE_URL = 'http://localhost:5000/api';
let currentImage = null;
let currentEdits = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    sharpen: 0,
    blur: 0,
    gamma: 1,
    rotate: 0,
    flipH: false,
    flipV: false
};
let editHistory = [];
let presets = [];
let autoSaveTimeout;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get image filename from sessionStorage
    currentImage = sessionStorage.getItem('currentEditImage');
    
    if (!currentImage) {
        alert('Không có ảnh để chỉnh sửa');
        window.close();
        return;
    }

    setupEventListeners();
    loadImageInfo();
    loadPresets();
    loadSavedEdits();
});

function setupEventListeners() {
    // Sliders
    ['brightness', 'contrast', 'saturation', 'hue', 'sharpen', 'blur', 'gamma', 'rotate'].forEach(id => {
        document.getElementById(id).addEventListener('input', handleSliderChange);
    });

    // Buttons
    document.getElementById('flipHBtn').addEventListener('click', () => {
        currentEdits.flipH = !currentEdits.flipH;
        updatePreview();
    });

    document.getElementById('flipVBtn').addEventListener('click', () => {
        currentEdits.flipV = !currentEdits.flipV;
        updatePreview();
    });

    document.getElementById('resetBtn').addEventListener('click', resetEdits);
    document.getElementById('exportBtn').addEventListener('click', openExportModal);
    document.getElementById('applyPresetBtn').addEventListener('click', applyPreset);
    document.getElementById('savePresetBtn').addEventListener('click', savePreset);

    // Export modal
    document.getElementById('qualitySlider').addEventListener('input', (e) => {
        document.getElementById('qualityValue').textContent = e.target.value;
        updateEstimatedSize();
    });

    document.getElementById('ppiSlider').addEventListener('input', (e) => {
        document.getElementById('ppiValue').textContent = e.target.value;
    });

    document.getElementById('confirmExportBtn').addEventListener('click', performExport);
}

async function loadImageInfo() {
    try {
        const response = await fetch(`${API_BASE_URL}/image/metadata/${currentImage}`);
        const data = await response.json();

        const info = document.getElementById('infoText');
        info.innerHTML = `
            <strong>Tên file:</strong> ${currentImage}<br>
            <strong>Kích thước:</strong> ${data.width}x${data.height} pixel<br>
            <strong>Định dạng:</strong> ${data.format?.toUpperCase() || 'Unknown'}<br>
            <strong>Màu sắc:</strong> ${data.space || 'Unknown'}<br>
            <strong>Mã hóa Alpha:</strong> ${data.hasAlpha ? 'Có' : 'Không'}
        `;

        sessionStorage.setItem('imageWidth', data.width);
        sessionStorage.setItem('imageHeight', data.height);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin ảnh:', error);
    }
}

function handleSliderChange(e) {
    const id = e.target.id;
    const value = e.target.value;

    currentEdits[id] = isNaN(value) ? 0 : parseFloat(value);
    document.getElementById(`${id}Value`).textContent = value;

    updatePreview();
    scheduleAutoSave();
}

async function updatePreview() {
    try {
        showLoading(true);

        const response = await fetch(`${API_BASE_URL}/image/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: currentImage,
                edits: currentEdits
            })
        });

        if (!response.ok) throw new Error('Lỗi tạo preview');

        const data = await response.json();
        const previewImage = document.getElementById('editPreview');
        previewImage.src = `${data.previewPath}?t=${Date.now()}`;

    } catch (error) {
        console.error('Lỗi preview:', error);
    } finally {
        showLoading(false);
    }
}

function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(autoSave, 2000);
}

async function autoSave() {
    try {
        const response = await fetch(`${API_BASE_URL}/image/save-edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: currentImage,
                edits: currentEdits
            })
        });

        if (response.ok) {
            addToHistory('Đã lưu tự động');
            console.log('Tự động lưu thành công');
        }
    } catch (error) {
        console.error('Lỗi auto-save:', error);
    }
}

async function loadSavedEdits() {
    try {
        // Try to load saved edits from server
        addToHistory('Tải chỉnh sửa đã lưu...');
    } catch (error) {
        console.error('Lỗi khi tải chỉnh sửa:', error);
    }
}

async function loadPresets() {
    try {
        const response = await fetch(`${API_BASE_URL}/image/presets`);
        presets = await response.json();

        const select = document.getElementById('presetSelect');
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Lỗi khi tải presets:', error);
    }
}

async function applyPreset() {
    const presetId = document.getElementById('presetSelect').value;
    if (!presetId) {
        alert('Vui lòng chọn một bộ lọc');
        return;
    }

    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    // Apply preset settings
    currentEdits = { ...currentEdits, ...preset.settings };

    // Update sliders
    ['brightness', 'contrast', 'saturation', 'hue', 'sharpen', 'blur', 'gamma', 'rotate'].forEach(id => {
        const element = document.getElementById(id);
        if (currentEdits[id] !== undefined) {
            element.value = currentEdits[id];
            document.getElementById(`${id}Value`).textContent = currentEdits[id];
        }
    });

    updatePreview();
    addToHistory(`Áp dụng bộ lọc: ${preset.name}`);
}

async function savePreset() {
    const name = document.getElementById('presetName').value.trim();
    if (!name) {
        alert('Vui lòng nhập tên bộ lọc');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch(`${API_BASE_URL}/image/preset/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                settings: {
                    brightness: currentEdits.brightness,
                    contrast: currentEdits.contrast,
                    saturation: currentEdits.saturation,
                    hue: currentEdits.hue,
                    sharpen: currentEdits.sharpen,
                    blur: currentEdits.blur,
                    gamma: currentEdits.gamma,
                    rotate: currentEdits.rotate,
                    flipH: currentEdits.flipH,
                    flipV: currentEdits.flipV
                }
            })
        });

        if (response.ok) {
            const data = await response.json();
            presets.push(data.preset);

            const option = document.createElement('option');
            option.value = data.preset.id;
            option.textContent = data.preset.name;
            document.getElementById('presetSelect').appendChild(option);

            document.getElementById('presetName').value = '';
            addToHistory(`Đã lưu bộ lọc: ${name}`);
            alert('Bộ lọc đã được lưu thành công!');
        }
    } catch (error) {
        console.error('Lỗi khi lưu preset:', error);
        alert(`Lỗi: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function resetEdits() {
    if (!confirm('Bạn chắc chắn muốn đặt lại tất cả chỉnh sửa?')) return;

    currentEdits = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        hue: 0,
        sharpen: 0,
        blur: 0,
        gamma: 1,
        rotate: 0,
        flipH: false,
        flipV: false
    };

    // Reset sliders
    ['brightness', 'contrast', 'saturation', 'hue', 'sharpen', 'blur', 'rotate'].forEach(id => {
        document.getElementById(id).value = currentEdits[id];
        document.getElementById(`${id}Value`).textContent = currentEdits[id];
    });

    document.getElementById('gamma').value = 1;
    document.getElementById('gammaValue').textContent = '1';

    updatePreview();
    addToHistory('Đã đặt lại tất cả chỉnh sửa');
}

function openExportModal() {
    const modal = new bootstrap.Modal(document.getElementById('exportModal'));
    updateEstimatedSize();
    modal.show();
}

function updateEstimatedSize() {
    const width = parseInt(sessionStorage.getItem('imageWidth')) || 3000;
    const height = parseInt(sessionStorage.getItem('imageHeight')) || 2000;
    const quality = document.getElementById('qualitySlider').value;

    // Simple estimation
    const estimatedKB = Math.round((width * height * 3 * (100 - quality)) / 100 / 1024);
    document.getElementById('estimatedSize').textContent = `~${estimatedKB} KB`;
}

async function performExport() {
    const format = document.querySelector('input[name="format"]:checked').value;
    const quality = document.getElementById('qualitySlider').value;
    const ppi = document.getElementById('ppiSlider').value;
    const filename = document.getElementById('exportName').value.trim() || 'exported-image';

    if (!format) {
        alert('Vui lòng chọn định dạng xuất');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch(`${API_BASE_URL}/image/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: currentImage,
                format: format,
                quality: quality,
                ppi: ppi
            })
        });

        if (!response.ok) throw new Error('Xuất ảnh thất bại');

        const data = await response.json();

        // Download the image
        const link = document.createElement('a');
        link.href = data.exportPath;
        link.download = `${filename}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        bootstrap.Modal.getInstance(document.getElementById('exportModal')).hide();
        addToHistory(`Xuất ${format.toUpperCase()} - ${data.fileSize}`);
        alert(`Ảnh đã được xuất thành công!\nKích cỡ: ${data.fileSize}`);

    } catch (error) {
        console.error('Lỗi xuất ảnh:', error);
        alert(`Lỗi: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function addToHistory(action) {
    const now = new Date().toLocaleTimeString('vi-VN');
    editHistory.push({ action, time: now });

    if (editHistory.length > 20) {
        editHistory.shift(); // Keep only last 20
    }

    updateHistoryDisplay();
}

function updateHistoryDisplay() {
    const historyDiv = document.getElementById('editHistory');
    historyDiv.innerHTML = editHistory
        .slice()
        .reverse()
        .map(item => `
            <div class="edit-history-item">
                <time>${item.time}</time> - ${item.action}
            </div>
        `)
        .join('');
}

function showLoading(show) {
    const indicator = document.getElementById('loadingIndicator');
    if (show) {
        indicator.classList.remove('d-none');
    } else {
        indicator.classList.add('d-none');
    }
}
