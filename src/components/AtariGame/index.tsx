import { NativeGame } from '../NativeGame/index.tsx';
import type { NativeSound } from '../../games/16bit/controllers/application.ts';
import { createAtariStApplication } from '../../games/atari-st/controllers/application.ts';
export function AtariGame(props: {
    audio: NativeSound;
    onPlatforms: () => void;
    onChoosePlatform?: (mode: string) => void;
    onMount?: () => void | (() => void);
}) {
    return (
        <NativeGame {...props} platform="atari-st" createApplication={createAtariStApplication} />
    );
}
