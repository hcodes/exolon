import { serveReferenceModules } from './reference-mode.ts';
import { openGame } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { GameState } from '../../src/types/game.ts';
import type { Graphics, NativeGraphics, CpcGraphics } from '../../src/types/graphics.ts';

export async function checkAirborneWeapons(session: Browser, name: string) {
    const page = await session.newPage();
    await serveReferenceModules(page);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        const result = await page.evaluate(async () => {
            const [
                { createState, step },
                { createRenderer },
                { createProjectileMotion },
                graphics,
                c64,
                cpc,
            ] = await Promise.all([
                import(new URL('./model/state.js', document.baseURI).href) as Promise<
                    typeof import('../../src/model/state.ts')
                >,
                import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/renderer.ts')
                >,
                import(new URL('./view/projectile-motion.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/projectile-motion.ts')
                >,
                fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                    (response) => response.json() as Promise<Graphics>,
                ),
                fetch('./assets/graphics/c64/c64-graphics.json').then(
                    (response) => response.json() as Promise<NativeGraphics>,
                ),
                fetch('./assets/graphics/amstrad-cpc/cpc-graphics.json').then(
                    (response) => response.json() as Promise<CpcGraphics>,
                ),
            ]);
            const map = {
                placements: [],
                actions: [],
                tiles: Array.from({ length: 768 }, (_, i) =>
                    i >= 576 ? { collision: 1, block: 33 } : null,
                ),
            };
            const initial = createState(map);
            initial.bullets = [{ x: 50, y: 90, dx: 1 }];
            initial.grenade = { x: 60, y: 80, dx: 1, phase: 20, projectileId: 1 };
            initial.enemyBullets = [{ x: 30, y: 126, dx: -1 }];
            const killed = step(initial, {}),
                next = step(killed.state, {});
            if (killed.state.death !== 46 || next.state.death !== 45)
                throw Error('A real enemy hit must trigger the death sequence');
            const motion = createProjectileMotion();
            motion.observe(killed.state, killed.events);
            motion.observe(next.state, next.events);
            const positions = [0, 0.5, 1].map(
                (fraction) => motion.sample(next.state, fraction).grenade!.x,
            );
            if (positions[0] !== 122 || positions[1] !== 125 || positions[2] !== 128)
                throw Error(`Dying rocket interpolation freezes: ${positions}`);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, { ...graphics, c64 });
            renderer.setCpcGraphics(cpc);
            const snapshot = JSON.stringify([killed.state, next.state]);
            const render = (state: GameState, mode: string) => {
                renderer.destroy();
                renderer.setGraphicsMode(mode);
                renderer.addEvents([], state);
                renderer.render(state, 0, 1);
                return {
                    width: canvas.width,
                    height: canvas.height,
                    pixels: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
                        .data,
                };
            };
            function bounds(state: GameState, mode: string, top: number, bottom: number) {
                const visible = render(state, mode);
                const base = render({ ...state, bullets: [], grenade: null }, mode);
                const scale = visible.width / 256;
                let left = Infinity,
                    right = -Infinity;
                for (let y = Math.floor(top * scale); y < bottom * scale; y++)
                    for (let x = Math.floor(60 * scale); x < 200 * scale; x++) {
                        const offset = (y * visible.width + x) * 4;
                        if (
                            ![0, 1, 2].some(
                                (channel) =>
                                    Math.abs(
                                        visible.pixels[offset + channel] -
                                            base.pixels[offset + channel],
                                    ) > 2,
                            )
                        )
                            continue;
                        left = Math.min(left, x / scale);
                        right = Math.max(right, x / scale);
                    }
                if (!Number.isFinite(left))
                    throw Error(`${mode}: airborne weapon disappeared during death`);
                return { left, right };
            }
            const modes = [];
            try {
                for (const mode of [
                    'retro',
                    'remastered',
                    'c64',
                    'cpc',
                    'gameboy',
                    'gameboy-color',
                    'split',
                ]) {
                    const bulletBefore = bounds(killed.state, mode, 90, 93),
                        bulletAfter = bounds(next.state, mode, 90, 93);
                    const rocketBefore = bounds(killed.state, mode, 75, 88),
                        rocketAfter = bounds(next.state, mode, 75, 88);
                    if (bulletAfter.left <= bulletBefore.left)
                        throw Error(`${mode}: visible bullet freezes after the astronaut is hit`);
                    if (rocketAfter.left <= rocketBefore.left)
                        throw Error(`${mode}: visible rocket freezes after the astronaut is hit`);
                    modes.push({
                        mode,
                        bullet: [bulletBefore.left, bulletAfter.left],
                        rocket: [rocketBefore.left, rocketAfter.left],
                    });
                }
                if (JSON.stringify([killed.state, next.state]) !== snapshot)
                    throw Error('Rendering mutated the projectile simulation');
                return { modes, positions };
            } finally {
                renderer.destroy();
            }
        });
        assert.equal(result.modes.length, 7);
        assert.deepEqual(result.positions, [122, 125, 128]);
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} lethal enemy hit, continued player bullet/rocket flight, actual moving pixels in all 7 graphics modes and smooth Remastered interpolation.`,
        );
    } finally {
        await page.close();
    }
}
