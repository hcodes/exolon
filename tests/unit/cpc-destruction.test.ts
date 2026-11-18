import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createState, step } from '../../src/model/state.ts';
import { createCpcRenderer } from '../../src/view/cpc-renderer.ts';
import { createScreen } from '../../src/view/spectrum.ts';
import type { CpcGraphics } from '../../src/types/graphics.ts';
import type { World } from '../../src/types/game.ts';

const graphics = JSON.parse(
    readFileSync('src/assets/graphics/amstrad-cpc/cpc-graphics.json', 'utf8'),
) as CpcGraphics;
const world = JSON.parse(readFileSync('src/data/world.json', 'utf8')) as World;

function canvasFixture() {
    let pixels = new Uint8ClampedArray();
    const context = {
        createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData(image: ImageData) {
            pixels = image.data.slice();
        },
        imageSmoothingEnabled: false,
    };
    const canvas = { width: 256, height: 192, getContext: () => context };
    return {
        renderer: createCpcRenderer(
            canvas as unknown as HTMLCanvasElement,
            graphics,
            createScreen(),
        ),
        pixels: () => pixels,
    };
}

function rocketImpact() {
    const target = createState(world);
    // Keep the actual first-screen barrel, tiles and collisions; isolate enemy firing.
    target.objects = [];
    target.grenade = { x: 74, y: 112, dx: 1, phase: 20, projectileId: 1 };
    const impact = step(step(target, {}).state, {});
    assert.deepEqual(impact.state.destroyed, [8]);
    assert.ok(impact.events.some((event) => event.type === 'object-destroyed'));
    return { target, impact };
}

test('CPC rocket destruction removes the real barrel and scatters debris beyond the impact flash', () => {
    const { renderer, pixels } = canvasFixture();
    const { impact } = rocketImpact();
    renderer.render({ ...impact.state, destroyed: [] });
    const intact = pixels();
    renderer.render(impact.state);
    const cleared = pixels();
    assert.notDeepEqual(cleared, intact, 'the destroyed barrel must leave the scenery cache');
    const snapshot = JSON.stringify(impact.state);
    renderer.observe(impact.state, impact.events);
    const later = { ...impact.state, tick: impact.state.tick + 12 };
    renderer.render(later);
    const debris = pixels();
    assert.notDeepEqual(debris, cleared, 'moving debris must outlive the ten-tick impact flash');
    let scattered = 0;
    for (let y = 0; y < 176; y++)
        for (let x = 0; x < 256; x += 2) {
            const index = (y * 256 + x) * 4;
            if (
                debris[index] === cleared[index] &&
                debris[index + 1] === cleared[index + 1] &&
                debris[index + 2] === cleared[index + 2]
            )
                continue;
            if (x < 144 || x >= 192 || y < 104 || y >= 144) scattered++;
            assert.deepEqual(debris.slice(index, index + 4), debris.slice(index + 4, index + 8));
        }
    assert.ok(scattered > 0, 'barrel fragments must travel away from the destroyed object');
    renderer.render(later);
    assert.deepEqual(pixels(), debris, 'pause must freeze the debris');
    assert.equal(JSON.stringify(impact.state), snapshot);
    renderer.render({ ...impact.state, tick: impact.state.tick + 176 });
    assert.deepEqual(pixels(), cleared, 'debris must expire');
});

test('CPC destruction debris is deduplicated and cleared on renderer reset or screen change', () => {
    const { renderer, pixels } = canvasFixture();
    const { impact } = rocketImpact();
    const later = { ...impact.state, tick: impact.state.tick + 12 };
    renderer.render(later);
    const cleared = pixels();
    renderer.observe(impact.state, impact.events);
    renderer.render(later);
    const debris = pixels();
    assert.notDeepEqual(debris, cleared);
    renderer.observe(impact.state, impact.events);
    renderer.render(later);
    assert.deepEqual(pixels(), debris, 'reobserving a tick must not XOR away its debris');
    renderer.reset();
    renderer.render(later);
    assert.deepEqual(pixels(), cleared);
    renderer.observe(impact.state, impact.events);
    const nextScreen = { ...createState(world, { screenIndex: 1 }), tick: later.tick };
    renderer.observe(nextScreen, []);
    renderer.render(nextScreen);
    const fresh = canvasFixture();
    fresh.renderer.render(nextScreen);
    assert.deepEqual(pixels(), fresh.pixels(), 'old debris must not leak into the next screen');
});
