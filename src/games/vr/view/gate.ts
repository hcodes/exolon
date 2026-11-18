import { Group } from 'three';
import type { MeshStandardMaterial } from 'three';
import type { VrInstance } from '../model/scene.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

export function createVrGate(
    item: VrInstance,
    r: VrResources,
    body: MeshStandardMaterial,
    trim: MeshStandardMaterial,
) {
    const group = new Group();
    group.name = 'gate-frame';
    const w = item.width,
        h = item.height,
        large = item.family === 'stage-gate',
        rail = large ? 14 : 13,
        top = large ? 0 : 9;
    function box(
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number,
        name = '',
    ) {
        return solid(group, r.box, body, x, -y, z, width, height, depth, name);
    }
    function brace(ax: number, ay: number, bx: number, by: number) {
        const mesh = solid(
            group,
            r.box,
            trim,
            (ax + bx) / 2,
            -(ay + by) / 2,
            5.2,
            Math.hypot(bx - ax, by - ay),
            0.9,
            0.8,
        );
        mesh.rotation.z = Math.atan2(ay - by, bx - ax);
    }
    for (const left of [large ? 1 : 9, w - rail - (large ? 1 : 9)]) {
        const start = top + (large ? 0 : 6);
        box(left + rail / 2, (start + h - 3) / 2, 0, rail, h - 3 - start, 10, 'gate-column');
        box(left + rail / 2, h - 2.5, 0, rail + (large ? 0 : 14), 5, 12, 'column-foot');
        for (let y = top + 11; y < h - 7; y += 12) {
            brace(left + 2.5, y, left + rail - 3, y + 8);
            brace(left + rail - 3, y + 8, left + 2.5, y + 8);
            solid(group, r.sphere, r.gold, left + rail - 3, -y - 8, 5.8, 0.65, 0.65, 0.5);
        }
    }
    box(w / 2, top + 3.25, 0, w, 6.5, 10, 'gate-crossbeam');
    if (!large) {
        box(w / 2, top + 11, 0, w * 0.28, 10, 10, 'lamp-crossbeam');
        for (let x = 5; x < w - 4; x += 9) {
            brace(x, top + 5.5, x + 3.5, top + 1.5);
            brace(x + 3.5, top + 1.5, Math.min(w - 2, x + 8), top + 5.5);
        }
    } else {
        for (let x = 10; x < w - 7; x += 6)
            solid(group, r.cylinder, r.gold, x, -h / 2, -2, 0.6, h, 0.6);
    }
    for (const tile of item.tiles) {
        if (tile.collision !== 4) continue;
        const x = tile.x - item.x + 4,
            y = tile.y - item.y + 3.3;
        box(x, y, 5.1, 5.6, 6, 1.2, 'lamp-socket');
        // The upper beacons sit above the lintel on short rooted pedestals.
        // The lower row is recessed into the recovered central bracket.
        if (y < top) box(x, (y + top) / 2, 3.9, 2.4, top - y, 3, 'lamp-pedestal');
    }
    return group;
}
