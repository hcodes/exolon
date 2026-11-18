import { Group } from 'three';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

// Recovered action-4 center is (x*8+4, y*8+3.3). The socket overlaps
// the gate's z=5 facade instead of placing a loose bulb at actor depth.
export function createVrLamp(r: VrResources) {
    const group = new Group();
    group.name = 'lamp-fixture';
    const socket = solid(group, r.cylinder, r.dark, 4, -3.3, 5.9, 2.2, 1.2, 2.2, 'lamp-housing');
    socket.rotation.x = Math.PI / 2;
    solid(group, r.ring, r.gold, 4, -3.3, 6.45, 1.65, 1.8, 1.65, 'lamp-bezel');
    solid(group, r.sphere, r.visor, 4, -3.3, 6.5, 1.5, 1.6, 0.3, 'lamp-glass');
    solid(group, r.sphere, r.red, 4, -3.3, 6.65, 1.45, 1.55, 0.35, 'lamp');
    solid(group, r.sphere, r.white, 3.6, -2.8, 6.93, 0.35, 0.4, 0.12, 'lamp-reflection');
    return group;
}
