import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { createVrResources } from '../../src/games/vr/view/materials.ts';
import { createVrMechanisms } from '../../src/games/vr/view/mechanisms.ts';
import { describeVrScene } from '../../src/games/vr/model/scene.ts';
import { createVrObject } from '../../src/games/vr/view/terrain.ts';
import { createState } from '../../src/model/state.ts';
import type { World } from '../../src/types/game.ts';

const world = JSON.parse(
    readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
) as World;

test('VR firing retracts the existing muzzle toward its fixed receiver and recovers', () => {
    const resources = createVrResources();
    const state = createState(world);
    const instance = describeVrScene(state).instances.find((item) => item.family === 'turret')!;
    const terrain = new Group();
    const turret = createVrObject(instance, world, resources);
    terrain.add(turret);
    const mechanisms = createVrMechanisms(resources);
    mechanisms.reset(state, terrain);
    const action = state.objects.find((object) => object.type === 3)!;
    const barrel = turret.getObjectByName('turret-barrel')!;
    action.phase = 1;
    mechanisms.update(state, 0);
    const resting = barrel.getWorldPosition(new Vector3());
    action.phase = 8;
    mechanisms.update(state, 33);
    assert.equal(barrel.getWorldPosition(new Vector3()).x - resting.x, 7);
    for (const phase of [7, 6, 5, 4, 3, 2, 1]) {
        action.phase = phase;
        mechanisms.update(state, (9 - phase) * 33);
        assert.equal(barrel.getWorldPosition(new Vector3()).x - resting.x, phase - 1);
    }
    assert.equal(mechanisms.group.getObjectByName('recoil-barrel'), undefined);
    resources.dispose();
});

test('VR muzzle flash appears only on the shot phase at the projectile origin', () => {
    const resources = createVrResources();
    for (const screenIndex of [0, 23]) {
        const state = createState(world, { screenIndex });
        const terrain = new Group();
        const instances = describeVrScene(state).instances.filter(
            (item) => item.family === 'turret',
        );
        for (const instance of instances) terrain.add(createVrObject(instance, world, resources));
        const mechanisms = createVrMechanisms(resources);
        mechanisms.reset(state, terrain);
        for (const action of state.objects.filter((object) => object.type === 3)) {
            const turret = terrain.children.find(
                (child) => child.userData.instance === action.instance,
            )!;
            const muzzle = turret.getObjectByName('turret-muzzle')!;
            const flash = turret.getObjectByName('turret-flash')!;
            const receiver = turret.getObjectByName('turret-receiver')!;
            assert.ok(muzzle, 'turret has a muzzle on its barrel assembly');
            assert.ok(flash, 'turret has a flash attached to its muzzle');
            assert.ok(receiver, 'turret has a fixed receiver');
            action.phase = 1;
            mechanisms.update(state, 0);
            assert.equal(flash.visible, false);
            const restingReceiver = receiver.getWorldPosition(new Vector3()).clone();
            action.phase = 9;
            mechanisms.update(state, 33);
            assert.equal(flash.visible, true);
            assert.deepEqual(muzzle.getWorldPosition(new Vector3()).toArray(), [
                action.x * 8 - 128,
                176 - (action.y * 8 + 3),
                11,
            ]);
            assert.equal(flash.parent, muzzle);
            action.phase = 8;
            mechanisms.update(state, 66);
            assert.equal(flash.visible, false);
            assert.deepEqual(receiver.getWorldPosition(new Vector3()), restingReceiver);
            state.destroyed.push(action.instance!);
            mechanisms.update(state, 99);
            assert.equal(turret.getObjectByName('turret')!.visible, false);
        }
        const decorative = terrain.children.find(
            (child) =>
                child.name.startsWith('turret-') &&
                !state.objects.some(
                    (object) => object.type === 3 && object.instance === child.userData.instance,
                ),
        );
        if (screenIndex === 23) assert.equal(decorative?.getObjectByName('turret')?.visible, true);
    }
    resources.dispose();
});

test('VR mechanisms rebind the surviving turret when static scenery is rebuilt', () => {
    const resources = createVrResources();
    const state = createState(world);
    const instance = describeVrScene(state).instances.find((item) => item.family === 'turret')!;
    const terrain = new Group();
    const original = createVrObject(instance, world, resources);
    terrain.add(original);
    const mechanisms = createVrMechanisms(resources);
    const action = state.objects.find((object) => object.type === 3)!;
    mechanisms.reset(state, terrain);
    action.phase = 3;
    mechanisms.update(state, 0);
    const oldBarrel = original.getObjectByName('turret-barrel')!;
    assert.equal(oldBarrel.position.x, 2);

    terrain.clear();
    const replacement = createVrObject(instance, world, resources);
    terrain.add(replacement);
    mechanisms.reset(state, terrain);
    action.phase = 8;
    mechanisms.update(state, 33);
    assert.equal(replacement.getObjectByName('turret-barrel')!.position.x, 7);
    assert.equal(oldBarrel.position.x, 2);
    resources.dispose();
});
