import type { Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildReferenceModules } from '../../tools/build/reference.mjs';

// Named modules are test-only and served by Playwright from a private cache.
// The regular HTTP server and the deployed dist expose only browser bundles.
export async function readReferenceModule(address: string): Promise<string | null> {
    const root = await buildReferenceModules();
    const file = referenceModulePath(root, address);
    if (file === null) return null;
    try {
        return await readFile(file, 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
    }
}
export async function serveReferenceModules(page: Page) {
    await buildReferenceModules();
    await page.route(
        (url) => url.origin === 'http://127.0.0.1:8091' && url.pathname.endsWith('.js'),
        async (route) => {
            const body = await readReferenceModule(route.request().url());
            if (body === null) await route.fallback();
            else await route.fulfill({ contentType: 'application/javascript', body });
        },
    );
}
export async function useReferenceRuntime(page: Page) {
    await serveReferenceModules(page);
    await page.route('**/runtime/main.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: "import '../entries/main.js';",
        }),
    );
}

export function referenceModulePath(root: string, address: string): string | null {
    const pathname = decodeURIComponent(new URL(address).pathname).replace(/^\/(?:reex\/)?/, '');
    const base = path.resolve(root);
    const file = path.resolve(base, pathname);
    return file.startsWith(base + path.sep) && file.endsWith('.js') ? file : null;
}
