import { Group } from 'three';
import type { GameState, Point } from '../../../types/game.ts';
import { createProjectileMotion } from '../../../view/projectile-motion.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

export type VrActorKind =
    'bullet' | 'enemy-bullet' | 'rocket' | 'grenade' | 'sphere' | 'flying' | 'killer';

export function createVrActor(kind: VrActorKind, r: VrResources, sprite = 1) {
    const group = new Group();
    group.name = kind;
    if (kind === 'bullet' || kind === 'enemy-bullet') {
        solid(group, r.sphere, kind === 'bullet' ? r.cyan : r.red, 0, 0, 0, 2.6, 0.65, 0.65);
    } else if (kind === 'rocket' || kind === 'grenade') {
        const body = solid(group, r.cylinder, r.white, 0, 0, 0, 1.3, 7, 1.3);
        body.rotation.z = Math.PI / 2;
        const nose = solid(group, r.cone, r.gold, 4.5, 0, 0, 1.3, 2, 1.3);
        nose.rotation.z = -Math.PI / 2;
        for (const z of [-1.4, 1.4]) solid(group, r.box, r.red, -2.5, 0, z, 2, 3.5, 0.5);
        const exhaust = solid(group, r.cone, r.cyan, -5.5, 0, 0, 1, 4, 1, 'exhaust');
        exhaust.rotation.z = Math.PI / 2;
    } else if (kind === 'sphere') {
        solid(group, r.sphere, r.gold, 0, 0, 0, 2.7, 2.7, 2.7);
        solid(group, r.ring, r.cyan, 0, 0, 0, 2.5, 2.5, 2.5);
    } else if (kind === 'killer') {
        solid(group, r.sphere, r.purple, 0, 0, 0, 7, 7, 7, 'sweeper-core');
        const ring = solid(group, r.ring, r.gold, 0, 0, 0, 7.1, 7.1, 7.1, 'sweeper-ring');
        ring.rotation.x = 0.65;
        for (let index = 0; index < 6; index++) {
            const angle = (index * Math.PI) / 3;
            const spike = solid(
                group,
                r.cone,
                r.purple,
                Math.cos(angle) * 7,
                Math.sin(angle) * 7,
                0,
                1.2,
                3,
                1.2,
                'sweeper-spike',
            );
            spike.rotation.z = angle - Math.PI / 2;
        }
    } else {
        const insect = sprite === 20 || sprite === 24;
        const mat = sprite === 37 || sprite === 41 ? r.purple : sprite === 16 ? r.green : r.gold;
        solid(group, r.sphere, r.dark, 0, 0, 0, 5.5, insect ? 2.9 : 3.8, 3.2, 'enemy-body');
        solid(group, r.sphere, mat, -1, 1, 0, 3.2, 2.8, 3.6, 'enemy-carapace');
        solid(group, r.sphere, r.red, 3.2, 0.9, 2.5, 1.2, 1.2, 1.2, 'enemy-eye');
        for (const sign of [-1, 1]) {
            const wing = solid(
                group,
                r.sphere,
                mat,
                -1,
                1.5,
                sign * 5.2,
                insect ? 5.8 : 4.1,
                0.65,
                3.2,
                `wing-${sign}`,
            );
            wing.rotation.x = sign * 0.35;
            if (insect)
                for (let i = 0; i < 3; i++) {
                    const leg = solid(
                        group,
                        r.cylinder,
                        r.metal,
                        i * 2 - 2,
                        -2.5,
                        sign * 3.7,
                        0.4,
                        5,
                        0.4,
                    );
                    leg.rotation.x = sign * 0.6;
                }
        }
    }
    return group;
}

export function createVrActors(r: VrResources) {
    const group = new Group();
    group.name = 'actors';
    const motion = createProjectileMotion();
    const pools = new Map<string, Group[]>();
    const used = new Map<string, number>();
    function place(
        kind: VrActorKind,
        point: Point & { depth?: number },
        angle = 0,
        sprite = 1,
        time = 0,
    ) {
        const key = `${kind}:${sprite}`;
        const index = used.get(key) ?? 0;
        let pool = pools.get(key);
        if (!pool) {
            pool = [];
            pools.set(key, pool);
        }
        if (index >= 96) return;
        let actor = pool[index];
        if (!actor) {
            actor = createVrActor(kind, r, sprite);
            pool.push(actor);
            group.add(actor);
        }
        used.set(key, index + 1);
        actor.visible = true;
        // Actor coordinates, unlike event coordinates, use two-pixel domain X.
        actor.position.set(
            point.x * 2 -
                128 +
                (kind === 'flying' || kind === 'killer' ? 8 : kind === 'sphere' ? 4 : 0),
            176 -
                point.y -
                (kind === 'flying' || kind === 'killer' ? 8 : kind === 'sphere' ? 4 : 0),
            point.depth ?? 11,
        );
        actor.rotation.z = angle;
        if (kind === 'sphere' || kind === 'killer') actor.rotation.y = time * 0.002;
        if (kind === 'flying') {
            const flap = Math.sin(time * 0.025 + index) * 0.55;
            const near = actor.getObjectByName('wing-1');
            const far = actor.getObjectByName('wing--1');
            if (near) near.rotation.x = flap;
            if (far) far.rotation.x = -flap;
        }
    }
    return {
        group,
        update(state: GameState, fraction: number, time: number) {
            const poses = motion.sample(state, fraction);
            used.clear();
            for (const pool of pools.values()) for (const actor of pool) actor.visible = false;
            // Launch dx belongs to each shot, so turning the astronaut cannot
            // move an existing projectile onto the opposite weapon depth.
            for (const bullet of state.bullets)
                place('bullet', { ...bullet, depth: bullet.dx < 0 ? -3.4 : 3.4 });
            for (const bullet of state.enemyBullets) place('enemy-bullet', bullet);
            if (poses.grenade && state.grenade)
                place(
                    'grenade',
                    {
                        x: poses.grenade.x / 2,
                        y: poses.grenade.y,
                        depth: state.grenade.dx < 0 ? -3.4 : 3.4,
                    },
                    -poses.grenade.angle,
                );
            for (const rocket of poses.rockets)
                place('rocket', { x: rocket.x / 2, y: rocket.y }, -rocket.angle);
            for (const sphere of state.spheres) place('sphere', sphere, 0, 1, time);
            for (const enemy of state.enemies) place('flying', enemy, 0, enemy.sprite, time);
            if (state.killer) place('killer', state.killer, time * 0.003);
        },
        clear() {
            motion.reset();
            group.clear();
            pools.clear();
            used.clear();
        },
    };
}
