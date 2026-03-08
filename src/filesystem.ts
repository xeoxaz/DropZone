import { readdirSync, statfsSync } from 'fs';
import { FileStorage } from './storage.js';
import { Database } from './database.js';

interface DeviceStorageUsage {
  mountPath: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  appPhysicalBytes: number;
  otherUsedBytes: number;
  blockGraph: {
    app: number;
    other: number;
    free: number;
  };
}

export interface StoredFile {
  id: number;
  name: string;
  operatorName: string;
  path: string;
  size: number;
  type: string;
  uploadedAt: string | Date;
  mode: string;
  hash: string;
  lastTouchedAt: string;
  downloadCount: number;
  previewCount: number;
  isDuplicate?: boolean;
}

export interface FileSystemStats {
  totalUploads: number;
  uniqueFiles: number;
  totalSize: number;
  savedSpace: number;
  uploadsByMode: {
    multistream: StoredFile[];
    arcpack: StoredFile[];
    chunkline: StoredFile[];
  };
  directories: {
    multistream: string;
    arcpack: string;
    chunkline: string;
    temp: string;
  };
  explorerDirectories: Array<{
    mode: string;
    path: string;
    label: string;
  }>;
}

export function getFileSystemStats(db: Database, storage: FileStorage): FileSystemStats {
  const storageStats = storage.getStorageStats();
  const allUploads = db.getAllUploadRecords();
  const explorerDirectories = listExplorerDirectories(storageStats);

  // Group uploads by mode
  const uploadsByMode = {
    multistream: [] as StoredFile[],
    arcpack: [] as StoredFile[],
    chunkline: [] as StoredFile[]
  };

  let totalSize = 0;
  const uniqueHashes = new Set<string>();

  for (const upload of allUploads) {
    uniqueHashes.add(upload.file_hash);

    const storedFile: StoredFile = {
      id: upload.id,
      name: upload.original_name,
      operatorName: upload.operator_name,
      path: upload.physical_path,
      size: Number(upload.size_bytes),
      type: getFileType(upload.original_name),
      uploadedAt: upload.uploaded_at,
      mode: upload.storage_mode,
      hash: upload.file_hash,
      lastTouchedAt: upload.last_touched_at,
      downloadCount: Number(upload.download_count || 0),
      previewCount: Number(upload.preview_count || 0)
    };

    totalSize += storedFile.size;

    if (upload.storage_mode in uploadsByMode) {
      uploadsByMode[upload.storage_mode as keyof typeof uploadsByMode].push(storedFile);
    }
  }

  // Check for duplicates
  const hashCounts = new Map<string, number>();
  for (const upload of allUploads) {
    hashCounts.set(upload.file_hash, (hashCounts.get(upload.file_hash) || 0) + 1);
  }

  // Mark duplicates and calculate space saved
  let physicalSize = 0;
  for (const mode of Object.values(uploadsByMode)) {
    for (const file of mode) {
      const count = hashCounts.get(file.hash) || 1;
      file.isDuplicate = count > 1;

      // Only count physical size once per unique hash
      if (!uniqueHashes.has(file.hash + '_counted')) {
        physicalSize += file.size;
        uniqueHashes.add(file.hash + '_counted');
      }
    }
  }

  const savedSpace = totalSize - physicalSize;

  return {
    totalUploads: allUploads.length,
    uniqueFiles: uniqueHashes.size / 2, // Divide by 2 because we added '_counted' suffix
    totalSize,
    savedSpace,
    uploadsByMode,
    directories: storageStats.directories,
    explorerDirectories
  };
}

function listExplorerDirectories(storageStats: any): Array<{ mode: string; path: string; label: string }> {
  const uploadsRoot = storageStats.uploadsDir as string;
  const modeRoots = storageStats.directories as Record<string, string>;
  const directories: Array<{ mode: string; path: string; label: string }> = [];
  const queue: string[] = [uploadsRoot];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    let entries: { isDirectory: () => boolean; name: string | Buffer }[];

    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryName = typeof entry.name === 'string' ? entry.name : entry.name.toString();
      const fullPath = `${current}/${entryName}`;
      const mode = classifyDirectoryMode(fullPath, modeRoots);

      directories.push({
        mode,
        path: fullPath,
        label: entryName
      });

      queue.push(fullPath);
    }
  }

  directories.sort((a, b) => a.path.localeCompare(b.path));
  return directories;
}

function classifyDirectoryMode(path: string, modeRoots: Record<string, string>): string {
  if (path === modeRoots.multistream || path.startsWith(modeRoots.multistream + '/')) return 'multistream';
  if (path === modeRoots.arcpack || path.startsWith(modeRoots.arcpack + '/')) return 'arcpack';
  if (path === modeRoots.chunkline || path.startsWith(modeRoots.chunkline + '/')) return 'chunkline';
  if (path === modeRoots.temp || path.startsWith(modeRoots.temp + '/')) return 'temp';
  return 'multistream';
}

function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'json': 'application/json',
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip'
  };

  return typeMap[ext || ''] || 'application/octet-stream';
}

export function getStorageUsage(db: Database, storage: FileStorage): any {
  const stats = getFileSystemStats(db, storage);
  const appPhysicalBytes = Math.max(0, stats.totalSize - stats.savedSpace);
  const deviceUsage = getDeviceStorageUsage(storage, appPhysicalBytes);

  return {
    totalUploads: stats.totalUploads,
    uniqueFiles: stats.uniqueFiles,
    totalSize: stats.totalSize,
    appPhysicalBytes,
    savedSpace: stats.savedSpace,
    totalSizeFormatted: formatFileSize(stats.totalSize),
    appPhysicalFormatted: formatFileSize(appPhysicalBytes),
    savedSpaceFormatted: formatFileSize(stats.savedSpace),
    deduplicationRatio: stats.totalUploads > 0 ? ((stats.savedSpace / stats.totalSize) * 100).toFixed(1) + '%' : '0%',
    device: deviceUsage,
    uploadsByMode: {
      multistream: {
        count: stats.uploadsByMode.multistream.length,
        size: stats.uploadsByMode.multistream.reduce((sum, f) => sum + f.size, 0),
        sizeFormatted: formatFileSize(stats.uploadsByMode.multistream.reduce((sum, f) => sum + f.size, 0))
      },
      arcpack: {
        count: stats.uploadsByMode.arcpack.length,
        size: stats.uploadsByMode.arcpack.reduce((sum, f) => sum + f.size, 0),
        sizeFormatted: formatFileSize(stats.uploadsByMode.arcpack.reduce((sum, f) => sum + f.size, 0))
      },
      chunkline: {
        count: stats.uploadsByMode.chunkline.length,
        size: stats.uploadsByMode.chunkline.reduce((sum, f) => sum + f.size, 0),
        sizeFormatted: formatFileSize(stats.uploadsByMode.chunkline.reduce((sum, f) => sum + f.size, 0))
      }
    }
  };
}

function getDeviceStorageUsage(storage: FileStorage, appPhysicalBytes: number): DeviceStorageUsage | null {
  try {
    const root = storage.getStorageStats().storageRoot;
    const statfs = statfsSync(root);
    const blockSize = Number(statfs.bsize);
    const totalBytes = Number(statfs.blocks) * blockSize;
    const freeBytes = Number(statfs.bfree) * blockSize;
    const availableBytes = Number(statfs.bavail) * blockSize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    const appBytes = Math.min(appPhysicalBytes, usedBytes);
    const otherUsedBytes = Math.max(0, usedBytes - appBytes);
    const blockGraph = {
      app: totalBytes > 0 ? (appBytes / totalBytes) * 100 : 0,
      other: totalBytes > 0 ? (otherUsedBytes / totalBytes) * 100 : 0,
      free: totalBytes > 0 ? (availableBytes / totalBytes) * 100 : 0
    };

    return {
      mountPath: root,
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercent,
      appPhysicalBytes: appBytes,
      otherUsedBytes,
      blockGraph
    };
  } catch (error) {
    console.warn('Could not read device storage usage:', (error as Error).message);
    return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
