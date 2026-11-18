import type { GameState } from '../types/game.ts';
import type { Departure, Appearance } from '../types/graphics.ts';
import type { GameEvent } from '../types/game.ts';
// Presentation only: the model exchanges chamber positions immediately.
// Six logical ticks keep the fade independent of rendering speed and wall time.
const HALF_TICKS = 3;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = (value: number) => {
    const amount = clamp(value);
    return amount * amount * (3 - 2 * amount);
};
const CANCEL_EVENTS = new Set(['death', 'respawn', 'screen', 'screen-change', 'game-over']);

function appearance(state: GameState) {
    return {
        tick: state.tick,
        screen: state.screenIndex,
        direction: state.player.direction ?? 1,
        armored: Boolean(state.exoskeleton),
    };
}

export function createTeleportMotion() {
    let active: { tick: number; screen: number; departure: Departure } | undefined;
    let snapshot: Appearance | undefined;
    let previous: Appearance | undefined;
    let lastStart: { tick: number; screen: number } | undefined;
    let consumedBatches = new WeakSet<GameEvent[]>();

    function observe(state: GameState, events: GameEvent[] = []) {
        if (!state?.player || !Number.isFinite(state.tick)) {
            active = snapshot = previous = undefined;
            return false;
        }
        const changedTick =
            !snapshot || state.tick !== snapshot.tick || state.screenIndex !== snapshot.screen;
        const before = changedTick ? snapshot : previous;
        const discontinuity =
            snapshot && (state.tick < snapshot.tick || state.screenIndex !== snapshot.screen);
        const cancelled =
            discontinuity ||
            state.death ||
            state.status !== 'playing' ||
            events.some((event) => CANCEL_EVENTS.has(event.type));
        if (changedTick) previous = snapshot;
        snapshot = appearance(state);
        if (cancelled) {
            active = undefined;
            if (discontinuity) {
                lastStart = undefined;
                consumedBatches = new WeakSet<GameEvent[]>();
            }
            return false;
        }
        if (active && state.tick - active.tick >= HALF_TICKS * 2) active = undefined;
        const departure = events.find((event) => event.type === 'teleport');
        const arrival = events.find((event) => event.type === 'teleport-arrive');
        if (
            !departure ||
            !arrival ||
            ![departure.x, departure.y, arrival.x, arrival.y].every(Number.isFinite) ||
            consumedBatches.has(events) ||
            (lastStart?.tick === state.tick && lastStart.screen === state.screenIndex)
        )
            return false;
        const source = before?.screen === state.screenIndex ? before : snapshot;
        active = {
            tick: state.tick,
            screen: state.screenIndex,
            departure: {
                x: departure.x - 8,
                y: departure.y - 12,
                direction: source.direction,
                armored: source.armored,
            },
        };
        lastStart = { tick: state.tick, screen: state.screenIndex };
        consumedBatches.add(events);
        return true;
    }

    return {
        observe,
        sample(state: GameState, fraction = 0) {
            observe(state);
            if (!active) return null;
            const elapsed = state.tick - active.tick + clamp(fraction);
            if (elapsed >= HALF_TICKS * 2) {
                active = undefined;
                return null;
            }
            return {
                departure: { ...active.departure, opacity: 1 - smooth(elapsed / HALF_TICKS) },
                arrivalOpacity: smooth((elapsed - HALF_TICKS) / HALF_TICKS),
            };
        },
        reset() {
            active = snapshot = previous = lastStart = undefined;
            consumedBatches = new WeakSet<GameEvent[]>();
        },
    };
}
