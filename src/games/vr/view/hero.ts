import { ExtrudeGeometry, Group, Shape, Vector3 } from 'three';
import type { Mesh } from 'three';
import type { GameState } from '../../../types/game.ts';
import { createHeroMotion, getJetpackThrust } from '../../../view/hero-motion.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

export function createVrHero(r: VrResources) {
    const group = new Group();
    group.name = 'astronaut';
    const body = new Group();
    const armor = new Group();
    armor.name = 'armor';
    group.add(body);
    body.add(armor);
    solid(body, r.sphere, r.cream, 0, 4.3, 0, 4, 6.1, 3.6, 'torso');
    solid(body, r.box, r.dark, 0, 0.2, 0, 6.6, 2.8, 6, 'belt');
    solid(body, r.box, r.gold, 1.4, 0.3, 3.2, 1.9, 1.6, 0.7, 'belt-buckle');
    solid(body, r.sphere, r.cream, 0.3, 11, 0, 4.5, 4.8, 4.1, 'helmet');
    solid(body, r.sphere, r.visor, 2.5, 11, 1.4, 3.2, 2.7, 3.2, 'visor');
    solid(body, r.sphere, r.cyan, 3.2, 12.3, 3.9, 1.4, 0.22, 0.3, 'visor-reflection');
    solid(body, r.cylinder, r.metal, 0, 7.3, 0, 3.5, 1.6, 3.5, 'helmet-collar');
    solid(body, r.box, r.metal, -4.2, 4.5, -0.4, 3.8, 9, 6, 'backpack');
    for (const z of [-2.5, 2.5]) {
        solid(body, r.cylinder, r.gold, -5, 3.3, z, 1.4, 8, 1.4, 'oxygen-tank');
        solid(body, r.cylinder, r.dark, -5, -1, z, 1.1, 1.4, 1.1, 'jet-nozzle');
    }
    solid(body, r.box, r.white, 1, 4.5, 3.2, 3.6, 4.2, 1.2, 'chest-panel');
    for (const [index, mat] of [r.cyan, r.red, r.green].entries())
        solid(body, r.box, mat, 0.1 + index * 1.1, 4.4, 4, 0.55, 0.6, 0.5);
    // Far arm and near arm sit on opposite depth planes, with real shoulder joints.
    for (const z of [-3.7, 3.7]) {
        solid(body, r.sphere, r.cream, 1, 5.2, z, 2, 2.5, 1.8, 'shoulder');
        const upper = solid(body, r.cylinder, r.cream, 2.8, 2.7, z, 1.5, 5.8, 1.5, 'upper-arm');
        upper.rotation.z = 0.48;
        const forearm = solid(body, r.cylinder, r.cream, 5.2, 1.3, z, 1.4, 5, 1.4, 'forearm');
        forearm.rotation.z = Math.PI / 2;
        solid(body, r.sphere, r.dark, 7.2, 1.4, z, 1.3, 1.4, 1.4, 'glove');
    }
    const weapon = new Group();
    weapon.name = 'weapon';
    weapon.position.set(8, 2.3, 3.4);
    body.add(weapon);
    solid(weapon, r.box, r.dark, 1, 0, 0, 8, 2.7, 2.2);
    const barrel = solid(weapon, r.cylinder, r.metal, 6.2, 0.3, 0, 0.7, 6, 0.7);
    barrel.rotation.z = Math.PI / 2;
    solid(weapon, r.box, r.gold, 0, -1.3, 0, 2, 2, 1.6);
    solid(weapon, r.box, r.cyan, 2, 1.5, 0, 2.5, 0.4, 1);
    const muzzle = solid(weapon, r.sphere, r.gold, 9.4, 0.3, 0, 2.2, 1.5, 1.5, 'muzzle');
    for (const z of [-4.1, 4.1])
        solid(armor, r.sphere, r.gold, 0, 5.5, z, 3.4, 3.5, 1.9, 'armor-shoulder');
    solid(armor, r.box, r.metal, -0.2, 3, 4, 6.6, 6.5, 1.8, 'armor-chest');
    solid(armor, r.box, r.cyan, 0, 3.2, 5, 3.6, 0.6, 0.5);
    const flame = new Group();
    body.add(flame);
    for (const z of [-2.5, 2.5]) {
        const mesh = solid(flame, r.cone, r.cyan, -5, -4.1, z, 0.9, 5.4, 0.9);
        mesh.rotation.z = Math.PI;
    }
    const direction = new Vector3();
    const axis = new Vector3(0, 1, 0);
    // The shared gait plants this curved Remastered sole, not a rotated box.
    // Mirror its pixel-space y coordinates into the scene's upwards y axis.
    const bootShape = new Shape();
    bootShape.moveTo(-1.1, 1.3);
    bootShape.quadraticCurveTo(-0.1, 0.9, 0.85, 1.25);
    bootShape.lineTo(1.05, 0.3);
    bootShape.quadraticCurveTo(1.7, -0.3, 2.5, -0.35);
    bootShape.quadraticCurveTo(3.1, -0.55, 3.05, -1.35);
    bootShape.quadraticCurveTo(2.5, -1.8, 0.5, -1.8);
    bootShape.lineTo(-1.9, -1.65);
    bootShape.quadraticCurveTo(-2.2, -0.6, -1.55, 0.15);
    bootShape.closePath();
    const bootGeometry = r.geometry(
        new ExtrudeGeometry(bootShape, { depth: 3.4, bevelEnabled: false, steps: 1 }),
    );
    bootGeometry.translate(0, 0, -1.7);
    const legs = [true, false].map((far) => {
        const z = far ? -2 : 2;
        const label = far ? 'far' : 'near';
        const thigh = solid(group, r.cylinder, r.cream, 0, 0, z, 1.65, 1, 1.65, `${label}-thigh`);
        const shin = solid(group, r.cylinder, r.cream, 0, 0, z, 1.4, 1, 1.4, `${label}-shin`);
        const knee = solid(group, r.sphere, r.metal, 0, 0, z, 1.75, 1.5, 1.65, `${label}-knee`);
        const boot = solid(group, bootGeometry, r.dark, 0, 0, z, 1, 1, 1, `${label}-boot`);
        return { far, z, thigh, shin, knee, boot };
    });
    const motion = createHeroMotion();
    function limb(mesh: Mesh, ax: number, ay: number, bx: number, by: number, z: number) {
        direction.set(bx - ax, -(by - ay), 0);
        mesh.position.set((ax + bx) / 2, -(ay + by) / 2, z);
        mesh.scale.y = direction.length();
        mesh.quaternion.setFromUnitVectors(axis, direction.normalize());
    }
    function update(state: GameState, fraction: number, time: number) {
        const pose = motion.sample(state, time);
        // Both feet share the map's depth, inside its extruded supporting rock.
        group.position.set(pose.x + 12 - 128, 176 - pose.y - 16, 0);
        group.rotation.y = state.player.direction < 0 ? Math.PI : 0;
        group.visible = !(state.invulnerable && state.tick & 2);
        body.position.set(pose.body.x, -pose.body.y, 0);
        body.rotation.z = -pose.body.lean;
        armor.visible = state.exoskeleton;
        muzzle.visible = state.fireTicks === 1;
        flame.visible = getJetpackThrust(state, fraction) > 0;
        if (flame.visible) flame.scale.y = 0.75 + Math.sin(time * 0.045) * 0.2;
        for (const leg of legs) {
            const poseLeg = pose.legs.find((value) => value.far === leg.far)!;
            limb(leg.thigh, poseLeg.hip.x, poseLeg.hip.y, poseLeg.knee.x, poseLeg.knee.y, leg.z);
            limb(leg.shin, poseLeg.knee.x, poseLeg.knee.y, poseLeg.ankle.x, poseLeg.ankle.y, leg.z);
            leg.knee.position.set(poseLeg.knee.x, -poseLeg.knee.y, leg.z);
            leg.boot.position.set(poseLeg.ankle.x, -poseLeg.ankle.y, leg.z);
            leg.boot.rotation.z = -poseLeg.footAngle;
        }
    }
    return { group, update };
}
