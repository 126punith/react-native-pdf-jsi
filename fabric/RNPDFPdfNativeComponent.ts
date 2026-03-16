/**
 * @format
 */
'use strict';

import type { HostComponent, ViewProps } from 'react-native';
import type { BubblingEventHandler, Int32, Float } from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import * as React from 'react';

type ChangeEvent = Readonly<{
    message: string | null;
}>;

export interface NativeProps extends ViewProps {
    path?: string | null;
    page?: Int32 | null;
    scale?: Float | null;
    minScale?: Float | null;
    maxScale?: Float | null;
    horizontal?: boolean | null;
    enablePaging?: boolean | null;
    enableRTL?: boolean | null;
    enableAnnotationRendering?: boolean | null;
    showsHorizontalScrollIndicator?: boolean | null;
    showsVerticalScrollIndicator?: boolean | null;
    scrollEnabled?: boolean | null;
    enableMomentum?: boolean | null;
    enableAntialiasing?: boolean | null;
    enableDoubleTapZoom?: boolean | null;
    fitPolicy?: Int32 | null;
    spacing?: Int32 | null;
    password?: string | null;
    onChange?: BubblingEventHandler<ChangeEvent> | null;
    singlePage?: boolean | null;
    pdfId?: string | null;
    highlightRects?: ReadonlyArray<Readonly<{ page: Int32; rect: string }>> | null;
    activeMatchIndex?: Int32 | null;
}

interface NativeCommands {
    readonly setNativePage: (
        viewRef: React.ElementRef<HostComponent<NativeProps>>,
        page: Int32
    ) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
    supportedCommands: ['setNativePage'],
});

export default codegenNativeComponent<NativeProps>('RNPDFPdfView') as HostComponent<NativeProps>;
