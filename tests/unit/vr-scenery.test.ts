import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Box3, Group, Raycaster, Vector3 } from 'three';
import { createState } from '../../src/model/state.ts';
import { describeVrScene } from '../../src/games/vr/model/scene.ts';
import { createVrResources } from '../../src/games/vr/view/materials.ts';
import { createVrMechanisms } from '../../src/games/vr/view/mechanisms.ts';
import { createVrObject, disposeVrScreen } from '../../src/games/vr/view/terrain.ts';
import type { World } from '../../src/types/game.ts';

const world = JSON.parse(
    readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
) as World;

test('VR first-screen floor meets the recovered standing surface across shaded tile seams', () => {
    const r = createVrResources();
    const floor = describeVrScene(createState(world)).instances.find((item) => item.block === 33)!;
    const mesh = createVrObject(floor, world, r);
    try {
        mesh.updateMatrixWorld(true);
        for (const x of [32, 36, 40, 44, 48, 52, 56]) {
            const ray = new Raycaster(new Vector3(x - 128, 40, 2), new Vector3(0, -1, 0));
            const hit = ray.intersectObject(mesh, true)[0];
            assert.ok(hit);
            assert.equal(hit.point.y, 32, `Pixel x=${x}: collision floor is pixel y=144`);
        }
    } finally {
        disposeVrScreen(mesh);
        r.dispose();
    }
});

test('VR first-screen signal lamps have a solid socket on their own gate at the recovered positions', () => {
    const r = createVrResources();
    const state = createState(world);
    const gate = describeVrScene(state).instances.find((item) => item.family === 'gate')!;
    const mesh = createVrObject(gate, world, r);
    const scenery = new Group();
    scenery.add(mesh);
    const mechanisms = createVrMechanisms(r);
    mechanisms.reset(state, scenery);
    try {
        mesh.updateMatrixWorld(true);
        const lamps = state.objects.filter((object) => object.type === 4);
        assert.equal(lamps.length, 6);
        for (const lamp of lamps) {
            const origin = new Vector3(lamp.x * 8 + 4 - 128, 176 - lamp.y * 8 - 3.3, 20);
            const hit = new Raycaster(origin, new Vector3(0, 0, -1)).intersectObject(mesh, true)[0];
            assert.ok(
                hit,
                `Lamp ${lamp.id} must connect to the gate rather than float in its opening`,
            );
            assert.ok(hit.point.z >= 5 && hit.point.z <= 7);
            const fixture = mechanisms.group.getObjectByName(`action-4-${lamp.id}`)!;
            fixture.updateMatrixWorld(true);
            const housing = new Box3().setFromObject(
                fixture.getObjectByName('lamp-housing')!,
                true,
            );
            const glass = new Box3().setFromObject(fixture.getObjectByName('lamp')!, true);
            assert.ok(housing.min.z < hit.point.z && housing.max.z > hit.point.z);
            assert.ok(glass.min.z < housing.max.z, 'The lens fits inside its housing');
            const center = glass.getCenter(new Vector3());
            assert.ok(Math.abs(center.x - origin.x) < 0.01 && Math.abs(center.y - origin.y) < 0.01);
        }
    } finally {
        disposeVrScreen(mesh);
        r.dispose();
    }
});

test('VR spacecraft exhaust follows the visual clock and rebinds after scenery replacement', () => {
    const r = createVrResources();
    const state = createState(world);
    const before = JSON.stringify(state);
    const item = describeVrScene(state).instances.find((instance) => instance.family === 'ship')!;
    const scenery = new Group();
    const original = createVrObject(item, world, r);
    scenery.add(original);
    const mechanisms = createVrMechanisms(r);
    function exhaustBounds(ship: Group) {
        ship.updateMatrixWorld(true);
        return ['left', 'right'].map((side) =>
            new Box3()
                .setFromObject(ship.getObjectByName(`ship-plume-${side}`)!, true)
                .getSize(new Vector3())
                .toArray(),
        );
    }
    try {
        mechanisms.reset(state, scenery);
        mechanisms.update(state, 0);
        const first = exhaustBounds(original);
        mechanisms.update(state, 1000);
        assert.notDeepEqual(
            exhaustBounds(original),
            first,
            'The ship uses the visual clock for exhaust',
        );
        for (const object of state.objects.filter(
            (object) => object.type === 2 && object.block === 2,
        ))
            assert.equal(mechanisms.group.getObjectByName(`action-2-${object.id}`), undefined);
        const detached = exhaustBounds(original);
        const replacement = createVrObject(item, world, r);
        scenery.clear();
        scenery.add(replacement);
        mechanisms.reset(state, scenery);
        const initial = exhaustBounds(replacement);
        mechanisms.update(state, 1500);
        assert.notDeepEqual(
            exhaustBounds(replacement),
            initial,
            'The replacement ship receives animation',
        );
        assert.deepEqual(
            exhaustBounds(original),
            detached,
            'Detached scenery is no longer animated',
        );
        assert.equal(
            JSON.stringify(state),
            before,
            'Exhaust leaves the original simulation unchanged',
        );
    } finally {
        disposeVrScreen(original);
        disposeVrScreen(scenery);
        r.dispose();
    }
});
