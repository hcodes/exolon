import type { createAudio } from '../view/audio.ts';
type TitleAudio = Pick<
    ReturnType<typeof createAudio>,
    'unlock' | 'loadMusic' | 'startMusic' | 'stopMusic' | 'setGraphicsMode' | 'musicInfo'
>;
interface MusicOptions {
    audio: TitleAudio;
    status: HTMLElement;
    graphicsMode: string;
    isEligible: () => boolean;
    isMuted: () => boolean;
}
import { audioMode } from '../utils/graphics.ts';

export function createMusicController({
    audio,
    status,
    graphicsMode,
    isEligible,
    isMuted,
}: MusicOptions) {
    let epochCounter = 0,
        currentMode = audioMode(graphicsMode);
    async function play({ autoplay = false } = {}) {
        if (!isEligible()) return;
        const epoch = ++epochCounter;
        if (isMuted()) {
            audio.stopMusic();
            status.textContent = 'Sound muted';
            return;
        }
        status.textContent = '';
        let loaded = false;
        const eligible = () => epoch === epochCounter && isEligible() && !isMuted();
        function tryStart() {
            if (!loaded || !eligible() || !audio.startMusic()) return false;
            status.textContent = `Playing ${audio.musicInfo?.title || ''}`;
            return true;
        }
        // Autoplay may stay suspended; preload the recording independently of it.
        await audio.unlock({ autoplay, onReady: tryStart });
        if (!eligible()) return;
        loaded = await audio.loadMusic();
        if (!eligible()) return;
        if (tryStart()) return;
        if (loaded) {
            status.textContent = 'Music will start after a tap or key press.';
        } else {
            status.textContent = 'Music unavailable. You can start the game.';
        }
    }
    return {
        play,
        invalidate() {
            return ++epochCounter;
        },
        isCurrent(epoch: number) {
            return epoch === epochCounter;
        },
        setGraphicsMode(mode: string) {
            const next = audioMode(mode);
            if (next !== currentMode) {
                currentMode = next;
                audio.setGraphicsMode(mode);
            }
        },
    };
}
