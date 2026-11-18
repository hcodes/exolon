import { ExtrudeGeometry, Group, Mesh, Shape, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BufferGeometry } from 'three';
import type { World } from '../../../types/game.ts';
import { dominantAttribute, spectrumPalette } from '../../../view/palette.ts';
import type { VrInstance } from '../model/scene.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';
import { createVrGate } from './gate.ts';
import { createVrPlanet } from './planets.ts';
import { createVrTurret } from './turret.ts';
import { createVrSpacecraft } from './spacecraft.ts';

// All static content uses recovered footprints. Curved machinery is authored in
// the same pixel space; the presentation rig alone converts to physical metres.
export function createVrObject(item: VrInstance, world: World, r: VrResources) {
    const group = new Group();
    group.name = `${item.family}-${item.instance}`;
    group.position.set(item.x - 128, 176 - item.y, 0);
    group.userData.instance = item.instance;
    const w = item.width,
        h = item.height;
    const palette = spectrumPalette(dominantAttribute(item.tiles));
    const body = r.material(palette.shade, 0.55);
    const trim = r.material(palette.light, 0.5);
    const glow = r.material(palette.light, 0.25, true);
    function box(
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number,
        mat = body,
        name = '',
    ) {
        return solid(group, r.box, mat, x, -y, z, width, height, depth, name);
    }
    function orb(
        x: number,
        y: number,
        z: number,
        rx: number,
        ry: number,
        rz: number,
        mat = body,
        name = '',
    ) {
        return solid(group, r.sphere, mat, x, -y, z, rx, ry, rz, name);
    }
    function tube(
        x: number,
        y: number,
        z: number,
        radius: number,
        length: number,
        mat = body,
        horizontal = false,
        name = '',
    ) {
        const mesh = solid(group, r.cylinder, mat, x, -y, z, radius, length, radius, name);
        if (horizontal) mesh.rotation.z = Math.PI / 2;
        return mesh;
    }
    function ring(x: number, y: number, z: number, radius: number, mat = glow, name = '') {
        return solid(group, r.ring, mat, x, -y, z, radius, radius, radius, name);
    }
    function extrude(points: number[][], depth: number, mat = body, z = -depth / 2) {
        const shape = new Shape(points.map(([x, y]) => new Vector2(x, -y)));
        const geometry = new ExtrudeGeometry(shape, {
            depth,
            bevelEnabled: true,
            bevelSize: 0.5,
            bevelThickness: 0.5,
            bevelSegments: 1,
            steps: 1,
        });
        geometry.userData.screenOwned = true;
        const mesh = new Mesh(geometry, mat);
        mesh.position.z = z;
        group.add(mesh);
        return mesh;
    }
    function flanges(y: number) {
        box(w / 2, y, 0, w, 2.4, 10, trim);
        for (const x of [2, w - 2]) orb(x, y, 5.3, 0.65, 0.65, 0.5, r.gold);
    }
    function chamber(suit: boolean) {
        box(w / 2, h / 2, -5, w, h, 2, r.dark);
        for (const x of [2, w - 2]) {
            tube(x, h / 2, 0, 2, h, trim);
            tube(x, h / 2, 3, 0.5, h * 0.85, glow);
        }
        flanges(2);
        flanges(h - 2);
        if (suit) {
            orb(w / 2, h * 0.31, -1, w * 0.16, h * 0.12, 3, r.cream);
            box(w / 2, h * 0.57, -1, w * 0.3, h * 0.32, 5, r.cream);
        } else {
            const hoop = ring(w / 2, h / 2, -1, Math.min(w, h) * 0.35, glow, 'teleporter-ring');
            hoop.scale.y *= h / w;
            for (let y = 8; y < h - 5; y += 7) box(w / 2, y, -3, w * 0.6, 0.45, 1, r.cyan);
        }
    }
    switch (item.family) {
        case 'planet': {
            group.add(createVrPlanet(item, r));
            break;
        }
        case 'ship': {
            group.add(createVrSpacecraft(item, r));
            break;
        }
        case 'terrain': {
            const geometries: BufferGeometry[] = [];
            for (const tile of item.tiles) {
                const loops = world.contours?.[tile.shape ?? -1];
                const polygons = loops?.length
                    ? loops
                    : [
                          [
                              [0, 0],
                              [8, 0],
                              [8, 8],
                              [0, 8],
                          ],
                      ];
                // Bitmap stippling describes rock shading, not air tunnels.
                // A convex outline inside each recovered tile turns that ink
                // into solid strata while retaining tile gaps and slope edges.
                const points = polygons.flat().map(([x, y]) => new Vector2(x, y));
                const top = Math.min(...points.map((point) => point.y));
                const edge = points.filter((point) => point.y === top);
                // A one-pixel blank above a broad solid ledge is bitmap shading,
                // not a lower collision floor. Keep genuine slopes unchanged.
                if (
                    tile.collision === 1 &&
                    top === 1 &&
                    Math.max(...edge.map((point) => point.x)) -
                        Math.min(...edge.map((point) => point.x)) >=
                        6
                )
                    points.push(new Vector2(0, 0), new Vector2(8, 0));
                points.sort((a, b) => a.x - b.x || a.y - b.y);
                const cross = (a: Vector2, b: Vector2, c: Vector2) =>
                    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                const lower: Vector2[] = [];
                const upper: Vector2[] = [];
                for (const point of points) {
                    while (
                        lower.length >= 2 &&
                        cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
                    )
                        lower.pop();
                    lower.push(point);
                }
                for (let index = points.length - 1; index >= 0; index--) {
                    const point = points[index];
                    while (
                        upper.length >= 2 &&
                        cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
                    )
                        upper.pop();
                    upper.push(point);
                }
                const outline = lower.slice(0, -1).concat(upper.slice(0, -1));
                const shapes = [
                    new Shape(
                        outline.map(
                            (point) =>
                                new Vector2(
                                    tile.x - item.x + point.x,
                                    -(tile.y - item.y + point.y),
                                ),
                        ),
                    ),
                ];
                const geometry = new ExtrudeGeometry(shapes, {
                    depth: 13,
                    bevelEnabled: false,
                    steps: 1,
                });
                geometry.translate(0, 0, -7);
                geometries.push(geometry);
            }
            const merged = mergeGeometries(geometries);
            for (const geometry of geometries) geometry.dispose();
            if (merged) {
                merged.userData.screenOwned = true;
                group.add(new Mesh(merged, r.material(palette.base, 0.18)));
            }
            // Mineral seams on the deep front edge distinguish rock from machinery.
            for (let x = 3; x < w; x += 13) {
                const first = item.tiles.find(
                    (tile) => x >= tile.x - item.x && x < tile.x - item.x + 8,
                );
                if (first) box(x, first.y - item.y + 5, 6.1, 3.8, 0.5, 0.4, trim);
            }
            break;
        }
        case 'teleporter':
            chamber(false);
            break;
        case 'changing-room':
            chamber(true);
            break;
        case 'column':
        case 'barrel': {
            const count =
                item.family === 'barrel' ? (item.block === 50 ? 4 : item.block === 26 ? 2 : 1) : 1;
            for (let i = 0; i < count; i++) {
                const x = ((i + 0.5) * w) / count;
                const radius = Math.max(1.5, (w / count) * 0.36);
                tube(x, h / 2, 0, radius, h - 3, body);
                for (const y of [2, h - 2]) tube(x, y, 0, radius * 1.15, 2.6, trim);
                box(x, h / 2, radius, 1.2, h * 0.65, 0.6, glow);
            }
            break;
        }
        case 'turret': {
            group.add(createVrTurret(r, w, h, body, trim));
            break;
        }
        case 'tower': {
            box(w / 2, h * 0.67, 0, Math.max(4, w * 0.45), h * 0.65, 9, body);
            flanges(h - 2);
            for (let y = h * 0.35; y < h - 4; y += 5) box(w / 2, y, 5, w * 0.35, 1, 1, trim);
            if (item.block === 15) {
                const dish = orb(w / 2, h * 0.16, 0, w * 0.46, h * 0.12, 3, trim, 'radar-dish');
                dish.rotation.z = 0.3;
                tube(w / 2, h * 0.16, 4, 0.7, w * 0.7, r.gold, true);
            } else {
                tube(w / 2, h * 0.15, 0, w * 0.24, h * 0.27, trim);
                orb(w / 2, 1, 0, 1.5, 1.5, 1.5, r.red);
            }
            break;
        }
        case 'gate':
        case 'stage-gate': {
            group.add(createVrGate(item, r, body, trim));
            break;
        }
        case 'supply': {
            box(w / 2, h / 2, 0, w - 1, h - 1, 9, body);
            for (const x of [2, w - 2]) box(x, h / 2, 4.8, 1.4, h, 1, r.gold);
            const mat = item.block === 20 ? r.red : r.cyan;
            box(w / 2, h / 2, 5.1, w * 0.38, 2, 0.6, mat);
            box(w / 2, h / 2, 5.1, 2, h * 0.45, 0.6, mat);
            break;
        }
        case 'sphere-pod': {
            orb(w / 2, h / 2, -1, w * 0.47, h * 0.46, 5, body);
            ring(w / 2, h / 2, 4, Math.min(w, h) * 0.3, r.gold);
            orb(w / 2, h / 2, 3, w * 0.22, h * 0.22, 3, r.cyan);
            break;
        }
        case 'pump': {
            box(w / 2, h * 0.2, -1, w, h * 0.32, 11, trim);
            tube(w / 2, h * 0.58, 0, w * 0.17, h * 0.65, r.metal);
            flanges(h - 2);
            for (let y = h * 0.38; y < h * 0.85; y += 4)
                ring(w / 2, y, 1, w * 0.18, r.green).rotation.x = Math.PI / 2;
            break;
        }
        case 'beacon':
            tube(w / 2, h * 0.6, 0, w * 0.16, h * 0.8, r.metal);
            orb(w / 2, h * 0.18, 0, w * 0.35, h * 0.17, 4, glow);
            flanges(h - 1);
            break;
        case 'mine':
            orb(w / 2, h - 2, 0, Math.max(3, w / 2), 3.2, 5, r.gold);
            orb(w / 2, h - 5, 0, 1, 1, 1, r.red);
            break;
        case 'mushroom':
            tube(w / 2, h * 0.68, 0, w * 0.16, h * 0.65, body);
            orb(w / 2, h * 0.27, 0, w * 0.5, h * 0.26, 7, trim);
            break;
        case 'wagon':
            box(w / 2, h * 0.4, 0, w, h * 0.65, 12, body);
            for (const x of [w * 0.2, w * 0.8]) {
                const wheel = tube(x, h * 0.83, 3, h * 0.18, 12, r.dark);
                wheel.rotation.x = Math.PI / 2;
                ring(x, h * 0.83, 9.2, h * 0.13, r.gold);
            }
            break;
        case 'diagonal': {
            const left = item.block === 48;
            extrude(
                left
                    ? [
                          [0, h],
                          [w, 0],
                          [w, h],
                      ]
                    : [
                          [0, 0],
                          [w, h],
                          [0, h],
                      ],
                10,
                body,
            );
            break;
        }
        case 'flash':
        case 'voltage':
            for (const x of [2, w - 2]) {
                tube(x, h / 2, -1, 1.6, h, r.metal);
                for (let y = 3; y < h; y += 4) ring(x, y, -1, 2, trim).rotation.x = Math.PI / 2;
            }
            box(w / 2, h / 2, 1, Math.max(1, w - 5), 1, 1, r.purple);
            break;
        case 'platform':
            box(w / 2, h / 2, 0, w, h, 12, trim);
            for (let x = 3; x < w; x += 5) box(x, h / 2, 6.3, 1.7, h * 0.65, 0.8, r.gold);
            break;
        case 'support':
            box(w / 2, h / 2, -1, w, h, 7, body);
            for (const y of [2, h - 2]) box(w / 2, y, 0, w, Math.min(3, h / 3), 10, trim);
            for (let x = 4; x < w; x += 10) {
                box(x, h / 2, 4, 1.2, Math.max(1, h - 4), 1, r.metal);
                orb(x, 2, 5.2, 0.7, 0.7, 0.6, r.gold);
            }
            break;
    }
    return group;
}

export function disposeVrScreen(group: Group) {
    group.traverse((object) => {
        if (object instanceof Mesh && object.geometry.userData.screenOwned)
            object.geometry.dispose();
    });
    group.clear();
}
