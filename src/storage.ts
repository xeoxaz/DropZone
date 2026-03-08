import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { createHash } from 'crypto';
import { Database } from './database';

export type StorageMode = 'multistream' | 'arcpack' | 'chunkline';

const DEFAULT_VAULT_ROOT = '/mnt/vault-01';

export function assertLinuxRuntime(): void {
  if (process.platform !== 'linux') {
    throw new Error('DropZone storage is Linux-only and requires a Linux filesystem mount.');
  }
}

export interface FileInfo {
  originalName: string;
  savedPath: string;
  size: number;
  type: string;
  uploadedAt: Date;
  hash?: string;
  isDuplicate?: boolean;
  uploadRecordId?: number;
}

export interface ChunkInfo {
  filename: string;
  chunkIndex: number;
  totalChunks: number;
  fileIndex: number;
  tempPath: string;
}

export class FileStorage {
  private readonly storageRoot: string;
  private readonly uploadsDir: string;
  private readonly tempDir: string;
  private db: Database;

  constructor(database: Database) {
    assertLinuxRuntime();

    this.db = database;
    this.storageRoot = resolve((process.env.DROPZONE_STORAGE_ROOT || '.').trim());
    this.uploadsDir = join(this.storageRoot, 'uploads');
    this.tempDir = join(this.uploadsDir, 'temp');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.storageRoot,
      this.uploadsDir,
      this.tempDir
    ];

    dirs.forEach(dir => {
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch (error) {
          const fsError = error as NodeJS.ErrnoException;
          if (fsError.code === 'EACCES') {
            throw new Error(
              `Storage path is not writable: ${dir}. ` +
              `Grant write access to ${this.storageRoot} (for example: sudo chown -R ${process.getuid?.()}:${process.getgid?.()} ${this.storageRoot}).`
            );
          }

          throw error;
        }
      }
    });
  }

  getDatabase(): Database {
    return this.db;
  }

  getModeDirectory(mode: StorageMode): string {
    return this.uploadsDir;
  }

  resolveStoredFilePath(inputPath: string, mode: StorageMode): string | null {
    const modeDir = this.getModeDirectory(mode);
    const candidate = inputPath.includes('/')
      ? resolve(inputPath)
      : resolve(join(modeDir, inputPath));

    if (!candidate.startsWith(modeDir + sep)) {
      return null;
    }

    return candidate;
  }

  async saveMultiStreamFile(file: File, index: number): Promise<FileInfo> {
    return this.saveMultiStreamFileWithTargetName(file, index, file.name);
  }

  async saveMultiStreamFileWithTargetName(file: File, index: number, targetName?: string): Promise<FileInfo> {
    const operatorName = this.sanitizeFilename(targetName || file.name || `upload_${Date.now()}_${index}`);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Calculate SHA-256 hash
    const hash = this.calculateHash(buffer);

    // Check if file already exists
    const existingFile = this.db.findFileByHash(hash);

    if (existingFile && existsSync(existingFile.physical_path)) {
      // Duplicate detected - reuse existing file
      const uploadRecordId = this.db.createUploadRecord({
        file_hash: hash,
        original_name: file.name,
        operator_name: operatorName,
        storage_mode: 'multistream'
      });

      return {
        originalName: file.name,
        savedPath: existingFile.physical_path,
        size: file.size,
        type: file.type,
        uploadedAt: new Date(),
        hash,
        isDuplicate: true,
        uploadRecordId
      };
    }

    if (existingFile && !existsSync(existingFile.physical_path)) {
      // Self-heal stale metadata so missing files are not treated as duplicates.
      this.db.deleteStoredFile(existingFile.hash);
      console.warn(`Removed stale hash record for missing file: ${existingFile.physical_path}`);
    }

    // New file - save physically
    const filePath = this.makeUniquePath(this.uploadsDir, operatorName);

    writeFileSync(filePath, buffer);

    // Create stored_files record
    this.db.createStoredFile({
      hash,
      physical_path: filePath,
      size_bytes: buffer.length,
      mime_type: file.type || null
    });

    // Create upload record
    const uploadRecordId = this.db.createUploadRecord({
      file_hash: hash,
      original_name: file.name,
      operator_name: operatorName,
      storage_mode: 'multistream'
    });

    return {
      originalName: file.name,
      savedPath: filePath,
      size: file.size,
      type: file.type,
      uploadedAt: new Date(),
      hash,
      isDuplicate: false,
      uploadRecordId
    };
  }

  private calculateHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async saveArcPackArchive(archiveData: any, metadata: any): Promise<string> {
    const timestamp = Date.now();
    const filename = `archive_${timestamp}.json`;
    const filePath = join(this.uploadsDir, filename);

    const archiveContent = {
      id: `arc_${timestamp}`,
      metadata,
      archiveData,
      createdAt: new Date().toISOString()
    };

    writeFileSync(filePath, JSON.stringify(archiveContent, null, 2));
    return filePath;
  }

  async saveChunk(chunk: File, chunkInfo: ChunkInfo): Promise<string> {
    const tempFilename = this.buildTempChunkName(chunkInfo.filename, chunkInfo.fileIndex, chunkInfo.chunkIndex, chunkInfo.totalChunks);
    const tempPath = join(this.tempDir, tempFilename);

    const arrayBuffer = await chunk.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    writeFileSync(tempPath, buffer);
    return tempPath;
  }

  async assembleChunks(filename: string, totalChunks: number, fileIndex: number): Promise<FileInfo> {
    const operatorName = this.sanitizeFilename(filename || `upload_${Date.now()}_${fileIndex}`);
    const chunks: Buffer[] = [];
    let totalSize = 0;

    // Collect all chunks
    for (let i = 0; i < totalChunks; i++) {
      const tempFilename = this.buildTempChunkName(filename, fileIndex, i, totalChunks);
      const tempPath = join(this.tempDir, tempFilename);

      if (!existsSync(tempPath)) {
        throw new Error(`Missing chunk file: ${tempFilename}`);
      }

      const buffer = readFileSync(tempPath);
      chunks.push(buffer);
      totalSize += buffer.length;
    }

    // Assemble buffer
    const finalBuffer = Buffer.concat(chunks);

    // Calculate hash
    const hash = this.calculateHash(finalBuffer);

    // Check if file already exists
    const existingFile = this.db.findFileByHash(hash);

    // Clean up temp files
    this.cleanupTempFiles(filename, fileIndex, totalChunks);

    if (existingFile && existsSync(existingFile.physical_path)) {
      // Duplicate detected - reuse existing file
      const uploadRecordId = this.db.createUploadRecord({
        file_hash: hash,
        original_name: filename,
        operator_name: operatorName,
        storage_mode: 'chunkline'
      });

      return {
        originalName: filename,
        savedPath: existingFile.physical_path,
        size: totalSize,
        type: 'application/octet-stream',
        uploadedAt: new Date(),
        hash,
        isDuplicate: true,
        uploadRecordId
      };
    }

    if (existingFile && !existsSync(existingFile.physical_path)) {
      // Self-heal stale metadata so missing files are not treated as duplicates.
      this.db.deleteStoredFile(existingFile.hash);
      console.warn(`Removed stale hash record for missing file: ${existingFile.physical_path}`);
    }

    // New file - save physically
    const finalPath = this.makeUniquePath(this.uploadsDir, operatorName);

    writeFileSync(finalPath, finalBuffer);

    // Create stored_files record
    this.db.createStoredFile({
      hash,
      physical_path: finalPath,
      size_bytes: finalBuffer.length,
      mime_type: null
    });

    // Create upload record
    const uploadRecordId = this.db.createUploadRecord({
      file_hash: hash,
      original_name: filename,
      operator_name: operatorName,
      storage_mode: 'chunkline'
    });

    return {
      originalName: filename,
      savedPath: finalPath,
      size: totalSize,
      type: 'application/octet-stream',
      uploadedAt: new Date(),
      hash,
      isDuplicate: false,
      uploadRecordId
    };
  }

  private cleanupTempFiles(filename: string, fileIndex: number, totalChunks: number): void {
    for (let i = 0; i < totalChunks; i++) {
      const tempFilename = this.buildTempChunkName(filename, fileIndex, i, totalChunks);
      const tempPath = join(this.tempDir, tempFilename);

      if (existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch (error) {
          console.error(`Failed to cleanup temp file: ${tempPath}`, error);
        }
      }
    }
  }

  private buildTempChunkName(filename: string, fileIndex: number, chunkIndex: number, totalChunks: number): string {
    const safeName = this.sanitizeFilename(filename);
    return `${fileIndex}_${safeName}_${chunkIndex}_${totalChunks}.part`;
  }

  private sanitizeFilename(filename: string): string {
    const trimmed = filename.trim();
    const fallback = 'incoming-file.bin';
    const withoutSeparators = (trimmed.length > 0 ? trimmed : fallback).replace(/[\\/]/g, '_');
    const safe = withoutSeparators.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\.{2,}/g, '.');
    return safe.slice(0, 255) || fallback;
  }

  private makeUniquePath(dir: string, filename: string): string {
    const extension = this.getFileExtension(filename);
    const basename = extension ? filename.slice(0, -extension.length) : filename;
    let candidate = join(dir, filename);
    let counter = 1;

    while (existsSync(candidate)) {
      const nextName = `${basename}_${counter}${extension}`;
      candidate = join(dir, nextName);
      counter++;
    }

    return candidate;
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  getStorageStats(): any {
    return {
      linuxOnly: true,
      storageRoot: this.storageRoot,
      uploadsDir: this.uploadsDir,
      tempDir: this.tempDir,
      directories: {
        multistream: join(this.uploadsDir, 'multistream'),
        arcpack: join(this.uploadsDir, 'arcpack'),
        chunkline: join(this.uploadsDir, 'chunkline'),
        temp: this.tempDir
      }
    };
  }
}
