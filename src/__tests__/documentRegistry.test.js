jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }), { virtual: true });

const mockOpen = jest.fn();
jest.mock(
    'react-native-nitro-modules',
    () => ({ NitroModules: { createHybridObject: () => ({ open: mockOpen }) } }),
    { virtual: true }
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function fakeDocument(path) {
    return { path, close: jest.fn() };
}

let registry;

beforeEach(() => {
    jest.resetModules();
    mockOpen.mockReset();
    mockOpen.mockImplementation(async (path) => fakeDocument(path));
    global.__DEV__ = false;
    registry = require('../PDFJSI');
});

describe('document registry', () => {
    test('concurrent acquires of the same path open the document once', async () => {
        const pending = deferred();
        mockOpen.mockImplementationOnce(() => pending.promise);

        const first = registry.acquirePdf('/a.pdf');
        const second = registry.acquirePdf('/a.pdf');
        const doc = fakeDocument('/a.pdf');
        pending.resolve(doc);

        await expect(first).resolves.toBe(doc);
        await expect(second).resolves.toBe(doc);
        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(registry.getPdfRegistryStats().referenced).toBe(1);
    });

    test('released documents stay warm and are closed once when evicted', async () => {
        const a = await registry.acquirePdf('/a.pdf');
        registry.releasePdf('/a.pdf');
        expect(a.close).not.toHaveBeenCalled();
        expect(registry.getPdfRegistryStats().warm).toBe(1);

        await registry.withPdfDocument('/b.pdf', () => {});
        await registry.withPdfDocument('/c.pdf', () => {});

        expect(a.close).toHaveBeenCalledTimes(1);
        expect(registry.getPdfRegistryStats()).toMatchObject({ open: 2, warm: 2, referenced: 0 });
    });

    test('warm pool is capped at two documents', async () => {
        const docs = [];
        for (const path of ['/1.pdf', '/2.pdf', '/3.pdf', '/4.pdf']) {
            docs.push(await registry.withPdfDocument(path, (doc) => doc));
        }
        expect(docs[0].close).toHaveBeenCalledTimes(1);
        expect(docs[1].close).toHaveBeenCalledTimes(1);
        expect(docs[2].close).not.toHaveBeenCalled();
        expect(docs[3].close).not.toHaveBeenCalled();
        expect(registry.getPdfRegistryStats().warm).toBe(2);
    });

    test('reacquiring a warm document does not reopen it', async () => {
        const first = await registry.withPdfDocument('/a.pdf', (doc) => doc);
        const second = await registry.withPdfDocument('/a.pdf', (doc) => doc);
        expect(second).toBe(first);
        expect(mockOpen).toHaveBeenCalledTimes(1);
    });

    test('a document is not closed while still referenced', async () => {
        const doc = await registry.acquirePdf('/a.pdf');
        await registry.acquirePdf('/a.pdf');
        registry.releasePdf('/a.pdf');
        registry.trimPdfCache();
        expect(doc.close).not.toHaveBeenCalled();
        registry.releasePdf(doc);
        registry.trimPdfCache();
        expect(doc.close).toHaveBeenCalledTimes(1);
    });

    test('invalidate while in use closes on last release and the next acquire is fresh', async () => {
        const old = await registry.acquirePdf('/a.pdf');
        registry.invalidatePdf('/a.pdf');
        expect(old.close).not.toHaveBeenCalled();

        const fresh = await registry.acquirePdf('/a.pdf');
        expect(fresh).not.toBe(old);
        expect(mockOpen).toHaveBeenCalledTimes(2);

        registry.releasePdf(old);
        expect(old.close).toHaveBeenCalledTimes(1);
        expect(fresh.close).not.toHaveBeenCalled();
    });

    test('invalidate closes an unreferenced warm document immediately', async () => {
        const doc = await registry.withPdfDocument('/a.pdf', (d) => d);
        registry.invalidatePdf('/a.pdf');
        expect(doc.close).toHaveBeenCalledTimes(1);
        expect(registry.getPdfRegistryStats().open).toBe(0);
    });

    test('pinned documents survive releases and eviction until closePdf', async () => {
        const pinned = await registry.openPdf('/pinned.pdf');
        await registry.withPdfDocument('/pinned.pdf', () => {});
        for (const path of ['/1.pdf', '/2.pdf', '/3.pdf']) {
            await registry.withPdfDocument(path, () => {});
        }
        registry.trimPdfCache();
        expect(pinned.close).not.toHaveBeenCalled();

        registry.closePdf('/pinned.pdf');
        expect(pinned.close).toHaveBeenCalledTimes(1);
        expect(registry.getPdfRegistryStats().open).toBe(0);
    });

    test('withPdfDocument releases the reference when fn throws', async () => {
        await expect(
            registry.withPdfDocument('/a.pdf', () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        expect(registry.getPdfRegistryStats()).toMatchObject({ referenced: 0, warm: 1 });
    });

    test('a failed open is not cached and can be retried', async () => {
        mockOpen.mockImplementationOnce(async () => {
            throw new Error('missing');
        });
        await expect(registry.acquirePdf('/a.pdf')).rejects.toThrow('missing');
        expect(registry.getPdfRegistryStats().open).toBe(0);

        await expect(registry.withPdfDocument('/a.pdf', (d) => d.path)).resolves.toBe('/a.pdf');
    });

    test('closePdf during an in-flight open closes the late document', async () => {
        const pending = deferred();
        mockOpen.mockImplementationOnce(() => pending.promise);
        const opening = registry.acquirePdf('/a.pdf');
        registry.closePdf('/a.pdf');
        const doc = fakeDocument('/a.pdf');
        pending.resolve(doc);

        await expect(opening).rejects.toThrow('closed');
        expect(doc.close).toHaveBeenCalledTimes(1);
    });

    test('withPdfDocument maps native errors to PdfError codes', async () => {
        await expect(
            registry.withPdfDocument('/a.pdf', () => {
                throw new Error('[invalid-page] Page 9 does not exist');
            })
        ).rejects.toMatchObject({ name: 'PdfError', code: 'invalid-page', message: 'Page 9 does not exist' });
        expect(registry.getPdfRegistryStats()).toMatchObject({ referenced: 0, pinned: 0, warm: 1 });
    });

    test('open failures surface their native code', async () => {
        mockOpen.mockImplementationOnce(async () => {
            throw new Error('[password-required] This PDF needs a password');
        });
        await expect(registry.acquirePdf('/locked.pdf')).rejects.toMatchObject({ code: 'password-required' });
    });

    test('a failed password open can be retried with a password', async () => {
        mockOpen.mockImplementationOnce(async () => {
            throw new Error('[password-required] needs a password');
        });
        await expect(registry.acquirePdf('/locked.pdf')).rejects.toMatchObject({ code: 'password-required' });
        await registry.acquirePdf('/locked.pdf', 'secret');
        expect(mockOpen).toHaveBeenLastCalledWith('/locked.pdf', 'secret');
    });

    test('closeAllPdfs closes everything', async () => {
        const pinned = await registry.openPdf('/p.pdf');
        const held = await registry.acquirePdf('/h.pdf');
        const warm = await registry.withPdfDocument('/w.pdf', (d) => d);
        registry.closeAllPdfs();
        expect(pinned.close).toHaveBeenCalledTimes(1);
        expect(held.close).toHaveBeenCalledTimes(1);
        expect(warm.close).toHaveBeenCalledTimes(1);
        expect(registry.getPdfRegistryStats().open).toBe(0);
    });

    test('memory warnings trim the warm pool', () => {
        const { AppState } = require('react-native');
        expect(AppState.addEventListener).toHaveBeenCalledWith('memoryWarning', registry.trimPdfCache);
    });
});
