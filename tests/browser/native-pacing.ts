import { prepareControl } from './control-navigation.ts';
import { openSettings, closeSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { NativeState } from '../../src/games/16bit/types/index.ts';
import type { BrowserHelpers } from './types.ts';

declare global {
    interface Window {
        __nativePacingState: NativeState;
        __nativePacingFrame: (now: number) => void;
    }
}

export async function checkNativePacing(
    browser: Browser,
    name: string,
    { prepare }: Pick<BrowserHelpers, 'prepare'>,
) {
    for (const [platform, expectedTicks, expectedAfterReturn] of [
        ['amiga', 7, 8],
        ['atari-st', 10, 10],
    ] as const) {
        const page = await browser.newPage({ hasTouch: name === 'WebKit' });
        async function activate(selector: string) {
            if (selector === '#pause') {
                await closeSettings(page);
                await page.locator('#game').focus();
                await page.keyboard.press('Pause');
                return;
            }
            await prepareControl(page.locator(selector));
            if (name === 'WebKit') await page.locator(selector).tap();
            else await page.locator(selector).click();
        }
        await prepare(page);
        await page.addInitScript(() => {
            let sequence = 0;
            const pending = new Map<number, FrameRequestCallback>();
            window.requestAnimationFrame = (callback) => {
                pending.set(++sequence, callback);
                return sequence;
            };
            window.cancelAnimationFrame = (id) => {
                pending.delete(id);
            };
            window.__nativePacingFrame = (now) => {
                const callbacks = Array.from(pending.values());
                pending.clear();
                callbacks.forEach((callback) => callback(now));
            };
        });
        const create = platform === 'amiga' ? 'createAmigaState' : 'createAtariStState';
        const step = platform === 'amiga' ? 'stepAmiga' : 'stepAtariSt';
        await page.route(`**/games/${platform}/model/index.js{,?v=*}`, (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `export * from './index.js?original';
                    import {${create} as create, ${step} as advance} from './index.js?original';
                    export function ${create}(...args) { return window.__nativePacingState = create(...args); }
                    export function ${step}(...args) {
                        const result = advance(...args);
                        window.__nativePacingState = result.state;
                        return result;
                    }`,
            }),
        );
        try {
            await page.goto(`http://127.0.0.1:8091/?game=${platform}&level=4`);
            await page.locator(`[data-platform="${platform}"][aria-disabled="false"]`).focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await activate('#new-game');
            await page.evaluate(() => {
                window.__nativePacingFrame(0);
                for (let now = 20; now <= 600; now += 20) window.__nativePacingFrame(now);
            });
            assert.equal(await page.evaluate(() => window.__nativePacingState.screenIndex), 3);
            assert.equal(
                await page.evaluate(() => window.__nativePacingState.tick),
                expectedTicks,
                `${platform} first-piston scene respects original source workload`,
            );
            await activate('#pause');
            await page.evaluate(() => {
                for (let now = 620; now <= 1200; now += 20) window.__nativePacingFrame(now);
            });
            assert.equal(await page.evaluate(() => window.__nativePacingState.tick), expectedTicks);
            await openSettings(page);
            const selection = page.locator('[data-cheat="levelSelection"]');
            await selection.focus();
            await page.keyboard.press('Space');
            await closeSettings(page);
            await activate('#previous-screen');
            assert.equal(await page.evaluate(() => window.__nativePacingState.screenIndex), 2);
            await page.evaluate(() => {
                for (let now = 1220; now <= 1800; now += 20) window.__nativePacingFrame(now);
            });
            assert.equal(await page.evaluate(() => window.__nativePacingState.tick), 0);
            await activate('#pause');
            await page.evaluate(() => {
                window.__nativePacingFrame(1820);
                for (let now = 1840; now <= 2420; now += 20) window.__nativePacingFrame(now);
            });
            assert.equal(await page.evaluate(() => window.__nativePacingState.tick), 10);
            await activate('#pause');
            await activate('#next-screen');
            assert.equal(await page.evaluate(() => window.__nativePacingState.screenIndex), 3);
            await activate('#pause');
            await page.evaluate(() => {
                window.__nativePacingFrame(2440);
                for (let now = 2460; now <= 3040; now += 20) window.__nativePacingFrame(now);
            });
            assert.equal(
                await page.evaluate(() => window.__nativePacingState.tick),
                expectedAfterReturn,
                'screen changes preserve the clock fraction while adopting the new interval',
            );
            console.log(
                `PASS: ${name} ${platform} first-piston source pacing, pause and screen interval changes.`,
            );
        } finally {
            await page.close();
        }
    }
}
