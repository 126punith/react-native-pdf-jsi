import { PdfError } from './errors';
import type { PdfCacheMode } from './specs/PdfCache.nitro';

export type { PdfCacheMode };

/** A remote document (`http(s)://`) or a local URI (`file://`, `content://`, `bundle-assets://`). */
export interface PdfUriSource {
  uri: string;
  /** Request headers for remote documents. Keep values ASCII. */
  headers?: Record<string, string>;
  /** `true` is `'session'`, `false` is `'none'`. Defaults to `'session'`. */
  cache?: PdfCacheMode | boolean;
  /** A stored copy younger than this is used without asking the server. */
  maxAgeMs?: number;
  /** Cache key instead of the URL and headers, for signed URLs that change. */
  cacheKey?: string;
}

/** An absolute path to a file on the device. */
export interface PdfFileSource {
  filePath: string;
}

/** The document's bytes as standard base64, without a `data:` prefix. */
export interface PdfBase64Source {
  base64: string;
}

/** `require('./file.pdf')` */
export type PdfAssetSource = number;

export type PdfSource = PdfUriSource | PdfFileSource | PdfBase64Source | PdfAssetSource;

export type NormalizedSource =
  | {
      kind: 'remote';
      url: string;
      headers: Record<string, string>;
      cache: PdfCacheMode;
      maxAgeMs?: number;
      cacheKey?: string;
    }
  | { kind: 'local'; uri: string }
  | { kind: 'base64'; base64: string };

export type AssetResolver = (asset: number) => { uri: string } | null | undefined;

const DATA_URI = /^data:application\/pdf;base64,/i;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function defaultAssetResolver(asset: number): { uri: string } | null | undefined {
  // Loaded lazily so this module can be used (and tested) outside React Native.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Image } = require('react-native') as typeof import('react-native');
  return Image.resolveAssetSource(asset);
}

function invalid(message: string): PdfError {
  return new PdfError('invalid-source', message);
}

function normalizeCache(cache: PdfUriSource['cache']): PdfCacheMode {
  if (cache === undefined || cache === true) {
    return 'session';
  }
  if (cache === false) {
    return 'none';
  }
  if (cache === 'none' || cache === 'session' || cache === 'persistent') {
    return cache;
  }
  throw invalid(`cache must be 'none', 'session', 'persistent' or a boolean, got ${String(cache)}.`);
}

function normalizeHeaders(headers: PdfUriSource['headers']): Record<string, string> {
  if (headers === undefined || headers === null) {
    return {};
  }
  if (typeof headers !== 'object') {
    throw invalid('headers must be an object of strings.');
  }
  const result: Record<string, string> = {};
  for (const name of Object.keys(headers).sort()) {
    const value = headers[name];
    if (!HEADER_NAME.test(name)) {
      throw invalid(`Header name "${name}" is not a valid HTTP token.`);
    }
    if (typeof value !== 'string') {
      throw invalid(`Header "${name}" must be a string.`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value)) {
      // The value may hold a token, so it is never included in the message.
      throw invalid(`Header "${name}" contains a control character.`);
    }
    result[name] = value;
  }
  return result;
}

function normalizeUri(source: PdfUriSource): NormalizedSource {
  const uri = source.uri;
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw invalid('uri must be a non-empty string.');
  }
  if (DATA_URI.test(uri)) {
    return normalizeBase64(uri.replace(DATA_URI, ''));
  }
  if (/^https?:\/\//i.test(uri)) {
    const maxAgeMs = source.maxAgeMs;
    if (maxAgeMs !== undefined && (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || maxAgeMs < 0)) {
      throw invalid('maxAgeMs must be a non-negative number.');
    }
    if (source.cacheKey !== undefined && (typeof source.cacheKey !== 'string' || source.cacheKey.length === 0)) {
      throw invalid('cacheKey must be a non-empty string.');
    }
    return {
      kind: 'remote',
      url: uri,
      headers: normalizeHeaders(source.headers),
      cache: normalizeCache(source.cache),
      ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
      ...(source.cacheKey !== undefined ? { cacheKey: source.cacheKey } : {}),
    };
  }
  if (/^data:/i.test(uri)) {
    throw invalid('Only data:application/pdf;base64 URIs are supported. Prefer { base64 }.');
  }
  return { kind: 'local', uri };
}

function normalizeBase64(base64: string): NormalizedSource {
  if (typeof base64 !== 'string' || base64.trim().length === 0) {
    throw invalid('base64 must be a non-empty string.');
  }
  if (DATA_URI.test(base64)) {
    return { kind: 'base64', base64: base64.replace(DATA_URI, '') };
  }
  if (/^data:/i.test(base64)) {
    throw invalid('base64 must be the document bytes without a data: prefix.');
  }
  return { kind: 'base64', base64 };
}

/** Validates a source and turns it into the single shape the loader handles. Throws `invalid-source`. */
export function normalizeSource(source: PdfSource, resolveAsset: AssetResolver = defaultAssetResolver): NormalizedSource {
  if (typeof source === 'number') {
    const resolved = resolveAsset(source);
    if (!resolved || typeof resolved.uri !== 'string' || resolved.uri.length === 0) {
      throw invalid(`Asset ${source} could not be resolved.`);
    }
    return normalizeUri({ uri: resolved.uri, cache: 'none' });
  }
  if (source === null || typeof source !== 'object') {
    throw invalid('source must be an object or the result of require().');
  }
  if ('base64' in source) {
    return normalizeBase64(source.base64);
  }
  if ('filePath' in source) {
    if (typeof source.filePath !== 'string' || source.filePath.length === 0) {
      throw invalid('filePath must be a non-empty string.');
    }
    return { kind: 'local', uri: source.filePath };
  }
  if ('uri' in source) {
    return normalizeUri(source);
  }
  throw invalid('source needs one of uri, filePath or base64.');
}

function sameHeaders(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

/** Compares normalized sources by value, so an inline object literal does not reload the document. */
export function sameSource(a: NormalizedSource | null, b: NormalizedSource | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'local':
      return a.uri === (b as typeof a).uri;
    case 'base64':
      return a.base64 === (b as typeof a).base64;
    case 'remote': {
      const other = b as typeof a;
      return (
        a.url === other.url &&
        a.cache === other.cache &&
        a.maxAgeMs === other.maxAgeMs &&
        a.cacheKey === other.cacheKey &&
        sameHeaders(a.headers, other.headers)
      );
    }
  }
}

/** FNV-1a over the text plus its length: a stable file name for a base64 document. */
export function base64Identifier(base64: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < base64.length; index++) {
    hash ^= base64.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `b64-${(hash >>> 0).toString(16).padStart(8, '0')}-${base64.length.toString(16)}`;
}
