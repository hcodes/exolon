import {
    ExtrudeGeometry,
    Group,
    Mesh,
    Path,
    Shape,
    SphereGeometry,
    TorusGeometry,
    Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { dominantAttribute, spectrumPalette } from '../../../view/palette.ts';
import type { VrInstance } from '../model/scene.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

// Six recovered planet blocks share a bounded set of unit meshes for the whole
// resource lifetime. A screen change only releases their lightweight instances.
const geometryCaches = new WeakMap<VrResources, Map<string, BufferGeometry>>();

function geometry(r: VrResources, key: string, create: () => BufferGeometry) {
    let cache = geometryCaches.get(r);
    if (!cache) {
        cache = new Map();
        geometryCaches.set(r, cache);
    }
    let value = cache.get(key);
    if (!value) {
        value = r.geometry(create());
        cache.set(key, value);
    }
    return value;
}

interface Crater {
    center: Vector3;
    radius: number;
    depth: number;
    floor: number;
    rim: number;
    apron: number;
}

function craterInventory(block: number) {
    let seed = block * 7919 + 104729;
    function random() {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    }
    // Broad weathered basins, flat-floored bowls and small rounded impacts.
    // Their depth/diameter ratios remain shallow enough to avoid drilled holes.
    const profiles = [
        [0.42, 0.027, 0.42, 0.007, 0.4],
        [0.275, 0.035, 0.23, 0.011, 0.36],
        [0.14, 0.014, 0.1, 0.0045, 0.4],
        [0.355, 0.03, 0.36, 0.0075, 0.42],
        [0.25, 0.032, 0.22, 0.01, 0.38],
        [0.23, 0.028, 0.18, 0.009, 0.4],
        [0.205, 0.025, 0.22, 0.008, 0.4],
        [0.17, 0.02, 0.12, 0.006, 0.4],
        [0.155, 0.018, 0.15, 0.0055, 0.4],
        [0.13, 0.014, 0.08, 0.0048, 0.42],
        [0.12, 0.013, 0.06, 0.0045, 0.42],
        [0.115, 0.012, 0.1, 0.0042, 0.42],
        [0.125, 0.014, 0.07, 0.0045, 0.42],
        [0.145, 0.016, 0.13, 0.005, 0.42],
    ];
    const craters: Crater[] = [];
    for (const [index, [radius, depth, floor, rim, apron]] of profiles.entries()) {
        for (let attempt = 0; attempt < 400; attempt++) {
            let center: Vector3;
            if (index < 3 && attempt === 0) {
                // Keep a broad basin, a bowl and a small pit visible from the
                // first map's spectator direction, with slight variant rotation.
                const [x, y] = [
                    [-0.38, 0.24],
                    [0.4, -0.3],
                    [0.38, 0.55],
                ][index];
                center = new Vector3(x, y, Math.sqrt(1 - x * x - y * y));
                center.applyAxisAngle(new Vector3(0, 1, 0), (block - 3) * 0.007);
            } else {
                const y = random() * 1.8 - 0.9;
                const longitude = random() * Math.PI * 2;
                const ring = Math.sqrt(1 - y * y);
                center = new Vector3(Math.cos(longitude) * ring, y, Math.sin(longitude) * ring);
            }
            // Separate the entire rounded aprons, not just the crater centers.
            // This preserves individual impacts rather than summing tall spikes.
            const overlaps = craters.some(
                (crater) =>
                    center.distanceTo(crater.center) <
                    radius * (1 + apron) + crater.radius * (1 + crater.apron) + 0.015,
            );
            if (overlaps) continue;
            craters.push({ center, radius, depth, floor, rim, apron });
            break;
        }
    }
    return craters;
}

// Quintic interpolation has zero first and second derivatives at both ends:
// the floor, wall, rounded lip and eroded outer apron join without radial steps.
function smoothProfile(value: number) {
    return value * value * value * (value * (value * 6 - 15) + 10);
}

function craterHeight(distance: number, crater: Crater) {
    const baseline = 0.985;
    if (distance >= 1 + crater.apron) return 0;
    if (distance >= 1) return crater.rim * (1 - smoothProfile((distance - 1) / crater.apron));
    // A broad impact must cut below its rim's tangent plane. Merely subtracting
    // a small radial dimple leaves the original convex spherical cap intact.
    const rimDot = 1 - (crater.radius * crater.radius) / 2;
    const localDot = 1 - (distance * crater.radius) ** 2 / 2;
    const floorHeight = baseline * rimDot - crater.depth;
    if (distance < crater.floor) {
        const axial = floorHeight + crater.depth * 0.15 * smoothProfile(distance / crater.floor);
        return axial / localDot - baseline;
    }
    const floorRadius = (floorHeight + crater.depth * 0.15) / localDot;
    const blend = smoothProfile((distance - crater.floor) / (1 - crater.floor));
    return floorRadius + (baseline + crater.rim - floorRadius) * blend - baseline;
}

function rockySurface(block: number) {
    // Bounded high-resolution shell: small craters span several complete rings
    // of triangles instead of collapsing into a star or a single dark pinhole.
    const surface = new SphereGeometry(1, 128, 96);
    const positions = surface.getAttribute('position');
    const craters = craterInventory(block);
    const direction = new Vector3();
    for (let index = 0; index < positions.count; index++) {
        direction.fromBufferAttribute(positions, index).normalize();
        let radius = 0.985;
        for (const crater of craters) {
            const distance = direction.distanceTo(crater.center) / crater.radius;
            radius += craterHeight(distance, crater);
        }
        // The baseline plus the highest authored rim is below one. No clipping
        // is needed, so the spherical silhouette and every rim stay smooth.
        positions.setXYZ(index, direction.x * radius, direction.y * radius, direction.z * radius);
    }
    surface.computeVertexNormals();
    return surface;
}

function cloudBelt(start: number, length: number, phase: number) {
    const belt = new SphereGeometry(1.003, 32, 5, 0, Math.PI * 2, start, length);
    const positions = belt.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index),
            y = positions.getY(index),
            z = positions.getZ(index);
        const longitude = Math.atan2(z, x);
        const latitude = Math.acos(Math.max(-1, Math.min(1, y / 1.003)));
        const curved = latitude + Math.sin(longitude * 3 + phase) * 0.018 * Math.sin(latitude);
        positions.setXYZ(
            index,
            Math.cos(longitude) * Math.sin(curved) * 1.003,
            Math.cos(curved) * 1.003,
            Math.sin(longitude) * Math.sin(curved) * 1.003,
        );
    }
    belt.computeVertexNormals();
    return belt;
}

function annulus(inner: number, outer: number) {
    const shape = new Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const ring = new ExtrudeGeometry(shape, {
        depth: 0.024,
        bevelEnabled: false,
        curveSegments: 24,
        steps: 1,
    });
    ring.translate(0, 0, -0.012);
    return ring;
}

/** Local recovered pixels: +x right, -y down, center at (w/2,-h/2,-22).
 * The caller positions this group at the map instance origin; no map offsets or
 * physical-metre conversion belong here. Planet radius and background depth
 * retain the original VR scene footprint, including the two ringed variants.
 */
export function createVrPlanet(item: VrInstance, r: VrResources): Group {
    const group = new Group();
    const palette = spectrumPalette(dominantAttribute(item.tiles));
    const radius = Math.min(item.width, item.height) / 2;
    const x = item.width / 2,
        y = -item.height / 2;
    const gas = [30, 36, 37].includes(item.block);
    const base = r.material(palette.base, 0.05);
    const shade = r.material(palette.shade, 0.05);
    const light = r.material(palette.light, 0.05);
    const surface = new Mesh(
        gas
            ? geometry(r, 'gas-surface', () => new SphereGeometry(1, 32, 24))
            : geometry(r, `rock-${item.block}`, () => rockySurface(item.block)),
        base,
    );
    surface.name = 'planet-surface';
    surface.position.set(x, y, -22);
    surface.scale.setScalar(radius);
    group.add(surface);
    if (gas) {
        const belts = [
            [0.48, 0.36],
            [0.93, 0.25],
            [1.32, 0.24],
            [1.73, 0.26],
            [2.19, 0.36],
        ];
        for (const [index, [start, length]] of belts.entries())
            solid(
                group,
                geometry(r, `belt-${item.block}-${index}`, () =>
                    cloudBelt(start, length, item.block + index),
                ),
                index % 2 ? light : shade,
                x,
                y,
                -22,
                radius,
                radius,
                radius,
                `planet-belt-${index}`,
            );
        for (const [name, start] of [
            ['north', 0],
            ['south', Math.PI - 0.34],
        ] as const)
            solid(
                group,
                geometry(
                    r,
                    `pole-${name}`,
                    () => new SphereGeometry(1.004, 32, 5, 0, Math.PI * 2, start, 0.34),
                ),
                light,
                x,
                y,
                -22,
                radius,
                radius,
                radius,
                `planet-${name}-pole`,
            );
        // A narrow, non-emissive arc suggests a lit atmosphere without an opaque
        // halo or overlapping transparent shells on the headset's GPU.
        const rim = solid(
            group,
            geometry(r, 'atmosphere', () => new TorusGeometry(1, 0.006, 4, 24, Math.PI * 0.7)),
            light,
            x,
            y,
            -22,
            radius,
            radius,
            radius,
            'planet-atmosphere',
        );
        rim.rotation.z = Math.PI * 0.4;
    }
    if ([30, 37].includes(item.block)) {
        const bands = [
            [1.16, 1.26],
            [1.29, 1.43],
            [1.48, 1.58],
        ];
        for (const [index, [inner, outer]] of bands.entries()) {
            const ring = solid(
                group,
                geometry(r, `ring-${index}`, () => annulus(inner, outer)),
                index === 1 ? light : shade,
                x,
                y,
                -22,
                radius,
                radius,
                radius,
                `planet-ring-${index}`,
            );
            ring.rotation.x = 1.12;
            ring.rotation.y = 0.24;
        }
    }
    return group;
}
