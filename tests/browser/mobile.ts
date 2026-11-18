import { closeSettings, openGame, openSettings, openHome } from './navigation.ts';
import { MOBILE_USER_AGENT } from './devices.ts';
import { checkTouchGestures } from './touch-gestures.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';

declare global {
    interface Window {
        __mobileNeutralSamples: number;
    }
}

export async function checkMobile(
    session: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
        chooseCheats,
    }: Pick<BrowserHelpers, 'prepare' | 'padFrames' | 'waitForPlaying' | 'chooseCheats'>,
) {
    const page = await session.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        userAgent: MOBILE_USER_AGENT,
    });
    await prepare(page);
    await page.addInitScript(() =>
        localStorage.setItem('exolon-cheats', JSON.stringify({ invulnerable: true })),
    );
    // Window fullscreen also covers mobile Safari. Native fullscreen is tested
    // separately; desktop browser windows cannot be resized while native-fullscreen.
    await page.addInitScript(() =>
        Object.defineProperty(Element.prototype, 'requestFullscreen', {
            configurable: true,
            value: undefined,
        }),
    );
    await page.route('**/input/index.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
        export * from './index.js?mobile-source';
        import {createInput as create} from './index.js?mobile-source';
        export function createInput(...args) {
            const input=window.__mobileInput=create(...args);
            window.__mobileNeutralSamples=0;
            return {...input,sample(){const commands=input.sample();if(!commands.fire)window.__mobileNeutralSamples++;return commands;}};
        }
    `,
        }),
    );
    const button = (action: string) => page.locator(`#touch [data-action="${action}"]`);
    const commands = () => page.evaluate(() => window.__mobileInput.sample());
    const releasedTick = async () => {
        const before = await page.evaluate(() => window.__mobileNeutralSamples);
        await page.waitForFunction((value) => window.__mobileNeutralSamples > value, before);
    };
    const center = async (action: string) => {
        const r = (await button(action).boundingBox())!;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    async function fits(width: number, height: number) {
        await page.setViewportSize({ width, height });
        await padFrames(page);
        await page.evaluate(() => scrollTo(0, 0));
        const result = await page.evaluate(() => {
            const rect = (id: string) => {
                const r = (document.getElementById(id) as HTMLElement).getBoundingClientRect();
                return {
                    left: r.left,
                    right: r.right,
                    top: r.top,
                    bottom: r.bottom,
                    width: r.width,
                    height: r.height,
                };
            };
            return {
                width: innerWidth,
                height: innerHeight,
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                game: rect('game'),
                pad: rect('touch'),
                settings: rect('settings-toggle'),
                fullscreen: rect('fullscreen'),
                stickLeft: document
                    .querySelector<HTMLElement>('[data-stick]')!
                    .getBoundingClientRect().left,
                rocketRight: document
                    .querySelector<HTMLElement>('[data-action="rocket"]')!
                    .getBoundingClientRect().right,
                options: document
                    .querySelector<HTMLElement>('.game-footer__options')!
                    .getBoundingClientRect().height,
                buttons: [...document.querySelectorAll('#touch button')].map((b) => {
                    const r = b.getBoundingClientRect();
                    return {
                        width: r.width,
                        height: r.height,
                        left: r.left,
                        right: r.right,
                        top: r.top,
                        bottom: r.bottom,
                        footer: Boolean(b.closest('footer')),
                    };
                }),
            };
        });
        assert.equal(
            result.overflow,
            false,
            `${name} ${width}×${height}: horizontal page overflow`,
        );
        if (width <= height)
            assert.ok(
                result.pad.top >= result.game.bottom - 1,
                'Portrait touch pad stays below the display',
            );
        assert.ok(result.pad.top >= 0, 'Touch controls must stay inside the viewport');
        if (width <= height) {
            assert.ok(
                Math.abs(result.fullscreen.bottom - result.settings.bottom) <= 1,
                `${name} ${width}×${height}: portrait Fullscreen must align with Settings at the bottom`,
            );
            assert.ok(
                result.fullscreen.right <= result.settings.left - 7,
                'Portrait Fullscreen must sit before Settings with a gap',
            );
            assert.ok(
                result.fullscreen.top >= result.game.bottom,
                'Portrait Fullscreen must not cover the game',
            );
        }
        assert.ok(
            result.pad.bottom <= result.height + 1,
            `${width}×${height}: pad is below the viewport`,
        );
        for (const b of result.buttons) {
            assert.ok(b.footer);
            assert.ok(
                b.width >= 44 && b.height >= 44,
                `${width}×${height}: touch target too small ${JSON.stringify(result)}`,
            );
            assert.ok(b.left >= 0 && b.right <= result.width + 1);
            assert.ok(
                b.right <= result.settings.left ||
                    b.left >= result.settings.right ||
                    b.bottom <= result.settings.top ||
                    b.top >= result.settings.bottom,
                `${name} ${width}×${height}: touch controls must not overlap Settings: ${JSON.stringify({ button: b, settings: result.settings })}`,
            );
        }
        if (width > height) {
            assert.ok(result.fullscreen.top <= 16, 'Landscape Fullscreen stays at the top');
            assert.ok(
                result.fullscreen.right >= width - 16,
                'Landscape Fullscreen stays at the right',
            );
            assert.ok(
                result.stickLeft <= 16,
                `${name} ${width}×${height}: stick must follow the browser's left edge`,
            );
            assert.ok(
                result.rocketRight >= result.width - 16,
                `${name} ${width}×${height}: weapons must follow the browser's right edge`,
            );
            assert.ok(
                result.options <= 58,
                'Landscape settings must stay in a single scrollable row',
            );
            assert.ok(result.game.height >= 140, 'Landscape game area is too small');
        }
        return result;
    }
    async function pointer(
        type: string,
        id: number,
        action: string | null,
        point?: { x: number; y: number },
    ) {
        const position = point || (await center(action!));
        await page.evaluate(
            ({ type, id, action, position }) => {
                const target = action
                    ? document.querySelector<HTMLElement>(`#touch [data-action="${action}"]`)!
                    : window;
                target.dispatchEvent(
                    new PointerEvent(type, {
                        pointerId: id,
                        pointerType: 'touch',
                        button: 0,
                        buttons: type === 'pointerup' ? 0 : 1,
                        clientX: position.x,
                        clientY: position.y,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            },
            { type, id, action, position },
        );
        await padFrames(page, 1);
    }
    try {
        await openGame(page, 'http://127.0.0.1:8091/', { expandSettings: false });
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        let layouts = 0;
        for (const [width, height] of [
            [320, 568],
            [390, 844],
            [568, 320],
            [844, 390],
            [768, 1024],
            [1024, 768],
            [820, 1180],
            [1180, 820],
            [1366, 1024],
            [1440, 600],
        ]) {
            await fits(width, height);
            layouts++;
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await padFrames(page);
        const fire = await center('fire');
        await pointer('pointerdown', 11, 'fire', fire);
        await waitForPlaying(page);
        await padFrames(page, 20);
        assert.equal(
            await page.locator('#ammo').textContent(),
            '99',
            'Starting touch must not fire',
        );
        assert.equal(await page.locator('#grenades').textContent(), '10');
        await pointer('pointerup', 11, null, fire);
        await checkTouchGestures(page);
        await pointer('pointerdown', 12, 'right');
        await pointer('pointerdown', 13, 'fire');
        assert.equal((await commands()).right, true);
        assert.equal((await commands()).fire, true);
        await pointer('pointerdown', 14, 'fire');
        await pointer('pointerup', 13, null, await center('fire'));
        assert.equal((await commands()).fire, true);
        await pointer('pointermove', 12, 'right', await center('left'));
        assert.equal((await commands()).left, true);
        assert.equal((await commands()).right, false);
        await pointer('pointermove', 12, 'right', { x: 1, y: 1 });
        assert.equal((await commands()).left, false);
        assert.equal((await commands()).fire, true);
        await pointer('pointermove', 12, 'right', await center('jump'));
        assert.equal((await commands()).jump, true);
        const stick = (await page.locator('[data-stick]').boundingBox())!;
        const midpoint = page.viewportSize()!.width / 2;
        await pointer('pointermove', 12, 'right', {
            x: midpoint,
            y: stick.y - stick.height / 2,
        });
        assert.equal((await commands()).right, true, 'drag remains active beyond the circle');
        assert.equal((await commands()).jump, true);
        assert.equal((await commands()).fire, true);
        await pointer('pointermove', 12, 'right', {
            x: midpoint + 1,
            y: stick.y + stick.height / 2,
        });
        assert.equal((await commands()).right, false, 'drag is neutral past the window midpoint');
        assert.equal((await commands()).jump, false);
        assert.equal((await commands()).fire, true);
        await pointer('pointermove', 12, 'right', {
            x: stick.x + stick.width * 0.8,
            y: stick.y + stick.height * 0.2,
        });
        assert.equal((await commands()).right, true);
        assert.equal((await commands()).jump, true);
        await pointer('pointermove', 12, 'right', {
            x: stick.x + stick.width / 2,
            y: stick.y + stick.height / 2,
        });
        assert.equal((await commands()).right, false);
        assert.equal((await commands()).jump, false);
        await pointer('pointercancel', 12, null, { x: 1, y: 1 });
        await pointer('pointerup', 14, null, { x: 1, y: 1 });
        assert.equal(Object.values(await commands()).some(Boolean), false);
        await releasedTick();
        await padFrames(page, 4);
        const beforeTap = Number(await page.locator('#ammo').textContent());
        await button('fire').tap();
        await page.waitForFunction(
            (before) =>
                Number((document.getElementById('ammo') as HTMLElement).textContent) === before - 1,
            beforeTap,
        );
        await padFrames(page, 4);
        assert.equal(
            Number(await page.locator('#ammo').textContent()),
            beforeTap - 1,
            'A short real tap produces exactly one shot',
        );
        // Display frames can run faster than the platform's simulation. Sample
        // the released FIRE state before starting a separate held-fire action.
        await releasedTick();
        const ammo = Number(await page.locator('#ammo').textContent()),
            rockets = Number(await page.locator('#grenades').textContent());
        await pointer('pointerdown', 15, 'fire');
        await page.waitForFunction(
            (before) =>
                Number((document.getElementById('ammo') as HTMLElement).textContent) < before,
            ammo,
        );
        await padFrames(page, 80);
        assert.equal(
            Number(await page.locator('#grenades').textContent()),
            rockets,
            'Holding FIRE never launches a rocket',
        );
        await pointer('pointerup', 15, null, await center('fire'));
        const beforeRocket = Number(await page.locator('#ammo').textContent());
        await pointer('pointerdown', 17, 'rocket');
        await page.waitForFunction(
            (before) =>
                Number((document.getElementById('grenades') as HTMLElement).textContent) < before,
            rockets,
        );
        await padFrames(page, 80);
        assert.equal(Number(await page.locator('#grenades').textContent()), rockets - 1);
        assert.equal(Number(await page.locator('#ammo').textContent()), beforeRocket);
        await pointer('pointerup', 17, null, await center('rocket'));
        await pointer('pointerdown', 16, 'left');
        await fits(844, 390);
        assert.equal(
            Object.values(await commands()).some(Boolean),
            false,
            'Rotation clears held controls',
        );
        await page.locator('#fullscreen').tap();
        await padFrames(page);
        await fits(844, 390);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        await chooseCheats(page, { invulnerable: true, levelSelection: true }, true);
        await closeSettings(page);
        await fits(568, 320);
        await page.locator('#game').focus();
        await page.keyboard.press('Pause');
        assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
        await fits(320, 568);
        await fits(390, 844);
        await fits(844, 390);
        await page.locator('#game').focus();
        await page.keyboard.press('Pause');
        await waitForPlaying(page);
        await page.locator('#fullscreen').tap();
        await padFrames(page);
        await openHome(page);
        await page.locator('#menu').tap();
        await closeSettings(page);
        await button('fire').press('Enter');
        await waitForPlaying(page);
        await padFrames(page, 20);
        assert.equal(
            await page.locator('#ammo').textContent(),
            '99',
            'Keyboard activation of FIRE starts without shooting',
        );
        await openHome(page);
        await page.locator('#menu').tap();
        await closeSettings(page);
        await button('fire').tap();
        await waitForPlaying(page);
        await padFrames(page, 20);
        assert.equal(
            await page.locator('#ammo').textContent(),
            '99',
            'A real starting tap must not shoot',
        );
        assert.equal(await page.locator('#grenades').textContent(), '10');
        if (name === 'Chromium') {
            const cdp = await page.context().newCDPSession(page),
                right = await center('right'),
                firePoint = await center('fire');
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ ...right, id: 1 }],
            });
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [
                    { ...right, id: 1 },
                    { ...firePoint, id: 2 },
                ],
            });
            await padFrames(page);
            assert.equal((await commands()).right, true);
            assert.equal((await commands()).fire, true);
            const left = await center('left');
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [
                    { ...left, id: 1 },
                    { ...firePoint, id: 2 },
                ],
            });
            await padFrames(page);
            assert.equal((await commands()).left, true);
            assert.equal((await commands()).right, false);
            assert.equal((await commands()).fire, true);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
            await padFrames(page);
            assert.equal(Object.values(await commands()).some(Boolean), false);
            await cdp.detach();
        }
        await fits(320, 568);
        await fits(844, 390);
        for (const [width, height, label] of [
            [390, 844, 'portrait'],
            [844, 390, 'landscape'],
            [1024, 768, 'tablet'],
        ] as const) {
            await fits(width, height);
            await page.locator('.game-footer__options').evaluate((element) => {
                element.scrollLeft = 0;
            });
            await page.screenshot({
                path: `/tmp/exolon-mobile-${name.toLowerCase()}-${label}.png`,
            });
        }
        console.log(
            `PASS: ${name} ${layouts} phone/tablet layouts, footer touch targets, multitouch/sliding/cancellation, FIRE start isolation, shots/rockets, rotation, fullscreen, Split and cheats.`,
        );
    } catch (error) {
        console.log(
            name,
            await page.evaluate(() => ({
                commands: window.__mobileInput?.sample(),
                ammo: (document.getElementById('ammo') as HTMLElement)?.textContent,
                rockets: (document.getElementById('grenades') as HTMLElement)?.textContent,
                status: (document.getElementById('mission-status') as HTMLElement)?.textContent,
                paused: (document.getElementById('pause') as HTMLButtonElement)?.getAttribute(
                    'aria-pressed',
                ),
                held: [
                    ...document.querySelectorAll<HTMLElement>(
                        '#touch .touch-controls__button_held',
                    ),
                ].map((b) => b.dataset.action),
            })),
        );
        throw error;
    } finally {
        await page.close();
    }
}
