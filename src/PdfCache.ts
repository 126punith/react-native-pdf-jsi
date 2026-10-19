import { PdfError, toPdfError } from './errors';
import { getPdfCache } from './PDFJSI';
import type { NormalizedSource, PdfCacheMode } from './source';
import { base64Identifier, normalizeSource } from './source';
import type { PdfSource } from './source';
import type { PdfCacheEntry, PdfDownloadsTarget } from './specs/PdfCache.nitro';

export type { PdfCacheEntry, PdfDownloadsTarget };

export interface PdfLoadProgress {
  loadedBytes: number;
  /** `undefined` when the server did not send a length. */
  totalBytes?: number;
}

export interface LoadOptions {
  onProgress?: (progress: PdfLoadProgress) => void;
  signal?: AbortSignal;
}

export interface LoadedSource {
  path: string;
  /** Set for remote sources. */
  entry?: PdfCacheEntry;
}

let nextRequestId = 0;

function requestId(): string {
  nextRequestId += 1;
  return `rq-${Date.now().toString(36)}-${nextRequestId}`;
}

function cancelled(): PdfError {
  return new PdfError('cancelled', 'The download was cancelled.');
}

/** Downloads, copies or decodes a normalized source into a local file and returns its path. */
export async function loadNormalizedSource(source: NormalizedSource, options: LoadOptions = {}): Promise<LoadedSource> {
  const { signal, onProgress } = options;
  if (signal?.aborted) {
    throw cancelled();
  }
  const cache = getPdfCache();
  try {
    switch (source.kind) {
      case 'local':
        return { path: await cache.resolveLocal(source.uri) };
      case 'base64':
        return { path: await cache.writeBase64(source.base64, base64Identifier(source.base64)) };
      case 'remote': {
        const id = requestId();
        const abort = () => cache.cancelDownload(id);
        signal?.addEventListener('abort', abort);
        try {
          const entry = await cache.download(
            {
              requestId: id,
              url: source.url,
              headers: source.headers,
              cache: source.cache,
              ...(source.cacheKey !== undefined ? { cacheKey: source.cacheKey } : {}),
              ...(source.maxAgeMs !== undefined ? { maxAgeMs: source.maxAgeMs } : {}),
            },
            onProgress
              ? (loadedBytes, totalBytes) =>
                  onProgress(totalBytes > 0 ? { loadedBytes, totalBytes } : { loadedBytes })
              : undefined
          );
          return { path: entry.filePath, entry };
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      throw cancelled();
    }
    throw toPdfError(error, source.kind === 'remote' ? 'download-failed' : 'io-error');
  }
}

/** Public cache API. Downloads happen natively; nothing goes through JS memory. */
export const PdfCache = {
  /** Downloads (or revalidates) a remote document ahead of time. */
  async download(source: PdfSource, options: LoadOptions = {}): Promise<PdfCacheEntry> {
    const normalized = normalizeSource(source);
    if (normalized.kind !== 'remote') {
      throw new PdfError('invalid-source', 'PdfCache.download needs an http(s) uri.');
    }
    const loaded = await loadNormalizedSource(normalized, options);
    return loaded.entry as PdfCacheEntry;
  },

  async getEntry(source: PdfSource): Promise<PdfCacheEntry | undefined> {
    const normalized = normalizeSource(source);
    if (normalized.kind !== 'remote') {
      return undefined;
    }
    return getPdfCache().getEntry(normalized.url, normalized.headers, normalized.cacheKey);
  },

  /** Removes a stored copy by its entry key. */
  remove(key: string): Promise<boolean> {
    return getPdfCache().remove(key);
  },

  clear(): Promise<void> {
    return getPdfCache().clear();
  },

  getByteSize(): Promise<number> {
    return getPdfCache().getByteSize();
  },

  get maxCacheBytes(): number {
    return getPdfCache().maxCacheBytes;
  },

  set maxCacheBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new PdfError('invalid-argument', 'maxCacheBytes must be a non-negative number.');
    }
    getPdfCache().maxCacheBytes = bytes;
  },
};

export type { PdfCacheMode };

/** Local-file helpers that replace react-native-blob-util for this library. */
export const PdfFiles = {
  get cacheDirectory(): string {
    return getPdfCache().cacheDirectory;
  },
  get documentDirectory(): string {
    return getPdfCache().documentDirectory;
  },
  exists: (path: string) => getPdfCache().fileExists(path),
  size: (path: string) => getPdfCache().fileSize(path),
  copy: (from: string, to: string) => getPdfCache().copyFile(from, to),
  remove: (path: string) => getPdfCache().deleteFile(path),
  /** Android: the public Downloads folder. iOS: the app's Documents folder. */
  saveToDownloads: (path: string, fileName: string, mimeType = 'application/pdf') =>
    getPdfCache().saveToDownloads(path, fileName, mimeType),
};
