import { prepareControl } from './control-navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

async function activate(page: Page, selector: string) {
    await prepareControl(page.locator(selector));
    await page.locator(selector).focus();
    await page.keyboard.press('Enter');
}

export async function checkAnalytics(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage();
        const requests: string[] = [],
            errors: string[] = [];
        await page.addInitScript(() => localStorage.setItem('exolon-settings-collapsed', 'false'));
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', async (route) => {
            requests.push(route.request().url());
            await route.fulfill({
                status: 204,
                headers: {
                    'access-control-allow-origin': 'http://127.0.0.1:8091',
                    'access-control-allow-credentials': 'true',
                },
            });
        });
        await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
        // Exercise the Fetch fallback in the compatibility bundle.
        if (legacy)
            await page.addInitScript(() =>
                Object.defineProperty(navigator, 'sendBeacon', {
                    configurable: true,
                    value: undefined,
                }),
            );
        try {
            const url = 'http://127.0.0.1:8091/' + (legacy ? '?legacy=1' : '');
            const pageView = page.waitForRequest((request) =>
                request.url().startsWith('https://mc.yandex.ru/watch/'),
            );
            await page.goto(url);
            await pageView;
            await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
            assert.equal(requests.length, 1, `${name} legacy${legacy}: exactly one page view`);
            const hit = new URL(requests[0]);
            assert.equal(hit.pathname, '/watch/114447683');
            assert.equal(hit.searchParams.get('page-url'), url);
            assert.match(hit.searchParams.get('browser-info') || '', /pv:1/);
            await page.locator('[data-platform="amiga"][aria-disabled="false"]').waitFor();
            await activate(page, '[data-platform="amiga"]');
            await page
                .locator('main[data-game="amiga"] #new-game:not([disabled])')
                .waitFor({ state: 'attached' });
            await activate(page, '#platforms');
            await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
            await activate(page, '[data-platform="retro"]');
            await page.locator('#new-game').waitFor({ state: 'attached' });
            await activate(page, '#new-game');
            await page.waitForFunction(() => document.getElementById('title-screen')?.hidden);
            assert.equal(
                requests.length,
                1,
                'Platform switches and game start must not duplicate the page view',
            );
            assert.deepEqual(errors, []);
            await checkErrorReports(page, legacy);
        } finally {
            await page.close();
        }
        const blocked = await browser.newPage();
        await blocked.addInitScript(() =>
            localStorage.setItem('exolon-settings-collapsed', 'false'),
        );
        const blockedErrors: string[] = [];
        blocked.on('pageerror', (error) => blockedErrors.push(error.message));
        await blocked.addInitScript(() =>
            Object.defineProperty(navigator, 'sendBeacon', {
                configurable: true,
                value: () => {
                    throw new Error('Blocked analytics transport');
                },
            }),
        );
        await blocked.route('https://mc.yandex.ru/**', (route) => route.abort());
        await blocked.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
        try {
            await blocked.goto('http://127.0.0.1:8091/' + (legacy ? '?legacy=1' : ''));
            await blocked.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
            await activate(blocked, '[data-platform="retro"]');
            await blocked.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await activate(blocked, '#new-game');
            await blocked.waitForFunction(() => document.getElementById('title-screen')?.hidden);
            await blocked.evaluate(() =>
                window.dispatchEvent(new ErrorEvent('error', { message: 'Blocked report' })),
            );
            assert.deepEqual(blockedErrors, [], 'Analytics failures must not prevent gameplay');
        } finally {
            await blocked.close();
        }
        await checkEarlyErrorPanel(browser, legacy);
    }
    console.log(
        `PASS: ${name} analytics, JS errors/rejections, debug panel, early failures and blocked transport in modern/legacy.`,
    );
}

async function expectReport(page: Page, trigger: () => Promise<unknown>, expected: unknown) {
    const report = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return url.hostname === 'mc.yandex.ru' && url.searchParams.has('site-info');
    });
    await trigger();
    const url = new URL((await report).url());
    assert.equal(url.pathname, '/watch/114447683');
    assert.deepEqual(JSON.parse(url.searchParams.get('site-info') || ''), expected);
    assert.doesNotMatch(url.searchParams.get('browser-info') || '', /pv:1/);
}

async function checkErrorReports(page: Page, legacy: boolean) {
    await expectReport(
        page,
        () =>
            page.evaluate(() => {
                const error = new Error('Runtime failure');
                error.stack = 'runtime-stack';
                window.dispatchEvent(new ErrorEvent('error', { error }));
            }),
        { 'JS errors': { 'Runtime failure': { 'runtime-stack': 1 } } },
    );
    await expectReport(
        page,
        () =>
            page.evaluate(() =>
                window.dispatchEvent(
                    new ErrorEvent('error', {
                        message: 'Legacy failure',
                        filename: 'game.js',
                        lineno: 12,
                        colno: 3,
                    }),
                ),
            ),
        { 'JS errors': { 'Legacy failure': { 'game.js:12:3': 1 } } },
    );
    for (const reason of ['Rejected value', null]) {
        await expectReport(
            page,
            () =>
                page.evaluate((reason) => {
                    const event = new Event('unhandledrejection');
                    Object.defineProperty(event, 'reason', { value: reason });
                    window.dispatchEvent(event);
                }, reason),
            { 'JS errors': { [reason || 'no_message']: { no_stack: 1 } } },
        );
    }
    assert.equal(await page.locator('.show-js-error').count(), 0, 'Panel requires debug=1');
    if (!legacy) {
        await expectReport(
            page,
            () =>
                page.evaluate(() => {
                    const error = new Error('Promise failure');
                    error.stack = 'promise-stack';
                    void Promise.reject(error);
                }),
            { 'JS errors': { 'Promise failure': { 'promise-stack': 1 } } },
        );
    }
}

async function checkEarlyErrorPanel(browser: Browser, legacy: boolean) {
    const page = await browser.newPage();
    const reports: unknown[] = [];
    await page.route('https://mc.yandex.ru/**', async (route) => {
        const data = new URL(route.request().url()).searchParams.get('site-info');
        if (data) reports.push(JSON.parse(data));
        await route.fulfill({ status: 204 });
    });
    await page.route(legacy ? '**/legacy/game.js*' : '**/runtime/main.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: "window.dispatchEvent(new ErrorEvent('error', {message: 'Script error.'})); throw new Error('Early failure');",
        }),
    );
    try {
        const report = page.waitForRequest((request) => request.url().includes('site-info='));
        await page.goto('http://127.0.0.1:8091/?debug=1' + (legacy ? '&legacy=1' : ''));
        await report;
        await page
            .locator('.show-js-error__message')
            .filter({ hasText: 'Early failure' })
            .waitFor();
        assert.equal(
            reports.length,
            1,
            'Ignore known webOS errors and report startup failure once',
        );
        assert.match(JSON.stringify(reports), /Early failure/);
        const href = await page.locator('.show-js-error__report[href]').getAttribute('href');
        assert.ok(href?.startsWith('https://github.com/hcodes/reex/issues/new?'));
        assert.equal(await page.locator('style').count(), 0, 'Styles are extracted at build time');
        const position = await page
            .locator('.show-js-error')
            .evaluate((node) => getComputedStyle(node).position);
        assert.equal(position, 'fixed');
    } finally {
        await page.close();
    }
}
