import { codegenNativeComponent } from 'react-native';
import type { HostComponent, ViewProps } from 'react-native';
import type { BubblingEventHandler, Int32, WithDefault } from 'react-native/Libraries/Types/CodegenTypes';

/** JSON-encoded `{ type: 'render', width, height }` or `{ type: 'error', code, message }`. */
export type PageViewChangeEvent = Readonly<{
  message: string;
}>;

export interface NativeProps extends ViewProps {
  /** Path of an open PdfDocument; that document is reused, so in-memory edits are shown. */
  path?: string;
  page?: WithDefault<Int32, 0>;
  /** Changing it redraws the page, for example after editing. */
  revision?: WithDefault<Int32, 0>;
  enableAnnotationRendering?: WithDefault<boolean, true>;
  onChange?: BubblingEventHandler<PageViewChangeEvent>;
}

export default codegenNativeComponent<NativeProps>('RNPDFPdfPageView') as HostComponent<NativeProps>;
