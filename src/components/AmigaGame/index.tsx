import { NativeGame } from '../NativeGame/index.tsx';
import type { AmigaSound } from '../../games/amiga/controllers/audio.ts';
import { createAmigaApplication } from '../../games/amiga/controllers/application.ts';
export function AmigaGame(props: {
    audio: AmigaSound;
    onPlatforms: () => void;
    onChoosePlatform?: (mode: string) => void;
    onMount?: () => void | (() => void);
}) {
    return <NativeGame {...props} platform="amiga" createApplication={createAmigaApplication} />;
}
