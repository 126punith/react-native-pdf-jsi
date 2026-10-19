import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from './specs/PdfLibrary.nitro';
import { acquirePdf, releasePdf } from './PDFJSI';
import { loadNormalizedSource, type PdfLoadProgress } from './PdfCache';
import { PdfError, toPdfError } from './errors';
import { normalizeSource, sameSource, type NormalizedSource, type PdfSource } from './source';

export interface UsePdfDocumentOptions {
  password?: string;
  onLoadProgress?: (progress: PdfLoadProgress) => void;
}

export interface UsePdfDocumentResult {
  /** Open document, shared with other users of the same path. Do not call close() on it. */
  document: PdfDocument | null;
  path: string | null;
  loading: boolean;
  error: PdfError | null;
}

function useStableSource(source: PdfSource | null | undefined): { value: NormalizedSource | null; error: PdfError | null } {
  const ref = useRef<{ value: NormalizedSource | null; error: PdfError | null }>({ value: null, error: null });
  let next: { value: NormalizedSource | null; error: PdfError | null };
  try {
    next = { value: source == null ? null : normalizeSource(source), error: null };
  } catch (error) {
    next = { value: null, error: toPdfError(error, 'invalid-source') };
  }
  const previous = ref.current;
  if (!sameSource(previous.value, next.value) || previous.error?.message !== next.error?.message) {
    ref.current = next;
  }
  return ref.current;
}

/**
 * Loads a source (downloading and caching remote files) and opens it as a
 * PdfDocument. The document is released when the source changes or the
 * component unmounts.
 */
export function usePdfDocument(source: PdfSource | null | undefined, options: UsePdfDocumentOptions = {}): UsePdfDocumentResult {
  const normalized = useStableSource(source);
  const { password } = options;
  const progressRef = useRef(options.onLoadProgress);
  progressRef.current = options.onLoadProgress;

  const [state, setState] = useState<UsePdfDocumentResult>({ document: null, path: null, loading: false, error: null });

  useEffect(() => {
    if (normalized.error) {
      setState({ document: null, path: null, loading: false, error: normalized.error });
      return;
    }
    const value = normalized.value;
    if (!value) {
      setState({ document: null, path: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    let acquired: PdfDocument | null = null;
    setState({ document: null, path: null, loading: true, error: null });

    (async () => {
      try {
        const loaded = await loadNormalizedSource(value, {
          signal: controller.signal,
          onProgress: (progress) => progressRef.current?.(progress),
        });
        if (controller.signal.aborted) return;
        const document = await acquirePdf(loaded.path, password);
        if (controller.signal.aborted) {
          releasePdf(document);
          return;
        }
        acquired = document;
        setState({ document, path: loaded.path, loading: false, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ document: null, path: null, loading: false, error: toPdfError(error, 'unsupported-pdf') });
      }
    })();

    return () => {
      controller.abort();
      if (acquired) {
        releasePdf(acquired);
        acquired = null;
      }
    };
  }, [normalized, password]);

  return state;
}

export default usePdfDocument;
