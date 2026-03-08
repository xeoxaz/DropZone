import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, readdirSync, rmSync, statSync, renameSync } from 'fs';
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

export interface DirectorySummary {
  path: string;
  mode: StorageMode;
  files: number;
  directories: number;
  items: number;
  protectedRoot: boolean;
}

export interface MoveResult {
  itemType: 'file' | 'directory';
  oldPath: string;
  newPath: string;
  name: string;
}

export interface RenameResult {
  oldPath: string;
  newPath: string;
  oldName: string;
  newName: string;
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

  createFolder(parentPath: string, mode: StorageMode, requestedName: string): { path: string; name: string } {
    const validatedParent = this.resolveStoredFilePath(parentPath, mode);
    if (!validatedParent) {
      throw new Error('Invalid parent directory path');
    }

    const safeName = this.sanitizeFolderName(requestedName);
    const folderPath = resolve(join(validatedParent, safeName));
    if (!folderPath.startsWith(validatedParent + sep)) {
      throw new Error('Invalid folder name');
    }

    if (existsSync(folderPath)) {
      throw new Error(`Folder already exists: ${safeName}`);
    }

    mkdirSync(folderPath, { recursive: false });
    return { path: folderPath, name: safeName };
  }

  getDirectorySummary(inputPath: string, mode: StorageMode): DirectorySummary {
    const directoryPath = this.resolveStoredFilePath(inputPath, mode);
    if (!directoryPath) {
      throw new Error('Invalid directory path');
    }

    if (!existsSync(directoryPath)) {
      throw new Error('Directory not found');
    }

    const stat = statSync(directoryPath);
    if (!stat.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    const counts = this.countDirectoryTree(directoryPath);
    const protectedRoot = this.isProtectedDirectory(directoryPath);
    return {
      path: directoryPath,
      mode,
      files: counts.files,
      directories: counts.directories,
      items: counts.files + counts.directories,
      protectedRoot
    };
  }

  deleteDirectory(inputPath: string, mode: StorageMode): DirectorySummary {
    const summary = this.getDirectorySummary(inputPath, mode);
    if (summary.protectedRoot) {
      throw new Error('Cannot delete protected root directory');
    }

    const prefix = summary.path.endsWith(sep) ? summary.path : summary.path + sep;
    const storedFiles = this.db.getStoredFilesByPathPrefix(prefix);
    for (const file of storedFiles) {
      this.db.deleteStoredFile(file.hash);
    }

    rmSync(summary.path, { recursive: true, force: false });
    return summary;
  }

  movePath(sourcePath: string, sourceMode: StorageMode, targetDirectoryPath: string, targetMode: StorageMode): MoveResult {
    const source = this.resolveStoredFilePath(sourcePath, sourceMode);
    const targetDir = this.resolveStoredFilePath(targetDirectoryPath, targetMode);
    if (!source || !targetDir) {
      throw new Error('Invalid move path');
    }

    if (!existsSync(source)) {
      throw new Error('Source path not found');
    }

    if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
      throw new Error('Target directory not found');
    }

    const sourceStat = statSync(source);
    const sourceName = source.split(sep).pop() || 'moved-item';
    const destination = resolve(join(targetDir, sourceName));

    if (source === destination) {
      throw new Error('Source and destination are the same');
    }

    if (existsSync(destination)) {
      throw new Error('Destination already has an item with the same name');
    }

    if (sourceStat.isDirectory()) {
      if (this.isProtectedDirectory(source)) {
        throw new Error('Cannot move protected root directory');
      }

      const sourcePrefix = source.endsWith(sep) ? source : source + sep;
      if (destination.startsWith(sourcePrefix)) {
        throw new Error('Cannot move a directory into itself');
      }
    }

    renameSync(source, destination);

    if (sourceStat.isDirectory()) {
      const oldPrefix = source.endsWith(sep) ? source : source + sep;
      const newPrefix = destination.endsWith(sep) ? destination : destination + sep;
      const affectedFiles = this.db.getStoredFilesByPathPrefix(oldPrefix);
      this.db.updateStoredFilePathPrefix(oldPrefix, newPrefix);
      for (const file of affectedFiles) {
        this.db.createFileAccessEvent(file.hash, 'move');
      }
      return {
        itemType: 'directory',
        oldPath: source,
        newPath: destination,
        name: sourceName
      };
    }

    const stored = this.db.findFileByPath(source);
    this.db.updateStoredFilePath(source, destination);
    if (stored) {
      this.db.createFileAccessEvent(stored.hash, 'move');
    }
    return {
      itemType: 'file',
      oldPath: source,
      newPath: destination,
      name: sourceName
    };
  }

  renameFile(sourcePath: string, sourceMode: StorageMode, requestedName: string): RenameResult {
    const source = this.resolveStoredFilePath(sourcePath, sourceMode);
    if (!source) {
      throw new Error('Invalid source path');
    }

    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error('Source file not found');
    }

    const oldName = source.split(sep).pop() || source;
    const oldExtension = this.getFileExtension(oldName);
    let safeName = this.sanitizeFilename(requestedName);
    const requestedExtension = this.getFileExtension(safeName);

    // If user omits file type while renaming, preserve the original extension.
    if ((!requestedExtension || requestedExtension === '.') && oldExtension) {
      safeName = safeName.replace(/\.$/, '') + oldExtension;
    }

    const parentDir = source.substring(0, source.lastIndexOf(sep));
    const destination = resolve(join(parentDir, safeName));

    if (!(destination === parentDir || destination.startsWith(parentDir + sep))) {
      throw new Error('Invalid destination filename');
    }

    if (destination === source) {
      throw new Error('New filename is the same as current name');
    }

    if (existsSync(destination)) {
      throw new Error('A file with this name already exists');
    }

    const stored = this.db.findFileByPath(source);
    renameSync(source, destination);
    this.db.updateStoredFilePath(source, destination);
    if (stored) {
      this.db.updateUploadOperatorNameByHash(stored.hash, safeName);
      this.db.createFileAccessEvent(stored.hash, 'rename');
    }

    return {
      oldPath: source,
      newPath: destination,
      oldName,
      newName: safeName
    };
  }

  getModeDirectory(mode: StorageMode): string {
    return this.uploadsDir;
  }

  resolveStoredFilePath(inputPath: string, mode: StorageMode): string | null {
    const modeDir = this.getModeDirectory(mode);
    const candidate = inputPath.includes('/')
      ? resolve(inputPath)
      : resolve(join(modeDir, inputPath));

    if (!(candidate === modeDir || candidate.startsWith(modeDir + sep))) {
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

  private sanitizeFolderName(folderName: string): string {
    const trimmed = folderName.trim();
    if (trimmed.length === 0) {
      throw new Error('Folder name cannot be empty');
    }

    if (trimmed === '.' || trimmed === '..') {
      throw new Error('Folder name cannot be . or ..');
    }

    // Linux filenames cannot contain slash or null; also strip control chars.
    const normalized = trimmed
      .replace(/[\/\0]/g, '_')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\.{2,}/g, '.');

    const safe = normalized.slice(0, 255).trim();
    if (safe.length === 0) {
      throw new Error('Folder name became empty after sanitization');
    }

    if (safe === '.' || safe === '..') {
      throw new Error('Folder name is invalid');
    }

    return safe;
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

  private countDirectoryTree(root: string): { files: number; directories: number } {
    const stack = [root];
    let files = 0;
    let directories = 0;

    while (stack.length > 0) {
      const current = stack.pop() as string;
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const name = String((entry as { name: unknown }).name);
        const fullPath = join(current, name);
        if (entry.isDirectory()) {
          directories++;
          stack.push(fullPath);
        } else {
          files++;
        }
      }
    }

    return { files, directories };
  }

  private isProtectedDirectory(path: string): boolean {
    const protectedDirs = new Set<string>([
      this.uploadsDir,
      this.tempDir,
      join(this.uploadsDir, 'multistream'),
      join(this.uploadsDir, 'arcpack'),
      join(this.uploadsDir, 'chunkline')
    ].map((value) => resolve(value)));

    return protectedDirs.has(resolve(path));
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
