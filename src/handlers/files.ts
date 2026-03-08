import { existsSync, unlinkSync } from 'fs';
import { FileStorage, type StorageMode } from '../storage.js';

interface CreateFolderRequest {
  parentPath?: string;
  mode?: StorageMode;
  name?: string;
}

interface MovePathRequest {
  sourcePath?: string;
  sourceMode?: StorageMode;
  targetDirectoryPath?: string;
  targetMode?: StorageMode;
}

interface RenamePathRequest {
  sourcePath?: string;
  sourceMode?: StorageMode;
  newName?: string;
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  // Video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  opus: 'audio/opus',
  // Text / docs / structured
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  pdf: 'application/pdf',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  // Archives / binaries
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar'
};

function detectPreviewContentType(filePath: string): string {
  const filename = filePath.split('/').pop() || '';
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : '';
  if (ext && EXTENSION_CONTENT_TYPES[ext]) {
    return EXTENSION_CONTENT_TYPES[ext];
  }

  const bunType = Bun.file(filePath).type;
  if (bunType && bunType.trim().length > 0) {
    return bunType;
  }

  // Never fall back to text/plain for unknown binary media.
  return 'application/octet-stream';
}

export async function handleFilePreview(req: Request, url: URL, storage: FileStorage): Promise<Response> {
  const path = url.searchParams.get('path');
  const mode = (url.searchParams.get('mode') || 'multistream') as StorageMode;

  if (!path) {
    return new Response('Missing file path', { status: 400 });
  }

  try {
    // Validate path to prevent directory traversal
    const validModes: StorageMode[] = ['multistream', 'arcpack', 'chunkline'];
    if (!validModes.includes(mode)) {
      return new Response('Invalid mode', { status: 400 });
    }

    // Decode the URL-encoded path
    const decodedPath = decodeURIComponent(path);
    console.log('Preview request for path:', decodedPath);

    const filePath = storage.resolveStoredFilePath(decodedPath, mode);
    if (!filePath) {
      return new Response('Invalid file path', { status: 400 });
    }

    if (!existsSync(filePath)) {
      console.error('File not found at path:', filePath);
      return new Response('File not found: ' + filePath, { status: 404 });
    }

    const contentType = detectPreviewContentType(filePath);

    try {
      storage.getDatabase().createFileAccessEventByPath(filePath, 'preview');
    } catch (error) {
      console.warn('Could not record preview access event:', (error as Error).message);
    }

    console.log('Serving file:', filePath, 'as', contentType);

    // Serve the file directly using Bun.file with normalized path
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('Preview error:', error);
    return new Response('Preview failed: ' + (error as Error).message, { status: 500 });
  }
}

export async function handleFileDownload(req: Request, url: URL, storage: FileStorage): Promise<Response> {
  console.log('Download endpoint hit');
  const path = url.searchParams.get('path');
  const mode = (url.searchParams.get('mode') || 'multistream') as StorageMode;

  console.log('Raw path param:', path);
  console.log('Raw mode param:', mode);

  if (!path) {
    console.log('Missing file path');
    return new Response('Missing file path', { status: 400 });
  }

  try {
    // Validate path to prevent directory traversal
    const validModes: StorageMode[] = ['multistream', 'arcpack', 'chunkline'];
    if (!validModes.includes(mode)) {
      return new Response('Invalid mode', { status: 400 });
    }

    // Decode the URL-encoded path
    const decodedPath = decodeURIComponent(path);
    console.log('Download request for path:', decodedPath);

    const filePath = storage.resolveStoredFilePath(decodedPath, mode);
    if (!filePath) {
      return new Response('Invalid file path', { status: 400 });
    }

    const filename = filePath.split('/').pop() || 'download';

    if (!existsSync(filePath)) {
      console.error('File not found at path:', filePath);
      return new Response('File not found', { status: 404 });
    }

    const file = Bun.file(filePath);
    const fileBuffer = await file.arrayBuffer();

    try {
      storage.getDatabase().createFileAccessEventByPath(filePath, 'download');
    } catch (error) {
      console.warn('Could not record download access event:', (error as Error).message);
    }

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('Download error:', error);
    return new Response('Download failed', { status: 500 });
  }
}

export async function handleFileDelete(req: Request, url: URL, storage: FileStorage): Promise<Response> {
  if (req.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405 });
  }

  const path = url.searchParams.get('path');
  const mode = (url.searchParams.get('mode') || 'multistream') as StorageMode;

  if (!path) {
    return new Response('Missing file path', { status: 400 });
  }

  try {
    // Validate path to prevent directory traversal
    const validModes: StorageMode[] = ['multistream', 'arcpack', 'chunkline'];
    if (!validModes.includes(mode)) {
      return new Response('Invalid mode', { status: 400 });
    }

    // Decode the URL-encoded path
    const decodedPath = decodeURIComponent(path);
    console.log('Delete request for path:', decodedPath);

    const filePath = storage.resolveStoredFilePath(decodedPath, mode);
    if (!filePath) {
      return new Response('Invalid file path', { status: 400 });
    }

    if (!existsSync(filePath)) {
      console.error('File not found at path:', filePath);
      return new Response('File not found', { status: 404 });
    }

    // Delete from database first (to maintain referential integrity)
    const storedFile = storage.getDatabase().findFileByPath(filePath);
    if (storedFile) {
      storage.getDatabase().deleteStoredFile(storedFile.hash);
      console.log('Database records deleted for hash:', storedFile.hash);
    }

    // Delete physical file
    unlinkSync(filePath);
    console.log('File deleted successfully:', filePath);

    return new Response(JSON.stringify({
      success: true,
      message: 'File deleted successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Delete failed: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleFolderCreate(req: Request, storage: FileStorage): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json() as CreateFolderRequest;
    const mode = body.mode || 'multistream';
    const name = (body.name || '').trim();
    const validModes: StorageMode[] = ['multistream', 'arcpack', 'chunkline'];
    if (!validModes.includes(mode)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid mode' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!name) {
      return new Response(JSON.stringify({ success: false, error: 'Folder name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const stats = storage.getStorageStats();
    const parentPath = (body.parentPath || stats.uploadsDir).trim();
    const created = storage.createFolder(parentPath, mode, name);
    if (!existsSync(created.path)) {
      throw new Error('Folder was not created on disk');
    }

    return new Response(JSON.stringify({
      success: true,
      folder: created
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Create folder failed: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleDirectorySummary(req: Request, url: URL, storage: FileStorage): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const path = url.searchParams.get('path');
  const mode = (url.searchParams.get('mode') || 'multistream') as StorageMode;
  if (!path) {
    return new Response(JSON.stringify({ success: false, error: 'Missing directory path' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const decodedPath = decodeURIComponent(path);
    const summary = storage.getDirectorySummary(decodedPath, mode);
    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleDirectoryDelete(req: Request, url: URL, storage: FileStorage): Promise<Response> {
  if (req.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405 });
  }

  const path = url.searchParams.get('path');
  const mode = (url.searchParams.get('mode') || 'multistream') as StorageMode;
  if (!path) {
    return new Response(JSON.stringify({ success: false, error: 'Missing directory path' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const decodedPath = decodeURIComponent(path);
    const summary = storage.deleteDirectory(decodedPath, mode);
    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handlePathMove(req: Request, storage: FileStorage): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json() as MovePathRequest;
    const sourcePath = (body.sourcePath || '').trim();
    const sourceMode = (body.sourceMode || 'multistream') as StorageMode;
    const targetDirectoryPath = (body.targetDirectoryPath || '').trim();
    const targetMode = (body.targetMode || sourceMode) as StorageMode;

    if (!sourcePath || !targetDirectoryPath) {
      return new Response(JSON.stringify({ success: false, error: 'sourcePath and targetDirectoryPath are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const moved = storage.movePath(sourcePath, sourceMode, targetDirectoryPath, targetMode);
    return new Response(JSON.stringify({ success: true, moved }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handlePathRename(req: Request, storage: FileStorage): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json() as RenamePathRequest;
    const sourcePath = (body.sourcePath || '').trim();
    const sourceMode = (body.sourceMode || 'multistream') as StorageMode;
    const newName = (body.newName || '').trim();

    if (!sourcePath || !newName) {
      return new Response(JSON.stringify({ success: false, error: 'sourcePath and newName are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const renamed = storage.renameFile(sourcePath, sourceMode, newName);
    return new Response(JSON.stringify({ success: true, renamed }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
