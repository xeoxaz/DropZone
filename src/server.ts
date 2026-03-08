import { handleMultiStream } from './handlers/multistream.js';
import { handleArcPack } from './handlers/arcpack.js';
import { handleChunkLine } from './handlers/chunkline.js';
import { handleFilePreview, handleFileDownload, handleFileDelete } from './handlers/files.js';
import { getHtmlPage } from './html.js';
import { triFlowModes, detectServerCapabilities } from './triflow.js';
import { FileStorage } from './storage.js';
import { getFileSystemStats, getStorageUsage } from './filesystem.js';
import { Database } from './database.js';

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
      return new Response(getHtmlPage(), {
        headers: {
          'Content-Type': 'text/html',
        },
      });
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
