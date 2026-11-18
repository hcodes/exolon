import { createEventScope } from '../lib/events.ts';

export function createPickerShip({
    document,
    window,
    animated = true,
}: {
    document: Document;
    window: Window & typeof globalThis;
    animated?: boolean;
}) {
    if (!animated) return () => {};
    const field = document.querySelector<HTMLElement>('.platform-picker__flyby')!;
    const flight = field.querySelector<HTMLElement>('.platform-picker__ship-flight')!;
    const events = createEventScope(window);
    const reducedMotion =
        typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : undefined;
    let timer: number | undefined;
    let previousY: number | undefined;
    let flying = false;
    let suspended = false;
    let disposed = false;

    function canFly() {
        return !disposed && !suspended && !document.hidden && !reducedMotion?.matches;
    }
    function cancelFlight() {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        flying = false;
        flight.classList.remove('platform-picker__ship-flight_active');
    }
    function scheduleFlight() {
        if (!canFly()) return;
        timer = window.setTimeout(startFlight, 3000 + Math.random() * 3000);
    }
    function finishFlight() {
        if (disposed || !flying) return;
        cancelFlight();
        scheduleFlight();
    }
    function startFlight() {
        timer = undefined;
        if (!canFly()) return;
        const maxY = Math.max(0, field.clientHeight - 12);
        let y = Math.floor(Math.random() * (maxY + 1));
        if (previousY !== undefined && Math.abs(y - previousY) < 12 && maxY >= 24) {
            const shift = Math.max(12, Math.floor(maxY / 3));
            y = previousY < maxY / 2 ? Math.min(maxY, previousY + shift) : previousY - shift;
        }
        previousY = y;
        // Keep 120 px/s until 75% of the path, then accelerate through the exit.
        const duration = ((field.clientWidth + 80) / 120) * (5 / 6) * 1000;
        flight.style.top = y + 'px';
        flight.style.animationDuration = duration + 'ms';
        flying = true;
        flight.classList.add('platform-picker__ship-flight_active');
        // Old engines may omit animationend; allow the entire tail to leave first.
        timer = window.setTimeout(finishFlight, duration + 250);
    }
    function handleAnimationEnd(event: Event) {
        if (event.target === flight) finishFlight();
    }
    function resetFlight() {
        if (disposed) return;
        cancelFlight();
        scheduleFlight();
    }
    function handlePageHide() {
        suspended = true;
        resetFlight();
    }
    function handlePageShow() {
        suspended = false;
        resetFlight();
    }
    events.on(flight, 'animationend', handleAnimationEnd);
    events.on(flight, 'webkitAnimationEnd', handleAnimationEnd);
    events.on(document, 'visibilitychange', resetFlight);
    events.on(reducedMotion, 'change', resetFlight);
    events.on(window, 'pagehide', handlePageHide);
    events.on(window, 'pageshow', handlePageShow);
    scheduleFlight();

    function destroy() {
        disposed = true;
        cancelFlight();
        events.destroy();
    }
    return destroy;
}
