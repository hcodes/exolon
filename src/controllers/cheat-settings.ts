import type { EventScope } from '../lib/events.ts';
import type { Cheats } from '../types/game.ts';
import { gameElement } from '../utils/dom.ts';

interface CheatSettingsOptions {
    document: Document;
    events: EventScope;
    options: Cheats;
    onChange(options: Cheats): void;
}

export function createCheatSettingsControl({
    document,
    events,
    options,
    onChange,
}: CheatSettingsOptions) {
    const group = gameElement(document, 'cheat-settings');
    const fields = [...group.querySelectorAll<HTMLInputElement>('[data-cheat]')];
    let current = { ...options };
    function update(next: Cheats) {
        current = { ...next };
        for (const field of fields) {
            const key = field.dataset.cheat;
            if (key && Object.prototype.hasOwnProperty.call(current, key))
                field.checked = current[key as keyof Cheats];
        }
    }
    function changeOption(event: Event) {
        const field = event.currentTarget as HTMLInputElement;
        const key = field.dataset.cheat;
        if (field.disabled || !key || !Object.prototype.hasOwnProperty.call(current, key)) return;
        current = { ...current, [key]: field.checked };
        onChange({ ...current });
    }
    for (const field of fields) events.on(field, 'change', changeOption);
    function setEnabled(enabled: boolean) {
        for (const field of fields) field.disabled = !enabled;
    }
    update(options);
    setEnabled(false);
    return { update, setEnabled };
}
