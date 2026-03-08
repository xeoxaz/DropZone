import { existsSync, unlinkSync } from 'fs';
import { FileStorage, type StorageMode } from '../storage.js';

const storage = new FileStorage();

export async function handleFilePreview(req: Request, url: URL): Promise<Response> {
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

    // Determine content type using normalized path
    const filename = filePath.split('/').pop() || '';
    const ext = filename.split('.').pop()?.toLowerCase();
    let contentType = 'text/plain';

    switch (ext) {
      case 'jpg':
      case 'jpeg':
        contentType = 'image/jpeg';
        break;
      case 'png':
        contentType = 'image/png';
        break;
      case 'gif':
        contentType = 'image/gif';
        break;
      case 'webp':
        contentType = 'image/webp';
        break;
      case 'pdf':
        contentType = 'application/pdf';
        break;
      case 'txt':
        contentType = 'text/plain';
        break;
      case 'json':
        contentType = 'application/json';
        break;
      case 'zip':
        contentType = 'application/zip';
        break;
      case 'tar':
        contentType = 'application/x-tar';
        break;
      case 'gz':
        contentType = 'application/gzip';
        break;
    }

    console.log('Serving file:', filePath, 'as', contentType);

    // Serve the file directly using Bun.file with normalized path
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('Preview error:', error);
    return new Response('Preview failed: ' + (error as Error).message, { status: 500 });
  }
}

export async function handleFileDownload(req: Request, url: URL): Promise<Response> {
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

export async function handleFileDelete(req: Request, url: URL): Promise<Response> {
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
