export interface TriFlowMode {
  name: 'MultiStream' | 'ArcPack' | 'ChunkLine';
  description: string;
  maxFileSize: number;
  requires: string[];
}

export const triFlowModes: TriFlowMode[] = [
  {
    name: 'MultiStream',
    description: 'Direct multi-file ingestion for small to medium files',
    maxFileSize: 50 * 1024 * 1024, // 50MB
    requires: ['FormData', 'Fetch API']
  },
  {
    name: 'ArcPack', 
    description: 'Client-side archive streaming for large file collections',
    maxFileSize: 500 * 1024 * 1024, // 500MB
    requires: ['Compression Streams', 'WebAssembly']
  },
  {
    name: 'ChunkLine',
    description: 'Resumable chunked transfer for very large files',
    maxFileSize: Infinity,
    requires: ['Streams API', 'Service Workers']
  }
];

export function detectServerCapabilities() {
  return {
    compression: true,
    chunking: true,
    streaming: true,
    maxFileSize: '2GB',
    supportedFormats: ['zip', 'tar', 'gzip']
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
