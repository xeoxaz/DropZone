import { handleMultiStream } from './handlers/multistream.js';
import { handleArcPack } from './handlers/arcpack.js';
import { handleChunkLine } from './handlers/chunkline.js';
import { handleFilePreview, handleFileDownload, handleFileDelete, handleFolderCreate, handleDirectorySummary, handleDirectoryDelete, handlePathMove, handlePathRename } from './handlers/files.js';
import { triFlowModes, detectServerCapabilities } from './triflow.js';
import { FileStorage } from './storage.js';
import { getFileSystemStats, getStorageUsage } from './filesystem.js';
import { Database } from './database.js';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'path';
import { format as formatLog } from 'util';

function getTimestamp24h(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function writeTimestamped(stream: NodeJS.WriteStream, args: unknown[]): void {
  stream.write(`[${getTimestamp24h()}] ${formatLog(...(args as []))}\n`);
}

console.log = (...args: unknown[]) => writeTimestamped(process.stdout, args);
console.info = (...args: unknown[]) => writeTimestamped(process.stdout, args);
console.debug = (...args: unknown[]) => writeTimestamped(process.stdout, args);
console.warn = (...args: unknown[]) => writeTimestamped(process.stderr, args);
console.error = (...args: unknown[]) => writeTimestamped(process.stderr, args);

const staticRoot = resolve('./src/static');

function resolveStaticPath(urlPath: string): string | null {
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/static\//, '');
  const candidate = resolve(join(staticRoot, relativePath));
  if (!candidate.startsWith(staticRoot + sep) && candidate !== staticRoot) {
    return null;
  }

  return candidate;
}

function getGhostRefreshIntervalMs(): number {
  const rawValue = process.env.DROPZONE_GHOST_REFRESH_MS;
  if (!rawValue) {
    return 60_000;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`Invalid DROPZONE_GHOST_REFRESH_MS value: ${rawValue}. Falling back to 60000ms.`);
    return 60_000;
  }

  return parsed;
}

// Initialize database and storage
const db = new Database();
await db.initialize();
const storage = new FileStorage(db);

// Cleanup orphaned records
const cleanedCount = db.cleanupOrphanedRecords();
if (cleanedCount > 0) {
  console.log(`✓ Cleaned ${cleanedCount} orphaned database record(s)`);
}

const compactedAtBoot = db.collapseBurstDuplicateUploadRecords();
if (compactedAtBoot > 0) {
  console.log(`✓ Compacted ${compactedAtBoot} duplicate upload record(s)`);
}

const ghostRefreshIntervalMs = getGhostRefreshIntervalMs();
if (ghostRefreshIntervalMs > 0) {
  setInterval(() => {
    const refreshed = db.cleanupOrphanedRecords();
    if (refreshed > 0) {
      console.log(`♻️ Auto-refresh cleaned ${refreshed} ghost record(s)`);
    }

    const compacted = db.collapseBurstDuplicateUploadRecords();
    if (compacted > 0) {
      console.log(`♻️ Auto-refresh compacted ${compacted} duplicate upload record(s)`);
    }
  }, ghostRefreshIntervalMs);
  console.log(`♻️ Ghost-file auto-refresh enabled: every ${ghostRefreshIntervalMs}ms`);
} else {
  console.log('♻️ Ghost-file auto-refresh disabled (DROPZONE_GHOST_REFRESH_MS=0)');
}

const server = Bun.serve({
  port: 7777,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      const indexPath = resolveStaticPath('/');
      if (!indexPath || !existsSync(indexPath)) {
        return new Response('Frontend entry not found', { status: 500 });
      }

      return new Response(Bun.file(indexPath), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (url.pathname.startsWith('/static/')) {
      const staticPath = resolveStaticPath(url.pathname);
      if (!staticPath || !existsSync(staticPath)) {
        return new Response('Static file not found', { status: 404 });
      }

      return new Response(Bun.file(staticPath));
    }

    if (url.pathname.startsWith('/api/triflow/')) {
      return handleTriFlowRequest(req, url);
    }

    if (url.pathname === '/api/health') {
      return new Response(
        JSON.stringify({ status: 'ok', service: 'DropZone', version: 'TriFlow Ingest v1.0' }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    // File handling endpoints
    if (url.pathname === '/api/files/preview') {
      return handleFilePreview(req, url, storage);
    }

    if (url.pathname === '/api/files/download') {
      return handleFileDownload(req, url, storage);
    }

    if (url.pathname === '/api/files/delete') {
      return handleFileDelete(req, url, storage);
    }

    if (url.pathname === '/api/files/folder') {
      return handleFolderCreate(req, storage);
    }

    if (url.pathname === '/api/files/directory/summary') {
      return handleDirectorySummary(req, url, storage);
    }

    if (url.pathname === '/api/files/directory') {
      return handleDirectoryDelete(req, url, storage);
    }

    if (url.pathname === '/api/files/move') {
      return handlePathMove(req, storage);
    }

    if (url.pathname === '/api/files/rename') {
      return handlePathRename(req, storage);
    }

    return new Response('Not Found', { status: 404 });
  },
});

async function handleTriFlowRequest(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === '/api/triflow/multistream' && req.method === 'POST') {
    return handleMultiStream(req, storage);
  }

  if (path === '/api/triflow/arcpack' && req.method === 'POST') {
    return handleArcPack(req, storage);
  }

  if (path === '/api/triflow/chunkline' && req.method === 'POST') {
    return handleChunkLine(req, storage);
  }

  if (path === '/api/triflow/capabilities') {
    return new Response(JSON.stringify({
      modes: triFlowModes,
      capabilities: detectServerCapabilities()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path === '/api/triflow/storage/stats') {
    return new Response(JSON.stringify({
      stats: storage.getStorageStats()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path === '/api/triflow/files') {
    db.cleanupOrphanedRecords();
    db.collapseBurstDuplicateUploadRecords();
    const files = getFileSystemStats(db, storage);
    const usage = getStorageUsage(db, storage);
    return new Response(JSON.stringify({
      files,
      usage
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Invalid TriFlow endpoint', { status: 404 });
}

console.log(`🚀 DropZone TriFlow Ingest System running on http://localhost:${server.port}`);
console.log(`📋 Available modes: ${triFlowModes.map(m => m.name).join(', ')}`);
console.log(`💾 Linux storage root: ${storage.getStorageStats().storageRoot}`);
