import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAmigaResources } from '../../src/games/amiga/controllers/resources.ts';
test('Amiga rejects incomplete maps, corrupt native pixels and missing sprite banks', async () => {
    const world: unknown = JSON.parse(
        await readFile(new URL('../../src/games/amiga/data/world.json', import.meta.url), 'utf8'),
    );
    const graphics: unknown = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    );
    assert.doesNotThrow(() => validateAmigaResources(world, graphics));
    assert.throws(() => validateAmigaResources({}, graphics), /Amiga/);
    assert.throws(() => validateAmigaResources(world, {}), /Amiga/);
    const corrupt = JSON.parse(JSON.stringify(graphics)) as {
        resources: Record<string, { frames: number[][] }>;
    };
    corrupt.resources.player.frames[0][0] = 255;
    assert.throws(() => validateAmigaResources(world, corrupt), /Amiga/);
    for (const key of ['menu-stars', 'game-stars', 'score-pipe', 'debris', 'window-tiles']) {
        const missing = JSON.parse(JSON.stringify(graphics)) as {
            resources: Record<string, unknown>;
        };
        delete missing.resources[key];
        assert.throws(() => validateAmigaResources(world, missing), /Amiga/);
    }
    delete corrupt.resources.player;
    assert.throws(() => validateAmigaResources(world, corrupt), /Amiga/);
});

test('Amiga validates every renderer dependency before starting a frame', async () => {
    const world = JSON.parse(
        await readFile(new URL('../../src/games/amiga/data/world.json', import.meta.url), 'utf8'),
    );
    const original = await readFile(
        new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
        'utf8',
    );
    const changes: ((value: Record<string, unknown>) => void)[] = [
        (value) => {
            delete value.palette;
        },
        (value) => {
            delete value.stageTileSets;
        },
        (value) => {
            delete value.stageFlyers;
        },
        (value) => {
            value.text = {};
        },
        (value) => {
            value.font = [[999]];
        },
        (value) => {
            value.highScores = [{ name: 'X', score: -1 }];
        },
    ];
    for (const change of changes) {
        const value = JSON.parse(original) as Record<string, unknown>;
        change(value);
        assert.throws(() => validateAmigaResources(world, value), /Amiga/);
    }
});
