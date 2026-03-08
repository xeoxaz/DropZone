import { triFlowModes, detectServerCapabilities, formatFileSize } from './triflow.js';

export function getHtmlPage(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DropZone - Direct Backup Solution</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #000;
            color: #fff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
        }

        .container {
            max-width: 900px;
            width: 100%;
            margin-top: 30px;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
        }

        h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }

        .subtitle {
            opacity: 0.8;
            margin-bottom: 5px;
        }

        .drop-zone {
            border: 2px dashed #444;
            border-radius: 8px;
            padding: 60px 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            background: #111;
            margin-bottom: 20px;
        }

        .drop-zone:hover {
            border-color: #666;
            background: #1a1a1a;
        }

        .drop-zone.drag-over {
            border-color: #4a9eff;
            background: #1a2332;
            transform: scale(1.02);
        }

        .drop-zone p {
            margin-bottom: 10px;
            font-size: 1.2rem;
        }

        .drop-zone small {
            opacity: 0.6;
        }

        .file-list {
            max-height: 300px;
            overflow-y: auto;
            margin-bottom: 20px;
        }

        .file-item {
            background: #111;
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 6px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-left: 3px solid #4a9eff;
        }

        .file-info {
            flex: 1;
        }

        .file-name {
            font-weight: 500;
            margin-bottom: 4px;
        }

        .file-meta {
            font-size: 0.8rem;
            opacity: 0.6;
        }

        .file-size {
            opacity: 0.8;
            margin-left: 15px;
        }

        .progress-bar {
            width: 100%;
            height: 4px;
            background: #333;
            border-radius: 2px;
            overflow: hidden;
            margin-top: 8px;
        }

        .progress-fill {
            height: 100%;
            background: #4a9eff;
            transition: width 0.3s ease;
        }

        .status {
            padding: 15px;
            border-radius: 6px;
            text-align: center;
            margin-bottom: 20px;
        }

        .status.info {
            background: #1a2332;
            border: 1px solid #4a9eff;
        }

        .status.success {
            background: #0a2a0a;
            border: 1px solid #4aff4a;
        }

        .status.error {
            background: #2a0a0a;
            border: 1px solid #ff4a4a;
        }

        .controls {
            display: flex;
            gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .btn:hover {
            border-color: #666;
            background: #2a2a2a;
        }

        .btn.primary {
            background: #4a9eff;
            border-color: #4a9eff;
        }

        .btn.primary:hover {
            background: #5aa8ff;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }

        .stat-card {
            background: #111;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
        }

        .stat-value {
            font-size: 1.5rem;
            font-weight: bold;
            color: #4a9eff;
        }

        .stat-label {
            font-size: 0.8rem;
            opacity: 0.6;
            margin-top: 5px;
        }

        .storage-section {
            margin-top: 40px;
            padding: 20px;
            background: #111;
            border-radius: 8px;
            border: 1px solid #333;
        }

        .storage-section h2 {
            text-align: center;
            margin-bottom: 20px;
            color: #4a9eff;
        }

        .storage-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }

        .storage-card {
            background: #1a1a1a;
            padding: 15px;
            border-radius: 6px;
            border: 1px solid #444;
            text-align: center;
        }

        .storage-card h3 {
            margin-bottom: 10px;
            color: #4a9eff;
            font-size: 1rem;
        }

        .storage-info {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        .storage-count {
            font-size: 0.9rem;
            opacity: 0.8;
        }

        .storage-size {
            font-size: 0.8rem;
            opacity: 0.6;
        }

        .files-section {
            margin-top: 30px;
            padding: 20px;
            background: #111;
            border-radius: 8px;
            border: 1px solid #333;
        }

        .files-section h2 {
            text-align: center;
            margin-bottom: 20px;
            color: #4a9eff;
        }

        .explorer-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding: 10px;
            background: #1a1a1a;
            border-radius: 6px;
            border: 1px solid #444;
        }

        .breadcrumb {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            opacity: 0.8;
        }

        .breadcrumb-item {
            cursor: pointer;
            transition: opacity 0.2s;
        }

        .breadcrumb-item:hover {
            opacity: 1;
            color: #4a9eff;
        }

        .view-controls {
            display: flex;
            gap: 8px;
        }

        .view-btn {
            background: #333;
            border: 1px solid #555;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
            transition: all 0.2s;
        }

        .view-btn.active {
            background: #4a9eff;
            border-color: #4a9eff;
        }

        .view-btn:hover {
            border-color: #666;
        }

        .files-explorer {
            max-height: 500px;
            overflow-y: auto;
            border: 1px solid #333;
            border-radius: 6px;
            background: #0a0a0a;
        }

        .file-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 15px;
            padding: 15px;
        }

        .file-list-view {
            padding: 0;
        }

        .file-item-grid {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 15px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid transparent;
        }

        .file-item-grid:hover {
            background: #1a1a1a;
            border-color: #4a9eff;
            transform: scale(1.02);
        }

        .file-item-list {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
            border-left: 3px solid transparent;
        }

        .file-item-list:hover {
            background: #1a1a1a;
            border-left-color: #4a9eff;
        }

        .file-icon {
            font-size: 2rem;
            margin-bottom: 8px;
        }

        .file-icon-list {
            font-size: 1.2rem;
            margin-right: 12px;
            width: 30px;
            text-align: center;
        }

        .file-name-grid {
            font-size: 0.8rem;
            text-align: center;
            word-break: break-word;
            margin-bottom: 4px;
        }

        .file-name-list {
            flex: 1;
            font-weight: 500;
            margin-bottom: 4px;
        }

        .file-meta-list {
            font-size: 0.8rem;
            opacity: 0.6;
            display: flex;
            gap: 15px;
            align-items: center;
        }

        .file-actions {
            display: flex;
            gap: 8px;
            opacity: 0;
            transition: opacity 0.2s;
        }

        .file-item-grid:hover .file-actions,
        .file-item-list:hover .file-actions {
            opacity: 1;
        }

        .action-btn {
            background: #333;
            border: 1px solid #555;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.7rem;
            transition: all 0.2s;
        }

        .action-btn:hover {
            background: #4a9eff;
            border-color: #4a9eff;
        }

        .action-btn.delete:hover {
            background: #ff4a4a;
            border-color: #ff4a4a;
        }

        .preview-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .preview-modal.active {
            display: flex;
        }

        .preview-content {
            max-width: 90vw;
            max-height: 90vh;
            background: #111;
            border-radius: 8px;
            border: 1px solid #333;
            padding: 20px;
            position: relative;
        }

        .preview-close {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #333;
            border: 1px solid #555;
            color: #fff;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
        }

        .preview-close:hover {
            background: #ff4a4a;
            border-color: #ff4a4a;
        }

        .preview-header {
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #333;
        }

        .preview-title {
            font-size: 1.2rem;
            font-weight: bold;
            color: #4a9eff;
            margin-bottom: 5px;
        }

        .preview-meta {
            font-size: 0.8rem;
            opacity: 0.6;
        }

        .preview-body {
            max-height: 70vh;
            overflow: auto;
        }

        .preview-body img {
            max-width: 100%;
            max-height: 70vh;
            object-fit: contain;
        }

        .preview-body pre {
            background: #000;
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
            font-size: 0.8rem;
        }

        .no-files {
            text-align: center;
            opacity: 0.6;
            padding: 40px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DropZone</h1>
            <p class="subtitle">Direct backup solution</p>
        </div>

        <div class="drop-zone" id="dropZone">
            <p>📁 Drag & drop files here</p>
            <small>or click to select files</small>
            <input type="file" id="fileInput" multiple style="display: none;">
        </div>

        <div class="status info" id="status">
            Drag files here or click to select files
        </div>

        <div class="file-list" id="fileList"></div>

        <div class="controls">
            <button class="btn" id="clearBtn">Clear Files</button>
            <button class="btn primary" id="uploadBtn">Start Upload</button>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-value" id="fileCount">0</div>
                <div class="stat-label">Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="totalSize">0 MB</div>
                <div class="stat-label">Total Size</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="activeMode">Auto</div>
                <div class="stat-label">Active Mode</div>
            </div>
        </div>

        <div class="storage-section">
            <h2>📁 Storage Overview</h2>
            <div class="storage-stats" id="storageStats">
                <div class="storage-card">
                    <h3>MultiStream</h3>
                    <div class="storage-info">
                        <span class="storage-count">0 files</span>
                        <span class="storage-size">0 MB</span>
                    </div>
                </div>
                <div class="storage-card">
                    <h3>ArcPack</h3>
                    <div class="storage-info">
                        <span class="storage-count">0 files</span>
                        <span class="storage-size">0 MB</span>
                    </div>
                </div>
                <div class="storage-card">
                    <h3>ChunkLine</h3>
                    <div class="storage-info">
                        <span class="storage-count">0 files</span>
                        <span class="storage-size">0 MB</span>
                    </div>
                </div>
            </div>

            <button class="btn primary" id="refreshStorage">Refresh Storage</button>
        </div>

        <div class="files-section">
            <h2>📋 File Explorer</h2>
            <div class="explorer-toolbar">
                <div class="breadcrumb">
                    <span class="breadcrumb-item" onclick="triFlow.navigateToRoot()">🏠 Root</span>
                    <span>/</span>
                    <span class="breadcrumb-item" id="currentMode">All Files</span>
                </div>
                <div class="view-controls">
                    <button class="view-btn active" id="gridViewBtn" onclick="triFlow.setView('grid')">Grid</button>
                    <button class="view-btn" id="listViewBtn" onclick="triFlow.setView('list')">List</button>
                </div>
            </div>
            <div class="files-explorer" id="filesExplorer">
                <div class="file-grid" id="filesContainer">
                    <p class="no-files">Loading files...</p>
                </div>
            </div>
        </div>

        <div class="preview-modal" id="previewModal">
            <div class="preview-content">
                <button class="preview-close" onclick="triFlow.closePreview()">✕ Close</button>
                <div class="preview-header">
                    <div class="preview-title" id="previewTitle">File Preview</div>
                    <div class="preview-meta" id="previewMeta">File information</div>
                </div>
                <div class="preview-body" id="previewBody">
                    Preview content will appear here
                </div>
            </div>
        </div>
    </div>

    <script>
        class TriFlowIngest {
            constructor() {
                this.selectedMode = null;
                this.files = [];
                this.activeUploads = new Map();
                this.currentView = 'grid';
                this.currentFilter = 'all';
                this.storedFiles = [];
                this.initializeEventListeners();
                this.detectCapabilities();
            }

            initializeEventListeners() {
                const dropZone = document.getElementById('dropZone');
                const fileInput = document.getElementById('fileInput');
                const uploadBtn = document.getElementById('uploadBtn');
                const clearBtn = document.getElementById('clearBtn');
                const refreshStorageBtn = document.getElementById('refreshStorage');

                // File handling only (mode selection removed)
                dropZone.addEventListener('click', () => fileInput.click());
                dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
                dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
                dropZone.addEventListener('drop', this.handleDrop.bind(this));
                fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

                // Controls
                uploadBtn.addEventListener('click', () => this.startUpload());
                clearBtn.addEventListener('click', () => this.clearFiles());
                refreshStorageBtn.addEventListener('click', () => this.loadStorageInfo());

                // Load storage info on page load
                this.loadStorageInfo();
            }

            detectCapabilities() {
                this.capabilities = {
                    compressionStreams: 'CompressionStream' in window,
                    webAssembly: 'WebAssembly' in window,
                    serviceWorkers: 'serviceWorker' in navigator,
                    streams: 'ReadableStream' in window
                };

                console.log('Detected capabilities:', this.capabilities);
            }

            selectMode(modeName) {
                this.selectedMode = modeName;
                document.getElementById('activeMode').textContent = modeName;
            }

            handleDragOver(e) {
                e.preventDefault();
                document.getElementById('dropZone').classList.add('drag-over');
            }

            handleDragLeave(e) {
                e.preventDefault();
                document.getElementById('dropZone').classList.remove('drag-over');
            }

            handleDrop(e) {
                e.preventDefault();
                document.getElementById('dropZone').classList.remove('drag-over');
                this.handleFiles(e.dataTransfer.files);
            }

            handleFiles(fileList) {
                this.files = Array.from(fileList);
                this.displayFiles();
                this.updateStats();
                this.autoSelectMode();
            }

            autoSelectMode() {
                if (this.selectedMode) return;

                const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
                const maxFileSize = Math.max(...this.files.map(f => f.size));

                let selectedMode = 'MultiStream';
                if (maxFileSize > 500 * 1024 * 1024) {
                    selectedMode = 'ChunkLine';
                } else if (totalSize > 50 * 1024 * 1024 || this.files.length > 10) {
                    selectedMode = 'ArcPack';
                }

                this.selectMode(selectedMode);
                this.updateStatus(\`Ready to upload \${this.files.length} files\`, 'info');
            }

            displayFiles() {
                const fileList = document.getElementById('fileList');
                fileList.innerHTML = this.files.map((file, index) => \`
                    <div class="file-item" data-index="\${index}">
                        <div class="file-info">
                            <div class="file-name">\${file.name}</div>
                            <div class="file-meta">
                                <span>Type: \${file.type || 'Unknown'}</span>
                                <span>Modified: \${new Date(file.lastModified).toLocaleDateString()}</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: 0%"></div>
                            </div>
                        </div>
                        <div class="file-size">\${formatFileSize(file.size)}</div>
                    </div>
                \`).join('');
            }

            updateStats() {
                const fileCount = this.files.length;
                const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);

                document.getElementById('fileCount').textContent = fileCount;
                document.getElementById('totalSize').textContent = formatFileSize(totalSize);
            }

            async startUpload() {
                if (this.files.length === 0) {
                    this.updateStatus('No files to upload', 'error');
                    return;
                }

                // Reset all progress bars
                this.files.forEach((_, index) => {
                    this.updateFileProgress(index, '0');
                });

                this.updateStatus('Preparing upload...', 'info');

                try {
                    switch (this.selectedMode) {
                        case 'MultiStream':
                            await this.multiStreamUpload();
                            break;
                        case 'ArcPack':
                            await this.arcPackUpload();
                            break;
                        case 'ChunkLine':
                            await this.chunkLineUpload();
                            break;
                        default:
                            throw new Error('No upload mode selected');
                    }

                    // Refresh storage info after successful upload
                    await this.loadStorageInfo();
                } catch (error) {
                    this.updateStatus('Upload failed: ' + error.message, 'error');
                    console.error('Upload error:', error);
                }
            }

            async loadStorageInfo() {
                try {
                    const response = await fetch('/api/triflow/files');
                    const data = await response.json();

                    if (response.ok) {
                        this.displayStorageStats(data.usage);
                        this.displayFilesList(data.files);
                    } else {
                        console.error('Failed to load storage info:', data);
                    }
                } catch (error) {
                    console.error('Error loading storage info:', error);
                }
            }

            displayStorageStats(usage) {
                // Update storage cards
                const storageCards = document.querySelectorAll('.storage-card');
                storageCards.forEach((card, index) => {
                    const modeNames = ['multistream', 'arcpack', 'chunkline'];
                    const mode = modeNames[index];
                    if (mode && usage.filesByMode[mode]) {
                        const countEl = card.querySelector('.storage-count');
                        const sizeEl = card.querySelector('.storage-size');
                        if (countEl) countEl.textContent = \`\${usage.filesByMode[mode].count} files\`;
                        if (sizeEl) sizeEl.textContent = usage.filesByMode[mode].sizeFormatted;
                    }
                });
            }

            displayFilesList(filesData) {
                this.storedFiles = [
                    ...filesData.filesByMode.multistream,
                    ...filesData.filesByMode.arcpack,
                    ...filesData.filesByMode.chunkline
                ];

                this.renderFilesExplorer();
            }

            renderFilesExplorer() {
                const container = document.getElementById('filesContainer');
                const filteredFiles = this.getFilteredFiles();

                if (filteredFiles.length === 0) {
                    container.innerHTML = '<p class="no-files">No files uploaded yet</p>';
                    return;
                }

                // Sort by upload date (newest first)
                filteredFiles.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

                if (this.currentView === 'grid') {
                    this.renderGridView(filteredFiles);
                } else {
                    this.renderListView(filteredFiles);
                }
            }

            getFilteredFiles() {
                if (this.currentFilter === 'all') {
                    return this.storedFiles;
                }
                return this.storedFiles.filter(file => file.mode === this.currentFilter);
            }

            renderGridView(files) {
                const container = document.getElementById('filesContainer');
                container.className = 'file-grid';

                container.innerHTML = files.map(file => {
                    const encodedPath = encodeURIComponent(file.path);
                    const encodedMode = encodeURIComponent(file.mode);
                    const encodedName = encodeURIComponent(file.name);

                    // Check if it's an image file by extension
                    const ext = file.name.split('.').pop()?.toLowerCase();
                    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
                    let fileIcon = '';

                    if (isImage) {
                        // Create thumbnail for image files
                        const imageUrl = '/api/files/preview?path=' + encodeURIComponent(file.path) + '&mode=' + encodeURIComponent(file.mode);
                        fileIcon = '<img src="' + imageUrl + '" alt="' + file.name + '" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;" />';
                    } else {
                        // Use emoji icon for non-image files
                        fileIcon = '<div class="file-icon">' + this.getFileIcon(file.type, file.name) + '</div>';
                    }

                    return '<div class="file-item-grid" onclick="triFlow.previewFile(decodeURIComponent(\\\'' + encodedPath + '\\\'), decodeURIComponent(\\\'' + encodedMode + '\\\'), decodeURIComponent(\\\'' + encodedName + '\\\'))">' +
                        fileIcon +
                        '<div class="file-name-grid">' + file.name + '</div>' +
                        '<div class="file-actions">' +
                            '<button class="action-btn" onclick="event.stopPropagation(); triFlow.downloadFile(decodeURIComponent(\\\'' + encodedPath + '\\\'), decodeURIComponent(\\\'' + encodedMode + '\\\'), decodeURIComponent(\\\'' + encodedName + '\\\'))">Download</button>' +
                            '<button class="action-btn delete" onclick="event.stopPropagation(); triFlow.deleteFile(decodeURIComponent(\\\'' + encodedPath + '\\\'), decodeURIComponent(\\\'' + encodedMode + '\\\'), decodeURIComponent(\\\'' + encodedName + '\\\'))">Delete</button>' +
                        '</div>' +
                    '</div>';
                }).join('');
            }

            renderListView(files) {
                const container = document.getElementById('filesContainer');
                container.className = 'file-list-view';

                container.innerHTML = files.map(file => {
                    const encodedPath = encodeURIComponent(file.path);
                    const encodedMode = encodeURIComponent(file.mode);
                    const encodedName = encodeURIComponent(file.name);

                    return '<div class="file-item-list" onclick="triFlow.previewFile(decodeURIComponent(\\\'' + encodedPath + '\\\'), decodeURIComponent(\\\'' + encodedMode + '\\\'), decodeURIComponent(\\\'' + encodedName + '\\\'))">' +
                        '<div class="file-icon-list">' + this.getFileIcon(file.type, file.name) + '</div>' +
                        '<div class="file-name-list">' + file.name + '</div>' +
                        '<div class="file-meta-list">' +
                            '<span>' + formatFileSize(file.size) + '</span>' +
                            '<span>' + new Date(file.uploadedAt).toLocaleDateString() + '</span>' +
                            '<span class="file-record-mode">' + file.mode + '</span>' +
                        '</div>' +
                        '<div class="file-actions">' +
                            '<button class="action-btn" onclick="event.stopPropagation(); triFlow.downloadFile(decodeURIComponent(\\\'' + encodedPath + '\\\'), decodeURIComponent(\\\'' + encodedMode + '\\\'), decodeURIComponent(\\\'' + encodedName + '\\\'))">Download</button>' +
                            '<button class="action-btn delete" onclick="event.stopPropagation(); triFlow.deleteFile(decodeURIComponent(\\\'' + encodedPath + '\\\'), decodeURIComponent(\\\'' + encodedMode + '\\\'), decodeURIComponent(\\\'' + encodedName + '\\\'))">Delete</button>' +
                        '</div>' +
                    '</div>';
                }).join('');
            }

            getFileIcon(type, name) {
                if (type.startsWith('image/')) return '🖼️';
                if (type === 'application/pdf') return '📄';
                if (type === 'text/plain') return '📝';
                if (type === 'application/json') return '📋';
                if (type.includes('zip') || type.includes('tar') || type.includes('gz')) return '📦';
                if (type.includes('video')) return '🎥';
                if (type.includes('audio')) return '🎵';
                return '📁';
            }

            setView(view) {
                this.currentView = view;

                // Update button states
                document.getElementById('gridViewBtn').classList.toggle('active', view === 'grid');
                document.getElementById('listViewBtn').classList.toggle('active', view === 'list');

                // Re-render files
                this.renderFilesExplorer();
            }

            navigateToRoot() {
                this.currentFilter = 'all';
                document.getElementById('currentMode').textContent = 'All Files';
                this.renderFilesExplorer();
            }

            navigateToMode(mode) {
                this.currentFilter = mode;
                document.getElementById('currentMode').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
                this.renderFilesExplorer();
            }

            async previewFile(path, mode, name) {
                const modal = document.getElementById('previewModal');
                const title = document.getElementById('previewTitle');
                const meta = document.getElementById('previewMeta');
                const body = document.getElementById('previewBody');

                title.textContent = name;
                meta.textContent = 'Mode: ' + mode + ' | Path: ' + path;
                body.innerHTML = '<p>Loading preview...</p>';

                modal.classList.add('active');

                try {
                    const response = await fetch('/api/files/preview?path=' + encodeURIComponent(path) + '&mode=' + encodeURIComponent(mode));

                    if (response.ok) {
                        const contentType = response.headers.get('Content-Type') || '';

                        if (contentType.startsWith('image/')) {
                            const blob = await response.blob();
                            const imageUrl = URL.createObjectURL(blob);
                            body.innerHTML = '<img src="' + imageUrl + '" alt="' + name + '">';
                        } else if (contentType.includes('text') || contentType.includes('json')) {
                            const text = await response.text();
                            body.innerHTML = '<pre>' + this.escapeHtml(text) + '</pre>';
                        } else if (contentType === 'application/pdf') {
                            const blob = await response.blob();
                            const pdfUrl = URL.createObjectURL(blob);
                            body.innerHTML = '<embed src="' + pdfUrl + '" type="application/pdf" width="100%" height="600px" />';
                        } else {
                            body.innerHTML = '<p>Preview not available for this file type. Please download to view.</p>';
                        }
                    } else {
                        body.innerHTML = '<p>Failed to load preview: ' + response.statusText + '</p>';
                    }
                } catch (error) {
                    body.innerHTML = '<p>Error loading preview: ' + error.message + '</p>';
                }
            }

            closePreview() {
                const modal = document.getElementById('previewModal');
                modal.classList.remove('active');

                // Clean up any object URLs
                const body = document.getElementById('previewBody');
                const img = body.querySelector('img');
                if (img && img.src.startsWith('blob:')) {
                    URL.revokeObjectURL(img.src);
                }
            }

            async downloadFile(path, mode, name) {
                try {
                    const response = await fetch('/api/files/download?path=' + encodeURIComponent(path) + '&mode=' + encodeURIComponent(mode));

                    if (response.ok) {
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = name;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        this.updateStatus('Download failed: ' + response.statusText, 'error');
                    }
                } catch (error) {
                    this.updateStatus('Download failed: ' + error.message, 'error');
                }
            }

            async deleteFile(path, mode, name) {
                if (!confirm('Are you sure you want to delete "' + name + '"?')) {
                    return;
                }

                try {
                    const response = await fetch('/api/files/delete?path=' + encodeURIComponent(path) + '&mode=' + encodeURIComponent(mode), {
                        method: 'DELETE'
                    });

                    const result = await response.json();

                    if (result.success) {
                        this.updateStatus('File deleted successfully', 'success');
                        await this.loadStorageInfo();
                    } else {
                        this.updateStatus('Delete failed: ' + result.error, 'error');
                    }
                } catch (error) {
                    this.updateStatus('Delete failed: ' + error.message, 'error');
                }
            }

            escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            async multiStreamUpload() {
                const formData = new FormData();
                this.files.forEach((file, index) => {
                    formData.append('file_' + index, file);
                });
                formData.append('mode', 'MultiStream');
                formData.append('metadata', JSON.stringify({
                    fileCount: this.files.length,
                    totalSize: this.files.reduce((sum, f) => sum + f.size, 0)
                }));

                return new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();

                    // Track upload progress
                    xhr.upload.addEventListener('progress', (e) => {
                        if (e.lengthComputable) {
                            const progress = (e.loaded / e.total * 100).toFixed(1);
                            // Update overall progress for all files
                            this.files.forEach((_, index) => {
                                this.updateFileProgress(index, progress);
                            });
                            this.updateStatus('Uploading files... ' + progress + '%', 'info');
                        }
                    });

                    xhr.addEventListener('load', () => {
                        if (xhr.status === 200) {
                            try {
                                const result = JSON.parse(xhr.responseText);
                                if (result.success) {
                                    // Set all progress to 100%
                                    this.files.forEach((_, index) => {
                                        this.updateFileProgress(index, '100');
                                    });
                                    this.updateStatus('Files uploaded successfully', 'success');
                                    resolve(result);
                                } else {
                                    throw new Error(result.error);
                                }
                            } catch (error) {
                                reject(error);
                            }
                        } else {
                            reject(new Error('Upload failed with status ' + xhr.status));
                        }
                    });

                    xhr.addEventListener('error', () => {
                        reject(new Error('Network error during upload'));
                    });

                    xhr.open('POST', '/api/triflow/multistream');
                    xhr.send(formData);
                });
            }

            async arcPackUpload() {
                // Simulated archive streaming with progress
                this.updateStatus('Creating archive stream...', 'info');

                // Simulate archive creation progress (0-30%)
                for (let i = 0; i <= 30; i += 5) {
                    this.files.forEach((_, index) => {
                        this.updateFileProgress(index, i.toString());
                    });
                    this.updateStatus('Creating archive stream... ' + i + '%', 'info');
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                try {
                    const archiveData = await this.createArchive();

                    // Simulate preparation progress (30-50%)
                    for (let i = 35; i <= 50; i += 5) {
                        this.files.forEach((_, index) => {
                            this.updateFileProgress(index, i.toString());
                        });
                        this.updateStatus('Preparing archive for upload... ' + i + '%', 'info');
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }

                    // Upload with progress tracking (50-100%)
                    return new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();

                        xhr.upload.addEventListener('progress', (e) => {
                            if (e.lengthComputable) {
                                // Map upload progress (50-100% range)
                                const uploadProgress = e.loaded / e.total;
                                const totalProgress = 50 + (uploadProgress * 50);
                                const displayProgress = totalProgress.toFixed(1);

                                this.files.forEach((_, index) => {
                                    this.updateFileProgress(index, displayProgress);
                                });
                                this.updateStatus('Uploading archive... ' + displayProgress + '%', 'info');
                            }
                        });

                        xhr.addEventListener('load', () => {
                            if (xhr.status === 200) {
                                try {
                                    const result = JSON.parse(xhr.responseText);
                                    if (result.success) {
                                        // Set all progress to 100%
                                        this.files.forEach((_, index) => {
                                            this.updateFileProgress(index, '100');
                                        });
                                        this.updateStatus('Archive uploaded successfully', 'success');
                                        resolve(result);
                                    } else {
                                        throw new Error(result.error);
                                    }
                                } catch (error) {
                                    reject(error);
                                }
                            } else {
                                reject(new Error('Upload failed with status ' + xhr.status));
                            }
                        });

                        xhr.addEventListener('error', () => {
                            reject(new Error('Network error during upload'));
                        });

                        xhr.open('POST', '/api/triflow/arcpack');
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        xhr.send(JSON.stringify({
                            archiveData,
                            metadata: {
                                fileCount: this.files.length,
                                totalSize: this.files.reduce((sum, f) => sum + f.size, 0),
                                mode: 'ArcPack'
                            }
                        }));
                    });
                } catch (error) {
                    this.updateStatus('Upload failed: ' + error.message, 'error');
                    throw error;
                }
            }

            async chunkLineUpload() {
                this.updateStatus('Starting chunked transfer...', 'info');

                try {
                    const totalFiles = this.files.length;

                    for (let i = 0; i < totalFiles; i++) {
                        const file = this.files[i];
                        this.updateStatus('Uploading file ' + (i + 1) + ' of ' + totalFiles + ': ' + file.name, 'info');
                        await this.uploadFileInChunks(file, i);

                        // Update overall progress for completed files
                        const completedFiles = i + 1;
                        const overallProgress = (completedFiles / totalFiles * 100).toFixed(1);

                        // Set completed files to 100%, others to 0
                        this.files.forEach((_, index) => {
                            if (index < completedFiles) {
                                this.updateFileProgress(index, '100');
                            } else {
                                this.updateFileProgress(index, '0');
                            }
                        });
                    }

                    this.updateStatus('All files uploaded successfully', 'success');
                } catch (error) {
                    this.updateStatus('Upload failed: ' + error.message, 'error');
                    throw error;
                }
            }

            async uploadFileInChunks(file, fileIndex) {
                const chunkSize = 1024 * 1024; // 1MB chunks
                const totalChunks = Math.ceil(file.size / chunkSize);

                for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                    const start = chunkIndex * chunkSize;
                    const end = Math.min(start + chunkSize, file.size);
                    const chunk = file.slice(start, end);

                    const formData = new FormData();
                    formData.append('chunk', chunk);
                    formData.append('filename', file.name);
                    formData.append('chunkIndex', chunkIndex.toString());
                    formData.append('totalChunks', totalChunks.toString());
                    formData.append('fileIndex', fileIndex.toString());

                    const response = await fetch('/api/triflow/chunkline', {
                        method: 'POST',
                        body: formData
                    });

                    const result = await response.json();
                    if (!result.success) {
                        throw new Error('Chunk ' + chunkIndex + ' upload failed');
                    }

                    // Update progress for current file
                    const progress = ((chunkIndex + 1) / totalChunks * 100).toFixed(1);
                    this.updateFileProgress(fileIndex, progress);

                    // Update status with chunk progress
                    const currentChunk = chunkIndex + 1;
                    this.updateStatus('Uploading ' + file.name + ' - chunk ' + currentChunk + ' of ' + totalChunks + ' (' + progress + '%)', 'info');
                }
            }

            async createArchive() {
                // Simplified archive creation - in real implementation would use compression streams
                return {
                    files: this.files.map(f => ({
                        name: f.name,
                        size: f.size,
                        type: f.type
                    })),
                    created: new Date().toISOString()
                };
            }

            updateFileProgress(fileIndex, progress) {
                const fileItem = document.querySelector(\`.file-item[data-index="\${fileIndex}"]\`);
                if (fileItem) {
                    const progressFill = fileItem.querySelector('.progress-fill');
                    progressFill.style.width = \`\${progress}%\`;
                }
            }

            clearFiles() {
                this.files = [];
                this.selectedMode = null;
                document.getElementById('fileList').innerHTML = '';
                document.getElementById('fileInput').value = '';
                this.updateStats();
                this.updateStatus('Files cleared', 'info');
                document.getElementById('activeMode').textContent = 'Auto';
            }

            updateStatus(message, type = 'info') {
                const status = document.getElementById('status');
                status.textContent = message;
                status.className = \`status \${type}\`;
            }
        }

        function formatFileSize(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        // Initialize TriFlow Ingest
        const triFlow = new TriFlowIngest();
    </script>
</body>
</html>
  `;
}
