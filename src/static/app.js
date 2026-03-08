class TriFlowIngest {
            constructor() {
                this.selectedMode = null;
                this.files = [];
                this.targetNames = [];
                this.activeUploads = new Map();
                this.currentView = 'grid';
                this.currentFilter = 'all';
                this.currentTab = 'upload';
                this.currentDirectoryPath = null;
                this.browserSearchTerm = '';
                this.dragState = null;
                this.hasUploadStarted = false;
                this.storedFiles = [];
                this.storedDirectories = [];
                this.directoryRoots = {};
                this.initializeEventListeners();
                this.detectCapabilities();
            }

            initializeEventListeners() {
                const dropZone = document.getElementById('dropZone');
                const fileInput = document.getElementById('fileInput');
                const uploadBtn = document.getElementById('uploadBtn');
                const clearBtn = document.getElementById('clearBtn');
                const refreshStorageBtn = document.getElementById('refreshStorage');
                const tabUpload = document.getElementById('tabUpload');
                const tabStorage = document.getElementById('tabStorage');
                const tabBrowser = document.getElementById('tabBrowser');
                const filesContainer = document.getElementById('filesContainer');
                const browserSearchInput = document.getElementById('browserSearchInput');

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
                tabUpload.addEventListener('click', () => this.switchTab('upload'));
                tabStorage.addEventListener('click', () => this.switchTab('storage'));
                tabBrowser.addEventListener('click', () => this.switchTab('browser'));
                if (browserSearchInput instanceof HTMLInputElement) {
                    browserSearchInput.addEventListener('input', (event) => {
                        this.setBrowserSearch(event.target.value);
                    });
                }
                document.addEventListener('click', () => this.hideItemContextMenu());
                document.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        this.hideItemContextMenu();
                    }
                });
                window.addEventListener('scroll', () => this.hideItemContextMenu(), true);

                filesContainer.addEventListener('contextmenu', (event) => {
                    const target = event.target;
                    if (!(target instanceof Element)) {
                        return;
                    }

                    if (target.closest('.file-item-grid') || target.closest('.file-item-list')) {
                        return;
                    }

                    this.openExplorerContextMenu(event);
                });

                filesContainer.addEventListener('dragover', (event) => {
                    if (!this.dragState) {
                        return;
                    }

                    event.preventDefault();
                });

                filesContainer.addEventListener('drop', async (event) => {
                    const target = event.target;
                    if (target instanceof Element && (target.closest('.file-item-grid') || target.closest('.file-item-list'))) {
                        return;
                    }

                    event.preventDefault();
                    const data = event.dataTransfer?.getData('application/dropzone-item');
                    const payload = data ? JSON.parse(data) : this.dragState;
                    const targetPath = this.currentDirectoryPath || this.getUploadsRoot();
                    const targetMode = this.currentFilter === 'all' ? 'multistream' : this.currentFilter;
                    if (!payload || !targetPath) {
                        return;
                    }

                    await this.moveExplorerItem(payload, targetPath, targetMode);
                });

                // Load storage info on page load
                this.loadStorageInfo();
                this.renderBreadcrumbs();
            }

            switchTab(tab) {
                this.currentTab = tab;

                const isUpload = tab === 'upload';
                const isStorage = tab === 'storage';
                const isBrowser = tab === 'browser';
                const uploadPanel = document.getElementById('uploadPanel');
                const storagePanel = document.getElementById('storagePanel');
                const browserPanel = document.getElementById('browserPanel');
                const tabUpload = document.getElementById('tabUpload');
                const tabStorage = document.getElementById('tabStorage');
                const tabBrowser = document.getElementById('tabBrowser');

                uploadPanel.classList.toggle('active', isUpload);
                storagePanel.classList.toggle('active', isStorage);
                browserPanel.classList.toggle('active', isBrowser);
                tabUpload.classList.toggle('active', isUpload);
                tabStorage.classList.toggle('active', isStorage);
                tabBrowser.classList.toggle('active', isBrowser);

                if (isStorage || isBrowser) {
                    this.loadStorageInfo();
                }
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
                this.targetNames = this.files.map(file => file.name);
                this.hasUploadStarted = false;
                this.displayFiles();
                this.updateStats();
                this.autoSelectMode();
            }

            setTargetName(index, value) {
                const fallback = this.files[index]?.name || '';
                const nextValue = value.trim().length > 0 ? value.trim() : fallback;
                this.targetNames[index] = nextValue;
            }

            getTargetName(index) {
                return this.targetNames[index] || this.files[index]?.name || ('incoming-file-' + (index + 1));
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
                this.updateStatus(`Ready to upload ${this.files.length} files`, 'info');
            }

            displayFiles() {
                const fileList = document.getElementById('fileList');
                fileList.innerHTML = this.files.map((file, index) => `
                    <div class="file-item" data-index="${index}">
                        <div class="file-info">
                            <div class="file-name">${file.name}</div>
                            <div class="file-meta">
                                <span>Type: ${file.type || 'Unknown'}</span>
                                <span>Modified: ${new Date(file.lastModified).toLocaleDateString()}</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: 0%"></div>
                            </div>
                            <div class="file-target" style="display: ${this.hasUploadStarted ? 'none' : 'block'};">
                                <label for="targetName_${index}">Save As</label>
                                <input
                                    id="targetName_${index}"
                                    type="text"
                                    value="${this.escapeAttr(this.getTargetName(index))}"
                                    ${this.hasUploadStarted ? 'disabled' : ''}
                                    oninput="triFlow.setTargetName(${index}, this.value)"
                                />
                            </div>
                        </div>
                        <div class="file-size">${formatFileSize(file.size)}</div>
                    </div>
                `).join('');
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

                this.hasUploadStarted = true;
                this.setTargetNameInputsLocked(true);

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

            setTargetNameInputsLocked(locked) {
                const targetSections = document.querySelectorAll('.file-target');
                targetSections.forEach((section) => {
                    if (section instanceof HTMLElement) {
                        section.style.display = locked ? 'none' : 'block';
                    }
                });

                const inputs = document.querySelectorAll('.file-target input');
                inputs.forEach((input) => {
                    if (input instanceof HTMLInputElement) {
                        input.disabled = locked;
                    }
                });
            }

            async loadStorageInfo() {
                try {
                    const response = await fetch('/api/triflow/files');
                    const data = await response.json();

                    if (response.ok) {
                        this.displayFilesList(data.files);
                        this.displayStorageStats(data.usage);
                    } else {
                        console.error('Failed to load storage info:', data);
                    }
                } catch (error) {
                    console.error('Error loading storage info:', error);
                }
            }

            displayStorageStats(usage) {
                const summaryCards = document.querySelectorAll('#storageStats .storage-card:not(.dedup-card)');
                if (summaryCards.length >= 3) {
                    const totalUploads = Number(usage.totalUploads || 0);
                    const uniqueFiles = Number(usage.uniqueFiles || 0);

                    const allCard = summaryCards[0];
                    const uniqueCard = summaryCards[1];
                    const savedCard = summaryCards[2];

                    const allCount = allCard.querySelector('.storage-count');
                    const allSize = allCard.querySelector('.storage-size');
                    if (allCount) allCount.textContent = `${totalUploads} records`;
                    if (allSize) allSize.textContent = usage.totalSizeFormatted;

                    const uniqueCount = uniqueCard.querySelector('.storage-count');
                    const uniqueSize = uniqueCard.querySelector('.storage-size');
                    if (uniqueCount) uniqueCount.textContent = `${uniqueFiles} unique files`;
                    if (uniqueSize) uniqueSize.textContent = usage.appPhysicalFormatted;

                    const savedCount = savedCard.querySelector('.storage-count');
                    const savedSize = savedCard.querySelector('.storage-size');
                    if (savedCount) savedCount.textContent = usage.deduplicationRatio;
                    if (savedSize) savedSize.textContent = usage.savedSpaceFormatted;
                }

                // Add deduplication stats if not already present
                const storageSection = document.querySelector('.storage-stats');
                let dedupCard = document.querySelector('.dedup-card');
                if (!dedupCard) {
                    dedupCard = document.createElement('div');
                    dedupCard.className = 'storage-card dedup-card';
                    dedupCard.innerHTML = '<h3>💾 Deduplication</h3><div class="storage-info"><span class="storage-count"></span><span class="storage-size"></span><span class="dedup-ratio"></span></div>';
                    storageSection.appendChild(dedupCard);
                }

                const dedupCountEl = dedupCard.querySelector('.storage-count');
                const dedupSizeEl = dedupCard.querySelector('.storage-size');
                const dedupRatioEl = dedupCard.querySelector('.dedup-ratio');

                if (dedupCountEl) dedupCountEl.textContent = `${usage.uniqueFiles} unique files`;
                if (dedupSizeEl) dedupSizeEl.textContent = `Saved: ${usage.savedSpaceFormatted}`;
                if (dedupRatioEl) dedupRatioEl.textContent = `Ratio: ${usage.deduplicationRatio}`;

                this.renderStorageHighlights(usage);
                this.renderFileTypeDistribution();
                this.renderLargestFiles(3);
                this.renderArchiveRecommendations(30, 5);
                this.renderDeviceUsage(usage.device, usage.appPhysicalFormatted);
            }

            renderStorageHighlights(usage) {
                const container = document.getElementById('storageHighlights');
                if (!container) {
                    return;
                }

                const totalUploads = Number(usage.totalUploads || 0);
                const uniqueFiles = Number(usage.uniqueFiles || 0);
                const duplicateRefs = Math.max(0, totalUploads - uniqueFiles);
                const duplicationFactor = uniqueFiles > 0 ? (totalUploads / uniqueFiles).toFixed(2) + 'x' : '0x';

                container.innerHTML =
                    '<div class="highlight-card">' +
                        '<div class="highlight-label">Total Logical Size</div>' +
                        '<div class="highlight-value">' + this.escapeHtml(usage.totalSizeFormatted || formatFileSize(0)) + '</div>' +
                        '<div class="highlight-sub">All upload records combined</div>' +
                    '</div>' +
                    '<div class="highlight-card">' +
                        '<div class="highlight-label">Physical On Disk</div>' +
                        '<div class="highlight-value">' + this.escapeHtml(usage.appPhysicalFormatted || formatFileSize(0)) + '</div>' +
                        '<div class="highlight-sub">Unique bytes currently stored</div>' +
                    '</div>' +
                    '<div class="highlight-card">' +
                        '<div class="highlight-label">Duplicate References</div>' +
                        '<div class="highlight-value">' + duplicateRefs + '</div>' +
                        '<div class="highlight-sub">Duplication factor: ' + duplicationFactor + '</div>' +
                    '</div>' +
                    '<div class="highlight-card">' +
                        '<div class="highlight-label">Space Saved</div>' +
                        '<div class="highlight-value">' + this.escapeHtml(usage.savedSpaceFormatted || formatFileSize(0)) + '</div>' +
                        '<div class="highlight-sub">Dedupe ratio: ' + this.escapeHtml(usage.deduplicationRatio || '0%') + '</div>' +
                    '</div>';
            }

            renderFileTypeDistribution() {
                const container = document.getElementById('fileTypeDistribution');
                if (!container) {
                    return;
                }

                const files = Array.isArray(this.storedFiles) ? this.storedFiles : [];
                const buckets = new Map();
                const palette = {
                    Image: '#4a9eff',
                    Video: '#00c2a8',
                    Audio: '#ff8c42',
                    Document: '#b388ff',
                    Archive: '#ffc857',
                    Text: '#64d2ff',
                    Other: '#8b9aad'
                };

                for (const file of files) {
                    const label = this.getFileTypeLabel(file);
                    const current = buckets.get(label) || { size: 0, count: 0 };
                    current.size += Number(file.size || 0);
                    current.count += 1;
                    buckets.set(label, current);
                }

                const entries = Array.from(buckets.entries())
                    .map(([label, data]) => ({ label, ...data }))
                    .sort((a, b) => b.size - a.size)
                    .slice(0, 6);

                const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
                if (entries.length === 0) {
                    container.innerHTML = '<div class="efficiency-item"><span class="efficiency-label">No files indexed yet</span><span class="efficiency-value">-</span></div>';
                    return;
                }

                container.innerHTML = entries.map((entry) => {
                    const percent = totalBytes > 0 ? (entry.size / totalBytes) * 100 : 0;
                    const color = palette[entry.label] || palette.Other;
                    return '<div class="mode-row">' +
                        '<span class="mode-label">' + this.escapeHtml(entry.label) + '</span>' +
                        '<div class="mode-bar"><div class="mode-fill" style="width:' + percent.toFixed(2) + '%; background:' + color + ';"></div></div>' +
                        '<span class="mode-value">' + formatFileSize(entry.size) + '</span>' +
                    '</div>' +
                    '<div class="mode-row">' +
                        '<span class="mode-label" style="opacity:.7">Files</span>' +
                        '<div class="mode-bar"><div class="mode-fill" style="width:' + percent.toFixed(2) + '%; background:#344861;"></div></div>' +
                        '<span class="mode-value">' + entry.count + '</span>' +
                    '</div>';
                }).join('');
            }

            renderLargestFiles(limit = 3) {
                const container = document.getElementById('largestFiles');
                if (!container) {
                    return;
                }

                const files = Array.isArray(this.storedFiles) ? this.storedFiles : [];
                const largest = files
                    .slice()
                    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
                    .slice(0, limit);

                if (largest.length === 0) {
                    container.innerHTML = '<div class="efficiency-item"><span class="efficiency-label">No files indexed yet</span><span class="efficiency-value">-</span></div>';
                    return;
                }

                container.innerHTML = largest.map((file, index) => {
                    const name = file.operatorName || file.name || 'unnamed-file';
                    const typeLabel = this.getFileTypeLabel(file);
                    return '<div class="largest-file-row">' +
                        '<div class="largest-file-top">' +
                            '<span class="largest-file-name">' + (index + 1) + '. ' + this.escapeHtml(name) + '</span>' +
                            '<span class="largest-file-size">' + formatFileSize(Number(file.size || 0)) + '</span>' +
                        '</div>' +
                        '<div class="largest-file-sub">' + this.escapeHtml(typeLabel) + '</div>' +
                    '</div>';
                }).join('');
            }

            renderArchiveRecommendations(staleDays = 30, limit = 5) {
                const container = document.getElementById('archiveRecommendations');
                if (!container) {
                    return;
                }

                const files = Array.isArray(this.storedFiles) ? this.storedFiles : [];
                const uniqueByPath = new Map();
                for (const file of files) {
                    const key = String(file.path || '');
                    if (!key) {
                        continue;
                    }

                    const existing = uniqueByPath.get(key);
                    if (!existing || new Date(file.uploadedAt).getTime() > new Date(existing.uploadedAt).getTime()) {
                        uniqueByPath.set(key, file);
                    }
                }

                const nowMs = Date.now();
                const candidates = Array.from(uniqueByPath.values())
                    .map((file) => {
                        const touchedMs = this.parseSqliteUtcDate(file.lastTouchedAt || file.uploadedAt);
                        const ageMs = Number.isFinite(touchedMs) ? (nowMs - touchedMs) : 0;
                        const ageDays = Math.max(0, Math.floor(ageMs / 86400000));
                        return {
                            file,
                            ageDays,
                            touchedMs: Number.isFinite(touchedMs) ? touchedMs : nowMs
                        };
                    })
                    .filter((entry) => entry.ageDays >= staleDays)
                    .sort((a, b) => {
                        if (b.ageDays !== a.ageDays) {
                            return b.ageDays - a.ageDays;
                        }

                        return Number(b.file.size || 0) - Number(a.file.size || 0);
                    })
                    .slice(0, limit);

                if (candidates.length === 0) {
                    container.innerHTML = '<div class="efficiency-item"><span class="efficiency-label">No stale files past ' + staleDays + ' days</span><span class="efficiency-value">Healthy</span></div>';
                    return;
                }

                container.innerHTML = candidates.map((entry) => {
                    const file = entry.file;
                    const displayName = file.operatorName || file.name || 'unnamed-file';
                    const touchedAtLabel = new Date(entry.touchedMs).toLocaleDateString();
                    const downloads = Number(file.downloadCount || 0);
                    const previews = Number(file.previewCount || 0);
                    return '<div class="archive-row">' +
                        '<div class="archive-title">"' + this.escapeHtml(displayName) + '" has not been touched in ' + entry.ageDays + ' days.</div>' +
                        '<div class="archive-sub">Would you like to compress this file?</div>' +
                        '<div class="archive-meta">' +
                            '<span>' + formatFileSize(Number(file.size || 0)) + '</span>' +
                            '<span>Downloads: ' + downloads + '</span>' +
                            '<span>Previews: ' + previews + '</span>' +
                            '<span>Last touched: ' + touchedAtLabel + '</span>' +
                        '</div>' +
                    '</div>';
                }).join('');
            }

            parseSqliteUtcDate(value) {
                const input = String(value || '').trim();
                if (!input) {
                    return Date.now();
                }

                const isoLike = input.includes('T') ? input : input.replace(' ', 'T') + 'Z';
                const parsed = Date.parse(isoLike);
                return Number.isFinite(parsed) ? parsed : Date.now();
            }

            getFileTypeLabel(file) {
                const type = String(file?.type || '').toLowerCase();
                const name = String(file?.name || '').toLowerCase();
                const ext = name.includes('.') ? name.split('.').pop() : '';

                if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'Image';
                if (type.startsWith('video/') || ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'mpeg', 'mpg', 'ogv'].includes(ext)) return 'Video';
                if (type.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga', 'aac', 'opus'].includes(ext)) return 'Audio';
                if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'Document';
                if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'Archive';
                if (type.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'csv', 'log', 'js', 'ts', 'html', 'css'].includes(ext)) return 'Text';
                return 'Other';
            }

            renderDeviceUsage(device, appPhysicalFormatted) {
                const container = document.getElementById('deviceUsage');
                if (!container) {
                    return;
                }

                const meta = container.querySelector('.device-meta');
                const bar = container.querySelector('.block-bar');
                const legend = container.querySelector('.block-legend');

                if (!meta || !bar || !legend) {
                    return;
                }

                if (!device) {
                    meta.textContent = 'Device information unavailable for this storage root.';
                    bar.innerHTML = '';
                    legend.innerHTML = '';
                    return;
                }

                const appPercent = Number((device.blockGraph.app || 0).toFixed(2));
                const otherPercent = Number((device.blockGraph.other || 0).toFixed(2));
                const freePercent = Number((device.blockGraph.free || 0).toFixed(2));

                meta.textContent =
                    'Mount: ' + device.mountPath +
                    ' | Total: ' + formatFileSize(device.totalBytes) +
                    ' | Used: ' + formatFileSize(device.usedBytes) +
                    ' (' + device.usagePercent.toFixed(1) + '%)';

                bar.innerHTML =
                    '<div class="block-segment app" style="width:' + appPercent + '%"></div>' +
                    '<div class="block-segment other" style="width:' + otherPercent + '%"></div>' +
                    '<div class="block-segment free" style="width:' + freePercent + '%"></div>';

                const appText = appPhysicalFormatted || formatFileSize(device.appPhysicalBytes || 0);
                legend.innerHTML =
                    '<div class="legend-item"><span class="legend-dot" style="background:#00c2a8"></span>DropZone Files: ' + appText + ' (' + appPercent.toFixed(1) + '%)</div>' +
                    '<div class="legend-item"><span class="legend-dot" style="background:#ff8c42"></span>Other Device Usage: ' + formatFileSize(device.otherUsedBytes || 0) + ' (' + otherPercent.toFixed(1) + '%)</div>' +
                    '<div class="legend-item"><span class="legend-dot" style="background:#2f7cff"></span>Free Space: ' + formatFileSize(device.availableBytes || 0) + ' (' + freePercent.toFixed(1) + '%)</div>';
            }

            displayFilesList(filesData) {
                this.storedFiles = [
                    ...filesData.uploadsByMode.multistream,
                    ...filesData.uploadsByMode.arcpack,
                    ...filesData.uploadsByMode.chunkline
                ];
                this.directoryRoots = filesData.directories || {};
                if (Array.isArray(filesData.explorerDirectories) && filesData.explorerDirectories.length > 0) {
                    this.storedDirectories = filesData.explorerDirectories;
                } else {
                    this.storedDirectories = this.buildDirectoryEntries(this.directoryRoots);
                }

                const uploadsRoot = this.getUploadsRoot();
                if (!this.currentDirectoryPath && uploadsRoot) {
                    this.currentDirectoryPath = uploadsRoot;
                }

                if (this.currentDirectoryPath) {
                    const stillExists = this.currentDirectoryPath === uploadsRoot || this.storedDirectories.some((dir) => dir.path === this.currentDirectoryPath);
                    if (!stillExists) {
                        this.currentDirectoryPath = uploadsRoot;
                        this.currentFilter = 'all';
                    }
                }

                this.renderFilesExplorer();
            }

            getUploadsRoot() {
                const rootCandidate = this.directoryRoots.multistream || this.directoryRoots.arcpack || this.directoryRoots.chunkline;
                if (!rootCandidate) {
                    return null;
                }

                const idx = rootCandidate.lastIndexOf('/');
                return idx > 0 ? rootCandidate.substring(0, idx) : rootCandidate;
            }

            getParentPath(path) {
                const idx = path.lastIndexOf('/');
                return idx > 0 ? path.substring(0, idx) : path;
            }

            getCurrentDirectoryEntry() {
                if (!this.currentDirectoryPath) {
                    return null;
                }

                return this.storedDirectories.find((dir) => dir.path === this.currentDirectoryPath) || null;
            }

            renderBreadcrumbs() {
                const trail = document.getElementById('breadcrumbTrail');
                if (!trail) {
                    return;
                }

                const items = [];
                items.push('<span class="breadcrumb-item" onclick="triFlow.navigateToRoot()">🏠 Root</span>');

                const uploadsRoot = this.getUploadsRoot();
                if (!this.currentDirectoryPath || this.currentDirectoryPath === uploadsRoot) {
                    items.push('<span>/</span>');
                    items.push('<span class="breadcrumb-item" style="opacity:1; cursor:default; color:#4a9eff;">All Files</span>');
                } else {
                    const currentDir = this.getCurrentDirectoryEntry();
                    items.push('<span>/</span>');
                    items.push('<span class="breadcrumb-item" onclick="triFlow.navigateToRoot()">All Files</span>');
                    items.push('<span>/</span>');
                    items.push('<span class="breadcrumb-item" style="opacity:1; cursor:default; color:#4a9eff;">' + (currentDir?.label || this.currentDirectoryPath) + '</span>');
                }

                trail.innerHTML = items.join(' ');
            }

            buildDirectoryEntries(directories) {
                return Object.entries(directories).map(([mode, path]) => ({
                    mode,
                    path,
                    label: mode.charAt(0).toUpperCase() + mode.slice(1)
                }));
            }

            renderFilesExplorer() {
                const container = document.getElementById('filesContainer');
                let visibleDirectories = this.getVisibleDirectories();
                let filteredFiles = this.getFilteredFiles();
                this.renderBreadcrumbs();

                if (this.browserSearchTerm) {
                    // Global search scope: include matches from all folders and files.
                    visibleDirectories = this.storedDirectories.filter((dir) => this.matchesBrowserSearch(dir.label, dir.path, dir.mode));
                    filteredFiles = this.storedFiles.filter((file) => this.matchesBrowserSearch(file.operatorName, file.name, file.path, file.mode, file.type));
                }

                if (filteredFiles.length === 0 && visibleDirectories.length === 0) {
                    container.innerHTML = this.browserSearchTerm
                        ? '<p class="no-files">No matches for "' + this.escapeHtml(this.browserSearchTerm) + '"</p>'
                        : '<p class="no-files">No files or directories found</p>';
                    return;
                }

                // Sort by upload date (newest first)
                filteredFiles.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

                if (this.currentView === 'grid') {
                    this.renderGridView(visibleDirectories, filteredFiles);
                } else {
                    this.renderListView(visibleDirectories, filteredFiles);
                }
            }

            getVisibleDirectories() {
                const uploadsRoot = this.getUploadsRoot();
                if (!this.currentDirectoryPath || this.currentDirectoryPath === uploadsRoot) {
                    return this.storedDirectories.filter((dir) => this.getParentPath(dir.path) === uploadsRoot);
                }

                return this.storedDirectories.filter((dir) => this.getParentPath(dir.path) === this.currentDirectoryPath);
            }

            getParentDirectoryTarget() {
                if (this.browserSearchTerm) {
                    return null;
                }

                const uploadsRoot = this.getUploadsRoot();
                if (!uploadsRoot || !this.currentDirectoryPath || this.currentDirectoryPath === uploadsRoot) {
                    return null;
                }

                const parentPath = this.getParentPath(this.currentDirectoryPath);
                const mode = this.currentFilter === 'all' ? 'multistream' : this.currentFilter;
                return {
                    mode,
                    path: parentPath,
                    label: '.. Parent Directory',
                    isParentShortcut: true
                };
            }

            getFilteredFiles() {
                if (this.currentDirectoryPath) {
                    return this.storedFiles.filter((file) => this.getParentPath(file.path) === this.currentDirectoryPath);
                }

                if (this.currentFilter === 'all') {
                    return this.storedFiles;
                }

                return this.storedFiles.filter(file => file.mode === this.currentFilter);
            }

            renderGridView(directories, files) {
                const container = document.getElementById('filesContainer');
                container.className = 'file-grid';

                const parentTarget = this.getParentDirectoryTarget();
                const allDirectories = parentTarget ? [parentTarget].concat(directories) : directories;

                const directoryCards = allDirectories.map(dir => {
                    const encodedPath = encodeURIComponent(dir.path);
                    const encodedMode = encodeURIComponent(dir.mode);
                    const encodedName = encodeURIComponent(dir.label);
                    const isParentCard = dir.isParentShortcut ? ' file-parent-shortcut' : '';

                    return '<div class="file-item-grid' + isParentCard + '" draggable="true" onclick="triFlow.navigateToDirectory(decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'))" oncontextmenu="triFlow.openItemContextMenu(event, 0, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragstart="triFlow.handleItemDragStart(event, 0, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragend="triFlow.handleItemDragEnd(event)" ondragover="triFlow.handleDropTargetDragOver(event)" ondragleave="triFlow.handleDropTargetDragLeave(event)" ondrop="triFlow.handleDropOnDirectory(event, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'))">' +
                        '<div class="file-icon">' + (dir.isParentShortcut ? '⬆️' : '📂') + '</div>' +
                        '<div class="file-name-grid">' + dir.label + '</div>' +
                    '</div>';
                });

                const fileCards = files.map(file => {
                    const encodedPath = encodeURIComponent(file.path);
                    const encodedMode = encodeURIComponent(file.mode);
                    const encodedName = encodeURIComponent(file.operatorName || file.name);

                    const duplicateBadge = file.isDuplicate ? '<span style="background: #ffc107; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">🔗 DUPLICATE</span>' : '';

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

                    return '<div class="file-item-grid" draggable="true" onclick="triFlow.previewFile(decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" oncontextmenu="triFlow.openItemContextMenu(event, 1, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragstart="triFlow.handleItemDragStart(event, 1, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragend="triFlow.handleItemDragEnd(event)">' +
                        fileIcon +
                        '<div class="file-name-grid">' + file.operatorName + '</div>' +
                        duplicateBadge +
                    '</div>';
                });

                container.innerHTML = directoryCards.concat(fileCards).join('');
            }

            renderListView(directories, files) {
                const container = document.getElementById('filesContainer');
                container.className = 'file-list-view';

                const parentTarget = this.getParentDirectoryTarget();
                const allDirectories = parentTarget ? [parentTarget].concat(directories) : directories;

                const directoryRows = allDirectories.map(dir => {
                    const encodedPath = encodeURIComponent(dir.path);
                    const encodedMode = encodeURIComponent(dir.mode);
                    const encodedName = encodeURIComponent(dir.label);
                    const isParentRow = dir.isParentShortcut ? ' file-parent-shortcut' : '';

                    return '<div class="file-item-list' + isParentRow + '" draggable="true" onclick="triFlow.navigateToDirectory(decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'))" oncontextmenu="triFlow.openItemContextMenu(event, 0, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragstart="triFlow.handleItemDragStart(event, 0, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragend="triFlow.handleItemDragEnd(event)" ondragover="triFlow.handleDropTargetDragOver(event)" ondragleave="triFlow.handleDropTargetDragLeave(event)" ondrop="triFlow.handleDropOnDirectory(event, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'))">' +
                        '<div class="file-icon-list">' + (dir.isParentShortcut ? '⬆️' : '📂') + '</div>' +
                        '<div class="file-name-list">' +
                            '<div>' + dir.label + '</div>' +
                        '</div>' +
                        '<div class="file-meta-list">' +
                            '<span>Directory</span>' +
                            '<span>-</span>' +
                            '<span class="file-record-mode">' + dir.mode + '</span>' +
                        '</div>' +
                    '</div>';
                });

                const fileRows = files.map(file => {
                    const encodedPath = encodeURIComponent(file.path);
                    const encodedMode = encodeURIComponent(file.mode);
                    const encodedName = encodeURIComponent(file.operatorName || file.name);

                    const duplicateBadge = file.isDuplicate ? '<span style="background: #ffc107; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-left: 8px;">🔗 DUP</span>' : '';

                    return '<div class="file-item-list" draggable="true" onclick="triFlow.previewFile(decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" oncontextmenu="triFlow.openItemContextMenu(event, 1, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragstart="triFlow.handleItemDragStart(event, 1, decodeURIComponent(\'' + encodedPath + '\'), decodeURIComponent(\'' + encodedMode + '\'), decodeURIComponent(\'' + encodedName + '\'))" ondragend="triFlow.handleItemDragEnd(event)">' +
                        '<div class="file-icon-list">' + this.getFileIcon(file.type, file.name) + '</div>' +
                        '<div class="file-name-list">' +
                            '<div>' + file.operatorName + duplicateBadge + '</div>' +
                        '</div>' +
                        '<div class="file-meta-list">' +
                            '<span>' + formatFileSize(file.size) + '</span>' +
                            '<span>' + new Date(file.uploadedAt).toLocaleDateString() + '</span>' +
                            '<span class="file-record-mode">' + file.mode + '</span>' +
                        '</div>' +
                    '</div>';
                });

                container.innerHTML = directoryRows.concat(fileRows).join('');
            }

            getFileIcon(type, name) {
                const normalizedType = String(type || '').toLowerCase();
                const normalizedName = String(name || '').toLowerCase();
                const ext = normalizedName.includes('.') ? normalizedName.split('.').pop() : '';

                if (normalizedType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return '🖼️';
                if (normalizedType.includes('video') || ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'mpeg', 'mpg', 'ogv'].includes(ext)) return '🎬';
                if (normalizedType.includes('audio') || ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga', 'aac', 'opus'].includes(ext)) return '🎵';
                if (normalizedType === 'application/pdf' || ext === 'pdf') return '📄';
                if (normalizedType === 'application/json' || ext === 'json') return '📋';
                if (normalizedType.startsWith('text/') || ['txt', 'md', 'log', 'csv'].includes(ext)) return '📝';
                if (normalizedType.includes('zip') || normalizedType.includes('tar') || normalizedType.includes('gz') || ['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return '📦';
                return '📄';
            }

            setView(view) {
                this.currentView = view;

                // Update button states
                document.getElementById('gridViewBtn').classList.toggle('active', view === 'grid');
                document.getElementById('listViewBtn').classList.toggle('active', view === 'list');

                // Re-render files
                this.renderFilesExplorer();
            }

            setBrowserSearch(value) {
                this.browserSearchTerm = String(value || '').trim().toLowerCase();
                this.renderFilesExplorer();
            }

            matchesBrowserSearch() {
                if (!this.browserSearchTerm) {
                    return true;
                }

                const terms = Array.from(arguments);
                return terms.some((term) => String(term || '').toLowerCase().includes(this.browserSearchTerm));
            }

            navigateToRoot() {
                this.currentFilter = 'all';
                this.currentDirectoryPath = this.getUploadsRoot();
                this.renderFilesExplorer();
            }

            navigateToMode(mode) {
                this.currentFilter = mode;
                this.currentDirectoryPath = this.directoryRoots[mode] || this.getUploadsRoot();
                this.renderFilesExplorer();
            }

            navigateToDirectory(path, mode) {
                this.currentFilter = mode;
                this.currentDirectoryPath = path;
                this.renderFilesExplorer();
            }

            handleItemDragStart(event, itemType, path, mode, name) {
                const normalizedType = Number(itemType) === 0 ? 'directory' : 'file';
                this.dragState = { itemType: normalizedType, path, mode, name };
                const payload = JSON.stringify(this.dragState);
                if (event.dataTransfer) {
                    event.dataTransfer.setData('application/dropzone-item', payload);
                    event.dataTransfer.effectAllowed = 'move';
                }

                const element = event.currentTarget;
                if (element instanceof HTMLElement) {
                    element.classList.add('dragging');
                }
            }

            handleItemDragEnd(event) {
                this.dragState = null;
                const element = event.currentTarget;
                if (element instanceof HTMLElement) {
                    element.classList.remove('dragging');
                }

                document.querySelectorAll('.drop-target').forEach((node) => node.classList.remove('drop-target'));
            }

            handleDropTargetDragOver(event) {
                if (!this.dragState) {
                    return;
                }

                event.preventDefault();
                const element = event.currentTarget;
                if (element instanceof HTMLElement) {
                    element.classList.add('drop-target');
                }
            }

            handleDropTargetDragLeave(event) {
                const element = event.currentTarget;
                if (element instanceof HTMLElement) {
                    element.classList.remove('drop-target');
                }
            }

            async handleDropOnDirectory(event, targetDirectoryPath, targetMode) {
                event.preventDefault();
                this.handleDropTargetDragLeave(event);

                const data = event.dataTransfer?.getData('application/dropzone-item');
                const payload = data ? JSON.parse(data) : this.dragState;
                if (!payload) {
                    return;
                }

                if (payload.path === targetDirectoryPath) {
                    return;
                }

                await this.moveExplorerItem(payload, targetDirectoryPath, targetMode);
            }

            async moveExplorerItem(item, targetDirectoryPath, targetMode) {
                try {
                    const response = await fetch('/api/files/move', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sourcePath: item.path,
                            sourceMode: item.mode,
                            targetDirectoryPath,
                            targetMode
                        })
                    });

                    const result = await response.json();
                    if (!response.ok || !result.success) {
                        throw new Error(result.error || 'Move failed');
                    }

                    this.updateStatus('Moved ' + result.moved.name, 'success');

                    if (this.currentDirectoryPath === item.path && result.moved.itemType === 'directory') {
                        this.currentDirectoryPath = result.moved.newPath;
                    }

                    await this.loadStorageInfo();
                } catch (error) {
                    this.updateStatus('Move failed: ' + error.message, 'error');
                    alert('Move failed: ' + error.message);
                }
            }

            openItemContextMenu(event, itemType, path, mode, name) {
                event.preventDefault();
                event.stopPropagation();

                const menu = document.getElementById('itemContextMenu');
                if (!menu) {
                    return;
                }

                const normalizedType = Number(itemType) === 0 || itemType === 'directory' ? 'directory' : 'file';
                this.contextMenuTarget = { itemType: normalizedType, path, mode, name };

                const header = '<div class="context-menu-header">' + this.escapeHtml(name) + '</div>';
                const entries = [];

                if (normalizedType === 'directory') {
                    entries.push('<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;open&quot;)">Open Directory</button>');
                    entries.push('<button class="context-menu-item danger" onclick="triFlow.handleContextAction(&quot;deleteDirectory&quot;)">Delete Directory</button>');
                } else {
                    entries.push('<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;preview&quot;)">Preview</button>');
                    entries.push('<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;download&quot;)">Download</button>');
                    entries.push('<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;rename&quot;)">Rename</button>');
                    entries.push('<button class="context-menu-item danger" onclick="triFlow.handleContextAction(&quot;delete&quot;)">Delete</button>');
                }

                entries.push('<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;copyPath&quot;)">Copy Path</button>');

                menu.innerHTML = header + entries.join('');
                menu.classList.add('active');

                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const menuRect = menu.getBoundingClientRect();
                const x = Math.min(event.clientX, Math.max(0, viewportWidth - menuRect.width - 8));
                const y = Math.min(event.clientY, Math.max(0, viewportHeight - menuRect.height - 8));

                menu.style.left = x + 'px';
                menu.style.top = y + 'px';
            }

            hideItemContextMenu() {
                const menu = document.getElementById('itemContextMenu');
                if (!menu) {
                    return;
                }

                menu.classList.remove('active');
                this.contextMenuTarget = null;
            }

            openExplorerContextMenu(event) {
                event.preventDefault();
                event.stopPropagation();

                const menu = document.getElementById('itemContextMenu');
                if (!menu) {
                    return;
                }

                this.contextMenuTarget = { itemType: 'explorer' };
                menu.innerHTML =
                    '<div class="context-menu-header">Explorer</div>' +
                    '<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;newFolder&quot;)">New Folder</button>' +
                    '<button class="context-menu-item" onclick="triFlow.handleContextAction(&quot;refresh&quot;)">Refresh</button>';

                menu.classList.add('active');
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const menuRect = menu.getBoundingClientRect();
                const x = Math.min(event.clientX, Math.max(0, viewportWidth - menuRect.width - 8));
                const y = Math.min(event.clientY, Math.max(0, viewportHeight - menuRect.height - 8));
                menu.style.left = x + 'px';
                menu.style.top = y + 'px';
            }

            async handleContextAction(action) {
                const target = this.contextMenuTarget;
                this.hideItemContextMenu();

                if (!target) {
                    return;
                }

                if (action === 'open') {
                    this.navigateToDirectory(target.path, target.mode);
                    return;
                }

                if (action === 'preview') {
                    await this.previewFile(target.path, target.mode, target.name);
                    return;
                }

                if (action === 'download') {
                    await this.downloadFile(target.path, target.mode, target.name);
                    return;
                }

                if (action === 'rename') {
                    await this.renameFileDialog(target.path, target.mode, target.name);
                    return;
                }

                if (action === 'delete') {
                    await this.deleteFile(target.path, target.mode, target.name);
                    return;
                }

                if (action === 'copyPath') {
                    try {
                        await navigator.clipboard.writeText(target.path);
                        this.updateStatus('Path copied to clipboard', 'success');
                    } catch (error) {
                        this.updateStatus('Failed to copy path', 'error');
                    }
                    return;
                }

                if (action === 'newFolder') {
                    await this.createFolderDialog();
                    return;
                }

                if (action === 'deleteDirectory') {
                    await this.deleteDirectory(target.path, target.mode, target.name);
                    return;
                }

                if (action === 'refresh') {
                    await this.loadStorageInfo();
                    return;
                }
            }

            getCreateFolderContext() {
                const allowedModes = ['multistream', 'arcpack', 'chunkline'];
                const currentEntry = this.getCurrentDirectoryEntry();
                const currentMode = allowedModes.includes(this.currentFilter) ? this.currentFilter : 'multistream';

                if (currentEntry && allowedModes.includes(currentEntry.mode)) {
                    return {
                        mode: currentEntry.mode,
                        parentPath: currentEntry.path,
                        label: currentEntry.label
                    };
                }

                const firstEntry = this.storedDirectories.find((dir) => allowedModes.includes(dir.mode));
                if (!firstEntry) {
                    return null;
                }

                const uploadsRoot = this.directoryRoots.multistream
                    ? this.directoryRoots.multistream.substring(0, this.directoryRoots.multistream.lastIndexOf('/'))
                    : firstEntry.path.substring(0, firstEntry.path.lastIndexOf('/'));
                return {
                    mode: currentMode,
                    parentPath: uploadsRoot,
                    label: 'All Files'
                };
            }

            isLinuxSafeFolderName(name) {
                if (!name || !name.trim()) {
                    return false;
                }

                const trimmed = name.trim();
                if (trimmed === '.' || trimmed === '..') {
                    return false;
                }

                if (/[\/\0]/.test(trimmed)) {
                    return false;
                }

                if (/[\x00-\x1F\x7F]/.test(trimmed)) {
                    return false;
                }

                return true;
            }

            isLinuxSafeFileName(name) {
                if (!name || !name.trim()) {
                    return false;
                }

                const trimmed = name.trim();
                if (trimmed === '.' || trimmed === '..') {
                    return false;
                }

                if (/[\/\0]/.test(trimmed)) {
                    return false;
                }

                if (/[\x00-\x1F\x7F]/.test(trimmed)) {
                    return false;
                }

                return true;
            }

            async renameFileDialog(path, mode, currentName) {
                const nextName = prompt('Rename file:', currentName || '');
                if (nextName === null) {
                    return;
                }

                if (!this.isLinuxSafeFileName(nextName)) {
                    this.updateStatus('Invalid file name for Linux filesystem', 'error');
                    alert('Invalid file name for Linux filesystem. Avoid /, control chars, ., and ..');
                    return;
                }

                try {
                    const response = await fetch('/api/files/rename', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sourcePath: path,
                            sourceMode: mode,
                            newName: nextName
                        })
                    });

                    const result = await response.json();
                    if (!response.ok || !result.success) {
                        throw new Error(result.error || 'Rename failed');
                    }

                    this.updateStatus('Renamed to ' + result.renamed.newName, 'success');
                    await this.loadStorageInfo();
                } catch (error) {
                    this.updateStatus('Rename failed: ' + error.message, 'error');
                    alert('Rename failed: ' + error.message);
                }
            }

            async createFolderDialog() {
                let context = this.getCreateFolderContext();
                if (!context) {
                    await this.loadStorageInfo();
                    context = this.getCreateFolderContext();
                }

                if (!context) {
                    alert('Cannot resolve storage directory context yet. Please refresh and try again.');
                    return;
                }

                const folderName = prompt('New folder name (Linux-safe, no /):', '');
                if (folderName === null) {
                    return;
                }

                if (!this.isLinuxSafeFolderName(folderName)) {
                    this.updateStatus('Invalid folder name for Linux filesystem', 'error');
                    alert('Invalid folder name for Linux filesystem. Avoid /, control chars, ., and ..');
                    return;
                }

                try {
                    const response = await fetch('/api/files/folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            parentPath: context.parentPath,
                            mode: context.mode,
                            name: folderName
                        })
                    });

                    const result = await response.json();
                    if (!response.ok || !result.success) {
                        throw new Error(result.error || 'Folder creation failed');
                    }

                    this.updateStatus('Created folder: ' + result.folder.name, 'success');
                    await this.loadStorageInfo();
                    if (context.mode && this.currentFilter === 'all') {
                        this.navigateToMode(context.mode);
                    }
                } catch (error) {
                    this.updateStatus('Create folder failed: ' + error.message, 'error');
                    alert('Create folder failed: ' + error.message);
                }
            }

            async previewFile(path, mode, name) {
                const modal = document.getElementById('previewModal');
                const title = document.getElementById('previewTitle');
                const meta = document.getElementById('previewMeta');
                const body = document.getElementById('previewBody');
                const previewUrl = '/api/files/preview?path=' + encodeURIComponent(path) + '&mode=' + encodeURIComponent(mode);

                title.textContent = name;
                meta.textContent = 'Mode: ' + mode + ' | Path: ' + path;
                body.innerHTML = '<p>Loading preview...</p>';

                modal.classList.add('active');

                try {
                    const lowerName = (name || '').toLowerCase();
                    const mediaExt = lowerName.includes('.') ? lowerName.split('.').pop() : '';
                    const videoExts = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'mpeg', 'mpg', 'ogv'];
                    const audioExts = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga', 'aac', 'opus'];

                    // Stream large media directly instead of reading whole files into memory.
                    if (mediaExt && videoExts.includes(mediaExt)) {
                        body.innerHTML = '<video controls preload="metadata" style="max-width: 100%; max-height: 75vh; width: 100%; background: #000;"><source src="' + previewUrl + '">Your browser does not support the video tag.</video>';
                        return;
                    }

                    if (mediaExt && audioExts.includes(mediaExt)) {
                        body.innerHTML = '<audio controls preload="metadata" style="width: 100%;"><source src="' + previewUrl + '">Your browser does not support the audio element.</audio>';
                        return;
                    }

                    const response = await fetch(previewUrl);

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
                        } else if (contentType.startsWith('video/')) {
                            body.innerHTML = '<video controls preload="metadata" style="max-width: 100%; max-height: 75vh; width: 100%; background: #000;"><source src="' + previewUrl + '" type="' + this.escapeAttr(contentType) + '">Your browser does not support the video tag.</video>';
                        } else if (contentType.startsWith('audio/')) {
                            body.innerHTML = '<audio controls preload="metadata" style="width: 100%;"><source src="' + previewUrl + '" type="' + this.escapeAttr(contentType) + '">Your browser does not support the audio element.</audio>';
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

            async deleteDirectory(path, mode, name) {
                try {
                    const summaryResponse = await fetch('/api/files/directory/summary?path=' + encodeURIComponent(path) + '&mode=' + encodeURIComponent(mode));
                    const summaryResult = await summaryResponse.json();
                    if (!summaryResponse.ok || !summaryResult.success) {
                        throw new Error(summaryResult.error || 'Could not summarize directory');
                    }

                    const summary = summaryResult.summary;
                    const message =
                        'Delete directory "' + name + '"?\n\n' +
                        'Contains:\n' +
                        '- Files: ' + summary.files + '\n' +
                        '- Directories: ' + summary.directories + '\n' +
                        '- Total items: ' + summary.items + '\n\n' +
                        'This cannot be undone.';

                    if (!confirm(message)) {
                        return;
                    }

                    const deleteResponse = await fetch('/api/files/directory?path=' + encodeURIComponent(path) + '&mode=' + encodeURIComponent(mode), {
                        method: 'DELETE'
                    });
                    const deleteResult = await deleteResponse.json();
                    if (!deleteResponse.ok || !deleteResult.success) {
                        throw new Error(deleteResult.error || 'Directory delete failed');
                    }

                    const deletedSummary = deleteResult.summary;
                    this.updateStatus(
                        'Directory deleted (' + deletedSummary.files + ' files, ' + deletedSummary.directories + ' directories, ' + deletedSummary.items + ' items)',
                        'success'
                    );

                    if (this.currentFilter !== 'all' && this.currentFilter === mode && path === this.getCurrentDirectoryEntry()?.path) {
                        this.navigateToRoot();
                    }

                    await this.loadStorageInfo();
                } catch (error) {
                    this.updateStatus('Delete directory failed: ' + error.message, 'error');
                    alert('Delete directory failed: ' + error.message);
                }
            }

            escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            escapeAttr(text) {
                return String(text)
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            }

            async multiStreamUpload() {
                const formData = new FormData();
                this.files.forEach((file, index) => {
                    formData.append('file_' + index, file);
                    formData.append('targetName_' + index, this.getTargetName(index));
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
                        const targetName = this.getTargetName(i);
                        this.updateStatus('Uploading file ' + (i + 1) + ' of ' + totalFiles + ': ' + targetName, 'info');
                        await this.uploadFileInChunks(file, i, targetName);

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

            async uploadFileInChunks(file, fileIndex, targetName) {
                const chunkSize = 1024 * 1024; // 1MB chunks
                const totalChunks = Math.ceil(file.size / chunkSize);

                for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                    const start = chunkIndex * chunkSize;
                    const end = Math.min(start + chunkSize, file.size);
                    const chunk = file.slice(start, end);

                    const formData = new FormData();
                    formData.append('chunk', chunk);
                    formData.append('filename', targetName);
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
                    this.updateStatus('Uploading ' + targetName + ' - chunk ' + currentChunk + ' of ' + totalChunks + ' (' + progress + '%)', 'info');
                }
            }

            async createArchive() {
                // Simplified archive creation - in real implementation would use compression streams
                return {
                    files: this.files.map((f, index) => ({
                        name: this.getTargetName(index),
                        originalName: f.name,
                        size: f.size,
                        type: f.type
                    })),
                    created: new Date().toISOString()
                };
            }

            updateFileProgress(fileIndex, progress) {
                const fileItem = document.querySelector(`.file-item[data-index="${fileIndex}"]`);
                if (fileItem) {
                    const progressFill = fileItem.querySelector('.progress-fill');
                    progressFill.style.width = `${progress}%`;
                }
            }

            clearFiles() {
                this.files = [];
                this.targetNames = [];
                this.hasUploadStarted = false;
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
                status.className = `status ${type}`;
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
        window.triFlow = new TriFlowIngest();
