import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { NativeState } from '../../src/games/16bit/types/index.ts';
import { closeSettings, openGame, openHome } from './navigation.ts';
import {
    LOCAL_STORAGE_KEY_EXOLON_CHEATS,
    LOCAL_STORAGE_KEY_AMIGA_CHEATS,
    LOCAL_STORAGE_KEY_ATARI_ST_CHEATS,
} from '../../src/lib/LocalStorage/keys.ts';

declare global {
    interface Window {
        __rocketNativeState: NativeState;
    }
}

export async function checkRocketCommand(
    browser: Browser,
    name: string,
    { prepare, padFrames }: Pick<BrowserHelpers, 'prepare' | 'padFrames'>,
) {
    for (const platform of ['classic', 'amiga', 'atari-st']) {
        for (const legacy of platform === 'classic' ? [false, true] : [false]) {
            const page = await browser.newPage();
            await prepare(page);
            const cheatsKey =
                platform === 'classic'
                    ? LOCAL_STORAGE_KEY_EXOLON_CHEATS
                    : platform === 'amiga'
                      ? LOCAL_STORAGE_KEY_AMIGA_CHEATS
                      : LOCAL_STORAGE_KEY_ATARI_ST_CHEATS;
            await page.addInitScript((key) => {
                // Ambient enemy damage must not reset the inventory during the held-trigger check.
                localStorage.setItem(key, JSON.stringify({ invulnerable: true }));
                window.__exolonVirtualPad = {
                    id: 'Rocket test controller',
                    index: 0,
                    connected: true,
                    mapping: 'standard',
                    axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                };
                Object.defineProperty(navigator, 'getGamepads', {
                    configurable: true,
                    value: () => [window.__exolonVirtualPad],
                });
            }, cheatsKey);
            const native = platform !== 'classic';
            if (native) {
                const step = platform === 'amiga' ? 'stepAmiga' : 'stepAtariSt';
                const create = platform === 'amiga' ? 'createAmigaState' : 'createAtariStState';
                await page.route(`**/games/${platform}/model/index.js{,?v=*}`, (route) =>
                    route.fulfill({
                        contentType: 'application/javascript',
                        body: `export * from './index.js?original';
                            import {${create} as create, ${step} as advance} from './index.js?original';
                            export function ${create}(...args) {
                                return window.__rocketNativeState = create(...args);
                            }
                            export function ${step}(...args) {
                                const result = advance(...args);
                                window.__rocketNativeState = result.state;
                                return result;
                            }`,
                    }),
                );
            }
            async function button(index: number, pressed: boolean) {
                await page.evaluate(
                    ({ index, pressed }) => {
                        window.__exolonVirtualPad.buttons[index] = {
                            pressed,
                            value: pressed ? 1 : 0,
                        };
                    },
                    { index, pressed },
                );
                await padFrames(page);
            }
            async function snapshot(page: Page) {
                return page.evaluate((native) => {
                    if (native)
                        return {
                            ammo: window.__rocketNativeState.ammo,
                            rockets: window.__rocketNativeState.grenades,
                        };
                    return {
                        ammo: Number(document.getElementById('ammo')!.textContent),
                        rockets: Number(document.getElementById('grenades')!.textContent),
                    };
                }, native);
            }
            try {
                const url = `http://127.0.0.1:8091/?${legacy ? 'legacy=1&' : ''}`;
                if (native) {
                    await page.goto(`${url}game=${platform}`);
                    await page.locator(`[data-platform="${platform}"]`).focus();
                    await page.keyboard.press('Enter');
                } else await openGame(page, url);
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                await openHome(page);
                await page.locator('#new-game').focus();
                await page.keyboard.press('Enter');
                await closeSettings(page);
                if (native)
                    await page.waitForFunction(
                        () =>
                            document.getElementById('game')?.dataset.menu === 'playing' &&
                            window.__rocketNativeState?.tick > 0,
                    );
                await padFrames(page, 8);
                const initial = await snapshot(page);
                await button(7, true);
                await padFrames(page, 8);
                assert.deepEqual(await snapshot(page), {
                    ammo: initial.ammo,
                    rockets: initial.rockets - 1,
                });
                await padFrames(page, 75);
                assert.deepEqual(
                    await snapshot(page),
                    { ammo: initial.ammo, rockets: initial.rockets - 1 },
                    'a held trigger launches only once and never fires a bullet',
                );
                await button(7, false);
                await button(2, true);
                await padFrames(page, 8);
                await button(2, false);
                assert.equal((await snapshot(page)).ammo, initial.ammo - 1);
                await padFrames(page, 8);
                await button(5, true);
                await padFrames(page, 8);
                await button(5, false);
                assert.deepEqual(await snapshot(page), {
                    ammo: initial.ammo - 2,
                    rockets: initial.rockets - 1,
                });
                console.log(
                    `PASS: ${name} ${platform} ${legacy ? 'legacy' : 'modern'} face/shoulder bullets, immediate trigger rocket and no held-trigger repeat.`,
                );
            } finally {
                await page.close();
            }
        }
    }
}
