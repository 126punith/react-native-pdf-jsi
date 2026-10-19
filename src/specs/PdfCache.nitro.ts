import type { HybridObject } from 'react-native-nitro-modules';

/**
 * - `none`: download into a temporary file that is removed on the next start.
 * - `session`: keep the copy in the cache directory; the OS may remove it.
 * - `persistent`: keep the copy in app storage, excluded from backups.
 */
export type PdfCacheMode = 'none' | 'session' | 'persistent';

export interface PdfDownloadRequest {
  /** Identifies this request for `cancelDownload`. */
  requestId: string;
  url: string;
  headers?: Record<string, string>;
  /** Cache key instead of the URL and headers (for signed URLs). */
  cacheKey?: string;
  cache: PdfCacheMode;
  /** A stored copy younger than this is used without asking the server. */
  maxAgeMs?: number;
  /** Files at least this large are downloaded in Range chunks when the server allows it. */
  chunkThresholdBytes?: number;
}

export interface PdfCacheEntry {
  key: string;
  url: string;
  filePath: string;
  byteSize: number;
  etag: string;
  lastModified: string;
  validatedAtMs: number;
  lastAccessMs: number;
  persistent: boolean;
  /** The copy was served without a successful request (offline fallback). */
  stale: boolean;
  /** The copy came from the cache (fresh or revalidated with 304). */
  fromCache: boolean;
}

export interface PdfDownloadsTarget {
  /** Where the file can be found: a `content://` URI on Android, a path on iOS. */
  uri: string;
}

/**
 * Native downloads, the document cache, and the local-file helpers the JS
 * layer needs without react-native-blob-util.
 *
 * Errors carry a stable code as a `[code]` prefix of the message.
 */
export interface PdfCache
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  download(
    request: PdfDownloadRequest,
    onProgress?: (loadedBytes: number, totalBytes: number) => void
  ): Promise<PdfCacheEntry>;
  cancelDownload(requestId: string): void;
  getEntry(url: string, headers?: Record<string, string>, cacheKey?: string): Promise<PdfCacheEntry | undefined>;
  remove(key: string): Promise<boolean>;
  clear(): Promise<void>;
  getByteSize(): Promise<number>;
  /** Least recently used copies are removed once the cache grows past this. 0 turns the cap off. */
  maxCacheBytes: number;

  /**
   * Turns a local source into a readable file path: `file://` URIs, absolute
   * paths, Android `content://` URIs and `bundle-assets://` / raw resources,
   * and iOS bundle resources. Copies are made into the cache when needed.
   */
  resolveLocal(uri: string): Promise<string>;
  /** Writes base64 PDF bytes into the cache and returns the path. The same text gives the same path. */
  writeBase64(base64: string, identifier: string): Promise<string>;

  readonly cacheDirectory: string;
  readonly documentDirectory: string;
  fileExists(path: string): Promise<boolean>;
  fileSize(path: string): Promise<number>;
  copyFile(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<boolean>;
  /** Android: MediaStore Downloads. iOS: the app's Documents folder (visible in Files when file sharing is on). */
  saveToDownloads(path: string, fileName: string, mimeType: string): Promise<PdfDownloadsTarget>;
}
