import * as React from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import type { NativeSyntheticEvent, StyleProp, ViewProps, ViewStyle } from 'react-native';

import NativePdfView, { Commands } from '../fabric/RNPDFPdfViewNativeComponent';
import type { NativeHighlightRect, ViewerChangeEvent } from '../fabric/RNPDFPdfViewNativeComponent';
import { PdfError, toPdfError } from './errors';
import { toPageIndex, toScale } from './pages';
import { loadNormalizedSource } from './PdfCache';
import type { PdfLoadProgress } from './PdfCache';
import { normalizeSource, sameSource } from './source';
import type { NormalizedSource, PdfSource } from './source';
import { parseViewerEvent } from './viewerEvents';
import type {
  PdfHighlight,
  PdfLinkPressEvent,
  PdfLoadEvent,
  PdfPageChangeEvent,
  PdfPageTapEvent,
  PdfPasswordRequiredEvent,
  PdfScaleChangeEvent,
} from './viewerEvents';

export type PdfFitPolicy = 'width' | 'height' | 'page';

export interface PdfViewProps extends Omit<ViewProps, 'children' | 'style'> {
  source: PdfSource;
  /** Changing it reopens the document; a downloaded file is reused. */
  password?: string;
  /** Zero-based page shown first. Applied once per loaded document; use `goToPage` afterwards. */
  initialPage?: number;
  /** Zoom shown first, relative to the fitted page. Applied once per loaded document. */
  initialScale?: number;
  /** Relative to the fitted page. Defaults to 1. */
  minScale?: number;
  /** Relative to the fitted page. Defaults to 4. */
  maxScale?: number;
  horizontal?: boolean;
  /** One page per swipe. */
  enablePaging?: boolean;
  /** Right-to-left page order in horizontal layouts. */
  enableRTL?: boolean;
  /** Shows only `initialPage`, without scrolling or zooming. Touches reach the parent. */
  singlePage?: boolean;
  /** How a page is scaled at zoom 1. Defaults to `'width'`. */
  fitPolicy?: PdfFitPolicy;
  /** dp / pt between pages. Defaults to 8. */
  spacing?: number;
  enableDoubleTapZoom?: boolean;
  scrollEnabled?: boolean;
  enableAnnotationRendering?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  showsVerticalScrollIndicator?: boolean;
  /** Rectangles drawn over pages, for example search matches. */
  highlights?: readonly PdfHighlight[];
  style?: StyleProp<ViewStyle>;
  /** Shown while the document downloads or opens. `null` hides the default spinner. */
  renderActivityIndicator?: ((progress: PdfLoadProgress | null) => React.ReactNode) | null;
  onLoadProgress?: (progress: PdfLoadProgress) => void;
  onLoad?: (event: PdfLoadEvent) => void;
  onPageChange?: (event: PdfPageChangeEvent) => void;
  onScaleChange?: (event: PdfScaleChangeEvent) => void;
  onPageTap?: (event: PdfPageTapEvent) => void;
  onLinkPress?: (event: PdfLinkPressEvent) => void;
  onPasswordRequired?: (event: PdfPasswordRequiredEvent) => void;
  onError?: (error: PdfError) => void;
}

export interface NavigationOptions {
  /** Defaults to true. */
  animated?: boolean;
}

export interface PdfViewRef {
  /** Zero-based; clamped to the last page. Ignored before `onLoad` and for values that are not whole numbers. */
  goToPage(page: number, options?: NavigationOptions): void;
  /** Relative to the fitted page; clamped to `[minScale, maxScale]`. `zoomTo(1)` resets the zoom. */
  zoomTo(scale: number, options?: NavigationOptions): void;
  /** Local path of the displayed document, once loaded. */
  getPath(): string | null;
}

const FIT_POLICY: Record<PdfFitPolicy, number> = { width: 0, height: 1, page: 2 };

type Callbacks = Pick<
  PdfViewProps,
  | 'onLoadProgress'
  | 'onLoad'
  | 'onPageChange'
  | 'onScaleChange'
  | 'onPageTap'
  | 'onLinkPress'
  | 'onPasswordRequired'
  | 'onError'
>;

interface Normalized {
  source: NormalizedSource | null;
  error: PdfError | null;
}

/** Keeps the previous normalized source while the new one is equal by value. */
function useNormalizedSource(source: PdfSource): Normalized {
  const previous = React.useRef<Normalized>({ source: null, error: null });
  let next: Normalized;
  try {
    next = { source: normalizeSource(source), error: null };
  } catch (error) {
    next = { source: null, error: toPdfError(error, 'invalid-source') };
  }
  if (next.source !== null && sameSource(previous.current.source, next.source)) {
    return previous.current;
  }
  if (
    next.error !== null &&
    previous.current.error !== null &&
    previous.current.error.message === next.error.message
  ) {
    return previous.current;
  }
  previous.current = next;
  return next;
}

function useHighlights(highlights: readonly PdfHighlight[] | undefined): NativeHighlightRect[] | undefined {
  const key = highlights === undefined ? '' : JSON.stringify(highlights);
  return React.useMemo(() => {
    if (highlights === undefined) {
      return undefined;
    }
    return highlights
      .filter((item) => toPageIndex(item.page) !== null && item.rect !== undefined)
      .map((item) => ({
        page: item.page,
        x: item.rect.x,
        y: item.rect.y,
        width: item.rect.width,
        height: item.rect.height,
      }));
    // `key` captures the contents; the array identity does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export const PdfView = React.forwardRef<PdfViewRef, PdfViewProps>(function PdfView(props, ref) {
  const {
    source,
    password,
    initialPage,
    initialScale,
    minScale,
    maxScale,
    horizontal,
    enablePaging,
    enableRTL,
    singlePage,
    fitPolicy,
    spacing,
    enableDoubleTapZoom,
    scrollEnabled,
    enableAnnotationRendering,
    showsHorizontalScrollIndicator,
    showsVerticalScrollIndicator,
    highlights,
    style,
    renderActivityIndicator,
    onLoadProgress,
    onLoad,
    onPageChange,
    onScaleChange,
    onPageTap,
    onLinkPress,
    onPasswordRequired,
    onError,
    ...viewProps
  } = props;

  const callbacks = React.useRef<Callbacks>({});
  callbacks.current = {
    onLoadProgress,
    onLoad,
    onPageChange,
    onScaleChange,
    onPageTap,
    onLinkPress,
    onPasswordRequired,
    onError,
  };

  const nativeRef = React.useRef<React.ElementRef<typeof NativePdfView>>(null);
  const pageCount = React.useRef<number | null>(null);
  const normalized = useNormalizedSource(source);
  const nativeHighlights = useHighlights(highlights);
  const [path, setPath] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<PdfLoadProgress | null>(null);

  React.useEffect(() => {
    if (normalized.error) {
      setPath(null);
      callbacks.current.onError?.(normalized.error);
      return undefined;
    }
    const target = normalized.source;
    if (target === null) {
      return undefined;
    }
    const controller = new AbortController();
    setPath(null);
    setProgress(null);
    pageCount.current = null;
    loadNormalizedSource(target, {
      signal: controller.signal,
      onProgress: (value) => {
        if (controller.signal.aborted) {
          return;
        }
        setProgress(value);
        callbacks.current.onLoadProgress?.(value);
      },
    }).then(
      (loaded) => {
        if (!controller.signal.aborted) {
          setPath(loaded.path);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          callbacks.current.onError?.(toPdfError(error));
        }
      }
    );
    return () => controller.abort();
  }, [normalized]);

  const handleChange = React.useCallback((event: NativeSyntheticEvent<ViewerChangeEvent>) => {
    const parsed = parseViewerEvent(event.nativeEvent.message);
    if (parsed === null) {
      return;
    }
    const current = callbacks.current;
    switch (parsed.type) {
      case 'load': {
        const { type: _type, ...payload } = parsed;
        pageCount.current = payload.pageCount;
        current.onLoad?.(payload);
        break;
      }
      case 'pageChange':
        pageCount.current = parsed.pageCount;
        current.onPageChange?.({ page: parsed.page, pageCount: parsed.pageCount });
        break;
      case 'scaleChange':
        current.onScaleChange?.({ scale: parsed.scale });
        break;
      case 'tap':
        current.onPageTap?.({ page: parsed.page, x: parsed.x, y: parsed.y });
        break;
      case 'link':
        current.onLinkPress?.({ url: parsed.url });
        break;
      case 'passwordRequired':
        current.onPasswordRequired?.({ incorrect: parsed.incorrect });
        if (!current.onPasswordRequired) {
          current.onError?.(
            new PdfError(
              parsed.incorrect ? 'password-incorrect' : 'password-required',
              parsed.incorrect ? 'The password is incorrect.' : 'This PDF needs a password.'
            )
          );
        }
        break;
      case 'error':
        current.onError?.(
          new PdfError(parsed.code, parsed.message, parsed.page !== undefined ? { page: parsed.page } : {})
        );
        break;
    }
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      goToPage(page, options) {
        const count = pageCount.current;
        if (count === null || nativeRef.current === null) {
          return;
        }
        const index = toPageIndex(page, count);
        if (index === null) {
          return;
        }
        Commands.goToPage(nativeRef.current, index, options?.animated ?? true);
      },
      zoomTo(scale, options) {
        if (pageCount.current === null || nativeRef.current === null) {
          return;
        }
        const value = toScale(scale);
        if (value === null) {
          return;
        }
        Commands.zoomTo(nativeRef.current, value, options?.animated ?? true);
      },
      getPath() {
        return path;
      },
    }),
    [path]
  );

  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return null;
  }

  const safeInitialPage = toPageIndex(initialPage) ?? 0;
  const safeInitialScale = toScale(initialScale) ?? 1;
  const safeMinScale = toScale(minScale) ?? 1;
  const safeMaxScale = Math.max(toScale(maxScale) ?? 4, safeMinScale);

  return (
    <View style={[styles.container, style]} {...viewProps}>
      {path === null ? (
        <View style={styles.loading}>
          {renderActivityIndicator === null
            ? null
            : renderActivityIndicator
              ? renderActivityIndicator(progress)
              : normalized.error === null && <ActivityIndicator />}
        </View>
      ) : (
        <NativePdfView
          ref={nativeRef}
          style={StyleSheet.absoluteFill}
          path={path}
          password={password ?? ''}
          initialPage={safeInitialPage}
          initialScale={safeInitialScale}
          minScale={safeMinScale}
          maxScale={safeMaxScale}
          horizontal={horizontal ?? false}
          enablePaging={enablePaging ?? false}
          enableRTL={enableRTL ?? false}
          singlePage={singlePage ?? false}
          fitPolicy={FIT_POLICY[fitPolicy ?? 'width'] ?? 0}
          spacing={typeof spacing === 'number' && Number.isFinite(spacing) && spacing >= 0 ? Math.round(spacing) : 8}
          enableDoubleTapZoom={enableDoubleTapZoom ?? true}
          scrollEnabled={scrollEnabled ?? true}
          enableAnnotationRendering={enableAnnotationRendering ?? true}
          showsHorizontalScrollIndicator={showsHorizontalScrollIndicator ?? true}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator ?? true}
          highlightRects={nativeHighlights}
          onChange={handleChange}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PdfView;
