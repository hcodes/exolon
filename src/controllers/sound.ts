import type { EventScope } from '../lib/events.ts';
import type { createAudio } from '../view/audio.ts';
interface SoundOptions {
    button: HTMLButtonElement;
    volume: HTMLInputElement;
    audio: Pick<ReturnType<typeof createAudio>, 'setVolume'>;
    events: EventScope;
    onUnmute: () => void;
    onInteraction: () => void;
}
export function createSoundControl({
    button,
    volume,
    audio,
    events,
    onUnmute,
    onInteraction,
}: SoundOptions) {
    let muted = false;
    function toggleMute(event: MouseEvent) {
        muted = !muted;
        updateVolume();
        const label = muted ? 'Unmute' : 'Mute';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.setAttribute('aria-pressed', String(muted));
        if (!muted) onUnmute();
        if (event.detail > 0) onInteraction();
    }
    events.on(button, 'click', toggleMute);
    function updateVolume() {
        audio.setVolume(muted ? 0 : Number(volume.value));
    }
    events.on(volume, 'input', updateVolume);
    events.on(volume, 'pointerup', onInteraction);
    return {
        get muted() {
            return muted;
        },
    };
}
