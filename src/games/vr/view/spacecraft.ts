import {
    BufferGeometry,
    ExtrudeGeometry,
    Float32BufferAttribute,
    Group,
    LatheGeometry,
    Mesh,
    Shape,
    ShapeUtils,
    Vector2,
    Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Material } from 'three';
import { spectrumPalette } from '../../../view/palette.ts';
import type { VrInstance } from '../model/scene.ts';
import type { VrResources } from './materials.ts';

const templates = new WeakMap<VrResources, Group>();
type Outline = readonly (readonly [number, number])[];

// The recovered front-facing 88×64 artwork is the construction drawing. Plates
// have separate physical depths; no bitmap, dome or substitute landing gear.
function buildSpacecraft(r: VrResources) {
    const ship = new Group();
    ship.name = 'spacecraft';
    const cyan = spectrumPalette(69),
        white = spectrumPalette(71),
        yellow = spectrumPalette(70),
        red = spectrumPalette(66);
    const batches = new Map<Material, BufferGeometry[]>();
    const primitives = new Set<BufferGeometry>([r.box, r.sphere, r.cylinder, r.cone, r.ring]);
    function add(mesh: Mesh, name = '') {
        if (name) {
            mesh.name = name;
            ship.add(mesh);
        } else {
            mesh.updateMatrix();
            const geometry = mesh.geometry.index
                ? mesh.geometry.toNonIndexed()
                : mesh.geometry.clone();
            geometry.applyMatrix4(mesh.matrix);
            const material = mesh.material as Material;
            const batch = batches.get(material) || [];
            batch.push(geometry);
            batches.set(material, batch);
        }
        return mesh;
    }
    function plate(points: Outline, z: number, depth: number, color: string, name = '') {
        const shape = new Shape(points.map(([x, y]) => new Vector2(x, -y)));
        const geometry = new ExtrudeGeometry(shape, {
            depth,
            bevelEnabled: false,
            curveSegments: 1,
            steps: 1,
        });
        const mesh = new Mesh(geometry, r.material(color, 0.55));
        mesh.position.z = z;
        add(mesh, name);
        if (!name) geometry.dispose();
        return mesh;
    }
    // Closed contour rings form a pressure vessel, with a broad belly and a
    // bevelled, narrower rear. Unlike a long extrusion, its side profile changes
    // throughout its depth while every ring stays inside the recovered outline.
    function hull(
        points: Outline,
        center: readonly [number, number],
        rings: readonly (readonly [number, number, number])[],
        color: string,
        name: string,
    ) {
        const vertices: number[] = [];
        const layers = rings.map(([z, sx, sy]) =>
            points.map(
                ([x, y]) =>
                    new Vector3(
                        center[0] + (x - center[0]) * sx,
                        -center[1] - (y - center[1]) * sy,
                        z,
                    ),
            ),
        );
        function triangle(a: Vector3, b: Vector3, c: Vector3, outward: Vector3) {
            const normal = b.clone().sub(a).cross(c.clone().sub(a));
            const ordered = normal.dot(outward) >= 0 ? [a, b, c] : [a, c, b];
            for (const vertex of ordered) vertices.push(vertex.x, vertex.y, vertex.z);
        }
        const faces = ShapeUtils.triangulateShape(
            points.map(([x, y]) => new Vector2(x, -y)),
            [],
        );
        for (const [index, sign] of [
            [0, 1],
            [layers.length - 1, -1],
        ] as const)
            for (const [a, b, c] of faces)
                triangle(
                    layers[index][a],
                    layers[index][b],
                    layers[index][c],
                    new Vector3(0, 0, sign),
                );
        for (let layer = 1; layer < layers.length; layer++) {
            const front = layers[layer - 1],
                back = layers[layer];
            for (let i = 0; i < points.length; i++) {
                const next = (i + 1) % points.length;
                const outward = front[i]
                    .clone()
                    .add(front[next])
                    .multiplyScalar(0.5)
                    .sub(new Vector3(center[0], -center[1], front[i].z));
                triangle(front[i], back[i], back[next], outward);
                triangle(front[i], back[next], front[next], outward);
            }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        return add(new Mesh(geometry, r.material(color, 0.55)), name);
    }
    function box(
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        color: string,
        name = '',
    ) {
        const mesh = new Mesh(r.box, r.material(color, 0.55));
        mesh.position.set(x, -y, z);
        mesh.scale.set(w, h, d);
        return add(mesh, name);
    }
    function pipe(
        points: readonly (readonly [number, number, number])[],
        radius: number,
        color: string,
    ) {
        for (let i = 1; i < points.length; i++) {
            const a = new Vector3(points[i - 1][0], -points[i - 1][1], points[i - 1][2]);
            const b = new Vector3(points[i][0], -points[i][1], points[i][2]);
            const mesh = new Mesh(r.cylinder, r.material(color, 0.55));
            mesh.position.copy(a).add(b).multiplyScalar(0.5);
            mesh.scale.set(radius, a.distanceTo(b), radius);
            mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.sub(a).normalize());
            add(mesh);
        }
    }
    function bolt(x: number, y: number, z: number) {
        const mesh = new Mesh(r.cylinder, r.material(white.light, 0.55));
        mesh.position.set(x, -y, z);
        mesh.rotation.x = Math.PI / 2;
        mesh.scale.set(0.33, 0.3, 0.33);
        add(mesh);
    }
    box(44, 22, -1.5, 88, 0.95, 1.3, white.light, 'ship-crossbeam');
    for (const [side, x] of [
        ['left', 29],
        ['right', 59],
    ] as const) {
        box(x, 11.2, -1, 0.9, 22, 1, white.light, `ship-aerial-${side}`);
        for (const [y, w, h] of [
            [7.25, 1.4, 1.5],
            [15.85, 1.8, 1.7],
            [21.5, 2.4, 3],
        ])
            box(x, y, -0.7, w, h, 1.6, white.base);
        pipe(
            [
                [x, 22, -1],
                [x < 44 ? 34 : 54, 25, 0],
            ],
            0.35,
            white.base,
        );
        for (const y of [9, 11, 13])
            box(x + (x < 44 ? 0.75 : -0.75), y, -0.8, 1.5, 0.4, 0.6, white.light);
    }
    plate(
        [
            [23, 24],
            [65, 24],
            [74, 32],
            [68, 43],
            [61, 49],
            [44, 63.4],
            [27, 49],
            [20, 43],
            [14, 32],
        ],
        -4,
        8,
        cyan.deep,
        'ship-underframe',
    );
    hull(
        [
            [25, 25],
            [63, 25],
            [65, 31],
            [64, 45],
            [59, 50],
            [44, 61.5],
            [29, 50],
            [24, 45],
            [23, 31],
        ],
        [44, 39],
        [
            [4, 1, 1],
            [-3, 1, 1],
            [-11, 0.98, 0.98],
            [-18, 0.86, 0.88],
            [-23, 0.68, 0.72],
        ],
        cyan.shade,
        'ship-pressure-hull',
    );
    // A fitted service cover and sparse heat fins finish the closed rear cap.
    // Negative depths keep these details on the back, clear of the front glass.
    plate(
        [
            [38, 33],
            [50, 33],
            [53, 37],
            [51, 45],
            [44, 49],
            [37, 45],
            [35, 37],
        ],
        -23.7,
        0.7,
        cyan.deep,
    );
    plate(
        [
            [39, 34],
            [49, 34],
            [51.5, 37.5],
            [49.8, 44.3],
            [44, 47.5],
            [38.2, 44.3],
            [36.5, 37.5],
        ],
        -24.1,
        0.4,
        cyan.base,
    );
    for (const x of [39, 41, 43, 45, 47, 49]) box(x, 39.5, -24.6, 0.55, 6, 0.8, cyan.deep);
    for (const x of [37.5, 50.5]) {
        box(x, 36.5, -24.2, 0.8, 0.8, 0.5, white.shade);
        box(x + (x < 44 ? 1 : -1), 44, -24.2, 0.8, 0.8, 0.5, white.shade);
    }
    plate(
        [
            [25, 25],
            [63, 25],
            [64, 47],
            [44, 63],
            [24, 47],
        ],
        1,
        6,
        cyan.base,
        'ship-hull',
    );
    plate(
        [
            [25.1, 24.2],
            [62.9, 24.2],
            [61.4, 29],
            [44, 33.2],
            [26.6, 29],
        ],
        6,
        3,
        cyan.base,
    );
    box(44, 24.3, 9.2, 37.6, 0.65, 0.5, white.light);
    for (let x = 28; x <= 60; x += 4) box(x + 1, 25.65, 9.2, 2, 1.1, 0.5, cyan.deep);

    const nozzleGeometry = new LatheGeometry(
        [
            new Vector2(2.8, 0),
            new Vector2(1.15, 8.05),
            new Vector2(1.5, 12.35),
            new Vector2(2.2, 12.35),
            new Vector2(1.8, 8.05),
            new Vector2(3.6, 0),
            new Vector2(2.8, 0),
        ],
        16,
    );
    const flameGeometry = new LatheGeometry(
        [
            new Vector2(0, -15.5),
            new Vector2(0.8, -11),
            new Vector2(1.8, -6),
            new Vector2(2.45, -2.5),
            new Vector2(2.2, 0),
            new Vector2(0, 0),
        ],
        12,
    );
    for (const [side, mirrored] of [
        ['left', false],
        ['right', true],
    ] as const) {
        const sx = (x: number) => (mirrored ? 88 - x : x);
        const outline = (points: Outline): Outline => points.map(([x, y]) => [sx(x), y]);
        const sidePlate = (points: Outline, z: number, depth: number, color: string, name = '') =>
            plate(outline(points), z, depth, color, name);
        hull(
            outline([
                [23.5, 24],
                [19, 26],
                [14.3, 32],
                [17.5, 40],
                [23.7, 36.7],
                [27, 27],
            ]),
            [sx(21), 30.5],
            [
                [7, 1, 1],
                [-2, 1, 1],
                [-9, 0.8, 0.84],
                [-13, 0.56, 0.62],
            ],
            white.shade,
            `ship-shoulder-fairing-${side}`,
        );
        hull(
            outline([
                [21, 28],
                [24, 29.6],
                [24, 44.8],
                [16, 41],
                [16, 33],
            ]),
            [sx(20), 36.5],
            [
                [9, 1, 1],
                [-1, 1, 1],
                [-10, 0.9, 0.92],
                [-16, 0.6, 0.65],
            ],
            yellow.shade,
            `ship-nacelle-housing-${side}`,
        );
        sidePlate(
            [
                [23.5, 24],
                [19, 26],
                [14.3, 32],
                [17.5, 40],
                [23.7, 36.7],
                [27, 27],
            ],
            0,
            8,
            white.shade,
        );
        sidePlate(
            [
                [23.3, 24.3],
                [19.3, 26.5],
                [15.5, 31.8],
                [18.2, 37],
                [23.3, 34.5],
                [26, 26.8],
            ],
            7,
            2,
            white.base,
            `ship-shoulder-${side}`,
        );
        sidePlate(
            [
                [17, 31.3],
                [20.8, 27.8],
                [21.8, 29],
                [18.1, 32.8],
            ],
            9,
            0.25,
            '#143a48',
        );
        sidePlate(
            [
                [21, 28],
                [24, 29.6],
                [24, 44.8],
                [16, 41],
                [16, 33],
            ],
            3,
            6.5,
            cyan.deep,
        );
        sidePlate(
            [
                [20.5, 28.5],
                [23.3, 30],
                [23.3, 43.3],
                [17.2, 40.2],
                [16.7, 33],
            ],
            9,
            1.2,
            yellow.base,
            `ship-nacelle-${side}`,
        );
        pipe(
            [
                [sx(20.2), 29.8, 10.6],
                [sx(17.5), 33.2, 10.6],
                [sx(17.9), 39, 10.6],
            ],
            0.25,
            yellow.highlight,
        );
        for (let y = 34; y < 40; y += 1.25)
            pipe(
                [
                    [sx(21.4), y, 10.55],
                    [sx(22.7), y + 0.6, 10.55],
                ],
                0.23,
                yellow.deep,
            );
        box(sx(20.75), 40.7, 10.1, 6.5, 1.2, 1, white.shade);
        box(sx(11.5), 22, -1, 5, 2, 2, white.shade);
        for (let x = 9; x < 27; x += 2) box(sx(x + 0.325), 22.7, -0.5, 0.65, 1.25, 0.8, white.base);
        pipe(
            [
                [sx(13), 22.3, -1],
                [sx(23), 26, 1],
            ],
            0.3,
            white.base,
        );
        // Separate folded shield armour surrounds the recessed angular canopy.
        sidePlate(
            [
                [26.4, 29],
                [33.8, 32],
                [36.3, 43.3],
                [42.2, 48],
                [41.8, 58.8],
                [28.3, 48.3],
            ],
            7,
            3.5,
            cyan.base,
            `ship-armour-${side}`,
        );
        sidePlate(
            [
                [26.4, 29],
                [28.3, 48.3],
                [31.8, 50.5],
                [29.3, 34],
            ],
            10.5,
            0.6,
            cyan.shade,
        );
        pipe(
            [
                [sx(27.4), 31, 11.2],
                [sx(29.4), 46.5, 11.2],
                [sx(40), 54.8, 11.2],
            ],
            0.22,
            cyan.light,
        );
        sidePlate(
            [
                [29.2, 35.2],
                [32, 36.5],
                [32.9, 42.1],
                [30, 40.7],
            ],
            10.6,
            0.6,
            cyan.deep,
        );
        for (let y = 36.5; y < 40.5; y += 1.15)
            pipe(
                [
                    [sx(30.1), y, 11.4],
                    [sx(32), y + 0.9, 11.4],
                ],
                0.2,
                cyan.shade,
            );
        pipe(
            [
                [sx(29.8), 42.7, 11],
                [sx(35.2), 46.2, 11],
                [sx(35.4), 49.4, 11],
            ],
            0.25,
            cyan.deep,
        );
        sidePlate(
            [
                [31.9, 48.2],
                [34.5, 49.8],
                [34.7, 52],
                [32.2, 50.3],
            ],
            10.6,
            0.8,
            white.shade,
        );
        for (const [x, y] of [
            [18.3, 33.7],
            [23.3, 27.4],
            [28.4, 32.3],
            [30, 46],
            [38.8, 53.4],
        ])
            bolt(sx(x), y, 11.4);
        for (const y of [49.8, 51])
            pipe(
                [
                    [sx(36.6), y, 11],
                    [sx(39.1), y + 1.8, 11],
                ],
                0.22,
                cyan.light,
            );
        // Source plumbing is offset seven pixels outside the nacelle, ending in
        // a genuine hollow flared bell, not a foot or a capped cylinder.
        pipe(
            [
                [sx(18.5), 36.5, 4.5],
                [sx(13), 37.5, 4.5],
                [sx(10.6), 40, 4.5],
                [sx(12), 42, 4.5],
            ],
            0.55,
            white.light,
        );
        sidePlate(
            [
                [10, 36.5],
                [14.3, 37.4],
                [15.7, 43],
                [9.5, 43],
            ],
            2.5,
            6,
            white.base,
        );
        box(sx(12.55), 42.6, 5.5, 6.5, 1.4, 7, '#0a2635');
        box(sx(12.55), 42.25, 9.1, 5.9, 0.5, 0.5, white.base);
        const nozzle = new Mesh(nozzleGeometry, r.material(white.light, 0.7));
        nozzle.position.set(sx(12.6), -55.55, 5.5);
        add(nozzle, `ship-nozzle-${side}`);
        for (const dx of [-1.4, 0, 1.4])
            pipe(
                [
                    [sx(12.6 + dx), 43.7, 7.4],
                    [sx(12.6 + dx), 47.5, 7.2],
                    [sx(12.6 + dx * 1.8), 54.3, 8],
                ],
                0.16,
                white.shade,
            );
        const plume = new Group();
        plume.name = `ship-plume-${side}`;
        plume.position.copy(nozzle.position);
        for (const [color, width, length, z] of [
            ['#ff7029', 1, 1, 0],
            ['#ffc34d', 0.83, 0.84, 0.95],
            ['#fffdf1', 0.53, 0.66, 1.65],
        ] as const) {
            const flame = new Mesh(flameGeometry, r.material(color, 0.05, true));
            flame.scale.set(width, length, width * 0.6);
            flame.position.z = z;
            plume.add(flame);
        }
        ship.add(plume);
    }
    const canopy: Outline = [
        [30.7, 29.5],
        [44, 32.4],
        [57.3, 29.5],
        [54.4, 42.5],
        [44, 49],
        [33.6, 42.5],
    ];
    plate(canopy, 7.5, 2.4, cyan.deep, 'ship-cockpit');
    const edge = canopy.map(([x, y]) => [x, y, 10.8] as const);
    pipe([...edge, edge[0]], 0.35, cyan.highlight);
    plate(
        [
            [32.4, 31.4],
            [40.7, 34],
            [40.8, 43.8],
            [35.1, 40.8],
        ],
        9.9,
        0.2,
        '#082c40',
    );
    plate(
        [
            [55.6, 31.4],
            [47.3, 34],
            [47.2, 43.8],
            [52.9, 40.8],
        ],
        9.9,
        0.2,
        '#082c40',
    );
    plate(
        [
            [41.5, 33],
            [46.5, 33],
            [46.4, 45.6],
            [44, 47.5],
            [41.6, 45.6],
        ],
        9.9,
        0.7,
        cyan.shade,
    );
    box(44, 39.1, 10.75, 3.6, 10, 0.5, '#031b2e');
    box(44, 38.95, 11.05, 2.8, 8.5, 0.1, '#061f33');
    pipe(
        [
            [42.8, 35.1, 11.15],
            [43.4, 35.1, 11.15],
            [43.4, 40, 11.15],
        ],
        0.12,
        '#90e8ef',
    );
    for (const points of [
        [
            [33.3, 31.8, 10.25],
            [35.4, 40.7, 10.25],
            [40.7, 44, 10.25],
        ],
        [
            [47.3, 44, 10.25],
            [52.8, 40.7, 10.25],
            [54.7, 32.3, 10.25],
        ],
    ] as const)
        pipe(points, 0.16, '#5ab6c0');
    plate(
        [
            [41.5, 48],
            [44, 49.6],
            [46.5, 48],
            [45.7, 60.2],
            [44, 63],
            [42.3, 60.2],
        ],
        7,
        3.5,
        cyan.base,
        'ship-keel',
    );
    box(44, 54.4, 10.6, 2, 6.2, 0.6, cyan.deep);
    box(43.6, 54.2, 11, 0.45, 4.4, 0.25, cyan.base);
    bolt(44, 50.2, 11);
    box(44, 22.95, 6, 7.4, 2.5, 5, cyan.deep);
    box(44, 22.1, 9, 5.4, 2.8, 3, red.base, 'ship-beacon');
    box(44, 20.35, 8.5, 1.8, 0.7, 2, red.base);
    box(43.85, 21.2, 10.6, 3.7, 0.4, 0.4, red.highlight);
    // Fixed detailing is one draw per material, shared across every ship. The
    // short-lived transformed primitives never enter the renderer resource pool.
    for (const [material, geometries] of batches) {
        const merged = mergeGeometries(geometries);
        for (const geometry of geometries) geometry.dispose();
        if (merged) ship.add(new Mesh(merged, material));
    }
    const geometries = new Set<BufferGeometry>();
    ship.traverse((child) => {
        if (child instanceof Mesh && !primitives.has(child.geometry))
            geometries.add(child.geometry);
    });
    for (const geometry of geometries) r.geometry(geometry);
    return ship;
}

export function createVrSpacecraft(item: VrInstance, r: VrResources): Group {
    let template = templates.get(r);
    if (!template) {
        template = buildSpacecraft(r);
        templates.set(r, template);
    }
    const ship = template.clone(true);
    ship.scale.set(item.width / 88, item.height / 64, 1);
    ship.userData.phase = item.instance;
    return ship;
}

export function updateVrSpacecraft(group: Group, time: number) {
    const seconds = (Number.isFinite(time) ? time : 0) * 0.001;
    const phase = typeof group.userData.phase === 'number' ? group.userData.phase : 0;
    for (const [index, side] of ['left', 'right'].entries()) {
        const plume = group.getObjectByName(`ship-plume-${side}`);
        if (!plume) continue;
        const offset = phase + index * 2.17;
        const pulse =
            0.5 +
            Math.sin(seconds * 9.7 + offset) * 0.3 +
            Math.sin(seconds * 23.3 + offset * 1.9) * 0.2;
        plume.scale.y = (13.8 + pulse * 2.2) / 15.5;
        // Origin and root radius remain fixed at the nozzle. Only the taper's
        // length pulses; the model, nozzle and its attachment never move.
    }
}
