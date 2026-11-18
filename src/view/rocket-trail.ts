import type { Point } from '../types/graphics.ts';

interface Exhaust extends Point {
    id: string;
}
interface Puff extends Point {
    born: number;
}
const LIFE = 10,
    SPACING = 3,
    MAX_PUFFS = 256;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function rocketGeometry(homing = false) {
    return { offset: homing ? 8 : 4, length: homing ? 7.2 : 4.6 };
}
export function rocketNozzle(pose: Point & { angle: number }, homing = false): Point {
    const { offset, length } = rocketGeometry(homing);
    return {
        x: pose.x + offset - Math.cos(pose.angle) * length,
        y: pose.y + offset - Math.sin(pose.angle) * length,
    };
}

// Presentation-only history in display pixels; it never changes model projectiles.
// Emission follows logical ticks, so extra RAFs cannot create extra smoke.
export function createRocketTrail() {
    let previousTick: number | undefined, screen: number | undefined;
    let anchors = new Map<string, Point>(),
        puffs: Puff[] = [];
    function reset() {
        previousTick = screen = undefined;
        anchors.clear();
        puffs = [];
    }
    return {
        observe(tick: number, screenIndex: number, exhaust: readonly Exhaust[]) {
            if (tick === previousTick && screenIndex === screen) return;
            if (screenIndex !== screen || previousTick === undefined || tick !== previousTick + 1)
                reset();
            puffs = puffs.filter((puff) => tick - 1 - puff.born < LIFE);
            const next = new Map<string, Point>();
            for (const item of exhaust) {
                if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
                const before = anchors.get(item.id),
                    distance = before ? Math.hypot(item.x - before.x, item.y - before.y) : 0;
                // Never connect a new missile, a discontinuity or an impossible leap.
                if (!before || distance > 18) puffs.push({ x: item.x, y: item.y, born: tick - 1 });
                else if (distance > 0) {
                    const count = Math.ceil(distance / SPACING);
                    for (let index = 1; index <= count; index++) {
                        const amount = index / count;
                        puffs.push({
                            x: before.x + (item.x - before.x) * amount,
                            y: before.y + (item.y - before.y) * amount,
                            born: tick - 1 + amount,
                        });
                    }
                }
                next.set(item.id, { x: item.x, y: item.y });
            }
            anchors = next;
            if (puffs.length > MAX_PUFFS) puffs = puffs.slice(-MAX_PUFFS);
            previousTick = tick;
            screen = screenIndex;
        },
        sample(tick: number, fraction = 0) {
            const time = tick - 1 + clamp(fraction);
            return puffs
                .filter((puff) => time >= puff.born && time - puff.born < LIFE)
                .map((puff) => {
                    const age = time - puff.born;
                    return {
                        x: puff.x,
                        y: puff.y - age * 0.12,
                        radius: 1.1 + age * 0.16,
                        opacity: (1 - age / LIFE) * 0.55,
                        hot: age < 1.5,
                    };
                });
        },
        reset,
    };
}
