import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, step } from '../../src/model/state.ts';
import { readFileSync } from 'node:fs';

import type { GameScreen, MapObject, World, Placement, Rocket } from '../../src/types/game.ts';

const screen = (): GameScreen & { placements: Placement[] } => ({
    id: 0,
    placements: [],
    actions: [],
    tiles: Array.from({ length: 768 }, (_, i) => (i >= 576 ? { collision: 1, block: 33 } : null)),
});

test('bullet-only fire holds never charge rockets but allow an explicit rocket command', () => {
    let state = createState(screen());
    const bullets = { fire: true, chargeRocket: false };
    for (let i = 0; i < 40; i++) state = step(state, bullets).state;
    assert.equal(state.ammo, 98);
    assert.equal(state.grenades, 10);
    state = step(state, { ...bullets, rocket: true }).state;
    assert.equal(state.ammo, 98);
    assert.equal(state.grenades, 9);
});

test('native movement preserves original spawn, jump table and facing turn delay', () => {
    let state = createState(screen());
    assert.deepEqual(
        [state.player.x, state.player.y, state.ammo, state.grenades],
        [16, 112, 99, 10],
    );
    state = step(state, { right: true }).state;
    assert.equal(state.player.x, 17);
    state = step(state, { left: true }).state;
    assert.equal(state.player.x, 17); // Turning consumes the ground movement tick.
    assert.equal(state.player.direction, -1);
    state = step(state, { jump: true }).state;
    assert.equal(state.player.y, 108);
    for (let i = 0; i < 21; i++) state = step(state, {}).state;
    assert.equal(state.player.y, 112);
});

test('fire emits one shot on press and a grenade at the fifteenth held tick', () => {
    let state = createState(screen());
    let result = step(state, { fire: true });
    state = result.state;
    assert.equal(state.ammo, 98);
    assert.deepEqual(
        result.events.map((e) => e.type),
        ['shot'],
    );
    for (let i = 0; i < 13; i++) state = step(state, { fire: true }).state;
    assert.equal(state.grenades, 10);
    result = step(state, { fire: true });
    assert.equal(result.state.grenades, 9);
    assert.ok(result.events.some((e) => e.type === 'grenade'));
    state = step(result.state, {}).state;
    assert.equal(state.fireTicks, 0);
    state = step(state, { fire: true }).state;
    assert.equal(state.ammo, 97);
});

test('model steps do not mutate their input and respect walls and duck', () => {
    const initial = createState(screen());
    initial.screen.tiles[14 * 32 + 7] = { collision: 1, block: 24 };
    const result = step(initial, { right: true });
    assert.equal(result.state.player.x, 16);
    assert.equal(initial.tick, 0);
    assert.equal(initial.player.x, 16);
    assert.equal(step(initial, { duck: true, right: true }).state.player.x, 16);
});

test('destroying a turret does not freeze bullets that are already airborne', () => {
    const state = createState(screen());
    // This incomplete placement exercises destruction bookkeeping, which reads only block.
    state.screen.placements!.push({ block: 5 } as Placement);
    state.destroyed = [0];
    state.enemyBullets = [{ x: 60, y: 0 }];
    const result = step(state, {});
    assert.equal(result.state.enemyBullets[0].x, 58);
});

test('already launched bullets and the player rocket keep flying after an enemy kills the astronaut', () => {
    const state = createState(screen());
    state.bullets = [{ x: 50, y: 90, dx: 1 }];
    state.grenade = { x: 60, y: 80, dx: 1, phase: 20, projectileId: 1 };
    state.enemyBullets = [{ x: 30, y: 126, dx: -1 }];
    const killed = step(state, {}).state;
    assert.equal(killed.death, 46);
    assert.equal(killed.bullets[0].x, 55);
    assert.deepEqual([killed.grenade!.x, killed.grenade!.phase], [61, 19]);
    const before = JSON.stringify(killed);
    const next = step(killed, { fire: true }).state;
    assert.equal(next.death, 45);
    assert.equal(next.bullets[0].x, 60);
    assert.deepEqual([next.grenade!.x, next.grenade!.phase], [64, 16]);
    assert.equal(JSON.stringify(killed), before);
});

test('an airborne bullet still destroys its target and awards points after the astronaut is killed', () => {
    const state = createState(screen());
    state.bullets = [{ x: 50, y: 94, dx: 1 }];
    state.enemies = [
        {
            x: 62,
            y: 90,
            kind: 'flying',
            sprite: 16,
            phase: 0,
            trajectory: [[0, 0]],
            trajectoryIndex: 0,
        },
    ];
    state.enemyBullets = [{ x: 30, y: 126, dx: -1 }];
    const killed = step(state, {}).state;
    assert.equal(killed.death, 46);
    assert.equal(killed.enemies.length, 1);
    const result = step(killed, {});
    assert.equal(result.state.enemies.length, 0);
    assert.equal(result.state.bullets.length, 0);
    assert.equal(result.state.score, 150);
    assert.equal(result.events.filter((event) => event.type === 'enemy-destroyed').length, 1);
    assert.deepEqual(
        result.events.filter((event) => event.type === 'hit').map((event) => event.weapon),
        ['bullet'],
    );
    assert.equal(step(result.state, {}).state.score, 150);
});

test('an airborne player rocket reaches and destroys a ground target during the death animation', () => {
    const map = screen();
    map.placements = [{ block: 5, x: 18, y: 10 }];
    map.tiles[10 * 32 + 18] = { collision: 3, block: 5, instance: 0 };
    const state = createState(map);
    state.grenade = { x: 66, y: 80, dx: 1, phase: 20, projectileId: 1 };
    state.enemyBullets = [{ x: 30, y: 126, dx: -1 }];
    const killed = step(state, {}).state;
    assert.equal(killed.death, 46);
    assert.equal(killed.grenade!.x, 67);
    const result = step(killed, {});
    assert.equal(result.state.grenade, null);
    assert.deepEqual(result.state.destroyed, [0]);
    assert.equal(result.state.objects[0].active, false);
    assert.equal(result.state.score, 150);
    assert.equal(result.events.filter((event) => event.type === 'object-destroyed').length, 1);
    assert.deepEqual(
        result.events.filter((event) => event.type === 'hit').map((event) => event.weapon),
        ['rocket'],
    );
});

test('continuing airborne weapons does not allow firing new ammunition during death', () => {
    const state = createState(screen());
    state.enemyBullets = [{ x: 30, y: 126, dx: -1 }];
    let killed = step(state, {}).state;
    for (let tick = 0; tick < 20; tick++) {
        const result = step(killed, { fire: true });
        killed = result.state;
        assert.ok(killed.death > 0);
        assert.equal(killed.ammo, 99);
        assert.equal(killed.grenades, 10);
        assert.equal(killed.bullets.length, 0);
        assert.equal(killed.grenade, null);
        assert.equal(
            result.events.some((event) => ['shot', 'grenade'].includes(event.type)),
            false,
        );
    }
});

test('initial jump cannot enter a solid ceiling', () => {
    const state = createState(screen());
    state.screen.tiles[13 * 32 + 4] = { collision: 1, block: 24 };
    const result = step(state, { jump: true });
    assert.equal(result.state.player.y, 112);
    assert.equal(result.state.player.jump, -1);
});

const world = (): World => ({
    screens: Array.from({ length: 125 }, (_, id) => ({ ...screen(), id })),
});
const marker = (type: number, x: number, y: number, instance = 0): MapObject => ({
    id: 0,
    type,
    x,
    y,
    instance,
    block: 0,
});

test('campaign exits advance through all 125 source layouts while preserving supplies', () => {
    let state = createState(world());
    state.ammo = 37;
    state.grenades = 4;
    state.lives = 6;
    for (let id = 1; id < 125; id++) {
        state.player.x = 127;
        state.player.y = 112;
        state.player.falling = false;
        const result = step(state, { right: true });
        state = result.state;
        if (state.status === 'bonus') {
            assert.equal(state.screenIndex, id - 1);
            state = step(state, {}).state;
            state = step(state, { fire: true }).state;
        }
        assert.equal(state.screen.id, id);
        assert.equal(state.screenIndex, id);
        assert.equal(state.stage, Math.floor(id / 25) + 1);
        assert.equal(state.level, (id % 25) + 1);
        assert.equal(state.status, 'playing');
        assert.ok(result.events.some((event) => event.type === 'screen' || event.type === 'stage'));
    }
    assert.deepEqual([state.ammo, state.grenades, state.lives], [99, 10, 9]);
    state.player.x = 127;
    state.player.y = 112;
    assert.equal(step(state, { right: true }).state.status, 'won');
});

test('ordinary screen change preserves ammo, grenades, lives, suit and entrance height', () => {
    const state = createState(world());
    Object.assign(state, { ammo: 37, grenades: 4, lives: 6, exoskeleton: true });
    state.player.x = 127;
    const result = step(state, { right: true });
    assert.deepEqual(
        [
            result.state.ammo,
            result.state.grenades,
            result.state.lives,
            result.state.exoskeleton,
            result.state.player.x,
            result.state.player.y,
        ],
        [37, 4, 6, true, 0, 112],
    );
    assert.equal(state.screenIndex, 0);
});

test('stage gate awards life and bravery bonus, replenishes and starts at original coordinates', () => {
    const maps = world();
    maps.screens[24].objects = [marker(16, 24, 18)];
    const state = createState(maps, { screenIndex: 24 });
    Object.assign(state, { ammo: 3, grenades: 1, lives: 6, score: 150 });
    state.player.x = 96;
    let result = step(state, {});
    assert.equal(result.state.status, 'bonus');
    assert.equal(result.state.score, 16150);
    assert.ok(result.events.some((event) => event.type === 'stage'));
    result = step(result.state, {});
    result = step(result.state, { fire: true });
    assert.equal(result.state.screenIndex, 25);
    assert.deepEqual([result.state.player.x, result.state.player.y], [0, 120]);
    assert.deepEqual([result.state.ammo, result.state.grenades, result.state.lives], [99, 10, 7]);
});

test('stage roulette needs a released fire key and awards original alternating bonus values', () => {
    let state = createState(world(), { screenIndex: 24 });
    state.player.x = 127;
    state = step(state, { right: true, fire: true }).state;
    assert.equal(state.status, 'bonus');
    const baseScore = state.score;
    state = step(state, { fire: true }).state;
    assert.equal(state.status, 'bonus');
    assert.equal(state.bonus!.armed, false);
    state = step(state, {}).state;
    state.bonus!.cursor = 6;
    const result = step(state, { fire: true });
    assert.equal(result.state.status, 'playing');
    assert.equal(result.state.score, baseScore + 7000);
    assert.equal(result.state.screenIndex, 25);
    assert.ok(result.events.some((event) => event.type === 'bonus' && event.points === 7000));
});

test('held powered rockets clear both first-screen obstacles and allow the original exit', () => {
    const campaign: World = JSON.parse(
        readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    let state = createState(campaign);
    const destroyed = [];
    for (let tick = 0; tick < 180 && !state.screenIndex; tick++) {
        const result = step(state, { right: true, fire: true });
        for (const event of result.events)
            if (event.type === 'object-destroyed') destroyed.push(event.instance);
        state = result.state;
    }
    assert.equal(state.screenIndex, 1);
    assert.deepEqual(destroyed, [8, 7]);
    assert.equal(state.lives, 9);
});

test('exoskeleton does not protect against original machine-gun bullets', () => {
    const state = createState(screen());
    state.exoskeleton = true;
    state.enemyBullets = [{ x: 24, y: 126, dx: -1 }];
    assert.equal(step(state, {}).state.death, 46);
});

test('original inclusive contact bounds consume a colliding enemy and award its destruction score', () => {
    const state = createState(screen());
    state.enemies = [
        {
            x: 27,
            y: 120,
            kind: 'flying',
            sprite: 16,
            phase: 0,
            trajectory: [[-1, 0]],
            trajectoryIndex: 0,
        },
    ];
    const result = step(state, {});
    assert.equal(result.state.death, 46);
    assert.equal(result.state.enemies.length, 0);
    assert.equal(result.state.score, 150);
});

test('a machine gun bullet touching the original player edge is lethal', () => {
    const state = createState(screen());
    state.enemyBullets = [{ x: 30, y: 126, dx: -1 }];
    const result = step(state, {});
    assert.equal(result.state.death, 46);
    assert.equal(result.state.enemyBullets.length, 0);
});

test('beam requires 25 ordinary hits, then clears its collision column and awards 1000 points', () => {
    const map = screen();
    map.objects = [marker(17, 10, 2)];
    let state = createState(map);
    for (let shot = 0; shot < 24; shot++) {
        state = step(state, { fire: true }).state;
        for (let tick = 0; tick < 4; tick++) state = step(state, {}).state;
    }
    assert.equal(state.objects[0].active, true);
    assert.equal(state.objects[0].hits, 24);
    state = step(state, { fire: true }).state;
    for (let tick = 0; tick < 4; tick++) state = step(state, {}).state;
    assert.equal(state.objects[0].active, false);
    assert.equal(state.score, 1000);
    for (let tick = 0; tick < 50; tick++) state = step(state, { right: true }).state;
    assert.ok(state.player.x > 40);
});

test('launcher rockets move two logical units and a player shot intercepts them for 50 points', () => {
    const state = createState(screen());
    state.rockets = [{ x: 60, y: 80, dx: -2, kind: 'launcher' }];
    const moved = step(state, {}).state;
    assert.equal(moved.rockets[0].x, 58);
    moved.bullets = [{ x: 56, y: 84, dx: 1 }];
    const hit = step(moved, {}).state;
    assert.equal(hit.rockets.length, 0);
    assert.equal(hit.score, 50);
});

test('final source gate ends campaign and equipped suit forfeits bravery bonus', () => {
    const maps = world();
    maps.screens[124].objects = [marker(16, 24, 18)];
    const state = createState(maps, { screenIndex: 124 });
    state.player.x = 96;
    state.exoskeleton = true;
    const result = step(state, {});
    assert.equal(result.state.status, 'won');
    assert.equal(result.state.score, 9000);
    assert.ok(result.events.some((event) => event.type === 'victory'));
});

test('refill boxes are consumed once and rooms toggle double fire on a fresh jump press', () => {
    const map = screen();
    map.objects = [marker(7, 5, 16), { ...marker(12, 5, 13), id: 1 }];
    let state = createState(map);
    state.ammo = 1;
    let result = step(state, { jump: true });
    state = result.state;
    assert.equal(state.ammo, 99);
    assert.equal(state.exoskeleton, true);
    assert.equal(state.player.y, 112);
    state = step(state, { jump: true }).state;
    assert.equal(state.exoskeleton, true);
    state = step(state, {}).state;
    result = step(state, { fire: true });
    assert.equal(result.state.bullets.length, 2);
    assert.equal(result.state.ammo, 98);
    assert.equal(result.state.bullets[1].y - result.state.bullets[0].y, 6);
});

test('teleport exchanges exact paired positions and requires releasing jump before returning', () => {
    const map = screen();
    map.objects = [marker(6, 5, 13), { ...marker(6, 20, 13), id: 1 }];
    let state = createState(map);
    const result = step(state, { jump: true });
    state = result.state;
    assert.equal(state.player.x, 77);
    assert.equal(state.player.y, 112);
    assert.ok(result.events.some((event) => event.type === 'teleport'));
    assert.equal(step(state, { jump: true }).state.player.x, 77);
    state = step(state, {}).state;
    assert.equal(step(state, { jump: true }).state.player.x, 17);
});

test('flying enemies follow decoded source trajectory and bullets destroy them for 150 points', () => {
    const maps = world();
    maps.enemies = [
        {
            screen: 0,
            sprite: 16,
            delay: 20,
            trajectory: [
                [-1, 0],
                [-1, -2],
            ],
        },
    ];
    const state = createState(maps);
    state.enemies = [
        {
            x: 60,
            y: 50,
            kind: 'flying',
            sprite: 16,
            phase: 0,
            trajectory: maps.enemies[0].trajectory,
            trajectoryIndex: 0,
        },
    ];
    const moved = step(state, {}).state;
    assert.deepEqual([moved.enemies[0].x, moved.enemies[0].y], [59, 50]);
    moved.bullets = [{ x: 58, y: 55, dx: 1 }];
    const result = step(moved, {});
    assert.equal(result.state.enemies.length, 0);
    assert.equal(result.state.score, 150);
    assert.ok(result.events.some((event) => event.type === 'enemy-destroyed'));
    assert.equal(state.enemies[0].x, 60);
});

test('rocket keeps its last descending phase and accelerates only below original phase 19', () => {
    let state = createState(screen());
    state.grenade = { x: 30, y: 20, dx: 1, phase: 32 };
    state = step(state, {}).state;
    assert.deepEqual([state.grenade!.x, state.grenade!.y, state.grenade!.phase], [31, 16, 31]);
    state.grenade = { x: 30, y: 20, dx: 1, phase: 19 };
    state = step(state, {}).state;
    assert.deepEqual([state.grenade!.x, state.grenade!.y, state.grenade!.phase], [33, 20, 16]);
    state.grenade = { x: 30, y: 20, dx: 1, phase: 1 };
    state = step(state, {}).state;
    assert.deepEqual([state.grenade!.x, state.grenade!.y, state.grenade!.phase], [33, 23, 1]);
});

test('powered rocket follows the complete original opening arc before horizontal acceleration', () => {
    let state = createState(screen());
    state.grenade = { x: 30, y: 80, dx: 1, phase: 32 };
    const trajectory = [];
    for (let tick = 0; tick < 20; tick++) {
        state = step(state, {}).state;
        assert.ok(state.grenade && Number.isFinite(state.grenade.y));
        trajectory.push([state.grenade.x, state.grenade.y, state.grenade.phase]);
    }
    assert.deepEqual(trajectory, [
        [31, 76, 31],
        [32, 72, 30],
        [33, 70, 29],
        [34, 68, 28],
        [35, 66, 27],
        [36, 65, 26],
        [37, 64, 25],
        [38, 63, 24],
        [39, 62, 23],
        [40, 62, 22],
        [41, 62, 21],
        [42, 62, 20],
        [43, 62, 19],
        [46, 62, 16],
        [49, 62, 13],
        [52, 62, 10],
        [55, 62, 7],
        [58, 62, 4],
        [61, 62, 1],
        [64, 65, 1],
    ]);
});

test('projectile identifiers survive source steps and are never reused by a replacement launch', () => {
    const map = screen();
    map.objects = [marker(13, 25, 2)];
    let state = createState(map);
    state = step(state, {}).state;
    const hostileId = state.rockets[0].projectileId;
    assert.ok(Number.isInteger(hostileId));
    state = step(state, {}).state;
    assert.equal(state.rockets[0].projectileId, hostileId);
    state.rockets = [];
    state = step(state, {}).state;
    assert.notEqual(state.rockets[0].projectileId, hostileId);
    state.fireTicks = 14;
    state = step(state, { fire: true }).state;
    const grenadeId = state.grenade!.projectileId;
    assert.ok(Number.isInteger(grenadeId));
    assert.notEqual(grenadeId, state.rockets[0].projectileId);
    state = step(state, {}).state;
    assert.equal(state.grenade!.projectileId, grenadeId);
    state.grenade = null;
    state.fireTicks = 14;
    state = step(state, { fire: true }).state;
    assert.notEqual(state.grenade!.projectileId, grenadeId);
});

test('mines are spent by contact, suit protects against mines but not hostile rockets', () => {
    const map = screen();
    map.objects = [marker(5, 5, 18)];
    let state = createState(map);
    assert.equal(step(state, {}).state.death, 46);
    state.exoskeleton = true;
    let result = step(state, {});
    assert.equal(result.state.death, 0);
    assert.equal(result.state.objects[0].active, false);
    state = result.state;
    state.rockets = [{ x: 22, y: 120, dx: -2, kind: 'launcher' }];
    result = step(state, {});
    assert.equal(result.state.death, 46);
});

test('death respawns at current screen entrance and preserves scene and suit', () => {
    let state = createState(world(), { screenIndex: 2 });
    state.player.y = 96;
    state.entrance = { x: 0, y: 96 };
    Object.assign(state, {
        death: 1,
        lives: 3,
        ammo: 4,
        grenades: 1,
        exoskeleton: true,
        destroyed: [2],
    });
    const result = step(state, {});
    state = result.state;
    assert.deepEqual(
        [
            state.screenIndex,
            state.player.x,
            state.player.y,
            state.lives,
            state.ammo,
            state.grenades,
        ],
        [2, 0, 112, 2, 99, 10],
    );
    assert.equal(state.exoskeleton, true);
    assert.deepEqual(state.destroyed, [2]);
});

test('a lethal hit aligns the original player Y without moving X', () => {
    const state = createState(screen());
    Object.assign(state.player, { x: 50, y: 115, jump: 9, walk: 0 });
    state.enemyBullets = [{ x: 60, y: 130, dx: -1 }];
    const result = step(state, {});
    assert.equal(result.state.death, 46);
    assert.deepEqual([result.state.player.x, result.state.player.y], [50, 112]);
    assert.deepEqual([state.player.x, state.player.y], [50, 115]);
});

test('death follows the source hop, holds on the floor and respawns on update 46', () => {
    let state = createState(screen());
    state.enemyBullets = [{ x: 24, y: 126, dx: -1 }];
    state = step(state, {}).state;
    state.ammo = 37;
    state.grenades = 4;
    // Source death table at 0x9D4A, consumed backwards before the final respawn.
    const expectedY = [
        108, 104, 102, 100, 98, 97, 96, 95, 94, 94, 94, 94, 94, 95, 96, 97, 98, 100, 102, 104, 108,
        112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112, 112,
        112, 112, 112, 112, 112, 112,
    ];
    for (let tick = 0; tick < expectedY.length; tick++) {
        const result = step(state, { right: true, jump: true, duck: true, fire: true });
        state = result.state;
        assert.equal(state.player.y, expectedY[tick], `death update ${tick + 1}`);
        assert.equal(state.death, 45 - tick);
        assert.deepEqual(
            [state.player.x, state.player.direction, state.player.duck],
            [16, 1, false],
        );
        assert.deepEqual([state.ammo, state.grenades, state.lives], [37, 4, 9]);
        assert.deepEqual(result.events, []);
    }
    const result = step(state, { right: true, jump: true, fire: true });
    assert.deepEqual(
        [
            result.state.death,
            result.state.player.x,
            result.state.player.y,
            result.state.lives,
            result.state.ammo,
            result.state.grenades,
        ],
        [0, 16, 112, 8, 99, 10],
    );
    assert.deepEqual(
        result.events.map((event) => event.type),
        ['respawn'],
    );
});

test('an airborne death falls past the hit height and stops on a lower floor', () => {
    const map = screen();
    map.tiles = map.tiles.map((_, index) => (index >= 640 ? { collision: 1, block: 33 } : null));
    let state = createState(map);
    state.player.y = 80;
    state.death = 46;
    const checkpoints = new Map([
        [9, 62],
        [22, 80],
        [23, 84],
        [34, 128],
        [45, 128],
    ]);
    for (let tick = 1; tick <= 45; tick++) {
        state = step(state, {}).state;
        if (checkpoints.has(tick))
            assert.equal(state.player.y, checkpoints.get(tick), `death update ${tick}`);
    }
    assert.equal(state.death, 1);
    assert.equal(state.lives, 9);
});

test('the death hop ignores a solid ceiling and homing rockets follow its actual Y', () => {
    const map = screen();
    map.tiles[13 * 32 + 4] = { collision: 1, block: 24 };
    let state = createState(map);
    state.death = 46;
    // Homing movement derives its direction from the target, so this fixture omits dx.
    state.rockets = [{ x: 100, y: 110, kind: 'homing' } as Rocket];
    state = step(state, {}).state;
    assert.equal(state.player.y, 108);
    assert.equal(state.rockets[0].y, 109);
    state = step(state, {}).state;
    assert.equal(state.player.y, 104);
});

test('death movement retains unsigned byte wrapping above and below the screen', () => {
    const rising = createState(screen());
    rising.player.y = 0;
    rising.death = 46;
    assert.equal(step(rising, {}).state.player.y, 252);
    const falling = createState(screen());
    falling.player.y = 252;
    falling.death = 26;
    assert.equal(step(falling, {}).state.player.y, 0);
});

test('browser campaign contains all original layouts, source objects and flying enemy definitions', () => {
    const recovered: World = JSON.parse(
        readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    assert.equal(recovered.screens.length, 125);
    assert.equal(recovered.enemies!.length, 70);
    assert.equal(
        recovered.screens.filter((map) => map.objects!.some((object) => object.type === 16)).length,
        5,
    );
    assert.ok(recovered.screens[2].objects!.some((object) => object.type === 10));
    assert.ok(recovered.screens[0].tiles.some((tile) => tile?.ink));
    assert.ok(recovered.enemies!.every((enemy) => enemy.trajectory.length > 1));
});
