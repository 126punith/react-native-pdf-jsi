import { base64Identifier, normalizeSource, sameSource } from '../source';
import { PdfError } from '../errors';

const noAssets = () => null;

function invalidSource(fn: () => unknown): PdfError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe('invalid-source');
    return error as PdfError;
  }
  throw new Error('expected an invalid-source error');
}

describe('normalizeSource', () => {
  test('remote URIs default to the session cache', () => {
    expect(normalizeSource({ uri: 'https://example.com/a.pdf' })).toEqual({
      kind: 'remote',
      url: 'https://example.com/a.pdf',
      headers: {},
      cache: 'session',
    });
  });

  test('boolean cache values map to modes', () => {
    expect(normalizeSource({ uri: 'https://x/a.pdf', cache: true })).toMatchObject({ cache: 'session' });
    expect(normalizeSource({ uri: 'https://x/a.pdf', cache: false })).toMatchObject({ cache: 'none' });
    expect(normalizeSource({ uri: 'https://x/a.pdf', cache: 'persistent' })).toMatchObject({ cache: 'persistent' });
  });

  test('unknown cache modes are rejected', () => {
    invalidSource(() => normalizeSource({ uri: 'https://x/a.pdf', cache: 'forever' as never }));
  });

  test('maxAgeMs and cacheKey are validated and kept', () => {
    expect(normalizeSource({ uri: 'https://x/a.pdf', maxAgeMs: 1000, cacheKey: 'doc-1' })).toMatchObject({
      maxAgeMs: 1000,
      cacheKey: 'doc-1',
    });
    invalidSource(() => normalizeSource({ uri: 'https://x/a.pdf', maxAgeMs: -1 }));
    invalidSource(() => normalizeSource({ uri: 'https://x/a.pdf', maxAgeMs: Number.NaN }));
    invalidSource(() => normalizeSource({ uri: 'https://x/a.pdf', cacheKey: '' }));
  });

  test('header names must be HTTP tokens', () => {
    invalidSource(() => normalizeSource({ uri: 'https://x/a.pdf', headers: { 'Bad Name': 'v' } }));
  });

  test('header values with control characters are rejected without echoing the value', () => {
    const error = invalidSource(() =>
      normalizeSource({ uri: 'https://x/a.pdf', headers: { Authorization: 'Bearer secret\r\nX: 1' } })
    );
    expect(error.message).not.toContain('secret');
  });

  test('tabs are allowed in header values', () => {
    expect(normalizeSource({ uri: 'https://x/a.pdf', headers: { A: 'x\ty' } })).toMatchObject({ headers: { A: 'x\ty' } });
  });

  test('data URIs become base64 sources', () => {
    expect(normalizeSource({ uri: 'data:application/pdf;base64,JVBERi0=' })).toEqual({ kind: 'base64', base64: 'JVBERi0=' });
    invalidSource(() => normalizeSource({ uri: 'data:text/plain;base64,AAAA' }));
  });

  test('base64 sources strip a data prefix and reject other prefixes', () => {
    expect(normalizeSource({ base64: 'data:application/pdf;base64,QUJD' })).toEqual({ kind: 'base64', base64: 'QUJD' });
    expect(normalizeSource({ base64: 'QUJD' })).toEqual({ kind: 'base64', base64: 'QUJD' });
    invalidSource(() => normalizeSource({ base64: '' }));
    invalidSource(() => normalizeSource({ base64: 'data:image/png;base64,AAAA' }));
  });

  test('file paths and local URIs are local', () => {
    expect(normalizeSource({ filePath: '/tmp/a.pdf' })).toEqual({ kind: 'local', uri: '/tmp/a.pdf' });
    expect(normalizeSource({ uri: 'content://docs/1' })).toEqual({ kind: 'local', uri: 'content://docs/1' });
    expect(normalizeSource({ uri: 'bundle-assets://a.pdf' })).toEqual({ kind: 'local', uri: 'bundle-assets://a.pdf' });
    invalidSource(() => normalizeSource({ filePath: '' }));
  });

  test('assets resolve through the resolver and are not cached', () => {
    expect(normalizeSource(7, () => ({ uri: 'http://localhost:8081/assets/a.pdf' }))).toMatchObject({
      kind: 'remote',
      cache: 'none',
    });
    expect(normalizeSource(7, () => ({ uri: 'file:///bundle/a.pdf' }))).toEqual({ kind: 'local', uri: 'file:///bundle/a.pdf' });
    invalidSource(() => normalizeSource(7, noAssets));
  });

  test('malformed sources are rejected', () => {
    invalidSource(() => normalizeSource(null as never));
    invalidSource(() => normalizeSource({} as never));
    invalidSource(() => normalizeSource({ uri: '  ' }));
  });
});

describe('sameSource', () => {
  test('compares by value, not identity', () => {
    const a = normalizeSource({ uri: 'https://x/a.pdf', headers: { B: '2', A: '1' } });
    const b = normalizeSource({ uri: 'https://x/a.pdf', headers: { A: '1', B: '2' } });
    expect(a).not.toBe(b);
    expect(sameSource(a, b)).toBe(true);
  });

  test('detects changes', () => {
    const a = normalizeSource({ uri: 'https://x/a.pdf' });
    expect(sameSource(a, normalizeSource({ uri: 'https://x/b.pdf' }))).toBe(false);
    expect(sameSource(a, normalizeSource({ uri: 'https://x/a.pdf', cache: 'none' }))).toBe(false);
    expect(sameSource(a, normalizeSource({ uri: 'https://x/a.pdf', headers: { A: '1' } }))).toBe(false);
    expect(sameSource(a, null)).toBe(false);
    expect(sameSource(null, null)).toBe(true);
  });
});

describe('base64Identifier', () => {
  test('is stable and depends on the content', () => {
    expect(base64Identifier('QUJD')).toBe(base64Identifier('QUJD'));
    expect(base64Identifier('QUJD')).not.toBe(base64Identifier('QUJE'));
    expect(base64Identifier('QUJD')).toMatch(/^b64-[0-9a-f]{8}-4$/);
  });
});
