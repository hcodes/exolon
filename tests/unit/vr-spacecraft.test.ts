import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { createVrResources } from '../../src/games/vr/view/materials.ts';
import { createVrSpacecraft, updateVrSpacecraft } from '../../src/games/vr/view/spacecraft.ts';
import type { VrInstance } from '../../src/games/vr/model/scene.ts';

const item: VrInstance = {
    instance: 7,
    block: 2,
    family: 'ship',
    x: 24,
    y: 16,
    width: 88,
    height: 64,
    tiles: [],
};

function frontColor(ship: Group, x: number, y: number) {
    ship.updateMatrixWorld(true);
    const hit = new Raycaster(new Vector3(x, -y, 100), new Vector3(0, 0, -1)).intersectObject(
        ship,
        true,
    )[0];
    if (!hit || !(hit.object instanceof Mesh)) return null;
    const material = hit.object.material;
    assert.ok(material instanceof MeshStandardMaterial);
    return `#${material.color.getHexString()}`;
}

test('VR spacecraft preserves the recovered front silhouette and independent colour landmarks', () => {
    const resources = createVrResources();
    const ship = createVrSpacecraft(item, resources);
    assert.equal(ship.name, 'spacecraft');
    // Hand-picked from the recovered 88×64 artwork: shield tip, white shoulders,
    // yellow nacelles, angular side panes, narrow central glass, raised beacon.
    for (const [x, y, color] of [
        [44, 61, '#43e7ed'],
        [19, 27, '#e0efeb'],
        [69, 27, '#e0efeb'],
        [19, 36, '#f5eb48'],
        [69, 36, '#f5eb48'],
        [37, 37, '#082c40'],
        [51, 37, '#082c40'],
        [44, 38, '#061f33'],
        [44, 22, '#ff394b'],
    ] as const) {
        assert.equal(frontColor(ship, x, y), color, `source landmark ${x},${y}`);
    }
    for (const [x, y] of [
        [5, 12],
        [44, 9],
        [25, 60],
        [63, 60],
        [44, 65],
    ])
        assert.equal(frontColor(ship, x, y), null, `open source silhouette ${x},${y}`);
    for (const name of [
        'ship-cockpit',
        'ship-keel',
        'ship-crossbeam',
        'ship-aerial-left',
        'ship-aerial-right',
    ])
        assert.ok(ship.getObjectByName(name), name);
    const beam = new Box3().setFromObject(ship.getObjectByName('ship-crossbeam')!);
    assert.equal(beam.min.x, 0);
    assert.equal(beam.max.x, 88);
    assert.ok(beam.min.y <= -22 && beam.max.y >= -22);
    for (const [name, x] of [
        ['ship-aerial-left', 29],
        ['ship-aerial-right', 59],
    ] as const) {
        const bounds = new Box3().setFromObject(ship.getObjectByName(name)!);
        assert.ok(Math.abs(bounds.getCenter(new Vector3()).x - x) < 0.01);
        assert.ok(bounds.max.y >= -0.21 && bounds.min.y <= -22);
    }
    resources.dispose();
});

test('VR spacecraft has mirrored open thrust bells and attached layered pulsing flames', () => {
    const resources = createVrResources();
    const ship = createVrSpacecraft(item, resources);
    for (const [side, x] of [
        ['left', 12.6],
        ['right', 75.4],
    ] as const) {
        const nozzle = ship.getObjectByName(`ship-nozzle-${side}`);
        const plume = ship.getObjectByName(`ship-plume-${side}`);
        assert.ok(nozzle instanceof Mesh && plume instanceof Group);
        assert.deepEqual(nozzle.position.toArray(), [x, -55.55, 5.5]);
        assert.deepEqual(plume.position.toArray(), [x, -55.55, 5.5]);
        nozzle.updateMatrixWorld(true);
        const mouth = new Raycaster(new Vector3(x, -55.56, 5.5), new Vector3(0, 1, 0));
        assert.equal(
            mouth.intersectObject(nozzle).length,
            0,
            'the nozzle is hollow, without a mouth cap',
        );
        const rim = new Raycaster(new Vector3(x + 3.2, -55.56, 5.5), new Vector3(0, 1, 0));
        assert.ok(rim.intersectObject(nozzle).length > 0, 'the flared mouth has a metal rim');
        assert.equal(plume.children.length, 3);
        const original = plume.position.clone();
        updateVrSpacecraft(ship, 1234);
        const firstLength = plume.scale.y;
        updateVrSpacecraft(ship, 1570);
        assert.notEqual(firstLength, plume.scale.y);
        assert.ok(plume.scale.y >= 0.85 && plume.scale.y <= 1.2);
        assert.deepEqual(
            plume.position,
            original,
            'pulse scales from the mouth instead of detaching it',
        );
        const bounds = new Box3().setFromObject(plume);
        assert.ok(Math.abs(bounds.max.y + 55.55) < 0.001);
    }
    resources.dispose();
});

test('VR spacecraft pressure cabin is closed, deep across its interior, and tapers toward the back', () => {
    const resources = createVrResources();
    const ship = createVrSpacecraft(item, resources);
    ship.updateMatrixWorld(true);
    const hull = ship.getObjectByName('ship-pressure-hull');
    assert.ok(hull instanceof Mesh, 'the armour is backed by a shaped pressure cabin');
    function section(x: number, y: number) {
        const front = new Raycaster(new Vector3(x, -y, 100), new Vector3(0, 0, -1)).intersectObject(
            hull!,
        )[0];
        const rear = new Raycaster(new Vector3(x, -y, -100), new Vector3(0, 0, 1)).intersectObject(
            hull!,
        )[0];
        assert.ok(front && rear, `closed pressure cabin at ${x},${y}`);
        return { front: front.point.z, rear: rear.point.z, depth: front.point.z - rear.point.z };
    }
    // These interior sections cannot acquire their depth from aerials, trim,
    // overlapping plates, or an arbitrary change to the ship's global bounds.
    for (const [x, y] of [
        [44, 35],
        [35, 40],
        [53, 40],
        [44, 50],
    ]) {
        const body = section(x, y);
        assert.ok(body.depth >= 26, `substantial pressure volume at ${x},${y}`);
        assert.ok(body.rear <= -22, `finished rear closure at ${x},${y}`);
        assert.ok(body.front <= 4.01, 'the pressure shell remains behind the frontal armour');
    }
    const edge = section(26, 40);
    assert.ok(
        edge.depth >= 10 && edge.depth < 23,
        'rounded side wall tapers before the deep cabin back',
    );
    function width(z: number) {
        const left = new Raycaster(new Vector3(0, -40, z), new Vector3(1, 0, 0)).intersectObject(
            hull!,
        )[0];
        const right = new Raycaster(new Vector3(88, -40, z), new Vector3(-1, 0, 0)).intersectObject(
            hull!,
        )[0];
        assert.ok(left && right, `closed side walls at depth ${z}`);
        return right.point.x - left.point.x;
    }
    assert.ok(width(-10) > 36, 'broad cabin belly has actual side walls');
    assert.ok(width(-21) < width(-10) - 6, 'the rear narrows instead of forming an extruded slab');
    for (const side of ['left', 'right']) {
        const shoulder = ship.getObjectByName(`ship-shoulder-fairing-${side}`);
        const nacelle = ship.getObjectByName(`ship-nacelle-housing-${side}`);
        assert.ok(shoulder instanceof Mesh && nacelle instanceof Mesh);
        const x = side === 'left' ? 20 : 68;
        for (const [mesh, y, minimumDepth] of [
            [shoulder, 27, 14],
            [nacelle, 36, 19],
        ] as const) {
            const front = new Raycaster(
                new Vector3(x, -y, 100),
                new Vector3(0, 0, -1),
            ).intersectObject(mesh)[0];
            const rear = new Raycaster(
                new Vector3(x, -y, -100),
                new Vector3(0, 0, 1),
            ).intersectObject(mesh)[0];
            assert.ok(
                front && rear && front.point.z - rear.point.z >= minimumDepth,
                `closed ${side} fairing at ${x},${y}`,
            );
        }
    }
    resources.dispose();
});

test('VR spacecraft shares bounded finite geometry, respects scaling, and leaves model data untouched', () => {
    const resources = createVrResources();
    const before = JSON.stringify(item);
    const ship = createVrSpacecraft(item, resources);
    const scaled = createVrSpacecraft({ ...item, width: 176, height: 32 }, resources);
    assert.deepEqual(scaled.scale.toArray(), [2, 0.5, 1]);
    assert.deepEqual(ship.position.toArray(), [0, 0, 0]);
    const geometries = new Set<BufferGeometry>();
    let meshes = 0;
    let triangles = 0;
    ship.traverse((child: Object3D) => {
        if (!(child instanceof Mesh)) return;
        meshes++;
        geometries.add(child.geometry);
        const positions = child.geometry.getAttribute('position');
        triangles += (child.geometry.index?.count ?? positions.count) / 3;
        for (let i = 0; i < positions.count; i++)
            assert.ok(
                [positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite),
            );
    });
    assert.ok(meshes <= 60, `${meshes} draw calls for one spacecraft`);
    assert.ok(triangles < 15000, `${triangles} rendered triangles`);
    const shared = new Set<BufferGeometry>();
    scaled.traverse((child) => {
        if (child instanceof Mesh) shared.add(child.geometry);
    });
    assert.deepEqual(shared, geometries, 'repeated screen instances reuse authored geometry');
    let disposed = 0;
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed++);
    ship.clear();
    assert.equal(disposed, 0, 'removing a screen must not dispose shared geometry');
    resources.dispose();
    assert.equal(disposed, geometries.size, 'renderer resources own every geometry lifetime');
    assert.equal(JSON.stringify(item), before);
});
