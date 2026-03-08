import { formatFileSize } from '../triflow.js';
import { FileStorage } from '../storage.js';

export async function handleArcPack(req: Request, storage: FileStorage): Promise<Response> {
  try {
    const body = await req.json() as { archiveData: any; metadata: any };
    const { archiveData, metadata } = body;

    console.log(`📦 ArcPack Upload - Files: ${metadata.fileCount}, Size: ${formatFileSize(metadata.totalSize)}`);
    console.log('Archive metadata:', archiveData);

    // Save archive data
    const archivePath = await storage.saveArcPackArchive(archiveData, metadata);

    console.log(`📦 Archive saved: ${archivePath}`);

    return new Response(JSON.stringify({
      success: true,
      mode: 'ArcPack',
      archiveId: `arc_${Date.now()}`,
      archivePath,
      metadata,
      storageStats: storage.getStorageStats()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('ArcPack error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'ArcPack upload failed: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
