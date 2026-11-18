import { createNativeApplication } from '../../16bit/controllers/application.ts';
import type { NativeSound } from '../../16bit/controllers/application.ts';
import { ATARI_ST_PAL_HZ, ATARI_ST_TICK_HZ } from '../constants/index.ts';
import { ATARI_ST_SCREEN_PAL_FRAMES } from '../constants/pacing.ts';
import { createAtariStState, stepAtariSt } from '../model/index.ts';
import { createAtariStRenderer } from '../view/renderer.ts';
import { validateAtariStResources } from './resources.ts';
import {
    LOCAL_STORAGE_KEY_ATARI_ST_CHEATS,
    LOCAL_STORAGE_KEY_ATARI_ST_SCORES,
    LOCAL_STORAGE_KEY_ATARI_ST_NAME,
} from '../../../lib/LocalStorage/keys.ts';
export function createAtariStApplication(options: {
    document: Document;
    window: Window & typeof globalThis;
    audio: NativeSound;
    onPlatforms: () => void;
}) {
    return createNativeApplication({
        ...options,
        profile: {
            id: 'atari-st',
            name: 'Atari ST',
            palHz: ATARI_ST_PAL_HZ,
            tickHz: ATARI_ST_TICK_HZ,
            screenPalFrames: ATARI_ST_SCREEN_PAL_FRAMES,
            restartMusic: false,
            asciiNames: true,
            storage: {
                cheats: LOCAL_STORAGE_KEY_ATARI_ST_CHEATS,
                scores: LOCAL_STORAGE_KEY_ATARI_ST_SCORES,
                name: LOCAL_STORAGE_KEY_ATARI_ST_NAME,
            },
            worldUrl: './games/atari-st/data/world.json',
            graphicsUrl: './assets/graphics/atari-st/resources.json',
            createState: createAtariStState,
            step: stepAtariSt,
            createRenderer: createAtariStRenderer,
            validateResources: validateAtariStResources,
        },
    });
}
