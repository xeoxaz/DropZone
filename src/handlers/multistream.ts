import { formatFileSize } from '../triflow.js';
import { FileStorage } from '../storage.js';

export async function handleMultiStream(req: Request, storage: FileStorage): Promise<Response> {
  try {
    const formData = await req.formData();
    const mode = formData.get('mode') as string;
    const metadata = JSON.parse(formData.get('metadata') as string);

    console.log(`🚀 MultiStream Upload - Files: ${metadata.fileCount}, Size: ${formatFileSize(metadata.totalSize)}`);

    // Process and save files
    const uploadedFiles = [];
    let fileIndex = 0;

    for (const [key, file] of formData.entries()) {
      if (key.startsWith('file_') && file instanceof File) {
        const targetName = formData.get(`targetName_${fileIndex}`) as string | null;
        const savedFile = await storage.saveMultiStreamFileWithTargetName(file, fileIndex, targetName || file.name);
        uploadedFiles.push({
          name: savedFile.originalName,
          size: savedFile.size,
          type: savedFile.type,
          savedPath: savedFile.savedPath,
          hash: savedFile.hash,
          isDuplicate: savedFile.isDuplicate,
          uploadRecordId: savedFile.uploadRecordId
        });
        const duplicateMsg = savedFile.isDuplicate ? ' [DUPLICATE - reused existing file]' : '';
        console.log(`📁 Saved: ${file.name} (${formatFileSize(file.size)}) -> ${savedFile.savedPath}${duplicateMsg}`);
        fileIndex++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      mode: 'MultiStream',
      uploadedFiles,
      metadata,
      storageStats: storage.getStorageStats()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('MultiStream error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'MultiStream upload failed: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
