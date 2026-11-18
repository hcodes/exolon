import type { GameState } from '../types/game.ts';
import type { Point, MotionSnapshot } from '../types/graphics.ts';
type HeroKind = 'idle' | 'walk' | 'crouch' | 'jump' | 'fall' | 'death';
// Visual skeleton only: source collision geometry and the game model stay separate.
const TICK_MS = 1000 / 30;
const STRIDE = 20; // Ten original successful two-pixel movement steps per cycle.
const UPPER_LEG = 6.7;
const LOWER_LEG = 6.9;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const smooth = (amount: number) => amount * amount * (3 - 2 * amount);

export function getJetpackThrust(state: GameState, fraction = 0) {
    const player = state?.player;
    if (
        !player ||
        state.death ||
        player.duck ||
        player.falling ||
        (state.status && state.status !== 'playing') ||
        !Number.isInteger(player.jump) ||
        player.jump < 1 ||
        player.jump > 9
    )
        return 0;
    // Post-step phases 1..9 are the rising portion of the source jump table.
    const phase = player.jump + clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
    const fade = clamp((phase - 8) / 2, 0, 1);
    return (1 - (0.35 * (phase - 1)) / 9) * (1 - fade * fade * (3 - 2 * fade));
}

function leg(hip: Point, target: Point, footAngle: number, far: boolean) {
    const dx = target.x - hip.x,
        dy = target.y - hip.y;
    const distance = Math.hypot(dx, dy) || 1;
    const reach = clamp(
        distance,
        Math.abs(UPPER_LEG - LOWER_LEG) + 1e-6,
        UPPER_LEG + LOWER_LEG - 1e-6,
    );
    const ux = dx / distance,
        uy = dy / distance;
    const along = (UPPER_LEG ** 2 - LOWER_LEG ** 2 + reach ** 2) / (2 * reach);
    const bend = Math.sqrt(Math.max(0, UPPER_LEG ** 2 - along ** 2));
    return {
        hip,
        knee: { x: hip.x + ux * along + uy * bend, y: hip.y + uy * along - ux * bend },
        ankle: { x: hip.x + ux * reach, y: hip.y + uy * reach },
        footAngle,
        far,
    };
}

function quadraticPeak(start: number, control: number, end: number) {
    const curvature = start - 2 * control + end;
    const t = curvature < 0 ? clamp((start - control) / curvature, 0, 1) : 0;
    return Math.max(start, end, (1 - t) ** 2 * start + 2 * (1 - t) * t * control + t ** 2 * end);
}

function rollingFoot(x: number, angle: number, pivot: Point, clearance = 0) {
    const cosine = Math.cos(angle),
        sine = Math.sin(angle);
    // Project the drawn toe-to-sole Bezier onto the vertical axis. Its interior
    // can be lower than either endpoint while the boot rolls onto its toe.
    const curvedSole = quadraticPeak(
        3.05 * sine + 1.35 * cosine,
        2.5 * sine + 1.8 * cosine,
        0.5 * sine + 1.8 * cosine,
    );
    const depth = Math.max(-1.9 * sine + 1.65 * cosine, curvedSole);
    return {
        x: x + pivot.x - (pivot.x * cosine - pivot.y * sine),
        y: 16 - depth - clearance,
        angle,
    };
}

function walkingFoot(phase: number) {
    if (phase < 0.6) {
        const contact = phase / 0.6;
        const angle =
            contact < 0.18
                ? -0.18 * (1 - smooth(contact / 0.18))
                : contact > 0.72
                  ? 0.5 * smooth((contact - 0.72) / 0.28)
                  : 0;
        const pivot = angle < 0 ? { x: -1.9, y: 1.65 } : { x: 3.05, y: 1.35 };
        // The body travels twelve pixels during contact, preserving a planted
        // sole at the unchanged twenty-pixel visual stride and 60% stance.
        return rollingFoot(6 - 12 * contact, angle, pivot);
    }
    const swing = (phase - 0.6) / 0.4;
    const eased = smooth(swing);
    // Both endpoints have the stance's -20px/cycle velocity. The foot slows
    // into heel strike instead of snapping from a stationary swing endpoint.
    const x = -6 - 8 * swing + 20 * eased;
    const angle = mix(0.5, -0.18, eased);
    const pivot = { x: mix(3.05, -1.9, eased), y: mix(1.35, 1.65, eased) };
    return rollingFoot(x, angle, pivot, Math.sin(Math.PI * swing) ** 2 * 1.3);
}

export function getHeroPose(kind: HeroKind, phase = 0, amount = 1) {
    phase = ((phase % 1) + 1) % 1;
    const blend = kind === 'walk' ? clamp(amount, 0, 1) : 0;
    const body = {
        x: kind === 'crouch' ? -0.8 : kind === 'jump' ? 0.4 : blend * 0.25,
        y: kind === 'crouch' ? 5 : (1 + Math.cos(phase * Math.PI * 4)) * 0.425 * blend,
        lean:
            kind === 'crouch' ? 0.12 : kind === 'jump' ? 0.06 : kind === 'death' ? 0 : 0.04 * blend,
    };
    const legs = [false, true].map((far) => {
        const foot = walkingFoot((phase + (far ? 0.5 : 0)) % 1);
        let target = { x: mix(far ? -3 : 2.6, foot.x, blend), y: mix(14.2, foot.y, blend) };
        let angle = foot.angle * blend;
        if (kind === 'crouch') target = { x: far ? -4.5 : 5, y: 14.2 };
        if (kind === 'jump') {
            target = { x: far ? -3.5 : 3.5, y: far ? 13 : 11.4 };
            angle = far ? 0.15 : -0.2;
        }
        if (kind === 'fall') {
            target = { x: far ? -4 : 4.4, y: far ? 13.7 : 14 };
            angle = far ? -0.2 : 0.15;
        }
        if (kind === 'death') {
            target = { x: far ? -4.6 : 5.7, y: far ? 11.6 : 14 };
            angle = far ? -0.35 : -0.2;
        }
        const grounded = kind === 'idle' || kind === 'walk';
        // Hip joints sit inside the pelvis; placing them at the crotch forced
        // a deep knee bend even when the astronaut was standing still.
        const hipX = grounded ? 0.2 : 0.8;
        const hipY = grounded ? 0.95 : 3;
        return leg({ x: body.x + (far ? -hipX : hipX), y: hipY + body.y }, target, angle, far);
    });
    return { kind, phase, blend, body, legs };
}

function posture(state: GameState): HeroKind {
    if (state.death || state.status === 'over') return 'death';
    if (state.player.duck) return 'crouch';
    if (state.player.falling) return 'fall';
    if (state.player.jump >= 0) return 'jump';
    return 'idle';
}

export function createHeroMotion() {
    let snapshot: MotionSnapshot | undefined;
    let fromX = 0,
        fromY = 0,
        toX = 0,
        toY = 0;
    let fromPhase = 0,
        toPhase = 0;
    let changedAt = 0,
        sampledAt: number | undefined;
    let blend = 0,
        targetBlend = 0;
    let kind: HeroKind = 'idle';

    function reset(state: GameState | undefined, now: number) {
        snapshot = state
            ? { tick: state.tick, screen: state.screenIndex, x: state.player.x, y: state.player.y }
            : undefined;
        fromX = toX = state ? state.player.x * 2 : 0;
        fromY = toY = state ? state.player.y : 0;
        fromPhase = toPhase = 0;
        changedAt = now;
        sampledAt = now;
        blend = targetBlend = 0;
        kind = state ? posture(state) : 'idle';
    }

    return {
        sample(state: GameState, now: number) {
            const p = state.player;
            // The title illustration is stationary and must not advance game gait.
            if (!Number.isFinite(state.tick))
                return { ...getHeroPose(posture(state)), x: p.x * 2, y: p.y };
            if (
                !snapshot ||
                snapshot.screen !== state.screenIndex ||
                state.tick < snapshot.tick ||
                Math.abs(p.x - snapshot!.x) > 4 ||
                Math.abs(p.y - snapshot.y) > 12
            )
                reset(state, now);
            if (state.tick !== snapshot!.tick) {
                const distance = (p.x - snapshot!.x) * 2;
                kind = posture(state);
                const walking = kind === 'idle' && distance !== 0;
                fromX = toX;
                toX = p.x * 2;
                fromY = toY;
                toY = p.y;
                fromPhase = toPhase;
                if (walking) toPhase += Math.abs(distance) / STRIDE;
                targetBlend = walking ? 1 : 0;
                changedAt = now;
                snapshot = { tick: state.tick, screen: state.screenIndex, x: p.x, y: p.y };
            }
            const elapsed = sampledAt === undefined ? 0 : clamp(now - sampledAt, 0, 64);
            sampledAt = now;
            blend = mix(blend, targetBlend, 1 - Math.exp(-elapsed / 55));
            const alpha = clamp((now - changedAt) / TICK_MS, 0, 1);
            const poseKind = kind === 'idle' && blend > 1e-4 ? 'walk' : kind;
            return {
                ...getHeroPose(poseKind, mix(fromPhase, toPhase, alpha), blend),
                x: mix(fromX, toX, alpha),
                y: mix(fromY, toY, alpha),
            };
        },
        reset() {
            reset(undefined, 0);
        },
    };
}
