import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';

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

  constructor() {
    assertLinuxRuntime();

    this.storageRoot = resolve((process.env.DROPZONE_STORAGE_ROOT || DEFAULT_VAULT_ROOT).trim());
    this.uploadsDir = join(this.storageRoot, 'uploads');
    this.tempDir = join(this.uploadsDir, 'temp');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.storageRoot,
      this.uploadsDir,
      this.tempDir,
      join(this.uploadsDir, 'multistream'),
      join(this.uploadsDir, 'arcpack'),
      join(this.uploadsDir, 'chunkline')
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

  getModeDirectory(mode: StorageMode): string {
    return join(this.uploadsDir, mode);
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
    const timestamp = Date.now();
    const extension = this.getFileExtension(file.name);
    const filename = `${timestamp}_${index}${extension}`;
    const filePath = join(this.uploadsDir, 'multistream', filename);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    writeFileSync(filePath, buffer);

    return {
      originalName: file.name,
      savedPath: filePath,
      size: file.size,
      type: file.type,
      uploadedAt: new Date()
    };
  }

  async saveArcPackArchive(archiveData: any, metadata: any): Promise<string> {
    const timestamp = Date.now();
    const filename = `archive_${timestamp}.json`;
    const filePath = join(this.uploadsDir, 'arcpack', filename);

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
    const tempFilename = `${chunkInfo.filename}_${chunkInfo.chunkIndex}_${chunkInfo.totalChunks}`;
    const tempPath = join(this.tempDir, tempFilename);

    const arrayBuffer = await chunk.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    writeFileSync(tempPath, buffer);
    return tempPath;
  }

  async assembleChunks(filename: string, totalChunks: number): Promise<FileInfo> {
    const finalDir = join(this.uploadsDir, 'chunkline');
    const timestamp = Date.now();
    const extension = this.getFileExtension(filename);
    const finalFilename = `${timestamp}_complete${extension}`;
    const finalPath = join(finalDir, finalFilename);

    const chunks: Buffer[] = [];
    let totalSize = 0;

    // Collect all chunks
    for (let i = 0; i < totalChunks; i++) {
      const tempFilename = `${filename}_${i}_${totalChunks}`;
      const tempPath = join(this.tempDir, tempFilename);

      if (!existsSync(tempPath)) {
        throw new Error(`Missing chunk file: ${tempFilename}`);
      }

      const buffer = readFileSync(tempPath);
      chunks.push(buffer);
      totalSize += buffer.length;
    }

    // Assemble final file
    const finalBuffer = Buffer.concat(chunks);
    writeFileSync(finalPath, finalBuffer);

    // Clean up temp files
    this.cleanupTempFiles(filename, totalChunks);

    return {
      originalName: filename,
      savedPath: finalPath,
      size: totalSize,
      type: 'application/octet-stream',
      uploadedAt: new Date()
    };
  }

  private cleanupTempFiles(filename: string, totalChunks: number): void {
    for (let i = 0; i < totalChunks; i++) {
      const tempFilename = `${filename}_${i}_${totalChunks}`;
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
