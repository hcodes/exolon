import type { EventScope } from '../lib/events.ts';
import { getLocalStorageItem, setLocalStorageItem } from '../lib/LocalStorage/index.ts';
import { LOCAL_STORAGE_KEY_EXOLON_SHOW_FPS } from '../lib/LocalStorage/keys.ts';

export function createFpsControl(document: Document, events: EventScope) {
    const checkbox = document.getElementById('show-fps') as HTMLInputElement;
    const counter = document.getElementById('fps-counter') as HTMLElement;
    let since: number | undefined;
    let previous: number | undefined;
    let frames = 0;
    checkbox.checked = getLocalStorageItem(LOCAL_STORAGE_KEY_EXOLON_SHOW_FPS) === 'true';
    counter.hidden = !checkbox.checked;

    function reset() {
        since = previous = undefined;
        frames = 0;
        counter.textContent = 'FPS: —';
    }
    function handleChange() {
        counter.hidden = !checkbox.checked;
        reset();
        setLocalStorageItem(LOCAL_STORAGE_KEY_EXOLON_SHOW_FPS, checkbox.checked);
    }
    events.on(checkbox, 'change', handleChange);
    events.on(document, 'visibilitychange', reset);
    events.on(document.defaultView, 'pagehide', reset);
    return {
        frame(now: number) {
            if (!checkbox.checked) return;
            if (document.hidden) {
                reset();
                return;
            }
            if (previous !== undefined && (now - previous > 1000 || now < previous)) reset();
            previous = now;
            if (since === undefined) {
                since = now;
                return;
            }
            frames++;
            const elapsed = now - since;
            if (elapsed < 500) return;
            counter.textContent = `FPS: ${Math.round((frames * 1000) / elapsed)}`;
            since = now;
            frames = 0;
        },
    };
}
