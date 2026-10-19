import { PdfError } from './errors';

/**
 * Returns a valid zero-based page index, or `null` for values that are not a
 * whole, finite, non-negative number. `NaN` usually comes from parsing user
 * input (`Number('a') - 1`), where doing nothing is the expected result.
 * When `pageCount` is known, the index is clamped to the last page.
 */
export function toPageIndex(value: unknown, pageCount?: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return null;
  }
  if (pageCount !== undefined && Number.isFinite(pageCount)) {
    if (pageCount <= 0) {
      return null;
    }
    return Math.min(value, pageCount - 1);
  }
  return value;
}

/** Like `toPageIndex`, but rejects with `invalid-page` instead of returning `null`. */
export function requirePageIndex(value: unknown, pageCount?: number): number {
  const page =
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && (pageCount === undefined || value < pageCount)
      ? value
      : null;
  if (page === null) {
    const range = pageCount === undefined ? 'a whole number from 0' : `0 to ${Math.max(0, pageCount - 1)}`;
    throw new PdfError('invalid-page', `Page ${String(value)} is not valid; expected ${range}.`);
  }
  return page;
}

/** A positive, finite scale, or `null`. */
export function toScale(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}
