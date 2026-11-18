import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAtariStRenderer } from '../../src/games/atari-st/view/renderer.ts';
import { createAtariStState } from '../../src/games/atari-st/model/index.ts';
import { validateAtariStResources } from '../../src/games/atari-st/controllers/resources.ts';
import { decodePng } from '../../tools/graphics/png.mjs';
const { world, graphics } = validateAtariStResources(
    ...((await Promise.all(
        [
            '../../src/games/atari-st/data/world.json',
            '../../src/assets/graphics/atari-st/resources.json',
        ].map(async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'))),
    )) as [unknown, unknown]),
);
function fixture() {
    let rgba = new Uint8ClampedArray(64000 * 4);
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            imageSmoothingEnabled: false,
            createImageData: () => ({ data: new Uint8ClampedArray(64000 * 4) }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
                rgba = new Uint8ClampedArray(image.data);
            },
        }),
    } as unknown as HTMLCanvasElement;
    const renderer = createAtariStRenderer(canvas, graphics, world);
    return { renderer, read: () => rgba };
}
function hash(bytes: Uint8Array | Uint8ClampedArray) {
    return createHash('sha256').update(bytes).digest('hex');
}
async function reference(name: string) {
    return decodePng(
        await readFile(
            new URL(
                `../../originals/images/atari-st/reference/source-${name}.png`,
                import.meta.url,
            ),
        ),
    ).rgba;
}
function crop(bytes: Uint8Array | Uint8ClampedArray, x: number, y: number, w: number, h: number) {
    const out = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++)
        out.set(
            bytes.subarray(((y + row) * 320 + x) * 4, ((y + row) * 320 + x + w) * 4),
            row * w * 4,
        );
    return out;
}

test('Atari title and name page match independently executed original full frames', async () => {
    const { renderer, read } = fixture();
    const state = createAtariStState(world);
    renderer.render(state, 0, { page: 'title' });
    assert.equal(
        hash(read()),
        hash(await reference('title')),
        'Original colored credits and TOS glyphs',
    );
    renderer.render(state, 0, { page: 'name', name: '' });
    assert.equal(
        hash(read()),
        hash(await reference('name')),
        'Original full border, logo and cyan name field',
    );
});
test('Atari Hall of Fame scroll preserves native font, bounds, pipes and rows', async () => {
    const { renderer, read } = fixture();
    const state = createAtariStState(world);
    renderer.render(state, 0, { page: 'scores' });
    for (const frame of [0, 1, 8, 9, 16, 145]) {
        renderer.render(state, frame * 40, { page: 'scores' });
        assert.equal(
            hash(read()),
            hash(await reference('scores-' + frame)),
            `Source scroll${frame}`,
        );
    }
});
test('Atari Game Over uses original stage colors and opaque source border', async () => {
    const { renderer, read } = fixture();
    const state = createAtariStState(world);
    state.status = 'over';
    renderer.render(state, 0);
    assert.equal(
        hash(crop(read(), 96, 72, 128, 48)),
        hash(crop(await reference('game-over'), 96, 72, 128, 48)),
    );
});
test('Atari bonus, congratulations and bravery panels match the source pages', async () => {
    const { renderer, read } = fixture();
    const state = createAtariStState(world);
    state.status = 'bonus';
    state.bonusPhase = 'summary';
    renderer.render(state, 0);
    assert.equal(
        hash(crop(read(), 80, 72, 160, 80)),
        hash(crop(await reference('bravery'), 80, 72, 160, 80)),
        'Bravery popup',
    );
    state.bonusPhase = 'ending';
    renderer.render(state, 0);
    assert.equal(hash(read()), hash(await reference('ending')), 'Full ending border');
    state.bonusPhase = 'roulette';
    renderer.render(state, 0);
    assert.equal(
        hash(read()),
        hash(await reference('bonus-roulette')),
        'Original roulette pointer',
    );
});
