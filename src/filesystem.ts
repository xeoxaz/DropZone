import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FileStorage } from './storage.js';

const storage = new FileStorage();

export interface StoredFile {
  name: string;
  path: string;
  size: number;
  type: string;
  uploadedAt: Date;
  mode: string;
}

export interface FileSystemStats {
  totalFiles: number;
  totalSize: number;
  filesByMode: {
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
}

export function getFileSystemStats(): FileSystemStats {
  const stats = storage.getStorageStats();
  const filesByMode = {
    multistream: getFilesInDirectory(stats.directories.multistream, 'multistream'),
    arcpack: getFilesInDirectory(stats.directories.arcpack, 'arcpack'),
    chunkline: getFilesInDirectory(stats.directories.chunkline, 'chunkline')
  };

  const allFiles = [...filesByMode.multistream, ...filesByMode.arcpack, ...filesByMode.chunkline];
  const totalSize = allFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    totalFiles: allFiles.length,
    totalSize,
    filesByMode,
    directories: stats.directories
  };
}

function getFilesInDirectory(dirPath: string, mode: string): StoredFile[] {
  try {
    const files = readdirSync(dirPath);
    return files.map(filename => {
      const filePath = join(dirPath, filename);
      const fileStat = statSync(filePath);
      
      return {
        name: filename,
        path: filePath,
        size: fileStat.size,
        type: getFileType(filename),
        uploadedAt: fileStat.mtime,
        mode
      };
    });
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
    return [];
  }
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

export function getStorageUsage(): any {
  const stats = getFileSystemStats();
  
  return {
    totalFiles: stats.totalFiles,
    totalSize: stats.totalSize,
    totalSizeFormatted: formatFileSize(stats.totalSize),
    filesByMode: Object.keys(stats.filesByMode).reduce((acc, mode) => {
      acc[mode] = {
        count: stats.filesByMode[mode as keyof typeof stats.filesByMode].length,
        size: stats.filesByMode[mode as keyof typeof stats.filesByMode].reduce((sum, file) => sum + file.size, 0),
        sizeFormatted: formatFileSize(stats.filesByMode[mode as keyof typeof stats.filesByMode].reduce((sum, file) => sum + file.size, 0))
      };
      return acc;
    }, {} as any)
  };
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
