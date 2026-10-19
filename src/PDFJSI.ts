/**
 * Nitro entry point and the document registry.
 *
 * Native documents are owned by a reference-counted registry. Hermes cannot
 * see the native memory behind a PdfDocument, so documents are closed
 * explicitly: when the last reference is released (after a small warm pool),
 * when the file is replaced (invalidatePdf), or on a memory warning.
 */

import { AppState } from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';

import { PdfError, toPdfError } from './errors';
import type { PdfCache } from './specs/PdfCache.nitro';
import type { PdfDocument, PdfLibrary } from './specs/PdfLibrary.nitro';

const WARM_POOL_SIZE = 2;

interface Entry {
  path: string;
  promise: Promise<PdfDocument>;
  document: PdfDocument | null;
  refs: number;
  pinned: boolean;
  stale: boolean;
  closed: boolean;
}

let library: PdfLibrary | undefined;
let cache: PdfCache | undefined;
/** path -> entry for the current (non-stale) document of that path */
const entries = new Map<string, Entry>();
/** entries whose file was replaced but are still referenced or pinned */
const staleEntries = new Set<Entry>();
/** released, unpinned entries kept open for fast reopen; oldest first */
const warmPool: Entry[] = [];

export function getPdfLibrary(): PdfLibrary {
  if (library === undefined) {
    library = NitroModules.createHybridObject<PdfLibrary>('PdfLibrary');
  }
  return library;
}

export function getPdfCache(): PdfCache {
  if (cache === undefined) {
    cache = NitroModules.createHybridObject<PdfCache>('PdfCache');
  }
  return cache;
}

function safeClose(document: PdfDocument): void {
  try {
    document.close();
  } catch (error) {
    if (__DEV__) {
      console.warn('react-native-pdf-jsi: close() failed', error);
    }
  }
}

function removeFromWarm(entry: Entry): void {
  const index = warmPool.indexOf(entry);
  if (index !== -1) {
    warmPool.splice(index, 1);
  }
}

function closeEntry(entry: Entry): void {
  if (entry.closed) {
    return;
  }
  entry.closed = true;
  removeFromWarm(entry);
  staleEntries.delete(entry);
  if (entries.get(entry.path) === entry) {
    entries.delete(entry.path);
  }
  if (entry.document) {
    safeClose(entry.document);
    entry.document = null;
  }
}

function closedWhileOpening(): PdfError {
  return new PdfError('document-closed', 'The PDF was closed while it was opening.');
}

function createEntry(path: string, password?: string): Entry {
  const entry: Entry = {
    path,
    promise: Promise.resolve(null as unknown as PdfDocument),
    document: null,
    refs: 0,
    pinned: false,
    stale: false,
    closed: false,
  };
  let opening: Promise<PdfDocument>;
  try {
    opening = getPdfLibrary().open(path, password);
  } catch (error) {
    opening = Promise.reject(error);
  }
  entry.promise = opening.then(
    (document) => {
      if (entry.closed) {
        safeClose(document);
        throw closedWhileOpening();
      }
      entry.document = document;
      if (entry.refs === 0 && !entry.pinned) {
        settleUnreferenced(entry);
      }
      return document;
    },
    (error: unknown) => {
      entry.closed = true;
      if (entries.get(path) === entry) {
        entries.delete(path);
      }
      staleEntries.delete(entry);
      throw toPdfError(error, 'unsupported-pdf');
    }
  );
  entries.set(path, entry);
  return entry;
}

function settleUnreferenced(entry: Entry): void {
  if (entry.closed || entry.refs > 0 || entry.pinned) {
    return;
  }
  if (entry.stale) {
    closeEntry(entry);
    return;
  }
  if (!entry.document) {
    return;
  }
  removeFromWarm(entry);
  warmPool.push(entry);
  while (warmPool.length > WARM_POOL_SIZE) {
    const oldest = warmPool.shift();
    if (oldest) {
      closeEntry(oldest);
    }
  }
}

function entryFor(path: string, password?: string): Entry {
  return entries.get(path) ?? createEntry(path, password);
}

async function acquireEntry(path: string, password?: string): Promise<Entry> {
  const entry = entryFor(path, password);
  entry.refs += 1;
  removeFromWarm(entry);
  try {
    await entry.promise;
  } catch (error) {
    entry.refs -= 1;
    throw error;
  }
  if (entry.closed) {
    entry.refs -= 1;
    throw closedWhileOpening();
  }
  return entry;
}

function releaseEntry(entry: Entry): void {
  if (entry.refs <= 0) {
    return;
  }
  entry.refs -= 1;
  settleUnreferenced(entry);
}

function findReferencedEntry(pathOrDocument: string | PdfDocument): Entry | null {
  const matches = (entry: Entry) =>
    entry.refs > 0 && (typeof pathOrDocument === 'string' ? entry.path === pathOrDocument : entry.document === pathOrDocument);
  for (const entry of entries.values()) {
    if (matches(entry)) {
      return entry;
    }
  }
  for (const entry of staleEntries) {
    if (matches(entry)) {
      return entry;
    }
  }
  return null;
}

/**
 * Takes a reference on the document at `path`, opening it if needed.
 * Every acquirePdf must be paired with releasePdf.
 */
export async function acquirePdf(path: string, password?: string): Promise<PdfDocument> {
  const entry = await acquireEntry(path, password);
  return entry.document as PdfDocument;
}

/** Releases a reference taken with acquirePdf (by path or document handle). */
export function releasePdf(pathOrDocument: string | PdfDocument): void {
  const entry = findReferencedEntry(pathOrDocument);
  if (entry) {
    releaseEntry(entry);
  }
}

/** Runs `fn(document)` while holding a reference; always releases it. */
export async function withPdfDocument<T>(
  path: string,
  fn: (document: PdfDocument) => T | Promise<T>,
  password?: string
): Promise<T> {
  const entry = await acquireEntry(path, password);
  try {
    return await fn(entry.document as PdfDocument);
  } catch (error) {
    throw toPdfError(error);
  } finally {
    releaseEntry(entry);
  }
}

/**
 * Call when the file at `path` is about to be replaced or deleted. The next
 * acquire opens a fresh document; the old one closes once nothing uses it.
 */
export function invalidatePdf(path: string): void {
  const entry = entries.get(path);
  if (!entry) {
    return;
  }
  entries.delete(path);
  entry.stale = true;
  removeFromWarm(entry);
  if (entry.refs > 0 || entry.pinned) {
    staleEntries.add(entry);
  } else {
    closeEntry(entry);
  }
}

/** Closes every released document kept warm for fast reopen. */
export function trimPdfCache(): void {
  while (warmPool.length > 0) {
    const entry = warmPool.shift();
    if (entry) {
      closeEntry(entry);
    }
  }
}

/** Force-closes every document, including referenced and pinned ones. */
export function closeAllPdfs(): void {
  for (const entry of [...entries.values(), ...staleEntries]) {
    closeEntry(entry);
  }
  warmPool.length = 0;
}

export interface PdfRegistryStats {
  open: number;
  referenced: number;
  pinned: number;
  warm: number;
  stale: number;
}

export function getPdfRegistryStats(): PdfRegistryStats {
  let referenced = 0;
  let pinned = 0;
  for (const entry of entries.values()) {
    if (entry.refs > 0) referenced += 1;
    if (entry.pinned) pinned += 1;
  }
  return {
    open: entries.size,
    referenced,
    pinned,
    warm: warmPool.length,
    stale: staleEntries.size,
  };
}

try {
  AppState.addEventListener('memoryWarning', trimPdfCache);
} catch {
  // AppState is unavailable outside a React Native runtime.
}

/**
 * Opens and pins the document at `path`. A pinned document stays open until
 * closePdf(path). Prefer withPdfDocument or acquirePdf/releasePdf.
 */
export async function openPdf(path: string, password?: string): Promise<PdfDocument> {
  const entry = entryFor(path, password);
  entry.pinned = true;
  removeFromWarm(entry);
  return entry.promise;
}

/** Force-closes the document at `path`, even if it is still referenced. */
export function closePdf(path: string): void {
  const live = entries.get(path);
  if (live) {
    closeEntry(live);
  }
  for (const entry of [...staleEntries]) {
    if (entry.path === path) {
      closeEntry(entry);
    }
  }
}

/** Whether the Nitro module is installed and linked. */
export function isPdfModuleAvailable(): boolean {
  try {
    getPdfLibrary();
    return true;
  } catch {
    return false;
  }
}

export function check16KBSupport() {
  return getPdfLibrary().kb16Support;
}
