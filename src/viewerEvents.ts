import type { PdfErrorCode } from './errors';
import { PDF_ERROR_CODES } from './errors';
import type { OutlineItem, PdfRect } from './specs/PdfLibrary.nitro';

export interface PdfLoadEvent {
  pageCount: number;
  /** First page size in PDF points. */
  width: number;
  height: number;
  path: string;
  outline: OutlineItem[];
}

export interface PdfPageChangeEvent {
  /** Zero-based page under the centre of the viewport (the last page once scrolled to the end). */
  page: number;
  pageCount: number;
}

export interface PdfScaleChangeEvent {
  /** Relative to the fitted page: 1 means the page fits as `fitPolicy` says. */
  scale: number;
}

export interface PdfPageTapEvent {
  page: number;
  /** PDF points from the page's top-left corner. */
  x: number;
  y: number;
}

export interface PdfLinkPressEvent {
  url: string;
}

export interface PdfPasswordRequiredEvent {
  /** A password was given and it was wrong. */
  incorrect: boolean;
}

export interface PdfHighlight {
  page: number;
  rect: PdfRect;
}

export type ViewerEvent =
  | ({ type: 'load' } & PdfLoadEvent)
  | ({ type: 'pageChange' } & PdfPageChangeEvent)
  | ({ type: 'scaleChange' } & PdfScaleChangeEvent)
  | ({ type: 'tap' } & PdfPageTapEvent)
  | ({ type: 'link' } & PdfLinkPressEvent)
  | ({ type: 'passwordRequired' } & PdfPasswordRequiredEvent)
  | { type: 'error'; code: PdfErrorCode; message: string; page?: number };

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function outline(value: unknown): OutlineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => ({ title: str(item.title), page: num(item.page), level: num(item.level) }));
}

/** Parses the JSON `message` of the native `onChange` event. Returns `null` for anything unknown. */
export function parseViewerEvent(message: string | null | undefined): ViewerEvent | null {
  if (typeof message !== 'string' || message.length === 0) {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(message);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (data.type) {
    case 'load':
      return {
        type: 'load',
        pageCount: num(data.pageCount),
        width: num(data.width),
        height: num(data.height),
        path: str(data.path),
        outline: outline(data.outline),
      };
    case 'pageChange':
      return { type: 'pageChange', page: num(data.page), pageCount: num(data.pageCount) };
    case 'scaleChange':
      return { type: 'scaleChange', scale: num(data.scale, 1) };
    case 'tap':
      return { type: 'tap', page: num(data.page), x: num(data.x), y: num(data.y) };
    case 'link':
      return { type: 'link', url: str(data.url) };
    case 'passwordRequired':
      return { type: 'passwordRequired', incorrect: data.incorrect === true };
    case 'error': {
      const code = str(data.code);
      return {
        type: 'error',
        code: (PDF_ERROR_CODES as readonly string[]).includes(code) ? (code as PdfErrorCode) : 'unknown',
        message: str(data.message, 'Unknown error'),
        ...(typeof data.page === 'number' ? { page: data.page } : {}),
      };
    }
    default:
      return null;
  }
}
