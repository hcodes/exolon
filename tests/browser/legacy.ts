import { prepareControl } from './control-navigation.ts';
import { openGame, openSettings, closeSettings, closeHome } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { LEGACY_MOBILE_USER_AGENT } from './devices.ts';
import { checkTouchGestures } from './touch-gestures.ts';

export async function checkLegacy(browser: Browser, name: string) {
    const context = await browser.newContext({
        hasTouch: true,
        userAgent: LEGACY_MOBILE_USER_AGENT,
        viewport: { width: 320, height: 568 },
    });
    const page = await context.newPage(),
        errors: string[] = [],
        scripts: string[] = [];
    // Use real keyboard activation for controls inside nested scroll containers.
    // Touch Events are exercised separately by FIRE and the Split divider below.
    async function activate(selector: string) {
        if (selector === '#pause') {
            await closeHome(page);
            await closeSettings(page);
            await page.locator('#game').focus();
            await page.keyboard.press('Pause');
            return;
        }
        const control = page.locator(selector);
        await prepareControl(control);
        await control.focus();
        await page.keyboard.press('Enter');
    }
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (request) => {
        if (request.resourceType() === 'script') scripts.push(request.url());
    });
    await page.addInitScript(() => {
        for (const name of ['PointerEvent', 'AbortController', 'fetch', 'URL'])
            delete (window as unknown as Record<string, unknown>)[name];
        for (const [object, names] of [
            [Object, ['fromEntries', 'entries', 'values']],
            [Array.prototype, ['flatMap', 'at', 'includes', 'find', 'findIndex', 'fill']],
            [String.prototype, ['includes', 'startsWith', 'endsWith', 'padStart', 'padEnd']],
            [Promise.prototype, ['finally']],
            [Math, ['hypot', 'imul', 'sign', 'tanh', 'trunc']],
            [Number, ['isFinite', 'isInteger', 'isSafeInteger']],
            [Object.getPrototypeOf(Uint8Array.prototype), ['fill', 'slice']],
        ] as const)
            for (const name of names) delete (object as unknown as Record<string, unknown>)[name];
        delete (Element.prototype as Partial<Element>).closest;
        delete (Element.prototype as Partial<Element>).append;
        delete (CanvasRenderingContext2D.prototype as Partial<CanvasRenderingContext2D>).ellipse;
        delete (KeyboardEvent.prototype as { code?: string }).code;
        delete (KeyboardEvent.prototype as { key?: string }).key;
    });
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.waitForFunction(
            () => document.querySelector<HTMLElement>('script[src*="legacy/game.js"]')!,
            null,
            { timeout: 10000 },
        );
        await page.waitForFunction(
            () =>
                !(document.querySelector('[data-cheat="invulnerable"]') as HTMLInputElement)
                    .disabled,
        );
        assert.ok(
            !scripts.some((url) => new URL(url).pathname.endsWith('/main.js')),
            'only the legacy bundle executes',
        );
        await openSettings(page);
        await page.locator('[data-cheat="invulnerable"]').focus();
        await page.keyboard.press('Space');
        assert.equal(await page.locator('[data-cheat="invulnerable"]').isChecked(), true);

        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        const fire = page.locator('[data-action="fire"]');
        assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
        await closeSettings(page);
        await fire.tap();
        await page.waitForFunction(
            () =>
                !(document.getElementById('pause') as HTMLButtonElement).hidden &&
                (document.getElementById('title-screen') as HTMLElement).hidden,
        );
        const ammo = await page.locator('#ammo').textContent();
        await checkTouchGestures(page);
        await fire.tap();
        await page.waitForFunction(
            (value) => (document.getElementById('ammo') as HTMLElement).textContent !== value,
            ammo,
        );
        await page.waitForTimeout(400);
        await page.locator('#game').focus();
        const afterTouch = await page.locator('#ammo').textContent();
        await page.keyboard.down('Space');
        await page.waitForFunction(
            (value) => (document.getElementById('ammo') as HTMLElement).textContent !== value,
            afterTouch,
        );
        await page.keyboard.up('Space');
        const rocketAmmo = await page.locator('#ammo').textContent();
        const rockets = Number(await page.locator('#grenades').textContent());
        await page.locator('[data-action="rocket"]').tap();
        await page.waitForFunction(
            (before) => Number(document.getElementById('grenades')!.textContent) === before - 1,
            rockets,
        );
        assert.equal(await page.locator('#ammo').textContent(), rocketAmmo);
        await page.evaluate(() => {
            const right = document.querySelector<HTMLElement>('[data-action="right"]')!;
            const fire = document.querySelector<HTMLElement>('[data-action="fire"]')!;
            const stick = document
                .querySelector<HTMLElement>('[data-stick]')!
                .getBoundingClientRect();
            function touch(type: string, id: number, target: HTMLElement, x: number, y: number) {
                const event = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperty(event, 'changedTouches', {
                    value: [{ identifier: id, target, clientX: x, clientY: y }],
                });
                target.dispatchEvent(event);
            }
            const f = fire.getBoundingClientRect();
            touch('touchstart', 20, right, stick.right - 20, stick.y + stick.height / 2);
            touch('touchstart', 21, fire, f.x + f.width / 2, f.y + f.height / 2);
            touch('touchmove', 20, right, stick.x + 20, stick.y + stick.height / 2);
        });
        assert.equal(
            await page
                .locator('[data-action="left"]')
                .getAttribute('class')
                .then((value) => value?.includes('touch-controls__button_held')),
            true,
        );
        assert.equal(
            await page
                .locator('[data-action="fire"]')
                .getAttribute('class')
                .then((value) => value?.includes('touch-controls__button_held')),
            true,
        );
        for (const offset of [0, 1, 0]) {
            await page.evaluate((offset) => {
                const target = document.querySelector<HTMLElement>('[data-action="right"]')!;
                const stick = document
                    .querySelector<HTMLElement>('[data-stick]')!
                    .getBoundingClientRect();
                const event = new Event('touchmove', { bubbles: true, cancelable: true });
                Object.defineProperty(event, 'changedTouches', {
                    value: [
                        {
                            identifier: 20,
                            target,
                            clientX: window.innerWidth / 2 + offset,
                            clientY: stick.y - stick.height / 2,
                        },
                    ],
                });
                target.dispatchEvent(event);
            }, offset);
            for (const action of ['right', 'jump', 'fire']) {
                assert.equal(
                    await page
                        .locator(`[data-action="${action}"]`)
                        .evaluate((element) =>
                            element.classList.contains('touch-controls__button_held'),
                        ),
                    action === 'fire' || offset === 0,
                    `${name}: legacy ${action} at midpoint + ${offset}`,
                );
            }
        }
        await page.evaluate(() => {
            for (const [id, action] of [
                [20, 'right'],
                [21, 'fire'],
            ] as const) {
                const target = document.querySelector<HTMLElement>(`[data-action="${action}"]`)!;
                const event = new Event('touchcancel', { bubbles: true, cancelable: true });
                Object.defineProperty(event, 'changedTouches', {
                    value: [{ identifier: id, target, clientX: 0, clientY: 0 }],
                });
                target.dispatchEvent(event);
            }
        });
        assert.equal(await page.locator('.touch-controls__button_held').count(), 0);
        const layouts = [];
        for (const [width, height] of [
            [320, 568],
            [568, 320],
            [768, 1024],
            [1024, 768],
            [1366, 768],
        ]) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(100);
            layouts.push(
                await page.evaluate(() => {
                    const rect = (id: string) =>
                        (document.getElementById(id) as HTMLElement).getBoundingClientRect();
                    const game = rect('game'),
                        pad = rect('touch');
                    return {
                        width: innerWidth,
                        height: innerHeight,
                        game: { width: game.width, height: game.height, bottom: game.bottom },
                        pad: { top: pad.top, bottom: pad.bottom },
                        fullscreenHidden:
                            (document.getElementById('fullscreen') as HTMLElement).hidden &&
                            getComputedStyle(document.getElementById('fullscreen')!).display ===
                                'none',
                        stickLeft: document
                            .querySelector<HTMLElement>('[data-stick]')!
                            .getBoundingClientRect().left,
                        rocketRight: document
                            .querySelector<HTMLElement>('[data-action="rocket"]')!
                            .getBoundingClientRect().right,
                        overflow: document.documentElement.scrollWidth > innerWidth,
                    };
                }),
            );
        }
        for (const layout of layouts) {
            if (layout.width > layout.height) {
                assert.ok(layout.stickLeft <= 16, JSON.stringify(layout));
                assert.ok(layout.rocketRight >= layout.width - 16, JSON.stringify(layout));
            }
            assert.equal(layout.fullscreenHidden, true, JSON.stringify(layout));
            assert.ok(!layout.overflow, JSON.stringify(layout));
            assert.ok(
                Math.abs(layout.game.width / layout.game.height - 4 / 3) < 0.02,
                JSON.stringify(layout),
            );
            assert.ok(
                (layout.width > layout.height || layout.pad.top >= layout.game.bottom - 1) &&
                    layout.pad.top >= 0 &&
                    layout.pad.bottom <= layout.height + 1,
                JSON.stringify(layout),
            );
        }
        await activate('#pause');
        assert.equal(await page.locator('#pause').textContent(), 'Resume');
        await activate('#pause');
        await openSettings(page);
        for (const mode of [
            'retro',
            'c64',
            'cpc',
            'gameboy',
            'gameboy-color',
            'remastered',
            'split',
        ]) {
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption(mode);
            await page.waitForFunction(
                (value) =>
                    (document.getElementById('game') as HTMLCanvasElement).dataset.graphics ===
                    value,
                mode,
            );
        }
        await closeSettings(page);
        const slider = page.locator('#split-divider'),
            bounds = (await slider.boundingBox())!;
        const old = await slider.getAttribute('aria-valuenow');
        await page.evaluate(
            ({ x, y }) => {
                const node = document.getElementById('split-divider') as HTMLElement;
                const point = (type: string, cx: number) => {
                    const e = new Event(type, { bubbles: true, cancelable: true });
                    Object.defineProperty(e, 'changedTouches', {
                        value: [{ identifier: 9, target: node, clientX: cx, clientY: y }],
                    });
                    node.dispatchEvent(e);
                };
                point('touchstart', x);
                point('touchmove', x + 30);
                point('touchend', x + 30);
            },
            { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        );
        assert.notEqual(await slider.getAttribute('aria-valuenow'), old);
        await slider.focus();
        await page.keyboard.press('Home');
        assert.equal(await slider.getAttribute('aria-valuenow'), '0');
        await page.keyboard.press('End');
        assert.equal(await slider.getAttribute('aria-valuenow'), '100');
        assert.equal(await page.locator('#fullscreen').isVisible(), false);
        await page.keyboard.press('Escape');
        await page.waitForFunction(
            () => !(document.getElementById('title-screen') as HTMLElement).hidden,
        );
        await page.screenshot({ path: `/tmp/exolon-legacy-${name.toLowerCase()}.png` });
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} automatic ES5 fallback without modern APIs, old keyboard/touch FIRE, five layouts, all modes, Split and hidden iOS Fullscreen.`,
        );
    } catch (error) {
        console.error(
            name,
            errors,
            await page.locator('#mission-status').textContent(),
            await page.locator('#overlay-copy').textContent(),
        );
        console.error(
            await page.locator('#touch').evaluate((node) =>
                [node, ...node.children].map((n) => ({
                    tag: n.tagName,
                    width: n.getBoundingClientRect().width,
                    flex: getComputedStyle(n).flex,
                    wrap: getComputedStyle(n).flexWrap,
                    display: getComputedStyle(n).display,
                    direction: getComputedStyle(n).flexDirection,
                })),
            ),
        );
        await page.screenshot({ path: `/tmp/exolon-legacy-${name.toLowerCase()}-failure.png` });
        throw error;
    } finally {
        await context.close();
    }
}
