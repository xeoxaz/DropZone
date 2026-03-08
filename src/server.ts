import { handleMultiStream } from './handlers/multistream.js';
import { handleArcPack } from './handlers/arcpack.js';
import { handleChunkLine } from './handlers/chunkline.js';
import { handleFilePreview, handleFileDownload, handleFileDelete } from './handlers/files.js';
import { getHtmlPage } from './html.js';
import { triFlowModes, detectServerCapabilities } from './triflow.js';
import { FileStorage } from './storage.js';
import { getFileSystemStats, getStorageUsage } from './filesystem.js';

const storage = new FileStorage();

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
      return handleFilePreview(req, url);
    }

    if (url.pathname === '/api/files/download') {
      return handleFileDownload(req, url);
    }

    if (url.pathname === '/api/files/delete') {
      return handleFileDelete(req, url);
    }

    return new Response('Not Found', { status: 404 });
  },
});

async function handleTriFlowRequest(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === '/api/triflow/multistream' && req.method === 'POST') {
    return handleMultiStream(req);
  }

  if (path === '/api/triflow/arcpack' && req.method === 'POST') {
    return handleArcPack(req);
  }

  if (path === '/api/triflow/chunkline' && req.method === 'POST') {
    return handleChunkLine(req);
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
    return new Response(JSON.stringify({
      files: getFileSystemStats(),
      usage: getStorageUsage()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Invalid TriFlow endpoint', { status: 404 });
}

console.log(`🚀 DropZone TriFlow Ingest System running on http://localhost:${server.port}`);
console.log(`📋 Available modes: ${triFlowModes.map(m => m.name).join(', ')}`);
console.log(`💾 Linux storage root: ${storage.getStorageStats().storageRoot}`);
