import type * as React from 'react';
import { codegenNativeCommands, codegenNativeComponent } from 'react-native';
import type { HostComponent, ViewProps } from 'react-native';
import type {
  BubblingEventHandler,
  Float,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

/** A JSON-encoded viewer event; see `src/viewerEvents.ts`. */
export type ViewerChangeEvent = Readonly<{
  message: string;
}>;

export type NativeHighlightRect = Readonly<{
  page: Int32;
  x: Float;
  y: Float;
  width: Float;
  height: Float;
}>;

export interface NativeProps extends ViewProps {
  path?: string;
  password?: string;
  initialPage?: WithDefault<Int32, 0>;
  initialScale?: WithDefault<Float, 1>;
  minScale?: WithDefault<Float, 1>;
  maxScale?: WithDefault<Float, 4>;
  horizontal?: WithDefault<boolean, false>;
  enablePaging?: WithDefault<boolean, false>;
  enableRTL?: WithDefault<boolean, false>;
  singlePage?: WithDefault<boolean, false>;
  /** 0: width, 1: height, 2: whole page. */
  fitPolicy?: WithDefault<Int32, 0>;
  spacing?: WithDefault<Int32, 8>;
  enableDoubleTapZoom?: WithDefault<boolean, true>;
  scrollEnabled?: WithDefault<boolean, true>;
  enableAnnotationRendering?: WithDefault<boolean, true>;
  showsHorizontalScrollIndicator?: WithDefault<boolean, true>;
  showsVerticalScrollIndicator?: WithDefault<boolean, true>;
  highlightRects?: ReadonlyArray<NativeHighlightRect>;
  onChange?: BubblingEventHandler<ViewerChangeEvent>;
}

type ComponentType = HostComponent<NativeProps>;

interface NativeCommands {
  goToPage: (viewRef: React.ElementRef<ComponentType>, page: Int32, animated: boolean) => void;
  zoomTo: (viewRef: React.ElementRef<ComponentType>, scale: Float, animated: boolean) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['goToPage', 'zoomTo'],
});

export default codegenNativeComponent<NativeProps>('RNPDFPdfView') as ComponentType;
