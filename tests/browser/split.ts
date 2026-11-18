import { activateControl, prepareControl } from './control-navigation.ts';
import { serveReferenceModules } from './reference-mode.ts';
import { openGame, reloadGame, openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { GameEvent, World, StageBonus } from '../../src/types/game.ts';
import type { Graphics } from '../../src/types/graphics.ts';

export async function checkSplitRenderer(session: Browser, name: string) {
    const page = await session.newPage();
    await serveReferenceModules(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        const frames = await page.evaluate(
            async (modernTolerance) => {
                const [{ createRenderer }, { createState }, world, graphics] = await Promise.all([
                    import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                        typeof import('../../src/view/renderer.ts')
                    >,
                    import(new URL('./model/state.js', document.baseURI).href) as Promise<
                        typeof import('../../src/model/state.ts')
                    >,
                    fetch('./data/world.json').then((r) => r.json() as Promise<World>),
                    fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                        (r) => r.json() as Promise<Graphics>,
                    ),
                ]);
                const canvases = Array.from({ length: 3 }, () => document.createElement('canvas'));
                const renderers = canvases.map((canvas) => createRenderer(canvas, graphics));
                ['retro', 'remastered', 'split'].forEach((mode, i) =>
                    renderers[i].setGraphicsMode(mode),
                );
                if (renderers[2].graphicsMode !== 'split')
                    throw Error('Split graphics mode is missing');
                if ((renderers[2].splitPosition as number) !== 0.5)
                    throw Error('The divider must start at 50%');
                const pixels = (canvas: HTMLCanvasElement) =>
                    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
                let checked = 0;
                const compare = (
                    draw: (renderer: ReturnType<typeof createRenderer>) => void,
                    positions = [0, 0.25, 0.5, 0.75, 1],
                ) => {
                    draw(renderers[0]);
                    draw(renderers[1]);
                    const retro = pixels(canvases[0]),
                        modern = pixels(canvases[1]);
                    for (const position of positions) {
                        renderers[2].setSplitPosition(position);
                        draw(renderers[2]);
                        if (canvases[2].width !== 1024 || canvases[2].height !== 768)
                            throw Error('Split resolution changed');
                        const split = pixels(canvases[2]),
                            boundary = Math.round(position * 1024);
                        for (let y = 0; y < 768; y++)
                            for (let x = 0; x < 1024; x++) {
                                const target = (y * 1024 + x) * 4;
                                const source =
                                    x < boundary ? ((y >> 2) * 256 + (x >> 2)) * 4 : target;
                                const expected = x < boundary ? retro : modern;
                                for (let channel = 0; channel < 4; channel++) {
                                    // WebKit can round a bright vector gradient by one
                                    // channel level between its first and repeated draw.
                                    // Source Retro pixels and alpha remain byte-exact.
                                    const tolerance =
                                        x < boundary || channel === 3 ? 0 : modernTolerance;
                                    if (
                                        Math.abs(
                                            split[target + channel] - expected[source + channel],
                                        ) > tolerance
                                    ) {
                                        throw Error(
                                            `Split crop mismatch frame ${checked} at ${position}, ${x},${y}, channel ${channel}`,
                                        );
                                    }
                                }
                            }
                        checked++;
                    }
                };
                const state = createState(world);
                state.tick = 20;
                state.bullets = [{ x: 24, y: 124, dx: 1 }];
                const events: GameEvent[] = [
                    { type: 'explosion', x: 120, y: 90 },
                    { type: 'teleport', x: 60, y: 70 },
                ];
                renderers.forEach((renderer) => renderer.addEvents(events, state));
                const before = JSON.stringify(state);
                compare((renderer) => renderer.render(state, 1000, 0.4));
                compare(
                    (renderer) => renderer.render(state, 1000, 0.4, { paused: true }),
                    [0.33, 0.67],
                );
                if (JSON.stringify(state) !== before) throw Error('Split mutated gameplay');
                compare((renderer) => renderer.renderTitle(2300), [0.5]);
                compare(
                    (renderer) =>
                        renderer.renderTitle(2300, {
                            scores: true,
                            rows: [{ name: 'ORBIT', score: 12345 }],
                        }),
                    [0.5],
                );
                for (const status of ['bonus', 'over', 'won'] as const) {
                    const sample = createState(world);
                    sample.status = status;
                    sample.bonus = { cursor: 3 } as StageBonus;
                    renderers.forEach((renderer) => renderer.addEvents([], sample));
                    compare(
                        (renderer) =>
                            renderer.render(sample, 1000, 0, {
                                nameEntry: status === 'won',
                                playerName: 'ORBIT',
                            }),
                        [0.5],
                    );
                }
                for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                    const sample = createState(world, { screenIndex });
                    renderers.forEach((renderer) => renderer.addEvents([], sample));
                    compare((renderer) => renderer.render(sample, 0, 0), [0.5]);
                }
                renderers[2].setSplitPosition(-5);
                if ((renderers[2].splitPosition as number) !== 0)
                    throw Error('Negative divider not clamped');
                renderers[2].setSplitPosition(5);
                if ((renderers[2].splitPosition as number) !== 1)
                    throw Error('Divider beyond right edge');
                renderers[2].setSplitPosition(NaN);
                if ((renderers[2].splitPosition as number) !== 1)
                    throw Error('Invalid position must be ignored');
                renderers[2].setGraphicsMode('retro');
                renderers[2].render(state, 1000, 0.4);
                renderers[0].render(state, 1000, 0.4);
                const restored = pixels(canvases[2]),
                    original = pixels(canvases[0]);
                if (
                    canvases[2].width !== 256 ||
                    !restored.every((value, i) => value === original[i])
                )
                    throw Error('Retro restoration failed');
                renderers.forEach((renderer) => renderer.destroy());
                return checked;
            },
            name === 'WebKit' ? 1 : 0,
        );
        assert.ok(frames >= 135);
        console.log(
            `PASS: ${name} ${frames} Split crops, exact original pixels, shared state/effects, menus, 125 screens, bounds and Retro restoration.`,
        );
    } finally {
        await page.close();
    }
}

export async function checkSplitControl(
    session: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
        overlayOpen,
        chooseCheats,
        expectMusic,
    }: Pick<
        BrowserHelpers,
        'prepare' | 'padFrames' | 'waitForPlaying' | 'overlayOpen' | 'chooseCheats' | 'expectMusic'
    >,
) {
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 }, hasTouch: true });
    await prepare(page);
    const activate = async (selector: string) => {
        if (selector === '#game') {
            await prepareControl(page.locator(selector));
            const options = { position: { x: 12, y: 12 } };
            if (name === 'WebKit') await page.locator(selector).tap(options);
            else await page.locator(selector).click(options);
        } else await activateControl(page.locator(selector), name === 'WebKit');
    };
    // Observe real model outputs at the module boundary; production has no test hooks.
    await page.route('**/model/state.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
        export * from './state.js?split-source';
        import {createState as create,step as advance} from './state.js?split-source';
        export function createState(...args) {return window.__splitState=create(...args);}
        export function step(...args) {const result=advance(...args);window.__splitState=result.state;return result;}
    `,
        }),
    );
    const divider = page.locator('#split-divider');
    const position = async () => Number(await divider.getAttribute('aria-valuenow'));
    const bounds = () =>
        page.locator('#game').evaluate((canvas) => {
            const r = canvas.getBoundingClientRect(),
                width = Math.min(r.width, (r.height * 4) / 3),
                height = (width * 3) / 4;
            return {
                left: r.left + (r.width - width) / 2,
                top: r.top + (r.height - height) / 2,
                width,
                height,
            };
        });
    const drag = async (fraction: number) => {
        await divider.scrollIntoViewIfNeeded();
        const box = (await divider.boundingBox())!,
            image = await bounds();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(image.left + image.width * fraction, image.top + image.height / 2, {
            steps: 6,
        });
        await page.mouse.up();
        assert.ok(
            Math.abs((await position()) - fraction * 100) < 1,
            `${name}: drag to ${fraction}, actual ${await position()}`,
        );
    };
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(
            await page.locator('#graphics-mode option[value="split"]').count(),
            1,
            'The footer has a Split mode',
        );
        assert.equal(await divider.isVisible(), false);
        assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        await padFrames(page);
        assert.equal(await divider.isVisible(), true);
        assert.equal(await position(), 50);
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'split');
        await activate('#game');
        await expectMusic(page, `${name} Split title`, 'ambient');
        await page.screenshot({
            path: `/tmp/exolon-split-title-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await chooseCheats(page, { invulnerable: true }, name === 'WebKit');
        await activate('#new-game');
        await waitForPlaying(page);
        await activate('#pause');
        const before = await page.evaluate(() => JSON.stringify(window.__splitState));
        await drag(0.25);
        await drag(0.75);
        await divider.focus();
        await page.keyboard.press('Home');
        assert.equal(await position(), 0);
        await page.keyboard.press('ArrowRight');
        assert.ok((await position()) > 0 && (await position()) < 10);
        await page.keyboard.press('End');
        assert.equal(await position(), 100);
        for (let i = 0; i < 5; i++) await page.keyboard.press('PageDown');
        assert.equal(await position(), 50);
        assert.equal(
            await page.evaluate(() => JSON.stringify(window.__splitState)),
            before,
            'Dragging on pause cannot mutate the game',
        );
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        assert.equal(await divider.isVisible(), false);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        await padFrames(page);
        assert.equal(await overlayOpen(page), true);
        assert.equal(await position(), 50);
        await activate('#pause');
        const actor = await page.evaluate(() => ({
            x: window.__splitState.player.x,
            ammo: window.__splitState.ammo,
            tick: window.__splitState.tick,
        }));
        await divider.focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space');
        await page.waitForFunction((tick) => window.__splitState.tick > tick + 2, actor.tick);
        assert.equal(
            await page.evaluate(() => window.__splitState.player.x),
            actor.x,
            'Slider arrows cannot move the astronaut',
        );
        assert.equal(
            await page.evaluate(() => window.__splitState.ammo),
            actor.ammo,
            'Slider Space cannot fire',
        );
        await activate('#pause');
        await page.evaluate(() =>
            (document.getElementById('split-divider') as HTMLElement).addEventListener(
                'pointerdown',
                (event) => {
                    window.__splitPointer = event.pointerId;
                },
                { once: true },
            ),
        );
        const box = (await divider.boundingBox())!,
            image = await bounds();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(image.left + image.width * 0.6, image.top + image.height / 2);
        await page.evaluate(() =>
            (document.getElementById('split-divider') as HTMLElement).dispatchEvent(
                new PointerEvent('pointercancel', {
                    pointerId: window.__splitPointer,
                    bubbles: true,
                }),
            ),
        );
        const cancelled = await position();
        await page.mouse.move(image.left + image.width * 0.8, image.top + image.height / 2);
        await page.mouse.up();
        assert.equal(await position(), cancelled, 'Cancelled drag cannot continue moving');
        await page.setViewportSize({ width: 844, height: 390 });
        await activate('#fullscreen');
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'true' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await padFrames(page);
        const fullImage = await bounds(),
            fullDivider = (await divider.boundingBox())!;
        assert.ok(
            Math.abs(fullDivider.height - fullImage.height) < 2,
            'Divider covers the contained image, excluding letterboxing',
        );
        assert.ok(Math.abs(fullDivider.y - fullImage.top) < 2);
        await drag(0.75);
        if (name === 'Chromium') {
            const client = await page.context().newCDPSession(page),
                b = (await divider.boundingBox())!,
                area = await bounds();
            await client.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }],
            });
            await client.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [
                    { x: area.left + area.width * 0.3, y: area.top + area.height / 2, id: 7 },
                ],
            });
            await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            assert.ok(
                Math.abs((await position()) - 30) < 1,
                'A real touchscreen gesture moves the divider',
            );
        }
        await page.screenshot({
            path: `/tmp/exolon-split-fullscreen-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await activate('#fullscreen');
        await page.waitForFunction(
            () => !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await page.keyboard.press('Escape');
        await activate('#show-scores');
        await padFrames(page);
        assert.equal(await divider.isVisible(), true);
        await drag(0.4);
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await padFrames(page);
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'split');
        assert.equal(await position(), 50);
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await padFrames(page);
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
            );
            await drag(0.6);
        }
        await page.screenshot({
            path: `/tmp/exolon-split-mobile-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        assert.equal(await divider.isVisible(), false);
        console.log(
            `PASS: ${name} saved Split option, centered divider, mouse/keyboard/cancel, live/paused state, ambient, records, mobile and letterboxed Fullscreen${name === 'Chromium' ? ', native touch' : ''}.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-split-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
}
