import { Group } from 'three';
import type { GameState } from '../../../types/game.ts';
import { solid } from './materials.ts';
import type { VrResources } from './materials.ts';

export function createVrEffects(r: VrResources) {
    const group = new Group();
    group.name = 'effects';
    const particles = Array.from({ length: 48 }, (_, index) => ({
        mesh: solid(group, r.sphere, index % 3 ? r.gold : r.red, 0, 0, 0, 0.8, 0.8, 0.8),
        start: -Infinity,
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
    }));
    let cursor = 0;
    let screen = -1;
    let tick = -1;
    let death = 0;
    let destroyedCount = 0;
    let enemies: { x: number; y: number }[] = [];
    function burst(x: number, y: number, time: number) {
        for (let i = 0; i < 12; i++) {
            const particle = particles[cursor++ % particles.length];
            const angle = (i * Math.PI * 2) / 12;
            const velocity = 0.015 + (i % 3) * 0.009;
            particle.start = time;
            particle.x = x;
            particle.y = y;
            particle.dx = Math.cos(angle) * velocity;
            particle.dy = Math.sin(angle) * velocity;
        }
    }
    return {
        group,
        update(state: GameState, time: number) {
            if (screen !== state.screenIndex || state.tick < tick) {
                for (const particle of particles) particle.start = -Infinity;
                screen = state.screenIndex;
                death = state.death;
                destroyedCount = state.destroyed.length;
                enemies = [];
            }
            if (tick !== state.tick) {
                if (state.death && !death)
                    burst(state.player.x * 2 + 12 - 128, 176 - state.player.y - 12, time);
                if (state.destroyed.length > destroyedCount) {
                    for (const object of state.objects)
                        if (state.destroyed.slice(destroyedCount).includes(object.instance!))
                            burst(object.x * 8 - 124, 172 - object.y * 8, time);
                }
                if (state.enemies.length < enemies.length && enemies[0])
                    burst(enemies[0].x * 2 - 120, 172 - enemies[0].y, time);
                enemies = state.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y }));
                tick = state.tick;
                death = state.death;
                destroyedCount = state.destroyed.length;
            }
            for (const particle of particles) {
                const age = time - particle.start;
                particle.mesh.visible = age >= 0 && age < 460;
                if (!particle.mesh.visible) continue;
                particle.mesh.position.set(
                    particle.x + particle.dx * age,
                    particle.y + particle.dy * age - age * age * 0.000025,
                    13 + Math.sin(cursor + particle.dx) * age * 0.002,
                );
                particle.mesh.scale.setScalar(Math.max(0.05, 1.3 * (1 - age / 460)));
            }
        },
    };
}
