import type { VirtualGamepad } from './types.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { MOBILE_USER_AGENT } from './devices.ts';
import { openSettings, closeSettings, openHome, closeHome } from './navigation.ts';

declare global {
    interface Window {
        __controlsFrame: (time: number) => void;
        __controlsPads: VirtualGamepad[];
    }
}

export async function checkControlMenu(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            viewport: { width: 1100, height: 900 },
            hasTouch: true,
            userAgent: MOBILE_USER_AGENT,
        });
        page.setDefaultTimeout(10000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) =>
            route.fulfill({ status: 404, body: '' }),
        );
        await page.addInitScript(() => {
            localStorage.setItem('exolon-settings-collapsed', 'false');
            window.__controlsPads = [];
            Object.defineProperty(navigator, 'getGamepads', {
                configurable: true,
                value: () => window.__controlsPads,
            });
            let sequence = 0;
            const pending = new Map<number, FrameRequestCallback>();
            window.requestAnimationFrame = (callback) => {
                pending.set(++sequence, callback);
                return sequence;
            };
            window.cancelAnimationFrame = (id) => pending.delete(id);
            window.__controlsFrame = (time) => {
                const frames = Array.from(pending.values());
                pending.clear();
                frames.forEach((callback) => callback(time));
            };
        });
        let now = 0;
        const frame = async (delta = 0) => {
            now += delta;
            await page.evaluate((time) => window.__controlsFrame(time), now);
        };
        const select = async (id: string, value: string) => {
            await page.waitForFunction(
                ({ id, value }) => {
                    const option = document.querySelector<HTMLOptionElement>(
                        `#${id} option[value="${value}"]`,
                    );
                    return option && !option.disabled;
                },
                { id, value },
                { polling: 20 },
            );
            await page.locator(`#${id}`).evaluate((element, value) => {
                (element as HTMLSelectElement).value = value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }, value);
            await page.waitForFunction(
                ({ id, value }) =>
                    id === 'graphics-mode'
                        ? document.getElementById('game')?.dataset.graphics === value
                        : (document.getElementById(id) as HTMLSelectElement).value === value,
                { id, value },
                { polling: 20 },
            );
            await frame();
            await page.locator('#game').focus();
        };
        const label = () => page.locator('#game').getAttribute('aria-label');
        const controls = async () => {
            await openHome(page);
            await page.locator('#show-controls').focus();
            await page.keyboard.press('Enter');
            await closeHome(page);
            await closeSettings(page);
            await page.locator('#game').focus();
            await frame();
        };
        try {
            await page.goto(`http://127.0.0.1:8091/?graphics=retro${legacy ? '&legacy=1' : ''}`);
            await page.locator('[data-platform="retro"][aria-disabled="false"]').focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await frame();
            await controls();
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'menu');
            for (const mode of ['retro', 'c64', 'sharp-mz800', 'cpc']) {
                await select('graphics-mode', mode);
                await controls();
                await page.keyboard.press('2');
                await frame();
                assert.match((await label()) || '', /Define keys.*LEFT/i);
                for (const [index, key] of ['z', 'x', 'w', 's', 'f'].entries()) {
                    await page.keyboard.down(key);
                    await frame(8000);
                    if (index === 0) {
                        assert.match((await label()) || '', /LEFT/i);
                        await page.keyboard.press('a'); // A second held key cannot skip a prompt.
                        await frame();
                        assert.match((await label()) || '', /LEFT/i);
                    }
                    await page.keyboard.up(key);
                    await frame();
                }
                assert.doesNotMatch((await label()) || '', /Define keys/i);
                assert.equal(await page.locator('#game').getAttribute('data-menu'), 'menu');
                await page.keyboard.press('1');
                await frame();
                assert.equal(
                    await page.locator('#pause').evaluate((e) => !(e as HTMLElement).hidden),
                    true,
                );
                await page.locator('#game').focus();
                await page.keyboard.down('f');
                await frame(mode === 'cpc' ? 52 : mode === 'sharp-mz800' ? 45 : 47);
                assert.equal(
                    (await page.locator('#ammo').textContent())?.trim(),
                    '98',
                    `${mode} rebound fire reaches actual model`,
                );
                await page.keyboard.up('f');
                await page.keyboard.press('Escape');
                await frame();
                await page.keyboard.press('f');
                await frame();
                assert.equal(
                    await page.locator('#pause').evaluate((e) => !(e as HTMLElement).hidden),
                    true,
                    'redefined fire starts from title',
                );
                await page.keyboard.press('Escape');
                await frame();
            }
            await select('graphics-mode', 'remastered');
            await page.keyboard.press('Escape');
            await frame();
            assert.equal(
                await page.locator('#show-controls').evaluate((e) => (e as HTMLElement).hidden),
                true,
            );
            await page.keyboard.press('2');
            await page
                .locator('#show-controls')
                .evaluate((element: HTMLButtonElement) => element.click());
            await frame();
            await frame(6000);
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
            assert.doesNotMatch((await label()) || '', /Define keys/i);
            await frame(6000);
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'scores');
            await page.keyboard.press('Escape');
            await page.locator('#game').focus();
            await page.keyboard.press('f');
            await frame();
            assert.equal(
                await page.locator('#pause').evaluate((e) => !(e as HTMLElement).hidden),
                true,
                'Remastered starts directly with rebound fire',
            );
            await page.keyboard.press('Escape');
            await frame();
            const remasteredBox = await page.locator('#game').boundingBox();
            assert.ok(remasteredBox);
            await page.touchscreen.tap(
                remasteredBox.x + remasteredBox.width / 2,
                remasteredBox.y + remasteredBox.height / 2,
            );
            await frame();
            assert.equal(
                await page.locator('#pause').evaluate((e) => !(e as HTMLElement).hidden),
                true,
                'Remastered title tap starts without selection',
            );
            assert.equal((await page.locator('#ammo').textContent())?.trim(), '99');
            await page.keyboard.press('Escape');
            await frame();
            await select('graphics-mode', 'split');
            await select('split-left', 'remastered');
            assert.equal(
                await page.locator('#show-controls').evaluate((e) => (e as HTMLElement).hidden),
                true,
            );
            await select('split-right', 'c64');
            assert.equal(
                await page.locator('#show-controls').evaluate((e) => (e as HTMLElement).hidden),
                true,
                'Right Split mode cannot enable control selection',
            );
            await select('split-left', 'retro');
            assert.equal(
                await page.locator('#show-controls').evaluate((e) => (e as HTMLElement).hidden),
                false,
            );
            await select('graphics-mode', 'retro');
            await controls();
            await page.keyboard.press('4');
            await frame();
            assert.match((await label()) || '', /INTERFACE 2/);
            await page.keyboard.press('2');
            await page.keyboard.press('z');
            await select('graphics-mode', 'c64');
            assert.doesNotMatch(
                (await label()) || '',
                /Define keys/i,
                'graphics changes cancel capture',
            );
            await controls();
            await page.keyboard.press('2');
            await page.keyboard.press('Escape');
            await frame();
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'menu');
            // The original device rows now select original device labels.
            const box = await page.locator('#game').boundingBox();
            assert.ok(box);
            await page.touchscreen.tap(
                box.x + box.width * 0.55,
                box.y + (box.height * (19 * 8 + 4)) / 192,
            );
            await frame();
            assert.match((await label()) || '', /JOYSTICK PORT 2/);
            await select('graphics-mode', 'split');
            await select('split-left', 'cpc');
            await select('split-right', 'c64');
            await controls();
            await page.keyboard.press('5');
            await frame();
            assert.doesNotMatch(
                (await label()) || '',
                /JOYSTICK PORT/,
                'Split uses left CPC menu choices',
            );
            await page.keyboard.press('2');
            await page.keyboard.press('z');
            await select('split-right', 'sharp-mz800');
            assert.doesNotMatch(
                (await label()) || '',
                /Define keys/i,
                'right Split change cancels a partial definition',
            );
            await page.keyboard.press('2');
            await page.evaluate(() =>
                window.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        keyCode: 10009,
                        bubbles: true,
                        cancelable: true,
                    }),
                ),
            );
            assert.doesNotMatch(
                (await label()) || '',
                /Define keys/i,
                'TV Back cancels definition before capture',
            );
            await page.keyboard.press('2');
            await page.keyboard.press('z');
            await openSettings(page);
            assert.doesNotMatch(
                (await label()) || '',
                /Define keys/i,
                'opening Settings cancels partial keys',
            );
            await closeSettings(page);
            await select('graphics-mode', 'sharp-mz800');
            await page.keyboard.press('Escape');
            await frame();
            const sharpBox = await page.locator('#game').boundingBox();
            assert.ok(sharpBox);
            await page.touchscreen.tap(
                sharpBox.x + (sharpBox.width * 160) / 320,
                sharpBox.y + (sharpBox.height * 128) / 200,
            );
            await frame();
            assert.match(
                (await label()) || '',
                /KEYBOARD/,
                'Sharp original controls work before the attract menu transition',
            );
            const priorStyle = await page.locator('#game').evaluate((element) => {
                const prior = element.getAttribute('style');
                element.style.width = '600px';
                element.style.height = '450px';
                element.style.objectFit = 'fill';
                element.style.flex = 'none';
                return prior;
            });
            const stretched = await page.locator('#game').boundingBox();
            assert.ok(stretched);
            await page.touchscreen.tap(
                stretched.x + stretched.width / 2,
                stretched.y + (stretched.height * 160) / 200,
            );
            await frame();
            assert.match(
                (await label()) || '',
                /JOYSTICK/,
                'stretched Sharp canvas must not be treated as letterboxed',
            );
            await page.locator('#game').evaluate((element, prior) => {
                if (prior === null) element.removeAttribute('style');
                else element.setAttribute('style', prior);
            }, priorStyle);
            await select('graphics-mode', 'cpc');
            await controls();
            await page.evaluate(() => {
                window.__controlsPads = [0, 1].map((index) => ({
                    id: `Controls pad ${index}`,
                    index,
                    connected: true,
                    mapping: 'standard',
                    axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                }));
            });
            await frame();
            const padButton = async (index: number, button: number, down: boolean) => {
                await page.evaluate(
                    ({ index, button, down }) => {
                        window.__controlsPads[index].buttons[button] = {
                            pressed: down,
                            value: Number(down),
                        };
                    },
                    { index, button, down },
                );
                await frame();
            };
            await padButton(0, 13, true);
            await padButton(0, 13, false);
            await padButton(0, 0, true);
            await padButton(0, 0, false);
            assert.match(
                (await label()) || '',
                /Define keys.*LEFT/i,
                'gamepad A selects Define instead of moving its focus to Start',
            );
            for (const button of [14, 15, 12, 13, 2]) {
                await padButton(0, button, true);
                await padButton(0, button, false);
            }
            assert.match(
                (await label()) || '',
                /Define keys.*LEFT/i,
                'gamepad controls cannot redefine keyboard keys',
            );
            for (const key of ['h', 'j', 'k', 'l', 't']) await page.keyboard.press(key);
            await frame();
            assert.doesNotMatch(
                (await label()) || '',
                /Define keys/i,
                'CPC keyboard definition finishes',
            );
            await select('graphics-mode', 'c64');
            await controls();
            await page.keyboard.press('5');
            await page.keyboard.press('1');
            await frame();
            await page.keyboard.down('f');
            await frame(47);
            assert.equal(
                (await page.locator('#ammo').textContent())?.trim(),
                '98',
                'defined keyboard fire works with original Joystick Port 2 selected',
            );
            await page.keyboard.up('f');
            await frame(47); // The model must sample release between distinct fire sources.
            const touchFire = await page.locator('#touch [data-action="fire"]').boundingBox();
            assert.ok(touchFire);
            await page.touchscreen.tap(
                touchFire.x + touchFire.width / 2,
                touchFire.y + touchFire.height / 2,
            );
            await frame(47);
            assert.equal(
                (await page.locator('#ammo').textContent())?.trim(),
                '97',
                'touch fire remains independent of defined keys',
            );
            await frame(47);
            await padButton(0, 2, true);
            await frame(47);
            assert.equal(
                (await page.locator('#ammo').textContent())?.trim(),
                '96',
                'standard gamepad fire works alongside keyboard and touch',
            );
            await padButton(0, 2, false);
            await page.evaluate(() => {
                window.__controlsPads.shift();
            });
            await frame();
            assert.equal(
                await page.locator('#pause').getAttribute('aria-pressed'),
                'true',
                'controller loss still pauses gameplay',
            );
            await frame();
            await page.locator('#game').focus();
            await page.keyboard.press('Pause');
            await frame();
            await padButton(0, 2, true);
            await frame(47);
            assert.equal(
                (await page.locator('#ammo').textContent())?.trim(),
                '95',
                'remaining controller is available automatically without port restrictions',
            );
            await padButton(0, 2, false);
            await page.keyboard.press('Escape');
            await frame();
            await select('graphics-mode', 'retro');
            await controls();
            await padButton(0, 0, true);
            await padButton(0, 0, false);
            await frame();
            await page.evaluate(() => {
                window.__controlsPads = [];
            });
            await frame();
            assert.equal(
                await page.locator('#pause').getAttribute('aria-pressed'),
                'true',
                'starting through the original menu establishes gamepad session ownership',
            );
            assert.deepEqual(errors, []);
            console.log(
                `PASS: ${name} ${legacy ? 'legacy' : 'native'} current keyboard/touch/gamepad controls, keyboard definition, automatic controller fallback and Split.`,
            );
        } finally {
            await page.close();
        }
    }
}
