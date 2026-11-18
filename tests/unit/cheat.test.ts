import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, step } from '../../src/model/state.ts';
import * as model from '../../src/model/state.ts';
const floor = () => ({
    tiles: Array.from({ length: 768 }, (_, i) => (i >= 576 ? { collision: 1, block: 33 } : null)),
    objects: [],
});

test('CHEAT MODE survives a lethal bullet that kills an ordinary astronaut', () => {
    for (const cheatMode of [false, true]) {
        const state = createState(floor(), { cheatMode });
        state.enemyBullets = [{ x: 18, y: 120, dx: 0 }];
        const hit = step(state, {}).state;
        assert.equal(hit.death, cheatMode ? 0 : 46);
        assert.equal(hit.lives, 9);
    }
});

test('an immortal astronaut falling outside the field returns without losing a life', () => {
    const state = createState(floor(), { cheatMode: true });
    state.player.y = 180;
    const fallen = step(state, {}).state;
    assert.equal(fallen.death, 0);
    assert.equal(fallen.lives, 9);
    assert.deepEqual({ x: fallen.player.x, y: fallen.player.y }, state.entrance);
});

test('cheat screen selection keeps supplies and resets danger while respecting bounds and normal mode', () => {
    const world = { screens: Array.from({ length: 125 }, floor) };
    const ordinary = createState(world);
    assert.equal(model.selectCheatScreen(ordinary, 25), ordinary);
    const state = createState(world, { cheatMode: true });
    Object.assign(state, {
        score: 1234,
        lives: 7,
        ammo: 24,
        grenades: 3,
        death: 46,
        bonus: { cursor: 2 },
        status: 'bonus',
    });
    state.enemyBullets = [{ x: 10, y: 10 }];
    state.destroyed = [2];
    const next = model.selectCheatScreen(state, 25);
    assert.equal(next.screenIndex, 25);
    assert.equal(next.stage, 2);
    assert.equal(next.level, 1);
    assert.deepEqual([next.score, next.lives, next.ammo, next.grenades], [1234, 7, 24, 3]);
    assert.equal(next.status, 'playing');
    assert.equal(next.death, 0);
    assert.equal(next.bonus, null);
    assert.deepEqual(next.enemyBullets, []);
    assert.deepEqual(next.destroyed, []);
    assert.equal(next.cheatMode, true);
    assert.equal(model.selectCheatScreen(next, 999).screenIndex, 124);
    assert.equal(model.selectCheatScreen(next, -1).screenIndex, 0);
    assert.equal(model.selectCheatScreen(next, NaN), next);
    assert.equal(state.screenIndex, 0);
    assert.equal(state.death, 46);
});

test('CHEAT MODE keeps ammunition through more shots than the ordinary magazine holds', () => {
    let state = createState(floor(), { cheatMode: true }),
        shots = 0;
    for (let press = 0; press < 130; press++) {
        const result = step(state, { fire: true });
        state = result.state;
        shots += result.events.filter((event) => event.type === 'shot').length;
        state = step(state, {}).state;
    }
    assert.equal(shots, 130);
    assert.equal(state.ammo, 99);
});

test('empty cheat supplies still fire and launch more than ten rockets with the original delay', () => {
    let state = createState(floor(), { cheatMode: true });
    state.ammo = 0;
    state.grenades = 0;
    state.exoskeleton = true;
    const first = step(state, { fire: true });
    state = first.state;
    assert.equal(first.events.filter((event) => event.type === 'shot').length, 1);
    assert.equal(state.bullets.length, 2);
    for (let tick = 1; tick < 14; tick++) {
        state = step(state, { fire: true }).state;
        assert.equal(state.grenade, null);
    }
    let launches = 0;
    for (let tick = 0; tick < 1000; tick++) {
        const result = step(state, { fire: true });
        state = result.state;
        launches += result.events.filter((event) => event.type === 'grenade').length;
    }
    assert.ok(launches > 10);
    assert.equal(state.ammo, 0);
    assert.equal(state.grenades, 0);
});

test('ordinary empty supplies remain empty and loaded supplies still decrease', () => {
    let empty = createState(floor());
    empty.ammo = 0;
    empty.grenades = 0;
    for (let tick = 0; tick < 30; tick++) {
        const result = step(empty, { fire: true });
        empty = result.state;
        assert.equal(
            result.events.some((event) => event.type === 'shot' || event.type === 'grenade'),
            false,
        );
    }
    let loaded = createState(floor());
    for (let tick = 0; tick < 15; tick++) loaded = step(loaded, { fire: true }).state;
    assert.equal(loaded.ammo, 98);
    assert.equal(loaded.grenades, 9);
});

test('infinite lives allows death and repeated respawn without spending the last life', () => {
    let state = createState(floor(), { cheats: { infiniteLives: true } });
    state.lives = 1;
    for (let attempt = 0; attempt < 3; attempt++) {
        state.invulnerable = 0;
        state.enemyBullets = [{ x: state.player.x + 2, y: state.player.y + 8, dx: 0 }];
        state = step(state, {}).state;
        assert.equal(state.death, 46);
        for (let tick = 0; tick < 46; tick++) state = step(state, {}).state;
        assert.equal(state.lives, 1);
        assert.equal(state.status, 'playing');
        assert.equal(state.death, 0);
    }
});

test('invulnerability alone blocks death without providing ammunition or rockets', () => {
    let state = createState(floor(), { cheats: { invulnerable: true } });
    state.ammo = 0;
    state.grenades = 0;
    state.enemyBullets = [{ x: 18, y: 120, dx: 0 }];
    for (let tick = 0; tick < 30; tick++) {
        const result = step(state, { fire: true });
        state = result.state;
        assert.equal(state.death, 0);
        assert.equal(
            result.events.some((event) => event.type === 'shot' || event.type === 'grenade'),
            false,
        );
    }
    state.player.y = 180;
    state = step(state, {}).state;
    assert.deepEqual({ x: state.player.x, y: state.player.y }, state.entrance);
});

test('infinite bullets fires an empty weapon but neither supplies rockets nor prevents death', () => {
    let state = createState(floor(), { cheats: { infiniteAmmo: true } });
    state.ammo = 0;
    state.grenades = 0;
    let shots = 0,
        rockets = 0;
    for (let tick = 0; tick < 30; tick++) {
        const result = step(state, { fire: true });
        state = result.state;
        shots += result.events.filter((event) => event.type === 'shot').length;
        rockets += result.events.filter((event) => event.type === 'grenade').length;
    }
    assert.equal(shots, 1);
    assert.equal(rockets, 0);
    assert.equal(state.ammo, 0);
    state.enemyBullets = [{ x: state.player.x + 2, y: state.player.y + 8, dx: 0 }];
    assert.equal(step(state, {}).state.death, 46);
});

test('infinite rockets launches an empty stock with the normal delay while bullets are spent', () => {
    let state = createState(floor(), { cheats: { infiniteRockets: true } });
    state.grenades = 0;
    state.ammo = 2;
    let rockets = 0;
    for (let tick = 0; tick < 15; tick++) {
        const result = step(state, { fire: true });
        state = result.state;
        rockets += result.events.filter((event) => event.type === 'grenade').length;
        if (tick < 14) assert.equal(rockets, 0);
    }
    assert.equal(rockets, 1);
    assert.equal(state.grenades, 0);
    assert.equal(state.ammo, 1);
});

test('level selection alone retains selected options and does not grant invulnerability', () => {
    const world = { screens: Array.from({ length: 125 }, floor) };
    let state = createState(world, { cheats: { levelSelection: true } });
    state = model.selectCheatScreen(state, 25);
    assert.equal(state.screenIndex, 25);
    assert.equal(state.cheatUsed, true);
    state.enemyBullets = [{ x: state.player.x + 2, y: state.player.y + 8, dx: 0 }];
    assert.equal(step(state, {}).state.death, 46);
    const ammoOnly = createState(world, { cheats: { infiniteAmmo: true } });
    assert.equal(model.selectCheatScreen(ammoOnly, 25), ammoOnly);
});

test('changing cheats takes effect immediately and retains cheat usage metadata after disabling', () => {
    const ordinary = createState(floor());
    let state = model.setCheats(ordinary, { infiniteAmmo: true });
    state.ammo = 1;
    state = step(state, { fire: true }).state;
    assert.equal(state.ammo, 1);
    assert.equal(state.cheatUsed, true);
    state = step(state, {}).state;
    state = model.setCheats(state, {});
    assert.equal(state.cheatMode, false);
    assert.equal(state.cheatUsed, true);
    state = step(state, { fire: true }).state;
    assert.equal(state.ammo, 0);
    assert.equal(ordinary.cheatUsed, false);
});

test('selecting a level after game over starts with fresh lives instead of reviving an exhausted run', () => {
    const world = { screens: Array.from({ length: 125 }, floor) };
    let state = createState(world, { cheats: { levelSelection: true } });
    state.lives = 1;
    state.death = 1;
    state.score = 2000;
    state = step(state, {}).state;
    assert.equal(state.status, 'over');
    assert.equal(state.lives, 0);
    state = model.selectCheatScreen(state, 1);
    assert.equal(state.lives, 9);
    assert.equal(state.score, 0);
    assert.equal(state.status, 'playing');
    assert.equal(state.cheatUsed, true);
    state.death = 1;
    state = step(state, {}).state;
    assert.equal(state.lives, 8);
    assert.equal(state.status, 'playing');
});

test('retry-level cheat restarts the exhausted screen with fresh resources without granting immortality', () => {
    const world = { screens: Array.from({ length: 125 }, floor) };
    let state = createState(world, { screenIndex: 36, cheats: { retryLevel: true } });
    assert.equal(state.cheatMode, true);
    assert.equal(state.cheatUsed, true);
    state.lives = 1;
    state.death = 1;
    state.score = 5000;
    state.ammo = 2;
    state.grenades = 0;
    state.exoskeleton = true;
    state = step(state, {}).state;
    assert.equal(state.status, 'over');
    assert.equal(state.lives, 0);
    const next = model.restartState(state);
    assert.equal(next.screenIndex, 36);
    assert.equal(next.status, 'playing');
    assert.equal(next.cheats.retryLevel, true);
    assert.deepEqual(
        [next.lives, next.ammo, next.grenades, next.score, next.exoskeleton],
        [9, 99, 10, 0, false],
    );
    assert.equal(state.status, 'over');
    assert.equal(state.lives, 0);
    next.enemyBullets = [{ x: next.player.x + 2, y: next.player.y + 8, dx: 0 }];
    assert.equal(step(next, {}).state.death, 46);
});

test('retry cheat applies to game over, preserves manual selection otherwise and leaves ordinary restart alone', () => {
    const world = { screens: Array.from({ length: 125 }, floor) };
    const ordinary = createState(world, { screenIndex: 36 });
    ordinary.status = 'over';
    assert.equal(model.restartState(ordinary).screenIndex, 0);
    const chosen = createState(world, {
        screenIndex: 36,
        cheats: { levelSelection: true, retryLevel: true },
    });
    assert.equal(model.restartState(chosen, { selectedScreen: 25 }).screenIndex, 25);
    chosen.status = 'won';
    assert.equal(model.restartState(chosen, { selectedScreen: 25 }).screenIndex, 25);
    chosen.status = 'over';
    assert.equal(model.restartState(chosen, { selectedScreen: 25 }).screenIndex, 36);
});
