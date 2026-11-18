import { spawnAmigaDebris } from '../../src/games/amiga/model/debris.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AMIGA_NATIVE } from '../../src/games/amiga/constants/index.ts';
import {
    createAmigaState,
    nativeAmigaOverlap,
    stepAmiga,
} from '../../src/games/amiga/model/index.ts';
import { extractAmigaModel, readAmigaModelTables } from '../../tools/recovery/amiga-model.mjs';
import type { AmigaWorld } from '../../src/games/amiga/types/index.ts';

const world = (): AmigaWorld => ({
    screens: Array.from({ length: 125 }, () => ({
        tiles: Array.from({ length: 920 }, (_, i) => (i >= 880 ? 0x79 : 0)),
    })),
});

test('Amiga bullet-only holds never charge rockets and explicit rockets consume no bullets', () => {
    let state = createAmigaState(world());
    const bullets = { fire: true, chargeRocket: false };
    for (let i = 0; i < 40; i++) state = stepAmiga(state, bullets).state;
    assert.equal(state.ammo, 98);
    assert.equal(state.grenades, 9);
    state = stepAmiga(state, { ...bullets, rocket: true }).state;
    assert.equal(state.ammo, 98);
    assert.equal(state.grenades, 8);
});

test('Amiga preserves consecutive touch fire edges without a neutral simulation step', () => {
    const bullets = { fire: true, chargeRocket: false, firePressed: true };
    let state = stepAmiga(createAmigaState(world()), bullets).state;
    state = stepAmiga(state, bullets).state;
    assert.equal(state.ammo, 97);
    assert.equal(state.grenades, 9);
});

test('Amiga movement uses three-pixel steps, a turn tick and its own fifteen-step jump', () => {
    let state = createAmigaState(world());
    assert.deepEqual([state.player.x, state.player.y, state.lives, state.grenades], [3, 176, 9, 9]);
    state = stepAmiga(state, { right: true }).state;
    assert.equal(state.player.x, 6);
    state = stepAmiga(state, { left: true }).state;
    assert.equal(state.player.x, 6);
    state = stepAmiga(state, { left: true }).state;
    assert.equal(state.player.x, 3);
    state = stepAmiga(state, { jump: true }).state;
    assert.equal(state.player.y, 176); // $e6ca initializes; $ebc4 applies next tick.
    for (let i = 0; i < 7; i++) state = stepAmiga(state, {}).state;
    assert.equal(state.player.y, 155);
    for (let i = 0; i < 8; i++) state = stepAmiga(state, {}).state;
    assert.equal(state.player.y, 176);
});

test('Amiga fires once on an edge and launches a grenade after ten additional held ticks', () => {
    let state = createAmigaState(world());
    state = stepAmiga(state, { fire: true }).state;
    assert.equal(state.ammo, 98);
    for (let i = 0; i < 9; i++) state = stepAmiga(state, { fire: true }).state;
    assert.equal(state.grenades, 9);
    const thrown = stepAmiga(state, { fire: true });
    assert.equal(thrown.state.grenades, 8);
    assert.ok(thrown.events.some((event) => event.type === 'grenade'));
    assert.equal(thrown.state.ammo, 98);
    state = stepAmiga(thrown.state, {}).state;
    assert.equal(stepAmiga(state, { fire: true }).state.ammo, 97);
});

test('Amiga solid tiles stop movement, duck changes its native anchor, and steps are immutable', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[21 * 40 + 4] = 0x78;
    const initial = createAmigaState({ screens: [{ tiles }] });
    assert.equal(stepAmiga(initial, { right: true }).state.player.x, 3);
    const duck = stepAmiga(initial, { duck: true }).state;
    assert.equal(duck.player.y, 182);
    assert.equal(duck.player.pose, 14);
    assert.equal(initial.player.y, 176);
    assert.equal(stepAmiga(duck, {}).state.player.y, 176);
});

test('Amiga deaths restore the screen checkpoint and ammunition with a native fifteen-frame delay', () => {
    let state = createAmigaState(world());
    state.player.x = 100;
    state.entities.push({
        id: 999,
        kind: 'enemy-bullet',
        x: 105,
        y: 145,
        width: 10,
        height: 6,
        frame: 0,
        type: 0,
        alive: true,
        phase: 0,
        dx: 0,
        dy: 0,
    });
    state = stepAmiga(state, {}).state;
    assert.equal(state.lives, 8);
    assert.equal(state.player.x, 3);
    assert.equal(state.player.deathTick, 0);
    assert.deepEqual([state.ammo, state.grenades], [99, 10]);
    for (let i = 0; i < 14; i++) state = stepAmiga(state, { right: true }).state;
    assert.equal(state.player.x, 3);
    state = stepAmiga(state, { right: true }).state;
    assert.equal(state.player.x, 6);
});

test('Amiga screen exits preserve height and stage ends run bonus before the next native bank', () => {
    let state = createAmigaState(world());
    state.player.x = 310;
    state = stepAmiga(state, { right: true }).state;
    assert.deepEqual([state.screenIndex, state.player.x, state.player.y], [1, 3, 176]);
    state = createAmigaState(world(), { screenIndex: 24 });
    state.player.x = 190;
    state = stepAmiga(state, {}).state;
    assert.equal(state.status, 'bonus');
    assert.equal(state.bonusPhase, 'summary');
    state = stepAmiga(state, { fire: true }).state;
    assert.equal(state.bonusPhase, 'roulette');
    assert.equal(stepAmiga(state, { fire: true }).state.status, 'bonus');
    state = stepAmiga(state, {}).state;
    state = stepAmiga(state, { fire: true }).state;
    assert.equal(state.screenIndex, 25);
    assert.equal(state.status, 'playing');
    state = createAmigaState(world(), { screenIndex: 124 });
    state.player.x = 190;
    state = stepAmiga(state, {}).state;
    state = stepAmiga(state, { fire: true }).state;
    assert.equal(state.bonusPhase, 'ending');
    state = stepAmiga(state, {}).state;
    state = stepAmiga(state, { fire: true }).state;
    assert.equal(state.bonusPhase, 'roulette');
    state = stepAmiga(state, {}).state;
    assert.equal(stepAmiga(state, { fire: true }).state.screenIndex, 0);
});

test('Amiga projectile kills award original points and do not mutate their prior frame', () => {
    const state = createAmigaState(world());
    state.entities.push({
        id: 999,
        kind: 'flyer',
        x: 80,
        y: 140,
        width: 24,
        height: 24,
        frame: 0,
        type: 0,
        alive: true,
        phase: 0,
        dx: 0,
        dy: 0,
    });
    state.entities.push({
        id: 1000,
        kind: 'bullet',
        x: 80,
        y: 140,
        width: 14,
        height: 6,
        frame: 0,
        type: 0,
        alive: true,
        phase: 0,
        dx: 12,
        dy: 0,
        life: 15,
    });
    const next = stepAmiga(state, {}).state;
    assert.equal(next.score, 150);
    assert.ok(state.entities.find((entity) => entity.id === 999)?.alive);
    assert.ok(!next.entities.find((entity) => entity.id === 999)?.alive);
    assert.equal(
        next.entities.find((entity) => entity.kind === 'explosion')?.type,
        0,
        'A destroyed enemy retains the large explosion',
    );
});

test('Amiga bullets striking intact structures create a short impact without destroying the target', () => {
    for (const kind of ['barrier', 'pod', 'turret'] as const) {
        const state = createAmigaState(world(), { invulnerable: true });
        state.entities = [
            {
                id: 999,
                kind,
                x: 96,
                y: 100,
                width: 64,
                height: 64,
                frame: 0,
                type: 0,
                alive: true,
                phase: 4,
                dx: 0,
                dy: 0,
            },
            {
                id: 1000,
                kind: 'bullet',
                x: 92,
                y: 120,
                width: 14,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: 12,
                dy: 0,
                life: 15,
            },
        ];
        let next = stepAmiga(state, {}).state;
        const impact = next.entities.find((entity) => entity.kind === 'explosion')!;
        assert.ok(impact, kind);
        assert.deepEqual([impact.width, impact.height, impact.frame], [32, 8, 1], kind);
        assert.ok(
            next.entities.some((entity) => entity.id === 999 && entity.alive),
            kind,
        );
        assert.equal(
            next.entities.some((entity) => entity.id === 1000),
            false,
            kind,
        );
        assert.equal(next.score, 0, kind);
        for (let frame = 2; frame <= 8; frame++) {
            next = stepAmiga(next, {}).state;
            assert.equal(
                next.entities.find((entity) => entity.id === impact.id)?.frame,
                frame,
                kind,
            );
        }
        next = stepAmiga(next, {}).state;
        assert.equal(
            next.entities.some((entity) => entity.id === impact.id),
            false,
            kind,
        );
        assert.ok(
            state.entities.every((entity) => entity.alive),
            'Previous state stays intact',
        );
    }
});

test('Amiga laser wall absorbs twenty bullets and awards each hit through the native score queue', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[2 * 40 + 20] = 0xf9;
    let state = createAmigaState({ screens: [{ tiles }] });
    state.entities.push({
        id: 999,
        kind: 'bullet',
        x: 158,
        y: 145,
        width: 14,
        height: 6,
        frame: 0,
        type: 0,
        alive: true,
        phase: 0,
        dx: 12,
        dy: 0,
        life: 15,
    });
    state = stepAmiga(state, {}).state;
    assert.equal(state.entities.find((entity) => entity.kind === 'laser')?.health, 19);
    assert.equal(state.pendingScore, 20);
    assert.equal(stepAmiga(state, {}).state.score, 50);
});

test('Amiga armor is acquired by the original up action below tile 0x78 and protects against a mine', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[16 * 40] = 0x78;
    tiles[22 * 40] = 0xa2;
    let state = createAmigaState({ screens: [{ tiles }] });
    // The up action is applied before stepping onto a separately positioned mine.
    // Position below the armor station; direct-entry placement chooses its top.
    state.player.y = 176;
    state.player.spawnY = 176;
    state.entities = state.entities.filter((entity) => entity.kind !== 'mine');
    state = stepAmiga(state, { jump: true }).state;
    assert.equal(state.player.armored, true);
    state.player.jumpKind = 0;
    state.entities.push({
        id: 999,
        kind: 'mine',
        x: 0,
        y: 176,
        width: 16,
        height: 8,
        frame: 0,
        type: 0,
        alive: true,
        phase: 880,
        dx: 0,
        dy: 0,
    });
    state = stepAmiga(state, {}).state;
    assert.equal(state.lives, 9);
    assert.equal(state.tiles[880], 0xa3);
});

test('Amiga grenade destruction removes the obstacle marker and its persistent collision body', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[12 * 40 + 10] = 0xff;
    let state = createAmigaState({ screens: [{ tiles }] });
    state.entities.push({
        id: 999,
        kind: 'grenade',
        x: 70,
        y: 96,
        width: 14,
        height: 6,
        frame: 0,
        type: 0,
        alive: true,
        phase: 9,
        dx: 1,
        dy: 0,
    });
    state = stepAmiga(state, {}).state;
    assert.equal(state.tiles[490], 0);
    assert.ok(!state.entities.some((entity) => entity.kind === 'barrier'));
    assert.equal(tiles[490], 0xff);
    assert.equal(stepAmiga(state, {}).state.tiles[490], 0);
});

test('Amiga flyer scheduling advances the original two-word random recurrence', () => {
    const state = createAmigaState(world(), {
        screenIndex: 1,
        seed: 0x19871201,
        seedHigh: 0x12345678,
    });
    const next = stepAmiga(state, {}).state;
    // Hand-evaluated $ef06/$ef4a: prepared low word has low byte 0x20,
    // then the 64-bit pair is multiplied by 0x20003. High word produces113.
    assert.equal(next.randomSeed, 0x70d53660);
    assert.equal(next.randomSeedHigh, 0xe38d3676);
    assert.ok(!next.entities.some((entity) => entity.kind === 'flyer'));
});

test('Amiga flyer damage excludes the eight-pixel left sprite margin', () => {
    const state = createAmigaState(world());
    state.entities.push({
        id: 999,
        kind: 'flyer',
        x: 30,
        y: 140,
        width: 32,
        height: 24,
        frame: 0,
        type: 0,
        alive: true,
        phase: 0,
        dx: 0,
        dy: 0,
    });
    assert.equal(stepAmiga(state, {}).state.lives, 9);
});

test('Amiga launcher animation sits thirty-two pixels above its map marker', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[12 * 40 + 10] = 0xfb;
    const launcher = createAmigaState({ screens: [{ tiles }] }).entities.find(
        (entity) => entity.kind === 'laser',
    )!;
    assert.deepEqual([launcher.x, launcher.y], [88, 64]);
});

test('Amiga grenade terrain sampling precedes the native arc movement', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[10 * 40 + 12] = 0x79;
    let state = createAmigaState({ screens: [{ tiles }] });
    state.entities.push({
        id: 999,
        kind: 'grenade',
        x: 85,
        y: 80,
        width: 14,
        height: 6,
        frame: 0,
        type: 0,
        alive: true,
        phase: 9,
        dx: 1,
        dy: 0,
    });
    state = stepAmiga(state, {}).state;
    assert.equal(state.entities.find((entity) => entity.id === 999)?.x, 94);
    assert.ok(!stepAmiga(state, {}).state.entities.some((entity) => entity.id === 999));
});

test('Amiga completion resumes the original first stage and keeps score and remaining lives', () => {
    let state = createAmigaState(world(), { screenIndex: 124 });
    state.player.x = 190;
    state.score = 12345;
    state.lives = 6;
    state = stepAmiga(state, {}).state;
    assert.equal(state.pendingScore, 320); // 10000 bravery +6*1000, in50-point units.
    state = stepAmiga(state, { fire: true }).state;
    assert.deepEqual([state.status, state.bonusPhase], ['bonus', 'ending']);
    assert.equal(stepAmiga(state, { fire: true }).state.bonusPhase, 'ending');
    state = stepAmiga(state, {}).state;
    state = stepAmiga(state, { fire: true }).state;
    assert.deepEqual([state.status, state.bonusPhase], ['bonus', 'roulette']);
    assert.equal(stepAmiga(state, { fire: true }).state.status, 'bonus');
    state = stepAmiga(state, {}).state;
    const completed = stepAmiga(state, { fire: true });
    state = completed.state;
    assert.ok(completed.events.some((event) => event.type === 'won'));
    assert.equal(state.status, 'playing');
    assert.deepEqual([state.screenIndex, state.lives, state.score], [0, 6, 12345]);
    assert.deepEqual([state.ammo, state.grenades, state.player.x, state.player.y], [99, 9, 3, 176]);
});

test('Amiga directional jumps retain the original arc entry when their sampled side tile is solid', () => {
    for (const [jumpKind, offset, x] of [
        [2, 119, 100],
        [3, 164, 96],
    ] as const) {
        const map = world();
        const tiles = [...map.screens[0].tiles];
        tiles[17 * 40 + 12 + offset] = 0x79;
        const state = createAmigaState({ screens: [{ tiles }] });
        state.player.x = 100;
        state.player.jumpKind = jumpKind;
        const next = stepAmiga(state, {}).state;
        assert.deepEqual([next.player.x, next.player.y, next.player.jumpIndex], [x, 171, 0]);
    }
});

test('Amiga right jumps advance the screen before applying the current horizontal arc delta', () => {
    const state = createAmigaState(world());
    state.player.x = 312;
    state.player.jumpKind = 3;
    state.player.jumpIndex = 1;
    const next = stepAmiga(state, {}).state;
    assert.deepEqual([next.screenIndex, next.player.x, next.player.y], [1, 7, 172]);
    assert.equal(next.player.spawnY, 172);
});

const originalWorld = JSON.parse(
    readFileSync(new URL('../../src/games/amiga/data/world.json', import.meta.url), 'utf8'),
) as AmigaWorld;

test('Amiga direct starts use the actual raised entry floors on maps34,50,108,109', () => {
    for (const [screenIndex, y] of [
        [34, 72],
        [50, 176],
        [108, 136],
        [109, 88],
    ]) {
        const state = createAmigaState(originalWorld, { screenIndex, invulnerable: true });
        assert.deepEqual([state.player.y, state.player.spawnY], [y, y], `screen${screenIndex}`);
    }
});

test('all125 original Amiga screens have a supported direct start that remains in bounds', () => {
    for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
        let state = createAmigaState(originalWorld, { screenIndex, invulnerable: true });
        const row = state.player.y / 8;
        const tiles = originalWorld.screens[screenIndex].tiles;
        const isSolid = (tile: number): boolean => tile >= 120 && tile <= 166;
        assert.ok(
            tiles.slice(row * 40, row * 40 + 4).some(isSolid),
            `unsupported screen${screenIndex}`,
        );
        for (let bodyRow = row - 5; bodyRow < row; bodyRow++) {
            assert.ok(
                !tiles.slice(bodyRow * 40, bodyRow * 40 + 5).some(isSolid),
                `blocked screen${screenIndex}`,
            );
        }
        for (let tick = 0; tick < 180; tick++) state = stepAmiga(state, {}).state;
        assert.ok(state.player.y >= 40 && state.player.y <= 184, `falling screen${screenIndex}`);
    }
});

test('Amiga offscreen recovery bypasses damage immunity without consuming a cheated life', () => {
    let state = createAmigaState(originalWorld, { screenIndex: 108, invulnerable: true });
    state.player.y = 240;
    state.player.ducked = true;
    state = stepAmiga(state, {}).state;
    assert.deepEqual([state.player.x, state.player.y, state.lives], [3, 136, 9]);
    for (let tick = 0; tick < 60; tick++) state = stepAmiga(state, {}).state;
    assert.equal(state.player.y, 136);
});

test('Amiga launch normalization rejects missing map data and bounds non-finite options', () => {
    assert.throws(() => createAmigaState({ screens: [] }), /screen/i);
    assert.throws(() => createAmigaState({ screens: [{ tiles: [] }] }), /tile/i);
    const state = createAmigaState(originalWorld, {
        screenIndex: NaN,
        seed: NaN,
        seedHigh: Infinity,
    });
    assert.equal(state.screenIndex, 0);
    assert.ok(Number.isFinite(state.randomSeed) && Number.isFinite(state.randomSeedHigh));
    assert.equal(createAmigaState(originalWorld, { screenIndex: 999 }).screenIndex, 124);
    assert.equal(createAmigaState(originalWorld, { screenIndex: -999 }).screenIndex, 0);
});

test('Amiga crouching dodges the high turret shot but remains vulnerable to its eight-pixel lower shot', () => {
    const shotAt = (duck: boolean, y: number) => {
        let state = createAmigaState(world());
        state.player.x = 100;
        if (duck) state = stepAmiga(state, { duck: true }).state;
        state.entities = [
            {
                id: 999,
                kind: 'enemy-bullet',
                x: 122,
                y,
                width: 10,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: -12,
                dy: 0,
            },
        ];
        return stepAmiga(state, { duck }).state;
    };
    // Original $ac7e..accc retains a40-high hurtbox; $e618 shifts crouchedY by6.
    // Native low gun atY128 emits Y132 or Y140 ($b9d4/$b9e8).
    // Upper guns use their fixed muzzle heights without that random offset.
    assert.equal(shotAt(false, 132).lives, 8);
    assert.equal(shotAt(true, 132).lives, 9);
    assert.equal(shotAt(true, 140).lives, 8);
});

test('Amiga native corner containment rejects crossing rectangles and retains its final inclusive corner', () => {
    assert.equal(
        nativeAmigaOverlap(
            { x: 0, y: 4, width: 10, height: 2 },
            { x: 4, y: 0, width: 2, height: 10 },
        ),
        false,
    );
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 4, y: 10, width: 2, height: 2 };
    assert.equal(nativeAmigaOverlap(a, b), true);
    assert.equal(nativeAmigaOverlap(b, a), false);
});

test('Amiga model extraction reads signed pairs and global screen records from native RAM addresses', () => {
    const memory = new Uint8Array(0x122ed);
    const view = new DataView(memory.buffer);
    const word = (address: number, value: number): void => view.setInt16(address, value);
    word(0xf896, -4);
    word(0xf8b2, 4);
    word(0xf8b6, -5);
    word(0xf8b8, -5);
    word(0xf8ba, 255);
    word(0xf8f4, 5);
    word(0xf8f6, -5);
    word(0xf8f8, 255);
    word(0xf9fa, 3);
    word(0xf9fc, -4);
    word(0xf9fe, 500);
    word(0x112d0, 208);
    word(0x112d2, 40);
    word(0x112d4, 501);
    word(0x112d0 + 124 * 8, 304);
    view.setUint32(0x118ac, 0x1a790);
    view.setUint32(0x118b0, 0xf202);
    word(0xf202, -6);
    word(0xf204, -1);
    word(0xf206, 500);
    memory[0x1207c + 124 * 5] = 3;
    const model = readAmigaModelTables(memory);
    assert.deepEqual(model.jumpLeft, [[-5, -5]]);
    assert.deepEqual(model.grenade, [[3, -4]]);
    assert.equal(model.jumpVertical[0], -4);
    assert.equal(model.jumpVertical[14], 4);
    assert.deepEqual(model.screens[0].pickups, [208, 40, 501, 0]);
    assert.equal(model.screens[124].pickups[0], 304);
    assert.equal(model.screens[124].barrierTypes[0], 3);
    assert.deepEqual(model.flyerPaths['0xf202'], [[-6, -1]]);
    assert.throws(() => readAmigaModelTables(memory.subarray(0, 0x122ec)), /bounds|size/i);
    view.setUint32(0x118b0, 0x122ec);
    assert.throws(() => readAmigaModelTables(memory), /bounds/i);
    assert.throws(() => extractAmigaModel(new Uint8Array(0x80000)), /checksum/i);
    assert.throws(() => extractAmigaModel(memory), /size/i);
});

test('Amiga committed model tables match the verified original-RAM extraction golden', () => {
    // Offline Disk.1 -> recoverAmigaMemory -> extractAmigaModel was compared
    // deeply and byte-for-byte with the generated constant. No disk is bundled.
    assert.equal(
        createHash('sha256').update(JSON.stringify(AMIGA_NATIVE)).digest('hex'),
        '8df2171fa78420cccfbd6bd8b03f376d6e2a4c282e351837829fdab126fb92f3',
    );
});

test('Amiga teleport starts idle and plays thirteen source frames once after transport', () => {
    const map = world();
    const tiles = [...map.screens[0].tiles];
    tiles[15 * 40 + 8] = 0x7b;
    tiles[15 * 40 + 28] = 0x7b;
    let state = createAmigaState({ screens: [{ tiles }] }, { invulnerable: true });
    assert.equal(state.teleportPhase, 13, 'source $f0b4 initially holds13');
    assert.equal(state.teleportFrame, -1, 'no effect before transport');
    state = stepAmiga(state, {}).state;
    assert.equal(state.teleportFrame, -1);
    state.player.x = 52;
    const transport = stepAmiga(state, { jump: true });
    assert.ok(transport.events.some((event) => event.type === 'teleport'));
    state = transport.state;
    assert.equal(state.player.x, 212);
    assert.equal(state.teleportPhase, 0, '$d5ae restarts the effect after an idle transport');
    assert.equal(state.teleportFrame, -1, 'source $d3da draws before player control');
    for (let frame = 0; frame < 13; frame++) {
        state = stepAmiga(state, {}).state;
        assert.equal(state.teleportFrame, frame);
        assert.equal(state.teleportPhase, frame + 1);
    }
    for (let tick = 0; tick < 30; tick++) {
        state = stepAmiga(state, {}).state;
        assert.equal(state.teleportFrame, -1, 'the completed effect never loops on its own');
        assert.equal(state.teleportPhase, 13);
    }
});

test('Amiga type-two turret fires the native double-projectile graphic and retains its bonus', () => {
    const original = JSON.parse(
        readFileSync(new URL('../../src/games/amiga/data/world.json', import.meta.url), 'utf8'),
    ) as AmigaWorld;
    let state = createAmigaState(original, {
        screenIndex: 3,
        seed: 0,
        seedHigh: 0,
        invulnerable: true,
    });
    state.entities = state.entities.filter((entity) => entity.kind === 'turret');
    assert.equal(state.entities[0].type, 2, 'original screen4 low double turret');
    const result = stepAmiga(state, {});
    state = result.state;
    const shot = state.entities.find((entity) => entity.kind === 'enemy-bullet');
    assert.ok(shot, 'source $b972 fires native state3, even though it also awards a bonus');
    // Independently executed $b8b4 with original state3, X240/Y24, seed0/0.
    assert.deepEqual([shot.x, shot.y, shot.type, shot.dx], [236, 36, 1, -12]);
    assert.equal(state.entities.find((entity) => entity.kind === 'turret')!.phase, 8);
    assert.ok(result.events.some((event) => event.type === 'enemy-shot'));
    state.player.x = 240;
    state.player.y = 56;
    const next = stepAmiga(state, {});
    assert.ok(next.events.some((event) => event.type === 'bonus' && event.value === 2000));
    assert.equal(
        next.state.entities.filter((entity) => entity.kind === 'enemy-bullet').length,
        1,
        'cannot fire when the hero is less than50px to the left',
    );
});

test('Amiga upper turret variants keep native muzzle heights without the low-turret distance rule', () => {
    for (const type of [0, 1]) {
        const state = createAmigaState(world(), { seed: 0, seedHigh: 0, invulnerable: true });
        state.player.x = 240;
        state.entities = [
            {
                id: 999,
                kind: 'turret',
                x: 240,
                y: 24,
                width: 64,
                height: 64,
                frame: 0,
                type,
                alive: true,
                phase: 4,
                dx: 0,
                dy: 0,
            },
        ];
        const shot = stepAmiga(state, {}).state.entities.find(
            (entity) => entity.kind === 'enemy-bullet',
        );
        assert.ok(shot, 'native states1/2 use $b9f0 without a distance gate');
        assert.deepEqual([shot.x, shot.y, shot.type], [240, type === 0 ? 47 : 30, 0]);
    }
});

test('Amiga guided rockets survive direct bullets and grenades', () => {
    for (const kind of ['bullet', 'grenade'] as const) {
        const state = createAmigaState(world());
        state.entities = [
            {
                id: 900,
                kind: 'hunter',
                x: 140,
                y: 100,
                width: 24,
                height: 15,
                frame: 0,
                type: 1,
                alive: true,
                phase: 0,
                dx: -5,
                dy: 0,
            },
            {
                id: 901,
                kind,
                x: kind === 'bullet' ? 132 : 137,
                y: kind === 'bullet' ? 100 : 104,
                width: 14,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: kind === 'bullet' ? 8 : 1,
                dy: 0,
                life: 10,
            },
        ];
        const next = stepAmiga(state, {});
        assert.ok(
            next.state.entities.some((entity) => entity.id === 900),
            `${kind} cannot shoot down the original guided rocket`,
        );
        assert.ok(
            next.state.entities.some((entity) => entity.id === 901),
            'no weapon collision is consumed',
        );
        assert.equal(next.state.score, 0);
    }
});

test('Amiga guided-rocket launcher requires a grenade and stops its active rocket', () => {
    for (const kind of ['bullet', 'grenade'] as const) {
        const tiles = [...world().screens[0].tiles];
        tiles[12 * 40 + 30] = 0xfb;
        const state = createAmigaState({ screens: [{ tiles }] });
        const launcher = state.entities.find((entity) => entity.kind === 'laser')!;
        state.entities.push(
            {
                id: 900,
                kind: 'hunter',
                x: 140,
                y: 100,
                width: 24,
                height: 15,
                frame: 0,
                type: 1,
                alive: true,
                phase: 0,
                dx: -5,
                dy: 0,
                parentId: launcher.id,
            },
            {
                id: 901,
                kind,
                x: launcher.x - (kind === 'bullet' ? 8 : 3),
                y: launcher.y + (kind === 'bullet' ? 0 : 4),
                width: 14,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: kind === 'bullet' ? 8 : 1,
                dy: 0,
                life: 10,
            },
        );
        const next = stepAmiga(state, {}).state;
        assert.equal(
            next.entities.some((entity) => entity.id === launcher.id),
            kind === 'bullet',
        );
        assert.equal(
            next.entities.some((entity) => entity.id === 900),
            kind === 'bullet',
        );
        assert.equal(next.score, kind === 'bullet' ? 0 : 150);
        assert.equal(next.tiles[12 * 40 + 30], 0xfb, 'native lower base remains after destruction');
    }
});

test('Amiga guided rocket moves with the previous speed before selecting its next acceleration stage', () => {
    for (const [x, speed, nextX, nextSpeed] of [
        [320, -5, 315, -4],
        [150, -4, 146, -6],
        [110, -6, 104, -7],
    ]) {
        const state = createAmigaState(world());
        state.entities = [
            {
                id: 900,
                kind: 'hunter',
                x,
                y: 135,
                width: 24,
                height: 15,
                frame: 0,
                type: 1,
                alive: true,
                phase: 0,
                dx: speed,
                dy: 0,
            },
        ];
        const rocket = stepAmiga(state, {}).state.entities.find((entity) => entity.id === 900)!;
        assert.deepEqual([rocket.x, rocket.y, rocket.dx], [nextX, 137, nextSpeed]);
    }
});

test('Amiga destroyed structures disperse the original fragment pool instead of a generic flash', () => {
    const reference = JSON.parse(
        readFileSync(new URL('../../research/amiga-projectiles.json', import.meta.url), 'utf8'),
    ) as {
        bursts: Record<
            string,
            Record<string, { x: number; y: number; direction: number; style: number }[]>
        >;
    };
    for (const [kind, type, profile] of [
        ['barrier', 0, 'barrier'],
        ['turret', 0, 'turret0'],
        ['turret', 1, 'turret1'],
        ['pod', 0, 'pod'],
        ['laser', 0, 'launcher'],
        ['laser', 1, 'laserWall'],
    ] as const) {
        let state = createAmigaState(world(), { invulnerable: true });
        state.nextEntityId = 1000;
        state.entities = [
            {
                id: 1,
                kind,
                type,
                x: 96,
                y: 64,
                width: 64,
                height: 64,
                phase: 4,
                frame: 0,
                alive: true,
                dx: 0,
                dy: 0,
                health: 1,
            },
            {
                id: 900,
                kind: type === 1 && kind === 'laser' ? 'bullet' : 'grenade',
                type: 0,
                x: 90,
                y: 72,
                width: 14,
                height: 6,
                phase: 9,
                frame: 0,
                alive: true,
                dx: kind === 'laser' && type === 1 ? 0 : 1,
                dy: 0,
                life: 15,
            },
        ];
        for (let tick = 1; tick <= 32; tick++) {
            const before = JSON.stringify(state);
            const next = stepAmiga(state, {});
            assert.equal(
                JSON.stringify(state),
                before,
                'fragment updates retain model immutability',
            );
            state = next.state;
            if (reference.bursts[profile][tick])
                assert.deepEqual(
                    state.entities
                        .filter((entity) => entity.kind === 'debris')
                        .map((entity) => ({
                            x: entity.x,
                            y: entity.y,
                            direction: entity.phase,
                            style: entity.type,
                        })),
                    reference.bursts[profile][tick],
                    `native $bedc/$bf3c ${profile} frame${tick}`,
                );
            assert.equal(
                state.entities.some((entity) => entity.kind === 'explosion' && entity.type === 0),
                false,
                'structures disintegrate into fragments without a substitute fireball',
            );
            assert.equal(
                state.entities.some((entity) => entity.kind === 'explosion' && entity.type === 1),
                profile === 'laserWall' && tick <= 8,
                'Only the laser wall retains the final bullet impact',
            );
        }
    }
});

test('Amiga overlapping destruction bursts respect the original210-slot pool without consuming gameplay randomness', () => {
    const state = createAmigaState(world());
    state.entities = [];
    const seed = [state.randomSeed, state.randomSeedHigh];
    const target = {
        id: 900,
        kind: 'barrier' as const,
        x: 96,
        y: 64,
        width: 64,
        height: 64,
        type: 0,
        frame: 0,
        phase: 0,
        dx: 0,
        dy: 0,
        alive: false,
    };
    spawnAmigaDebris(state, target);
    assert.equal(state.entities.length, 125);
    spawnAmigaDebris(state, target);
    assert.equal(state.entities.length, 210);
    spawnAmigaDebris(state, target);
    assert.equal(state.entities.length, 210);
    assert.equal(new Set(state.entities.map((entity) => entity.id)).size, 210);
    assert.deepEqual([state.randomSeed, state.randomSeedHigh], seed);
});

test('Amiga rockets launched near an entry edge move inward instead of disappearing', () => {
    const reference = JSON.parse(
        readFileSync(new URL('../../research/amiga-projectiles.json', import.meta.url), 'utf8'),
    ) as {
        rocketEdges: { startX: number; startY: number; direction: number; x: number; y: number }[];
    };
    for (const edge of reference.rocketEdges) {
        const state = createAmigaState(world(), { invulnerable: true });
        state.entities = [
            {
                id: 900,
                kind: 'grenade',
                x: edge.startX,
                y: edge.startY,
                width: 14,
                height: 6,
                type: 0,
                frame: 0,
                phase: 0,
                dx: edge.direction,
                dy: 0,
                alive: true,
            },
        ];
        const shot = stepAmiga(state, {}).state.entities.find((entity) => entity.id === 900);
        assert.ok(shot, 'original $c0ca checks only the forward exit edge');
        assert.deepEqual([shot.x, shot.y], [edge.x, edge.y]);
    }
});

test('Amiga pistons draw before advancing their original rise and retraction state', () => {
    const reference = JSON.parse(
        readFileSync(new URL('../../research/amiga-pistons.json', import.meta.url), 'utf8'),
    ) as { timeline: { tick: number; drawnHeight: number; height: number; phase: number }[] };
    let state = createAmigaState(world(), { seed: 0, seedHigh: 0, invulnerable: true });
    state.entities = [
        {
            id: 900,
            kind: 'spike',
            x: 96,
            y: 175,
            width: 32,
            height: 0,
            frame: 0,
            phase: 0,
            type: 0,
            dx: 0,
            dy: 0,
            alive: true,
        },
    ];
    for (const frame of reference.timeline) {
        state = stepAmiga(state, {}).state;
        const piston = state.entities.find((entity) => entity.id === 900)!;
        assert.deepEqual(
            [piston.frame, piston.height, piston.phase, piston.y],
            [frame.drawnHeight, frame.height, frame.phase, 175 - frame.height],
            `original $a3a6 state tick${frame.tick}`,
        );
    }
});

test('Amiga stepped mines emit the original orange burst once, with or without armor', () => {
    const reference = JSON.parse(
        readFileSync(new URL('../../research/amiga-projectiles.json', import.meta.url), 'utf8'),
    ) as {
        mine: {
            player: [number, number];
            tile: number;
            frames: Record<string, { x: number; y: number; direction: number; style: number }[]>;
        };
    };
    for (const armored of [false, true]) {
        const map = world();
        const tiles = [...map.screens[0].tiles];
        tiles[892] = 0xa2;
        let state = createAmigaState({ screens: [{ tiles }] });
        state.player.x = reference.mine.player[0];
        state.player.y = reference.mine.player[1];
        state.player.armored = armored;
        state.entities = state.entities.filter((entity) => entity.kind === 'mine');
        state = stepAmiga(state, {}).state;
        assert.equal(state.tiles[892], reference.mine.tile);
        assert.equal(state.lives, armored ? 9 : 8);
        assert.equal(
            state.entities.some((entity) => entity.kind === 'explosion'),
            false,
        );
        for (let tick = 0; tick <= 32; tick++) {
            if (tick) state = stepAmiga(state, {}).state;
            if (!reference.mine.frames[tick]) continue;
            const actual = state.entities
                .filter((entity) => entity.kind === 'debris')
                .map((entity) => ({
                    x: entity.x,
                    y: entity.y,
                    direction: entity.phase,
                    style: entity.type,
                }));
            assert.deepEqual(
                actual,
                reference.mine.frames[tick],
                `mine source frame${tick}, armored${armored}`,
            );
        }
        assert.equal(state.lives, armored ? 9 : 8, 'burst does not repeat or cause extra damage');
        assert.equal(state.entities.filter((entity) => entity.kind === 'mine').length, 1);
        assert.equal(state.entities.find((entity) => entity.kind === 'mine')!.type, 1);
    }
});

test('Amiga heavy rockets emit the original seven stationary smoke puffs in either direction', () => {
    const reference = JSON.parse(
        readFileSync(new URL('../../research/amiga-rocket-trail.json', import.meta.url), 'utf8'),
    ) as {
        directions: Record<
            string,
            { tick: number; slots: { x: number; y: number; life: number }[] }[]
        >;
    };
    for (const direction of [1, -1]) {
        let state = createAmigaState(world(), { invulnerable: true });
        state.entities = [
            {
                id: 999,
                kind: 'grenade',
                x: 96,
                y: 120,
                width: 14,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: direction,
                dy: 0,
            },
        ];
        for (const frame of reference.directions[String(direction)]) {
            const previous = JSON.stringify(state);
            const input = state;
            state = stepAmiga(input, {}).state;
            assert.equal(JSON.stringify(input), previous, 'Smoke updates preserve the prior frame');
            const puffs = state.entities
                .filter((entity) => entity.kind === 'rocket-trail' && entity.life! > 0)
                .sort((a, b) => a.path! - b.path!)
                .map(({ x, y, life }) => ({ x, y, life }));
            assert.deepEqual(puffs, frame.slots, `direction ${direction}, tick ${frame.tick}`);
            assert.equal(state.score, 0, 'Smoke cannot award points');
        }
        assert.equal(
            state.entities.some((entity) => entity.kind === 'rocket-trail'),
            false,
            'The final puff vanishes after its sixth frame',
        );
    }
});
