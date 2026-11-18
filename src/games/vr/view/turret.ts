import { Group } from 'three';
import type { Material } from 'three';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

// Recovered tall guns put action 3 one tile below their top; low guns put it
// at the top. Shots travel left from the action's first pixel, three pixels down.
export function createVrTurret(
    r: VrResources,
    width: number,
    height: number,
    body: Material,
    trim: Material,
) {
    const group = new Group();
    group.name = 'turret';
    const low = height <= 16;
    const boreY = low ? -3 : -11;
    const baseY = -height + 3;
    const pivotX = width * 0.64;
    solid(group, r.box, r.dark, width / 2 + 5, baseY - 1, 3, width - 10, 4, 20, 'turret-foot');
    solid(group, r.box, body, width / 2 + 5, baseY + 1, 3, width - 12, 3, 18);
    solid(group, r.cylinder, r.metal, pivotX, baseY + 3, 3, 9, 2, 7);
    if (!low) {
        solid(group, r.box, body, pivotX, -25, 3, 16, 12, 12, 'turret-pedestal');
        for (const z of [-3.3, 9.3]) {
            solid(group, r.box, trim, pivotX, -25, z, 11, 7, 0.8);
            for (const x of [pivotX - 3, pivotX + 3])
                solid(group, r.sphere, r.gold, x, -25, z, 0.6, 0.6, 0.5);
        }
    }
    solid(group, r.sphere, body, pivotX + 3, low ? -7 : -15, 5, 14, low ? 6 : 11, 9);
    solid(group, r.box, r.metal, pivotX - 1, boreY, 11, 13, 5.6, 8, 'turret-receiver');
    solid(group, r.box, trim, pivotX + 2, boreY + 2.4, 11, 12, 1.3, 8.8);
    solid(group, r.box, r.dark, pivotX + 7.3, boreY, 11, 1.6, 4.5, 7);
    // Paired trunnions and their inset hubs stay fixed while the barrel slides.
    for (const z of [1.5, 15.8]) {
        const axle = solid(group, r.cylinder, trim, pivotX, boreY - 1.6, z, 3.2, 1.8, 3.2);
        axle.rotation.x = Math.PI / 2;
        const hub = solid(group, r.cylinder, r.dark, pivotX, boreY - 1.6, z + 1, 1.45, 0.4, 1.45);
        hub.rotation.x = Math.PI / 2;
    }
    for (let index = 0; index < 3; index++)
        solid(group, r.box, r.dark, pivotX + 6 + index * 2, boreY - 5, 12, 0.7, 3, 0.7);
    solid(group, r.sphere, r.red, pivotX + 3, boreY + (low ? 2 : 4), 13, 0.8, 0.7, 0.7);

    const barrel = new Group();
    barrel.name = 'turret-barrel';
    barrel.position.set(0, boreY, 11);
    group.add(barrel);
    const shaft = solid(barrel, r.cylinder, r.gold, 15, 0, 0, 1.1, 26, 1.1);
    shaft.rotation.z = Math.PI / 2;
    for (const x of [5.5, 9, 12.5, 16, 19.5, 23]) {
        const sleeve = solid(barrel, r.cylinder, r.metal, x, 0, 0, 1.4, 0.8, 1.4);
        sleeve.rotation.z = Math.PI / 2;
    }
    const muzzleSleeve = solid(barrel, r.cylinder, trim, 1.8, 0, 0, 2, 3.2, 2);
    muzzleSleeve.rotation.z = Math.PI / 2;
    const muzzle = new Group();
    muzzle.name = 'turret-muzzle';
    barrel.add(muzzle);
    const bore = solid(muzzle, r.cylinder, r.dark, 0.19, 0, 0, 1.38, 0.08, 1.38);
    bore.rotation.z = Math.PI / 2;
    const rim = solid(muzzle, r.ring, r.gold, 0.12, 0, 0, 1.65, 1.65, 1.65);
    rim.rotation.y = Math.PI / 2;
    const flash = new Group();
    flash.name = 'turret-flash';
    flash.visible = false;
    muzzle.add(flash);
    const flame = solid(
        flash,
        r.cone,
        r.material('#ffd58a', 0.15, true),
        -2.8,
        0,
        0,
        1.7,
        5.6,
        1.7,
    );
    flame.rotation.z = Math.PI / 2;
    solid(flash, r.sphere, r.cream, -0.6, 0, 0, 1.2, 0.85, 0.85);
    return group;
}

export function updateVrTurret(group: Group, phase: number) {
    // Phase 9 emits the shot at the extended muzzle; original phases 8..1
    // then retract seven pixels toward the receiver and recover one per step.
    const barrel = group.getObjectByName('turret-barrel');
    if (barrel) barrel.position.x = phase >= 2 && phase <= 8 ? phase - 1 : 0;
    const flash = group.getObjectByName('turret-flash');
    if (flash) flash.visible = phase === 9;
}
