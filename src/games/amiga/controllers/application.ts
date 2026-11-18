import { createNativeApplication } from '../../16bit/controllers/application.ts';
import type { NativeSound } from '../../16bit/controllers/application.ts';
import { AMIGA_PAL_HZ, AMIGA_TICK_HZ } from '../constants/index.ts';
import { AMIGA_SCREEN_PAL_FRAMES } from '../constants/pacing.ts';
import { createAmigaState, stepAmiga } from '../model/index.ts';
import { createAmigaRenderer } from '../view/renderer.ts';
import { validateAmigaResources } from './resources.ts';
import {
    LOCAL_STORAGE_KEY_AMIGA_CHEATS,
    LOCAL_STORAGE_KEY_AMIGA_SCORES,
    LOCAL_STORAGE_KEY_AMIGA_NAME,
} from '../../../lib/LocalStorage/keys.ts';
export function createAmigaApplication(options: {
    document: Document;
    window: Window & typeof globalThis;
    audio: NativeSound;
    onPlatforms: () => void;
}) {
    return createNativeApplication({
        ...options,
        profile: {
            id: 'amiga',
            name: 'Amiga',
            palHz: AMIGA_PAL_HZ,
            tickHz: AMIGA_TICK_HZ,
            screenPalFrames: AMIGA_SCREEN_PAL_FRAMES,
            storage: {
                cheats: LOCAL_STORAGE_KEY_AMIGA_CHEATS,
                scores: LOCAL_STORAGE_KEY_AMIGA_SCORES,
                name: LOCAL_STORAGE_KEY_AMIGA_NAME,
            },
            worldUrl: './games/amiga/data/world.json',
            graphicsUrl: './assets/graphics/amiga/resources.json',
            createState: createAmigaState,
            step: stepAmiga,
            createRenderer: createAmigaRenderer,
            validateResources: validateAmigaResources,
        },
    });
}
