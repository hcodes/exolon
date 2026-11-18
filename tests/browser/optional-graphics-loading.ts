import { openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page, Request } from 'playwright';

const ORIGIN = 'http://127.0.0.1:8091/';
const banks = {
    c64: '/assets/graphics/c64/c64-graphics.json',
    cpc: '/assets/graphics/amstrad-cpc/cpc-graphics.json',
    'sharp-mz800': '/assets/graphics/sharp-mz800/graphics.json',
};
type Bank = keyof typeof banks;
async function settle(page: Page) {
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
}
async function start(page: Page, legacy: boolean, mode: string) {
    await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
    await page.locator(`[data-platform="${mode}"][aria-disabled="false"]`).press('Enter');
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
    await graphics(page, mode);
}
async function graphics(page: Page, mode: string) {
    await page.waitForFunction(
        (mode) => document.getElementById('game')?.dataset.graphics === mode,
        mode,
    );
}
async function pane(page: Page, side: string, mode: string) {
    await page.waitForFunction(
        ({ side, mode }) =>
            (document.getElementById(`split-${side}`) as HTMLSelectElement).value === mode,
        { side, mode },
    );
}
async function observe(browser: Browser) {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    const requests: string[] = [],
        errors: string[] = [];
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (Object.values(banks).includes(path)) requests.push(path);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    return { page, requests, errors };
}
export async function checkOptionalGraphicsLoading(
    browser: Browser,
    name: string,
    legacy: boolean,
) {
    for (const mode of ['retro', 'remastered', ...Object.keys(banks)]) {
        const { page, requests, errors } = await observe(browser);
        try {
            await start(page, legacy, mode);
            await settle(page);
            assert.deepEqual(
                requests,
                mode in banks ? [banks[mode as Bank]] : [],
                `${mode} startup fetches only its selected optional graphics bank`,
            );
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    // Startup follows the latest selection, even if its original bank never answers.
    {
        const { page, requests, errors } = await observe(browser);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**${banks.c64}*`, async (route) => {
            await gate;
            await route.continue();
        });
        try {
            await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
            const requested = page.waitForRequest(
                (request) => new URL(request.url()).pathname === banks.c64,
            );
            await page.locator('[data-platform="c64"][aria-disabled="false"]').press('Enter');
            await requested;
            assert.equal(await page.locator('#new-game').isDisabled(), true);
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('retro');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await graphics(page, 'retro');
            assert.deepEqual(requests, [banks.c64]);
            const completed = page.waitForEvent(
                'requestfinished',
                (request) => new URL(request.url()).pathname === banks.c64,
            );
            release();
            await completed;
            await settle(page);
            assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'retro');
            assert.equal(await page.locator('#graphics-mode').inputValue(), 'retro');
            assert.deepEqual(errors, []);
        } finally {
            release();
            await page.unrouteAll({ behavior: 'wait' });
            await page.close();
        }
    }
    // A completed stale selection is cached, but cannot replace a newer selection.
    // Exercise both a successful and a failed response after leaving the classic app.
    for (const abandon of ['selection', 'application', 'failed-application']) {
        const { page, requests, errors } = await observe(browser);
        if (abandon !== 'selection')
            await page.addInitScript(() => {
                Object.defineProperty(window, 'AbortController', { value: undefined });
            });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(`**${banks.c64}*`, async (route) => {
            await gate;
            if (abandon === 'failed-application') await route.abort();
            else await route.continue();
        });
        try {
            await start(page, legacy, 'remastered');
            const requested = page.waitForRequest(
                (request) => new URL(request.url()).pathname === banks.c64,
            );
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('c64');
            await requested;
            assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'remastered');
            await page
                .locator('#graphics-mode')
                .selectOption(abandon === 'selection' ? 'retro' : 'amiga');
            await graphics(page, abandon === 'selection' ? 'retro' : 'amiga');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            const matches = (request: Request) => new URL(request.url()).pathname === banks.c64;
            const completed =
                abandon === 'failed-application'
                    ? page.waitForEvent('requestfailed', matches)
                    : page.waitForEvent('requestfinished', matches);
            release();
            await completed;
            await settle(page);
            assert.equal(
                await page.locator('#game').getAttribute('data-graphics'),
                abandon === 'selection' ? 'retro' : 'amiga',
                'Late optional artwork cannot override a newer graphics choice or engine',
            );
            if (abandon === 'selection') {
                for (const mode of ['c64', 'cpc', 'c64', 'cpc']) {
                    await openSettings(page);
                    await page.locator('#graphics-mode').selectOption(mode);
                    await graphics(page, mode);
                }
                assert.deepEqual(requests, [banks.c64, banks.cpc], 'Each bank loads once per app');
                await page.route(`**${banks['sharp-mz800']}*`, (route) => route.abort());
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption('sharp-mz800');
                await graphics(page, 'retro');
                await page.waitForFunction(
                    () =>
                        document.querySelector<HTMLOptionElement>(
                            '#graphics-mode option[value="sharp-mz800"]',
                        )!.disabled,
                );
                assert.deepEqual(requests, [banks.c64, banks.cpc, banks['sharp-mz800']]);
            }
            assert.deepEqual(errors, []);
        } finally {
            release();
            await page.unrouteAll({ behavior: 'wait' });
            await page.close();
        }
    }
    const { page, requests, errors } = await observe(browser);
    let releaseSplit!: () => void;
    const splitGate = new Promise<void>((resolve) => {
        releaseSplit = resolve;
    });
    await page.route(`**${banks.c64}*`, async (route) => {
        await splitGate;
        await route.continue();
    });
    try {
        await start(page, legacy, 'retro');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        await graphics(page, 'split');
        await settle(page);
        assert.deepEqual(requests, [], 'Default Split uses no optional graphics banks');
        await openSettings(page);
        await page.locator('#split-right').selectOption('cpc');
        await pane(page, 'right', 'cpc');
        assert.deepEqual(requests, [banks.cpc], 'Split requests the selected side only');
        await openSettings(page);
        await page.locator('#split-left').selectOption('cpc');
        await pane(page, 'left', 'cpc');
        const requested = page.waitForRequest(
            (request) => new URL(request.url()).pathname === banks.c64,
        );
        await openSettings(page);
        await page.locator('#split-left').selectOption('c64');
        await requested;
        await pane(page, 'left', 'cpc');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('c64');
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'split');
        assert.equal(await page.locator('#split-options').isVisible(), true);
        assert.equal(await page.locator('#split-divider').isVisible(), true);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        await openSettings(page);
        await page.locator('#split-left').selectOption('retro');
        await pane(page, 'left', 'retro');
        const completed = page.waitForEvent(
            'requestfinished',
            (request) => new URL(request.url()).pathname === banks.c64,
        );
        releaseSplit();
        await completed;
        await settle(page);
        assert.equal(
            await page.locator('#split-left').inputValue(),
            'retro',
            'A late Split bank cannot restore a superseded side choice',
        );
        await openSettings(page);
        await page.locator('#split-left').selectOption('c64');
        await pane(page, 'left', 'c64');
        await openSettings(page);
        await page.locator('#split-right').selectOption('c64');
        await pane(page, 'right', 'c64');
        assert.deepEqual(
            requests,
            [banks.cpc, banks.c64],
            'Split shares and caches selected banks',
        );
        assert.deepEqual(errors, []);
    } finally {
        releaseSplit();
        await page.unrouteAll({ behavior: 'wait' });
        await page.close();
    }
    console.log(
        `PASS: ${name} ${legacy ? 'legacy' : 'modern'} optional graphics: selected startup bank only, deferred selection, one request per bank, Split demand, failure fallback and stale success/error.`,
    );
}
