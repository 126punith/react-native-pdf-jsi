/**
 * Error codes are stable and identical on iOS and Android. Messages are for
 * people and may change: match on `error.code`.
 */
export type PdfErrorCode =
  | 'invalid-source'
  | 'download-failed'
  | 'password-required'
  | 'password-incorrect'
  | 'unsupported-pdf'
  | 'page-render-failed'
  | 'out-of-memory'
  | 'invalid-page'
  | 'invalid-argument'
  | 'unsupported-operation'
  | 'io-error'
  | 'cancelled'
  | 'document-closed'
  | 'unknown';

export const PDF_ERROR_CODES: readonly PdfErrorCode[] = [
  'invalid-source',
  'download-failed',
  'password-required',
  'password-incorrect',
  'unsupported-pdf',
  'page-render-failed',
  'out-of-memory',
  'invalid-page',
  'invalid-argument',
  'unsupported-operation',
  'io-error',
  'cancelled',
  'document-closed',
  'unknown',
];

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly page?: number;
  readonly cause?: unknown;

  constructor(code: PdfErrorCode, message: string, options: { page?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
    if (options.page !== undefined) {
      this.page = options.page;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, PdfError.prototype);
  }
}

export function isPdfError(value: unknown): value is PdfError {
  return value instanceof PdfError;
}

function isKnownCode(code: string): code is PdfErrorCode {
  return (PDF_ERROR_CODES as readonly string[]).includes(code);
}

const CODE_PREFIX = /\[([a-z-]+)\]\s*/;

/**
 * Native code reports errors as `[code] message`. Nitro may wrap the message
 * (for example `Error: [code] message`), so the prefix is searched, not anchored.
 */
export function parseNativeError(message: string): { code: PdfErrorCode; message: string } {
  const match = CODE_PREFIX.exec(message);
  if (match && match[1] !== undefined && isKnownCode(match[1])) {
    const rest = message.slice(match.index + match[0].length).trim();
    return { code: match[1], message: rest.length > 0 ? rest : match[1] };
  }
  return { code: 'unknown', message };
}

/** Turns anything thrown by native code or JS into a PdfError. */
export function toPdfError(error: unknown, fallback: PdfErrorCode = 'unknown'): PdfError {
  if (error instanceof PdfError) {
    return error;
  }
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const parsed = parseNativeError(raw);
  const code = parsed.code === 'unknown' ? fallback : parsed.code;
  return new PdfError(code, parsed.message, { cause: error });
}

/** Default English messages for display. Apps can provide their own per code. */
export const DEFAULT_ERROR_MESSAGES: Record<PdfErrorCode, string> = {
  'invalid-source': 'The PDF source is not valid.',
  'download-failed': 'The PDF could not be downloaded.',
  'password-required': 'This PDF is protected. Enter its password.',
  'password-incorrect': 'The password is incorrect.',
  'unsupported-pdf': 'This file is not a PDF that can be opened.',
  'page-render-failed': 'A page could not be displayed.',
  'out-of-memory': 'There is not enough memory to display this PDF.',
  'invalid-page': 'That page does not exist.',
  'invalid-argument': 'An argument is not valid.',
  'unsupported-operation': 'This operation is not supported on this platform.',
  'io-error': 'The file could not be read or written.',
  cancelled: 'The operation was cancelled.',
  'document-closed': 'The PDF was closed.',
  unknown: 'Something went wrong while handling the PDF.',
};

export function errorMessageFor(error: unknown): string {
  return DEFAULT_ERROR_MESSAGES[toPdfError(error).code];
}
