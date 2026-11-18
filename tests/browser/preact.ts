import { useReferenceRuntime } from './reference-mode.ts';
import { openGame } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

export async function checkPreact(session: Browser, name: string) {
    const page = await session.newPage(),
        errors: string[] = [];
    await useReferenceRuntime(page);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        const listeners = new Set(),
            add = window.addEventListener.bind(window),
            remove = window.removeEventListener.bind(window);
        window.addEventListener = (
            type: string,
            callback: EventListenerOrEventListenerObject,
            ...options: [options?: boolean | AddEventListenerOptions]
        ) => {
            if (type === 'pageshow') listeners.add(callback);
            add(type, callback, ...options);
        };
        window.removeEventListener = (
            type: string,
            callback: EventListenerOrEventListenerObject,
            ...options: [options?: boolean | EventListenerOptions]
        ) => {
            if (type === 'pageshow') listeners.delete(callback);
            remove(type, callback, ...options);
        };
        window.__pageShowListeners = () => listeners.size;
    });
    let release!: () => void;
    const gate = new Promise<void>((done) => {
        release = done;
    });
    let requestStarted!: () => void;
    const started = new Promise<void>((done) => {
        requestStarted = done;
    });
    await page.route('**/data/world.json*', async (route) => {
        requestStarted();
        await gate;
        await route.abort('failed');
    });
    try {
        await page.goto('http://127.0.0.1:8091/', { waitUntil: 'domcontentloaded' });
        await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
        assert.equal(await page.evaluate(() => window.__pageShowListeners()), 1);
        await page.locator('[data-platform="retro"][aria-disabled="false"]').focus();
        await page.keyboard.press('Enter');
        await started;
        // Unmount aborts an in-flight fetch immediately. Listen before triggering it.
        const failed = page.waitForEvent('requestfailed', (request) =>
            new URL(request.url()).pathname.endsWith('/data/world.json'),
        );
        await page.evaluate(async () => {
            // Use the same versioned Preact instance as the mounted application.
            const module = performance
                .getEntriesByType('resource')
                .find((entry) =>
                    new URL(entry.name).pathname.endsWith('/node_modules/preact/dist/preact.js'),
                );
            if (!module) throw new Error('Mounted Preact module was not observed');
            const { render } = await (import(module.name) as Promise<typeof import('preact')>);
            render(null, document.getElementById('app') as HTMLElement);
        });
        assert.equal(await page.locator('.game-app').count(), 0);
        assert.equal(
            await page.evaluate(() => window.__pageShowListeners()),
            0,
            'Unmount must also remove the bfcache reload listener',
        );
        release();
        await failed;
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.deepEqual(
            errors,
            [],
            `${name}: failed pending initialization must remain cancelled after unmount`,
        );
        console.log(
            `PASS: ${name} Preact unmount cancels pending initialization without detached DOM writes or unhandled rejection.`,
        );
    } finally {
        release();
        await page.close();
    }
}

export async function checkPreactBonus(session: Browser, name: string) {
    const page = await session.newPage({ hasTouch: name === 'WebKit' }),
        errors: string[] = [];
    await useReferenceRuntime(page);
    page.on('pageerror', (error) => errors.push(error.message));
    // Advance the first tick to the stage boundary; bonus rules and UI are real.
    await page.route('**/model/state.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
        export * from './state.js?preact-bonus-source';
        import {step as original} from './state.js?preact-bonus-source';
        export function step(previous,input) {
            if(previous.screenIndex===24&&previous.tick===0)previous={...previous,player:{...previous.player,x:128}};
            return original(previous,input);
        }
    `,
        }),
    );
    try {
        await openGame(page, 'http://127.0.0.1:8091/?debug=1&screen=24');
        if (name === 'WebKit') await page.locator('#new-game:not([disabled])').tap();
        else await page.locator('#new-game:not([disabled])').click();
        await page.locator('#bonus-stop:not([disabled])').waitFor();
        assert.equal(await page.locator('[data-bonus-index]').count(), 8);
        assert.equal(await page.locator('[data-bonus-index].bonus__item_active').count(), 1);
        if (name === 'WebKit') await page.locator('#bonus-stop').tap();
        else await page.locator('#bonus-stop').click();
        await page.waitForFunction(
            () => (document.getElementById('sector') as HTMLElement).textContent === '026 / 125',
        );
        assert.equal(
            await page.locator('#bonus-stop').count(),
            0,
            'Preact removes the stopped bonus button',
        );
        assert.equal(await page.locator('#bonus-screen').isHidden(), true);
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} declarative bonus rows and delegated Stop advance the real stage without stale controls.`,
        );
    } finally {
        await page.close();
    }
}
