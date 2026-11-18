import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { BufferGeometry, Group } from 'three';
import { createVrResources } from '../../src/games/vr/view/materials.ts';
import { createVrPlanet } from '../../src/games/vr/view/planets.ts';
import { describeVrScene } from '../../src/games/vr/model/scene.ts';
import type { VrInstance } from '../../src/games/vr/model/scene.ts';
import { createState } from '../../src/model/state.ts';
import type { World } from '../../src/types/game.ts';

const world = JSON.parse(
    readFileSync(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
) as World;
const examples = new Map<number, VrInstance>();
for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
    for (const item of describeVrScene(createState(world, { screenIndex })).instances)
        if (item.family === 'planet' && !examples.has(item.block)) examples.set(item.block, item);
}

function meshes(group: Group) {
    const result: Mesh[] = [];
    group.traverse((child) => {
        if (child instanceof Mesh) result.push(child);
    });
    return result;
}

function createPlanet(item: VrInstance, resources: ReturnType<typeof createVrResources>) {
    return createVrPlanet(item, resources);
}

test('rocky VR planets have depressed basins and raised ridges on the actual spherical surface', () => {
    const resources = createVrResources();
    for (const block of [3, 4, 35]) {
        const group = createPlanet(examples.get(block)!, resources);
        const body = group.getObjectByName('planet-surface');
        assert.ok(body instanceof Mesh, `block ${block} has a detailed surface`);
        const positions = body.geometry.getAttribute('position');
        const radii = Array.from({ length: positions.count }, (_, index) =>
            Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)),
        );
        assert.ok(Math.max(...radii) - Math.min(...radii) > 0.04, 'Basins have physical depth');
        assert.equal(
            body.geometry.getAttribute('color'),
            undefined,
            'Relief uses lighting, not painted flecks',
        );
        assert.ok(body.material instanceof MeshStandardMaterial);
        assert.equal(body.material.vertexColors, false);
        assert.ok(!Array.isArray(body.material), 'Rocky relief remains one draw call');
        assert.ok(body.geometry.getIndex()!.count / 3 <= 24576, 'Tessellation stays bounded');
        const undisturbed = radii.filter((radius) => Math.abs(radius - 0.985) < 0.000001);
        assert.ok(
            undisturbed.length > radii.length * 0.35,
            'Ground between impacts is a smooth sphere',
        );
    }
    resources.dispose();
});

// Recover depressions independently from indexed mesh topology, merging the
// sphere's duplicate seam/pole vertices by direction. Triangle area keeps basin
// sizes independent of latitude and the number of tessellation samples.
function basinGeometry(geometry: BufferGeometry) {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const indices = geometry.getIndex()!;
    const nodes: { direction: Vector3; radius: number; area: number; edges: Set<number> }[] = [];
    const keys = new Map<string, number>();
    const nodeIndices: number[] = [];
    for (let index = 0; index < positions.count; index++) {
        const point = new Vector3().fromBufferAttribute(positions, index);
        const radius = point.length();
        const direction = point.divideScalar(radius);
        const key = direction
            .toArray()
            .map((value) => Math.round(value * 100000))
            .join(':');
        let node = keys.get(key);
        if (node === undefined) {
            node = nodes.length;
            keys.set(key, node);
            nodes.push({ direction, radius, area: 0, edges: new Set() });
        }
        nodeIndices.push(node);
    }
    let maxSlope = 0;
    let maxNormalTurn = 0;
    for (let index = 0; index < indices.count; index += 3) {
        const vertices = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
        const ids = vertices.map((vertex) => nodeIndices[vertex]);
        const [a, b, c] = ids.map((id) => nodes[id].direction);
        const area =
            new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
        for (const id of ids) nodes[id].area += area / 3;
        for (let edge = 0; edge < 3; edge++) {
            const first = ids[edge],
                second = ids[(edge + 1) % 3];
            nodes[first].edges.add(second);
            const distance = nodes[first].direction.distanceTo(nodes[second].direction);
            if (distance < 0.00001) continue;
            maxSlope = Math.max(
                maxSlope,
                Math.abs(nodes[first].radius - nodes[second].radius) / distance,
            );
            const normalA = new Vector3().fromBufferAttribute(normals, vertices[edge]);
            const normalB = new Vector3().fromBufferAttribute(normals, vertices[(edge + 1) % 3]);
            maxNormalTurn = Math.max(maxNormalTurn, normalA.angleTo(normalB));
        }
    }
    const remaining = new Set(nodes.flatMap((node, index) => (node.radius < 0.982 ? [index] : [])));
    const basins: { area: number; depth: number; center: Vector3; rimRelief: number }[] = [];
    while (remaining.size) {
        const first = remaining.values().next().value!;
        const pending = [first];
        remaining.delete(first);
        let area = 0,
            depth = 0;
        const center = new Vector3();
        const members: typeof nodes = [];
        let floorPoint = new Vector3();
        while (pending.length) {
            const node = nodes[pending.pop()!];
            area += node.area;
            members.push(node);
            if (0.985 - node.radius > depth)
                floorPoint = node.direction.clone().multiplyScalar(node.radius);
            depth = Math.max(depth, 0.985 - node.radius);
            center.addScaledVector(node.direction, node.area);
            for (const adjacent of node.edges)
                if (remaining.delete(adjacent)) pending.push(adjacent);
        }
        center.normalize();
        const extent = Math.max(...members.map((node) => node.direction.distanceTo(center)));
        let rimHeight = -Infinity;
        for (const node of nodes) {
            const distance = node.direction.distanceTo(center);
            if (distance >= extent * 0.95 && distance <= extent * 1.3)
                rimHeight = Math.max(rimHeight, node.radius * node.direction.dot(center));
        }
        basins.push({ area, depth, center, rimRelief: rimHeight - floorPoint.dot(center) });
    }
    return { basins, maxSlope, maxNormalTurn };
}

test('rocky VR planets have diverse connected bowls with continuous walls and rounded rims', () => {
    const resources = createVrResources();
    for (const block of [3, 4, 35]) {
        const body = createPlanet(examples.get(block)!, resources).getObjectByName(
            'planet-surface',
        );
        assert.ok(body instanceof Mesh);
        const { basins, maxSlope, maxNormalTurn } = basinGeometry(body.geometry);
        const areas = basins.map((basin) => basin.area);
        const depths = basins.map((basin) => basin.depth);
        assert.ok(basins.length >= 10, `block ${block} retains separate impact bowls`);
        assert.ok(
            Math.max(...areas) / Math.min(...areas) > 6,
            'Broad basins and small pits have distinct sizes',
        );
        assert.ok(
            Math.max(...depths) / Math.min(...depths) > 2,
            'Bowl depths vary with impact class',
        );
        assert.ok(Math.max(...depths) > 0.06, 'Medium walls have visible geometric depth');
        assert.ok(maxSlope < 1.05, `No abrupt radial jumps or puncture-like walls: ${maxSlope}`);
        assert.ok(maxNormalTurn < 0.55, 'Adjacent faces turn smoothly through floor, wall and rim');
        for (const basin of basins.filter((basin) => basin.area > 0.13))
            assert.ok(
                basin.rimRelief > 0.02,
                'Broad crater floors sit physically below their rim plane',
            );
        const visible = basins.filter((basin) => basin.center.z > 0.5);
        assert.ok(
            visible.some((basin) => basin.area > 0.2 && basin.depth > 0.045),
            'A broad basin faces the first-map spectator',
        );
        assert.ok(
            visible.some((basin) => basin.area < 0.05),
            'Smaller craters also face the spectator',
        );
        for (const [index, basin] of basins.entries())
            for (const other of basins.slice(index + 1))
                assert.ok(
                    basin.center.distanceTo(other.center) > 0.15,
                    'Impact centers are distinct',
                );
    }
    resources.dispose();
});

test('gas VR planets wrap multiple belts and polar caps around the whole globe', () => {
    const resources = createVrResources();
    for (const block of [30, 36, 37]) {
        const group = createPlanet(examples.get(block)!, resources);
        const belts = meshes(group).filter((mesh) => mesh.name.startsWith('planet-belt'));
        assert.ok(belts.length >= 5, `block ${block} has visible cloud belts`);
        for (const belt of belts) {
            belt.geometry.computeBoundingBox();
            const size = belt.geometry.boundingBox!.getSize(new Vector3());
            assert.ok(size.x > 0.8 && size.z > 0.8, 'Belts surround the sphere in depth');
        }
        assert.ok(group.getObjectByName('planet-north-pole'));
        assert.ok(group.getObjectByName('planet-south-pole'));
    }
    resources.dispose();
});

test('VR planets preserve recovered centers, radius, background depth and ring variants', () => {
    const resources = createVrResources();
    assert.deepEqual(
        [...examples.keys()].sort((a, b) => a - b),
        [3, 4, 30, 35, 36, 37],
    );
    for (const item of examples.values()) {
        const group = createPlanet(item, resources);
        const body = group.getObjectByName('planet-surface');
        assert.ok(body instanceof Mesh);
        const radius = Math.min(item.width, item.height) / 2;
        assert.deepEqual(body.position.toArray(), [item.width / 2, -item.height / 2, -22]);
        assert.deepEqual(body.scale.toArray(), [radius, radius, radius]);
        const rings = meshes(group).filter((mesh) => mesh.name.startsWith('planet-ring'));
        assert.equal(rings.length, [30, 37].includes(item.block) ? 3 : 0);
        const size = new Box3().setFromObject(group).getSize(new Vector3());
        assert.ok(size.z >= radius * 1.9, 'Recovered sphere remains fully volumetric');
        assert.ok(size.x <= radius * 3.3 && size.y <= radius * 3.3, 'Detail has bounded extent');
        for (const mesh of meshes(group)) {
            const position = mesh.geometry.getAttribute('position');
            for (const value of position.array) assert.ok(Number.isFinite(value));
        }
        assert.ok(meshes(group).length <= 13, 'Planet draw count stays bounded');
    }
    resources.dispose();
});

test('VR planet detail is deterministic, reused and disposed with shared resources', () => {
    const resources = createVrResources();
    const geometries = new Set<BufferGeometry>();
    const first = createPlanet(examples.get(3)!, resources);
    const second = createPlanet(examples.get(3)!, resources);
    const firstMeshes = meshes(first);
    const secondMeshes = meshes(second);
    for (const [index, mesh] of firstMeshes.entries()) {
        assert.equal(mesh.geometry, secondMeshes[index].geometry);
        assert.deepEqual(mesh.position.toArray(), secondMeshes[index].position.toArray());
        assert.deepEqual(mesh.rotation.toArray(), secondMeshes[index].rotation.toArray());
    }
    const independentResources = createVrResources();
    const independent = meshes(createPlanet(examples.get(3)!, independentResources));
    for (const [index, mesh] of firstMeshes.entries())
        assert.deepEqual(
            mesh.geometry.getAttribute('position').array,
            independent[index].geometry.getAttribute('position').array,
        );
    independentResources.dispose();
    for (const item of examples.values())
        for (const mesh of meshes(createPlanet(item, resources))) geometries.add(mesh.geometry);
    const disposed = new Set<BufferGeometry>();
    for (const geometry of geometries)
        geometry.addEventListener('dispose', () => disposed.add(geometry));
    resources.dispose();
    assert.equal(
        disposed.size,
        geometries.size,
        'All shared detail belongs to the resource lifetime',
    );
});
