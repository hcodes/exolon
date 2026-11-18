import { NOTIFICATION_DURATION } from '../constants/interface.ts';

export function createNotifications(
    element: HTMLElement,
    timers: Pick<Window, 'setTimeout' | 'clearTimeout'>,
) {
    let timer: number | undefined;
    let destroyed = false;
    function clear() {
        if (timer !== undefined) timers.clearTimeout(timer);
        timer = undefined;
        element.hidden = true;
        element.textContent = '';
    }
    return {
        show(message: string, duration = NOTIFICATION_DURATION) {
            if (destroyed) return;
            timers.clearTimeout(timer);
            element.textContent = message;
            element.hidden = false;
            timer = timers.setTimeout(clear, duration);
        },
        clear,
        destroy() {
            destroyed = true;
            clear();
        },
    };
}
