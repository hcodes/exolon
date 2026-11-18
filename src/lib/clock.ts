export function createClock(
    tick: () => void,
    interval: number,
    { pauseOnStall = true }: { pauseOnStall?: boolean } = {},
) {
    let previous: number | null = null;
    let accumulator = 0;
    let running = false;
    return {
        frame(now: number) {
            if (!running) return false;
            if (previous === null) {
                previous = now;
                return true;
            }
            let elapsed = now - previous;
            previous = now;
            if (elapsed < 0 || (elapsed > 250 && pauseOnStall)) {
                this.pause();
                return false;
            }
            // Slow TV rendering must not repeatedly pause or build a catch-up backlog.
            // Hidden pages and focus loss are paused explicitly by their controllers.
            if (elapsed > 250) elapsed = interval;
            accumulator += elapsed;
            while (accumulator + 1e-7 >= interval) {
                accumulator -= interval;
                tick();
                if (!running) break;
            }
            // false means an unsafe elapsed interval, not a stop requested by tick.
            return true;
        },
        setInterval(next: number) {
            if (!Number.isFinite(next) || next <= 0)
                throw new RangeError('Invalid clock interval.');
            if (next === interval) return;
            accumulator = (accumulator / interval) * next;
            interval = next;
            // A style change starts a new wall-clock segment without discarding tick progress.
            previous = null;
        },
        get fraction() {
            return Math.max(0, Math.min(1, accumulator / interval));
        },
        resume() {
            running = true;
            previous = null;
        },
        pause() {
            running = false;
            previous = null;
        },
        reset() {
            this.pause();
            accumulator = 0;
        },
        destroy() {
            this.reset();
        },
    };
}
