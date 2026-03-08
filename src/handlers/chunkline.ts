import { FileStorage, type ChunkInfo } from '../storage.js';

const chunkProgressState = new Map<string, { totalChunks: number; lastPercent: number }>();

function renderChunkProgress(filename: string, chunkIndex: number, totalChunks: number): void {
  const completeChunks = chunkIndex + 1;
  const percent = Math.min(100, Math.floor((completeChunks / totalChunks) * 100));
  const width = 24;
  const filled = Math.min(width, Math.round((percent / 100) * width));
  const bar = '#'.repeat(filled) + '-'.repeat(width - filled);

  const key = `${filename}:${totalChunks}`;
  const previous = chunkProgressState.get(key);
  if (previous && previous.lastPercent === percent && completeChunks < totalChunks) {
    return;
  }

  chunkProgressState.set(key, { totalChunks, lastPercent: percent });

  const message = `\r🔗 ChunkLine ${filename} [${bar}] ${String(percent).padStart(3, ' ')}% (${completeChunks}/${totalChunks})`;
  process.stdout.write(message);

  if (completeChunks >= totalChunks) {
    process.stdout.write('\n');
    chunkProgressState.delete(key);
  }
}

export async function handleChunkLine(req: Request, storage: FileStorage): Promise<Response> {
  try {
    const formData = await req.formData();
    const chunk = formData.get('chunk') as File;
    const filename = formData.get('filename') as string;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string);
    const totalChunks = parseInt(formData.get('totalChunks') as string);
    const fileIndex = parseInt(formData.get('fileIndex') as string);

    renderChunkProgress(filename, chunkIndex, totalChunks);

    // Save chunk
    const chunkInfo: ChunkInfo = {
      filename,
      chunkIndex,
      totalChunks,
      fileIndex,
      tempPath: ''
    };

    const tempPath = await storage.saveChunk(chunk, chunkInfo);
    chunkInfo.tempPath = tempPath;

    const isComplete = chunkIndex === totalChunks - 1;
    let assembledFile = null;

    // If this is the last chunk, assemble the file
    if (isComplete) {
      console.log(`🔗 Assembling final file: ${filename}`);
      assembledFile = await storage.assembleChunks(filename, totalChunks, fileIndex);
      const duplicateMsg = assembledFile.isDuplicate ? ' [DUPLICATE - reused existing file]' : '';
      console.log(`🔗 File assembled: ${assembledFile.savedPath}${duplicateMsg}`);
    }

    return new Response(JSON.stringify({
      success: true,
      mode: 'ChunkLine',
      filename,
      chunkIndex,
      totalChunks,
      fileIndex,
      isComplete,
      chunkSize: chunk.size,
      tempPath,
      assembledFile,
      storageStats: storage.getStorageStats()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('ChunkLine error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'ChunkLine upload failed: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
