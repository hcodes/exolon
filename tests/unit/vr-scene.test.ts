import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Box3, Mesh, Vector3 } from 'three';
import { createVrResources } from '../../src/games/vr/view/materials.ts';
import { createVrObject, disposeVrScreen } from '../../src/games/vr/view/terrain.ts';
import { createVrHero } from '../../src/games/vr/view/hero.ts';
import { createVrActor, createVrActors } from '../../src/games/vr/view/entities.ts';
import { createState } from '../../src/model/state.ts';
import type { VrInstance } from '../../src/games/vr/model/scene.ts';
import type { GameScreen, World } from '../../src/types/game.ts';
import {
    describeVrScene,
    domainToPixel,
    eventToPixel,
    inventoryVrWorld,
    pixelToScene,
    tileToPixel,
} from '../../src/games/vr/model/scene.ts';

const world = JSON.parse(
    readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
) as World;

test('VR coordinates preserve domain, event and tile conventions', () => {
    assert.deepEqual(domainToPixel({ x: 12, y: 40 }), { x: 24, y: 40 });
    assert.deepEqual(eventToPixel({ x: 24, y: 40 }), { x: 24, y: 40 });
    assert.deepEqual(tileToPixel({ x: 3, y: 4 }), { x: 24, y: 32 });
    assert.deepEqual(pixelToScene({ x: 0, y: 176 }), { x: -128, y: 0 });
    assert.deepEqual(pixelToScene({ x: 256, y: 0 }), { x: 128, y: 176 });
});

test('VR inventory exhaustively covers all 125 maps, actions and flying species', () => {
    const inventory = inventoryVrWorld(world);
    assert.equal(inventory.screens, 125);
    assert.deepEqual(
        inventory.blocks,
        [
            0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26,
            27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
            49, 50, 51, 52, 53, 54, 55, 58, 59, 60, 61,
        ],
    );
    assert.deepEqual(inventory.unsupportedBlocks, []);
    assert.deepEqual(inventory.unsupportedActions, []);
    assert.deepEqual(inventory.unsupportedEnemies, []);
    assert.deepEqual(inventory.actions, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.deepEqual(inventory.enemies, [1, 16, 20, 24, 37, 41]);
    for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
        const state = createState(world, { screenIndex });
        const before = JSON.stringify(state);
        const description = describeVrScene(state);
        assert.ok(description.instances.length > 0, `screen ${screenIndex}`);
        assert.ok(
            description.instances.every((item) => item.family && item.height > 0 && item.width > 0),
        );
        assert.equal(JSON.stringify(state), before);
    }
});

test('VR descriptions omit HUD, destroyed and collected supplies while retaining independent instances', () => {
    const screen: GameScreen = { tiles: Array.from({ length: 768 }, () => null) };
    screen.tiles[0] = { block: 19, instance: 1, ink: true, collision: 0 };
    screen.tiles[1] = { block: 19, instance: 2, ink: true, collision: 0 };
    screen.tiles[2] = { block: 24, instance: 3, ink: true, collision: 1 };
    screen.tiles[704] = { block: 24, instance: 4, ink: true, collision: 1 };
    const state = createState(screen);
    assert.deepEqual(
        describeVrScene(state).instances.map((item) => item.instance),
        [1, 2, 3],
    );
    state.destroyed = [3];
    state.objects = [
        {
            id: 0,
            type: 7,
            x: 0,
            y: 0,
            instance: 1,
            active: false,
            phase: 0,
            hits: 0,
            length: 0,
            yOffset: 0,
        },
    ];
    assert.deepEqual(
        describeVrScene(state).instances.map((item) => item.instance),
        [2],
    );
});

test('VR map families have finite, genuinely deep geometry and recognizable components', () => {
    const resources = createVrResources();
    const examples = new Map<number, VrInstance>();
    for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
        for (const item of describeVrScene(createState(world, { screenIndex })).instances) {
            if (!examples.has(item.block)) examples.set(item.block, item);
        }
    }
    for (const item of examples.values()) {
        const family = item.family;
        const object = createVrObject(item, world, resources);
        const bounds = new Box3().setFromObject(object);
        const size = bounds.getSize(new Vector3());
        assert.ok(size.x > 0 && size.y > 0 && size.z > 0.5, family);
        object.traverse((child) => {
            if (!(child instanceof Mesh)) return;
            const position = child.geometry.getAttribute('position');
            for (let index = 0; index < position.count; index++) {
                assert.ok(
                    Number.isFinite(position.getX(index)) &&
                        Number.isFinite(position.getY(index)) &&
                        Number.isFinite(position.getZ(index)),
                    family,
                );
            }
        });
        if (family === 'ship') assert.ok(object.getObjectByName('ship-cockpit'));
        if (family === 'teleporter') assert.ok(object.getObjectByName('teleporter-ring'));
        if (family === 'turret') assert.ok(object.getObjectByName('turret-barrel'));
        disposeVrScreen(object);
    }
    // Sphere-home tiles are invisible markers; action 9 supplies the live sphere meshes.
    assert.deepEqual(
        [...examples.keys()].sort((a, b) => a - b),
        inventoryVrWorld(world).blocks.filter((block) => block !== 39),
    );
    resources.dispose();
});

test('VR hero is articulated and every projectile/enemy has volume', () => {
    const resources = createVrResources();
    const hero = createVrHero(resources);
    for (const name of [
        'helmet',
        'visor',
        'backpack',
        'weapon',
        'near-thigh',
        'far-shin',
        'armor',
    ]) {
        assert.ok(hero.group.getObjectByName(name), name);
    }
    const state = createState(world);
    const before = JSON.stringify(state);
    hero.update(state, 0.5, 250);
    assert.equal(JSON.stringify(state), before);
    for (const kind of [
        'bullet',
        'rocket',
        'grenade',
        'sphere',
        'enemy-bullet',
        'flying',
    ] as const) {
        const actor = createVrActor(kind, resources, 16);
        const size = new Box3().setFromObject(actor).getSize(new Vector3());
        assert.ok(size.x > 0 && size.y > 0 && size.z > 0, kind);
    }
    resources.dispose();
});

test('VR rocket meshes follow the shared measured projectile arc without changing simulation', () => {
    const resources = createVrResources();
    const actors = createVrActors(resources);
    const state = createState(world);
    state.rockets = [{ kind: 'launcher', projectileId: 1, x: 40, y: 60, dx: 1 }];
    actors.update(state, 1, 0);
    const next = {
        ...state,
        tick: state.tick + 1,
        rockets: [{ ...state.rockets[0], x: 42, y: 64 }],
    };
    const before = JSON.stringify(next);
    actors.update(next, 1, 33);
    const mesh = actors.group.getObjectByName('rocket')!;
    assert.ok(mesh.rotation.z < -0.5);
    assert.equal(mesh.position.y, 176 - 64);
    assert.equal(JSON.stringify(next), before);
    resources.dispose();
});

test('VR hazard meshes use recovered sprite centers and the sweeper disappears with model state', () => {
    const resources = createVrResources();
    const actors = createVrActors(resources);
    const state = createState(world);
    state.spheres = [{ kind: 'sphere', x: 10, y: 20, dx: 1 }];
    state.enemies = [
        { kind: 'flying', x: 30, y: 40, sprite: 16, phase: 0, trajectory: [], trajectoryIndex: 0 },
    ];
    state.killer = { x: 50, y: 60 };
    const before = JSON.stringify(state);
    actors.update(state, 1, 400);
    const killer = actors.group.getObjectByName('killer');
    assert.ok(killer?.visible, 'The lethal sweeper has a visible actor');
    assert.deepEqual(killer.position.toArray(), [-20, 108, 11]);
    assert.deepEqual(actors.group.getObjectByName('sphere')?.position.toArray(), [-104, 152, 11]);
    assert.deepEqual(actors.group.getObjectByName('flying')?.position.toArray(), [-60, 128, 11]);
    const size = new Box3().setFromObject(killer).getSize(new Vector3());
    assert.ok(
        size.x >= 14 && size.y >= 14 && size.z >= 10,
        'The sweeper is a substantial volumetric hazard',
    );
    assert.equal(JSON.stringify(state), before);
    actors.update({ ...state, tick: state.tick + 1, killer: null }, 1, 433);
    assert.equal(killer.visible, false, 'A missing sweeper never remains on screen');
    resources.dispose();
});
