import * as React from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { NativeSyntheticEvent, StyleProp, ViewProps, ViewStyle } from 'react-native';

import NativePdfPageView from '../fabric/RNPDFPdfPageViewNativeComponent';
import type { PageViewChangeEvent } from '../fabric/RNPDFPdfPageViewNativeComponent';
import { PDF_ERROR_CODES, PdfError } from './errors';
import type { PdfErrorCode } from './errors';
import { toPageIndex } from './pages';
import type { PdfDocument } from './specs/PdfLibrary.nitro';

export interface PdfPageProps extends Omit<ViewProps, 'children' | 'style'> {
  /** An open document, for example from `usePdfDocument`. Its in-memory edits are shown. */
  document: PdfDocument;
  /** Zero-based page. */
  page: number;
  /** Change it to redraw after editing the document. */
  revision?: number;
  enableAnnotationRendering?: boolean;
  /** The page's aspect ratio is applied unless the style sets both width and height. */
  style?: StyleProp<ViewStyle>;
  /** Pixel size of the drawn bitmap. */
  onRender?: (size: { width: number; height: number }) => void;
  onError?: (error: PdfError) => void;
}

function aspectRatioOf(document: PdfDocument, page: number): number | undefined {
  try {
    const size = document.pageSize(page);
    return size.width > 0 && size.height > 0 ? size.width / size.height : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Draws one page of an open `PdfDocument`, sized by the page's aspect ratio.
 * Use it for thumbnails, page pickers and custom layouts.
 */
export function PdfPage({
  document,
  page,
  revision,
  enableAnnotationRendering,
  style,
  onRender,
  onError,
  ...viewProps
}: PdfPageProps): React.ReactElement | null {
  const callbacks = React.useRef({ onRender, onError });
  callbacks.current = { onRender, onError };

  const pageCount = document.pageCount;
  const index = toPageIndex(page, pageCount);
  const aspectRatio = index === null ? undefined : aspectRatioOf(document, index);

  React.useEffect(() => {
    if (index === null) {
      callbacks.current.onError?.(new PdfError('invalid-page', `Page ${page} is outside 0..${pageCount - 1}`, { page }));
    }
  }, [index, page, pageCount]);

  const handleChange = React.useCallback((event: NativeSyntheticEvent<PageViewChangeEvent>) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.nativeEvent.message) as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.type === 'render' && typeof data.width === 'number' && typeof data.height === 'number') {
      callbacks.current.onRender?.({ width: data.width, height: data.height });
    } else if (data.type === 'error') {
      const code = typeof data.code === 'string' && (PDF_ERROR_CODES as readonly string[]).includes(data.code) ? (data.code as PdfErrorCode) : 'unknown';
      callbacks.current.onError?.(new PdfError(code, typeof data.message === 'string' ? data.message : 'Failed to draw the page'));
    }
  }, []);

  if (index === null || (Platform.OS !== 'android' && Platform.OS !== 'ios')) {
    return null;
  }

  return (
    <NativePdfPageView
      {...viewProps}
      style={[styles.page, aspectRatio === undefined ? null : { aspectRatio }, style]}
      path={document.path}
      page={index}
      revision={typeof revision === 'number' && Number.isFinite(revision) ? Math.trunc(revision) | 0 : 0}
      enableAnnotationRendering={enableAnnotationRendering ?? true}
      onChange={handleChange}
    />
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: 'white' },
});
