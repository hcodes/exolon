import { Group } from 'three';
import type { GameState } from '../../../types/game.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';
import { createVrLamp } from './lamps.ts';
import { updateVrTurret } from './turret.ts';
import { updateVrSpacecraft } from './spacecraft.ts';

export function createVrMechanisms(r: VrResources) {
    const group = new Group();
    group.name = 'active-machinery';
    const objects = new Map<number, Group>();
    const ships = new Set<Group>();
    function reset(state: GameState, staticScene: Group) {
        group.clear();
        objects.clear();
        ships.clear();
        for (const instance of staticScene.children) {
            const ship = instance.getObjectByName('spacecraft');
            if (ship instanceof Group) ships.add(ship);
        }
        for (const object of state.objects) {
            if (![2, 3, 4, 5, 10, 15, 17].includes(object.type)) continue;
            if (object.type === 2 && object.block === 2) continue;
            if (object.type === 3) {
                const instance = staticScene.children.find(
                    (child) => child.userData.instance === object.instance,
                );
                const turret = instance?.getObjectByName('turret');
                if (turret instanceof Group) objects.set(object.id, turret);
                continue;
            }
            const mesh = new Group();
            mesh.position.set(object.x * 8 - 128, 176 - object.y * 8, 10);
            mesh.name = `action-${object.type}-${object.id}`;
            objects.set(object.id, mesh);
            group.add(mesh);
            if (object.type === 17) {
                solid(
                    mesh,
                    r.cylinder,
                    r.purple,
                    4,
                    -8 - object.length * 4,
                    -1,
                    1.2,
                    Math.max(1, object.length * 8),
                    1.2,
                    'beam',
                );
                solid(mesh, r.sphere, r.cyan, 4, -8, -1, 3, 1.5, 3);
            } else if (object.type === 4) {
                mesh.position.z = 0;
                mesh.add(createVrLamp(r));
            } else if (object.type === 5) {
                solid(mesh, r.sphere, r.gold, 8, 2, 0, 7, 2.7, 4);
                solid(mesh, r.sphere, r.red, 8, 4, 0, 1.1, 1.1, 1.1);
            } else if (object.type === 10) {
                solid(mesh, r.cylinder, r.green, 12, -12, -2, 3.5, 24, 3.5);
                solid(mesh, r.box, r.metal, 12, -25, -2, 22, 5, 9);
            } else if (object.type === 15) {
                for (let i = 0; i < 8; i++) {
                    const arc = solid(
                        mesh,
                        r.cylinder,
                        r.purple,
                        i * 4,
                        -7,
                        0,
                        0.45,
                        5,
                        0.45,
                        `arc-${i}`,
                    );
                    arc.rotation.z = i % 2 ? -0.6 : 0.6;
                }
            } else if (object.type === 2 && object.block !== 2) {
                const flame = solid(mesh, r.cone, r.cyan, 4, -14, -2, 3, 13, 3);
                flame.rotation.z = Math.PI;
            }
        }
    }
    return {
        group,
        reset,
        update(state: GameState, time: number) {
            for (const ship of ships) updateVrSpacecraft(ship, time);
            for (const object of state.objects) {
                const mesh = objects.get(object.id);
                if (!mesh) continue;
                mesh.visible =
                    (object.active || object.type === 5) &&
                    !state.destroyed.includes(object.instance!);
                if (!mesh.visible) continue;
                if (object.type === 10) mesh.position.y = 176 - (object.y + object.yOffset) * 8;
                else if (object.type === 17) {
                    const beam = mesh.getObjectByName('beam');
                    if (beam) {
                        beam.visible = object.length > 0 && object.hits < 25;
                        beam.scale.x = beam.scale.z =
                            (0.8 + Math.sin(time * 0.02) * 0.25) * (1 - object.hits / 25);
                    }
                } else if (object.type === 3) {
                    updateVrTurret(mesh, object.phase);
                } else if (object.type === 4) {
                    const lamp = mesh.getObjectByName('lamp');
                    if (lamp) lamp.visible = Math.sin(time * 0.006 + object.id) > -0.4;
                } else if (object.type === 15)
                    for (const [i, arc] of mesh.children.entries())
                        arc.scale.y = 2 + Math.sin(time * 0.02 + i) * 2;
            }
        },
    };
}
