import { Database as SQLiteDatabase } from 'bun:sqlite';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

export interface StoredFile {
  hash: string;
  physical_path: string;
  size_bytes: number;
  mime_type: string | null;
  created_at: string;
}

export interface UploadRecord {
  id: number;
  file_hash: string;
  original_name: string;
  operator_name: string;
  storage_mode: 'multistream' | 'arcpack' | 'chunkline';
  uploaded_at: string;
}

export class Database {
  private db: SQLiteDatabase;
  private readonly duplicateWindowSeconds: number;

  constructor(dbPath?: string) {
    const defaultPath = process.env.DROPZONE_STORAGE_ROOT
      ? resolve(join(process.env.DROPZONE_STORAGE_ROOT, 'uploads', 'dropzone.db'))
      : resolve('./dropzone.db'); // Default to project directory for development
    const path = dbPath || defaultPath;
    console.log(`📊 SQLite database path: ${path}`);
    this.db = new SQLiteDatabase(path);
    const configuredWindow = Number.parseInt(process.env.DROPZONE_UPLOAD_DEDUP_WINDOW_SECONDS || '15', 10);
    this.duplicateWindowSeconds = Number.isFinite(configuredWindow) && configuredWindow >= 0
      ? configuredWindow
      : 15;
    console.log(`✓ SQLite database opened successfully`);
  }

  async initialize(): Promise<void> {
    this.createTables();
  }

  private createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS stored_files (
        hash TEXT PRIMARY KEY,
        physical_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mime_type TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS upload_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_hash TEXT NOT NULL,
        original_name TEXT NOT NULL,
        operator_name TEXT NOT NULL,
        storage_mode TEXT NOT NULL CHECK(storage_mode IN ('multistream', 'arcpack', 'chunkline')),
        uploaded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (file_hash) REFERENCES stored_files(hash) ON DELETE CASCADE
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_file_hash ON upload_records(file_hash)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_uploaded_at ON upload_records(uploaded_at DESC)`);
  }

  findFileByHash(hash: string): StoredFile | null {
    const query = this.db.query('SELECT * FROM stored_files WHERE hash = ?');
    return query.get(hash) as StoredFile | null;
  }

  findFileByPath(physicalPath: string): StoredFile | null {
    const query = this.db.query('SELECT * FROM stored_files WHERE physical_path = ?');
    return query.get(physicalPath) as StoredFile | null;
  }

  createStoredFile(file: Omit<StoredFile, 'created_at'>): void {
    const query = this.db.query('INSERT INTO stored_files (hash, physical_path, size_bytes, mime_type) VALUES (?, ?, ?, ?)');
    query.run(file.hash, file.physical_path, file.size_bytes, file.mime_type);
  }

  createUploadRecord(record: Omit<UploadRecord, 'id' | 'uploaded_at'>): number {
    const recentMatch = this.findRecentMatchingUploadRecord(record, this.duplicateWindowSeconds);
    if (recentMatch) {
      console.warn(
        `Skipped duplicate upload record for hash ${record.file_hash} (reused id ${recentMatch.id})`
      );
      return recentMatch.id;
    }

    const query = this.db.query('INSERT INTO upload_records (file_hash, original_name, operator_name, storage_mode) VALUES (?, ?, ?, ?)');
    const result = query.run(record.file_hash, record.original_name, record.operator_name, record.storage_mode);
    return result.lastInsertRowid as number;
  }

  collapseBurstDuplicateUploadRecords(withinSeconds: number = this.duplicateWindowSeconds): number {
    if (withinSeconds <= 0) {
      return 0;
    }

    const records = this.db.query(`
      SELECT id, file_hash, original_name, operator_name, storage_mode, uploaded_at
      FROM upload_records
      ORDER BY uploaded_at DESC, id DESC
    `).all() as UploadRecord[];

    const lastKeptBySignature = new Map<string, number>();
    const duplicateIds: number[] = [];

    for (const record of records) {
      const signature = `${record.file_hash}|${record.original_name}|${record.operator_name}|${record.storage_mode}`;
      const uploadedAtMs = this.parseSqliteTimestampMs(record.uploaded_at);

      if (uploadedAtMs === null) {
        continue;
      }

      const lastKeptMs = lastKeptBySignature.get(signature);
      if (lastKeptMs !== undefined && (lastKeptMs - uploadedAtMs) <= withinSeconds * 1000) {
        duplicateIds.push(record.id);
        continue;
      }

      lastKeptBySignature.set(signature, uploadedAtMs);
    }

    if (duplicateIds.length === 0) {
      return 0;
    }

    const deleteQuery = this.db.query('DELETE FROM upload_records WHERE id = ?');
    for (const id of duplicateIds) {
      deleteQuery.run(id);
    }

    return duplicateIds.length;
  }

  private findRecentMatchingUploadRecord(
    record: Omit<UploadRecord, 'id' | 'uploaded_at'>,
    withinSeconds: number
  ): UploadRecord | null {
    if (withinSeconds === 0) {
      return null;
    }

    const query = this.db.query(`
      SELECT *
      FROM upload_records
      WHERE file_hash = ?
        AND original_name = ?
        AND operator_name = ?
        AND storage_mode = ?
        AND uploaded_at >= datetime('now', ?)
      ORDER BY uploaded_at DESC
      LIMIT 1
    `);

    return query.get(
      record.file_hash,
      record.original_name,
      record.operator_name,
      record.storage_mode,
      `-${withinSeconds} seconds`
    ) as UploadRecord | null;
  }

  private parseSqliteTimestampMs(value: string): number | null {
    const isoLike = value.replace(' ', 'T') + 'Z';
    const parsed = Date.parse(isoLike);
    return Number.isFinite(parsed) ? parsed : null;
  }

  getAllUploadRecords(): (UploadRecord & { physical_path: string; size_bytes: number })[] {
    const query = this.db.query(`
      SELECT
        ur.*,
        sf.physical_path,
        sf.size_bytes
      FROM upload_records ur
      JOIN stored_files sf ON ur.file_hash = sf.hash
      ORDER BY ur.uploaded_at DESC
    `);
    return query.all() as (UploadRecord & { physical_path: string; size_bytes: number })[];
  }

  getUploadRecordsByHash(hash: string): UploadRecord[] {
    const query = this.db.query('SELECT * FROM upload_records WHERE file_hash = ? ORDER BY uploaded_at DESC');
    return query.all(hash) as UploadRecord[];
  }

  deleteUploadRecord(id: number): void {
    const query = this.db.query('DELETE FROM upload_records WHERE id = ?');
    query.run(id);
  }

  deleteStoredFile(hash: string): void {
    // This will cascade delete all upload_records due to FK constraint
    const query = this.db.query('DELETE FROM stored_files WHERE hash = ?');
    query.run(hash);
  }

  deleteStoredFileByPath(physicalPath: string): void {
    const query = this.db.query('DELETE FROM stored_files WHERE physical_path = ?');
    query.run(physicalPath);
  }

  cleanupOrphanedRecords(): number {
    const allFiles = this.db.query('SELECT hash, physical_path FROM stored_files').all() as StoredFile[];
    let cleaned = 0;

    for (const file of allFiles) {
      if (!existsSync(file.physical_path)) {
        this.deleteStoredFile(file.hash);
        cleaned++;
        console.log(`🧹 Cleaned orphaned record for missing file: ${file.physical_path}`);
      }
    }

    return cleaned;
  }

  close(): void {
    this.db.close();
  }
}
