import { requirePageIndex, toPageIndex, toScale } from '../pages';
import { parseViewerEvent } from '../viewerEvents';

describe('toPageIndex', () => {
  test('accepts whole non-negative numbers', () => {
    expect(toPageIndex(0)).toBe(0);
    expect(toPageIndex(12)).toBe(12);
  });

  test('returns null for NaN, fractions, negatives and non-numbers', () => {
    for (const value of [Number.NaN, Infinity, -1, 1.5, '2', null, undefined]) {
      expect(toPageIndex(value)).toBeNull();
    }
  });

  test('clamps to the last page when the count is known', () => {
    expect(toPageIndex(99, 10)).toBe(9);
    expect(toPageIndex(3, 10)).toBe(3);
    expect(toPageIndex(0, 0)).toBeNull();
  });
});

describe('requirePageIndex', () => {
  test('throws invalid-page outside the range', () => {
    expect(requirePageIndex(2, 3)).toBe(2);
    expect(() => requirePageIndex(3, 3)).toThrow(expect.objectContaining({ code: 'invalid-page' }));
    expect(() => requirePageIndex(Number.NaN)).toThrow(expect.objectContaining({ code: 'invalid-page' }));
    expect(() => requirePageIndex(-1)).toThrow(expect.objectContaining({ code: 'invalid-page' }));
  });
});

describe('toScale', () => {
  test('only positive finite numbers', () => {
    expect(toScale(2)).toBe(2);
    expect(toScale(0)).toBeNull();
    expect(toScale(-1)).toBeNull();
    expect(toScale(Number.NaN)).toBeNull();
    expect(toScale('2')).toBeNull();
  });
});

describe('parseViewerEvent', () => {
  test('parses known events', () => {
    expect(parseViewerEvent('{"type":"pageChange","page":2,"pageCount":10}')).toEqual({
      type: 'pageChange',
      page: 2,
      pageCount: 10,
    });
  });

  test('ignores malformed and unknown messages', () => {
    expect(parseViewerEvent('not json')).toBeNull();
    expect(parseViewerEvent('{"type":"mystery"}')).toBeNull();
    expect(parseViewerEvent(undefined)).toBeNull();
  });
});
