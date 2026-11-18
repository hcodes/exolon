import type { GameState } from '../types/game.ts';
import type {
    MotionProjectile,
    ProjectileSegment,
    ProjectileSnapshot,
    Point,
} from '../types/graphics.ts';
import type { GameEvent } from '../types/game.ts';
// Presentation only: the original model owns trajectory, substeps and collisions.
// Observe every logical tick, then sample the clock's retained tick fraction.
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function point(item: MotionProjectile) {
    return { x: item.x * 2, y: item.y };
}

function identity(item: MotionProjectile, kind: string) {
    return Number.isInteger(item.projectileId) ? `${kind}:${item.projectileId}` : null;
}

function stationary(
    item: MotionProjectile,
    velocity = { x: (item.dx || -1) * 2, y: 0 },
    measured = false,
) {
    const position = point(item);
    return {
        from: position,
        to: position,
        start: velocity,
        end: velocity,
        measured,
        moving: false,
        phase: item.phase,
        direction: item.dx,
        kind: item.kind,
        instance: item.instance,
    };
}

function observeProjectile(
    item: MotionProjectile,
    previous: ProjectileSegment | undefined,
    launch: Point | undefined,
    freeze: boolean,
) {
    const position = point(item);
    if (
        !previous ||
        previous.direction !== item.dx ||
        previous.kind !== item.kind ||
        previous.instance !== item.instance ||
        (item.phase !== undefined && item.phase > previous.phase!) ||
        Math.abs(position.x - previous.to.x) > 12 ||
        Math.abs(position.y - previous.to.y) > 12
    ) {
        return stationary(item, launch, Boolean(launch));
    }
    const velocity = { x: position.x - previous.to.x, y: position.y - previous.to.y };
    // Frozen model positions still retain the missile's last direction. A
    // death or chamber transition may reset interpolation without relaunching it.
    if (freeze || (!velocity.x && !velocity.y))
        return stationary(item, previous.end, previous.measured);
    return {
        from: previous.to,
        to: position,
        start: previous.measured ? previous.end : velocity,
        end: velocity,
        measured: true,
        moving: true,
        phase: item.phase,
        direction: item.dx,
        kind: item.kind,
        instance: item.instance,
    };
}

function pose(segment: ProjectileSegment, amount: number) {
    const { from, to, start, end } = segment;
    if (!segment.moving)
        return { x: to.x, y: to.y, dx: end.x, dy: end.y, angle: Math.atan2(end.y, end.x) };
    // Adjacent segments share the measured endpoint tangent, so rotation and
    // position stay continuous when the source arc changes or gains substeps.
    const t2 = amount * amount,
        t3 = t2 * amount;
    const h00 = 2 * t3 - 3 * t2 + 1,
        h10 = t3 - 2 * t2 + amount;
    const h01 = -2 * t3 + 3 * t2,
        h11 = t3 - t2;
    const d00 = 6 * t2 - 6 * amount,
        d10 = 3 * t2 - 4 * amount + 1;
    const d01 = -d00,
        d11 = 3 * t2 - 2 * amount;
    const x = h00 * from.x + h10 * start.x + h01 * to.x + h11 * end.x;
    const y = h00 * from.y + h10 * start.y + h01 * to.y + h11 * end.y;
    const dx = d00 * from.x + d10 * start.x + d01 * to.x + d11 * end.x;
    const dy = d00 * from.y + d10 * start.y + d01 * to.y + d11 * end.y;
    return { x, y, dx, dy, angle: Math.atan2(dy, dx) };
}

export function createProjectileMotion() {
    let snapshot: ProjectileSnapshot | undefined;
    let observed: GameState | undefined;
    let segments = new Map<string, ProjectileSegment>();

    function observe(state: GameState, events: GameEvent[] = []) {
        if (state === observed) return;
        const sameScreenTick =
            snapshot && state.screenIndex === snapshot.screen && state.tick === snapshot.tick + 1;
        const discontinuity =
            !snapshot ||
            !sameScreenTick ||
            Boolean(state.death) !== snapshot.death ||
            state.status !== snapshot.status ||
            Math.abs(state.player.x - snapshot.x) > 4 ||
            Math.abs(state.player.y - snapshot.y) > 12 ||
            events.some((event) =>
                ['teleport', 'teleport-arrive', 'respawn', 'screen', 'death'].includes(event.type),
            );
        const previous = sameScreenTick ? segments : new Map<string, ProjectileSegment>();
        const next = new Map<string, ProjectileSegment>();
        const launched = events.find((event) => event.type === 'grenade');
        if (state.grenade) {
            const item = state.grenade;
            const key = identity(item, 'grenade');
            // A launch event records the source player's position before the
            // first grenade substep. Its difference gives the real launch arc.
            const launch = launched
                ? {
                      x: item.x * 2 - (launched.x + 8),
                      y: item.y - (launched.y + (state.player.duck ? 6 : 0)),
                  }
                : undefined;
            if (key)
                next.set(key, observeProjectile(item, previous.get(key), launch, discontinuity));
        }
        for (const item of state.rockets || []) {
            const key = identity(item, 'rocket');
            if (key)
                next.set(key, observeProjectile(item, previous.get(key), undefined, discontinuity));
        }
        segments = next;
        snapshot = {
            tick: state.tick,
            screen: state.screenIndex,
            death: Boolean(state.death),
            status: state.status,
            x: state.player.x,
            y: state.player.y,
        };
        observed = state;
    }

    function sampleItem(item: MotionProjectile, kind: string, amount: number) {
        return pose(segments.get(identity(item, kind)!) || stationary(item), amount);
    }

    return {
        observe,
        sample(state: GameState, fraction = 0) {
            if (!snapshot || state.tick !== snapshot.tick || state.screenIndex !== snapshot.screen)
                observe(state);
            const amount = clamp(fraction);
            return {
                grenade: state.grenade ? sampleItem(state.grenade, 'grenade', amount) : null,
                rockets: (state.rockets || []).map((item) => sampleItem(item, 'rocket', amount)),
            };
        },
        reset() {
            snapshot = undefined;
            observed = undefined;
            segments = new Map();
        },
    };
}
