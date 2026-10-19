import { PdfError, errorMessageFor, isPdfError, parseNativeError, toPdfError } from '../errors';

describe('parseNativeError', () => {
  test('reads a leading code', () => {
    expect(parseNativeError('[password-required] Needs a password')).toEqual({
      code: 'password-required',
      message: 'Needs a password',
    });
  });

  test('finds the code inside a wrapped message', () => {
    expect(parseNativeError('Error: [invalid-page] Page 4 is out of range')).toEqual({
      code: 'invalid-page',
      message: 'Page 4 is out of range',
    });
  });

  test('unknown codes and plain messages are unknown', () => {
    expect(parseNativeError('[not-a-code] x')).toEqual({ code: 'unknown', message: '[not-a-code] x' });
    expect(parseNativeError('boom')).toEqual({ code: 'unknown', message: 'boom' });
  });

  test('a code without a message keeps the code as the message', () => {
    expect(parseNativeError('[cancelled]')).toEqual({ code: 'cancelled', message: 'cancelled' });
  });
});

describe('toPdfError', () => {
  test('returns PdfErrors unchanged', () => {
    const error = new PdfError('io-error', 'disk full');
    expect(toPdfError(error)).toBe(error);
  });

  test('uses the fallback only when no code is present', () => {
    expect(toPdfError(new Error('boom'), 'download-failed').code).toBe('download-failed');
    expect(toPdfError(new Error('[io-error] nope'), 'download-failed').code).toBe('io-error');
  });

  test('accepts strings and other values', () => {
    expect(toPdfError('[out-of-memory] big').code).toBe('out-of-memory');
    expect(toPdfError(42).message).toBe('Unknown error');
  });

  test('keeps the original error as the cause', () => {
    const original = new Error('[io-error] x');
    expect(toPdfError(original).cause).toBe(original);
  });
});

describe('PdfError', () => {
  test('is an Error with a code and optional page', () => {
    const error = new PdfError('page-render-failed', 'bad page', { page: 3 });
    expect(error).toBeInstanceOf(Error);
    expect(isPdfError(error)).toBe(true);
    expect(error.name).toBe('PdfError');
    expect(error.page).toBe(3);
  });

  test('errorMessageFor gives a readable default', () => {
    expect(errorMessageFor(new Error('[password-incorrect] x'))).toBe('The password is incorrect.');
  });
});
