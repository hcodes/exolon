import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Box3, Raycaster, Vector3 } from 'three';
import { describeVrScene } from '../../src/games/vr/model/scene.ts';
import { createVrActors } from '../../src/games/vr/view/entities.ts';
import { createVrHero } from '../../src/games/vr/view/hero.ts';
import { createVrResources } from '../../src/games/vr/view/materials.ts';
import { createVrObject, disposeVrScreen } from '../../src/games/vr/view/terrain.ts';
import { createState, step } from '../../src/model/state.ts';
import type { GameState, World } from '../../src/types/game.ts';

const world = JSON.parse(
    readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
) as World;

function bootBounds(hero: ReturnType<typeof createVrHero>) {
    hero.group.updateMatrixWorld(true);
    return ['near-boot', 'far-boot'].map((name) => {
        const boot = hero.group.getObjectByName(name);
        assert.ok(boot, name);
        return new Box3().setFromObject(boot, true);
    });
}

function assertGrounded(hero: ReturnType<typeof createVrHero>, state: GameState) {
    // First-map collision starts at pixel y=144: the sprite is 32px tall,
    // with its drawing origin at y+16. Scene y increases upwards from 176.
    assert.equal(state.player.y, 112);
    const bounds = bootBounds(hero);
    for (const boot of bounds) {
        assert.ok(boot.min.y >= 31.99, `Sole penetrates the floor: ${boot.min.y}`);
    }
    // The shared motion eases into gait by blending ankle targets; the small
    // transition clearance is below 0.06px, rather than a permanent foot gap.
    const support = Math.min(...bounds.map((boot) => boot.min.y));
    assert.ok(support <= 32.065, `No boot supports the astronaut: ${support}`);
}

test('VR boots stand within the terrain depth instead of beyond its front edge', () => {
    const resources = createVrResources();
    try {
        for (const direction of [-1, 1] as const) {
            const state = createState(world);
            state.player.direction = direction;
            const hero = createVrHero(resources);
            hero.update(state, 0, 0);
            for (const boot of bootBounds(hero)) {
                assert.ok(boot.min.z >= -7 && boot.max.z <= 6, 'Both feet sit on the rock depth');
            }
        }
    } finally {
        resources.dispose();
    }
});

test('VR idle and crouched soles meet the first-map collision floor in both directions', () => {
    const resources = createVrResources();
    try {
        for (const direction of [-1, 1] as const) {
            for (const duck of [false, true]) {
                const state = createState(world);
                state.player.direction = direction;
                state.player.duck = duck;
                const before = JSON.stringify(state);
                const hero = createVrHero(resources);
                hero.update(state, 0, 0);
                assertGrounded(hero, state);
                assert.equal(JSON.stringify(state), before);
            }
        }
    } finally {
        resources.dispose();
    }
});

test('VR first-map soles contact the real extruded rock underneath both feet', () => {
    const resources = createVrResources();
    const state = createState(world);
    const ledge = describeVrScene(state).instances.find(
        (item) =>
            item.family === 'terrain' && item.tiles.some((tile) => tile.x === 32 && tile.y === 144),
    );
    assert.ok(ledge);
    const terrain = createVrObject(ledge, world, resources);
    terrain.updateMatrixWorld(true);
    const ray = new Raycaster();
    try {
        for (const direction of [-1, 1] as const) {
            for (const duck of [false, true]) {
                Object.assign(state.player, { direction, duck });
                const hero = createVrHero(resources);
                hero.update(state, 0, 0);
                for (const boot of bootBounds(hero)) {
                    const point = boot.getCenter(new Vector3());
                    point.y = 40;
                    ray.set(point, new Vector3(0, -1, 0));
                    const hit = ray.intersectObject(terrain, true)[0];
                    assert.ok(hit, 'There is supporting rock below each boot');
                    assert.ok(Math.abs(hit.point.y - 32) < 1e-6, 'Rock meets the collision floor');
                    assert.ok(Math.abs(boot.min.y - hit.point.y) < 0.01, 'Sole touches the rock');
                }
            }
        }
    } finally {
        disposeVrScreen(terrain);
        resources.dispose();
    }
});

test('VR boots keep contact through a complete model-driven stride and turn', () => {
    const resources = createVrResources();
    try {
        const hero = createVrHero(resources);
        let state = createState(world);
        hero.update(state, 0, 0);
        for (let tick = 1; tick <= 32; tick++) {
            state = step(state, tick <= 16 ? { right: true } : { left: true }).state;
            const before = JSON.stringify(state);
            const start = (tick * 1000) / 30;
            for (const offset of [0, 8, 16, 25, 33]) {
                hero.update(state, offset / (1000 / 30), start + offset);
                assertGrounded(hero, state);
            }
            assert.equal(JSON.stringify(state), before);
        }
    } finally {
        resources.dispose();
    }
});

test('VR jumping and falling keep airborne soles instead of snapping them to terrain', () => {
    const resources = createVrResources();
    try {
        for (const falling of [false, true]) {
            for (const direction of [-1, 1] as const) {
                const state = createState(world);
                Object.assign(state.player, { y: 100, jump: falling ? -1 : 3, falling, direction });
                const before = JSON.stringify(state);
                const hero = createVrHero(resources);
                hero.update(state, 0.5, 0);
                const lowest = Math.min(...bootBounds(hero).map((boot) => boot.min.y));
                assert.ok(lowest > 44, 'Airborne legs retain their tucked pose above y+32');
                assert.equal(hero.group.position.y, 60, 'The original sprite origin follows y+16');
                assert.equal(JSON.stringify(state), before);
            }
        }
    } finally {
        resources.dispose();
    }
});

test('VR player shots leave the muzzle depth and retain their launch side after turning', () => {
    const resources = createVrResources();
    try {
        for (const { direction, depth } of [
            { direction: -1, depth: -3.4 },
            { direction: 1, depth: 3.4 },
        ]) {
            let state = createState(world);
            state.player.direction = direction;
            state = step(state, { fire: true, rocket: true }).state;
            assert.equal(state.bullets.length, 1, 'The model spawned a player bullet');
            assert.ok(state.grenade, 'The model spawned the player rocket');
            // Launcher/homing rockets belong to enemies, unlike the player's
            // powered grenade. Their existing presentation depth stays intact.
            state.enemyBullets.push({ x: 60, y: 80, dx: -1 });
            state.rockets.push({ kind: 'launcher', projectileId: 99, x: 80, y: 60, dx: -2 });
            const hero = createVrHero(resources);
            const actors = createVrActors(resources);
            const before = JSON.stringify(state);
            hero.update(state, 1, 0);
            hero.group.updateMatrixWorld(true);
            const muzzle = hero.group.getObjectByName('muzzle');
            assert.ok(muzzle);
            const emittedFrom = muzzle.getWorldPosition(new Vector3());
            assert.ok(Math.abs(emittedFrom.z - depth) < 1e-6);
            actors.update(state, 1, 0);
            for (const kind of ['bullet', 'grenade']) {
                const shot = actors.group.getObjectByName(kind);
                assert.ok(shot?.visible, kind);
                assert.ok(
                    Math.abs(shot.position.z - emittedFrom.z) < 1e-6,
                    `${kind} leaves the gun`,
                );
            }
            assert.equal(actors.group.getObjectByName('enemy-bullet')?.position.z, 11);
            assert.equal(actors.group.getObjectByName('rocket')?.position.z, 11);
            assert.equal(JSON.stringify(state), before);

            state = step(state, direction === 1 ? { left: true } : { right: true }).state;
            assert.equal(state.player.direction, -direction);
            assert.equal(state.bullets.length, 1, 'The original bullet remains in flight');
            assert.ok(state.grenade, 'The original player rocket remains in flight');
            const afterTurn = JSON.stringify(state);
            actors.update(state, 1, 1000 / 30);
            for (const kind of ['bullet', 'grenade']) {
                assert.equal(
                    actors.group.getObjectByName(kind)?.position.z,
                    depth,
                    `${kind} keeps its launch plane`,
                );
            }
            assert.equal(actors.group.getObjectByName('enemy-bullet')?.position.z, 11);
            assert.equal(actors.group.getObjectByName('rocket')?.position.z, 11);
            assert.equal(JSON.stringify(state), afterTurn);
        }
    } finally {
        resources.dispose();
    }
});
