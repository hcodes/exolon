import { getLocalStorageItem, setLocalStorageItem } from '../../lib/LocalStorage/index.ts';
import {
    LOCAL_STORAGE_KEY_VR_BEST_SCORE,
    LOCAL_STORAGE_KEY_VR_PLAYER_RECORD,
    LOCAL_STORAGE_KEY_VR_HIGH_SCORES,
    LOCAL_STORAGE_KEY_VR_CHEATS,
    LOCAL_STORAGE_KEY_VR_SCALE,
} from '../../lib/LocalStorage/keys.ts';
import type { PreferenceName, PreferenceStore } from '../../types/ui.ts';
import { readObject } from '../../utils/settings.ts';

export function createVrPreferences(
    storage = {
        get: (key: string): unknown => getLocalStorageItem(key),
        set: (key: string, value: unknown) => setLocalStorageItem(key, value),
    },
) {
    const keys: Partial<Record<PreferenceName, string>> = {
        bestScore: LOCAL_STORAGE_KEY_VR_BEST_SCORE,
        playerRecord: LOCAL_STORAGE_KEY_VR_PLAYER_RECORD,
        highScores: LOCAL_STORAGE_KEY_VR_HIGH_SCORES,
    };
    const scores: PreferenceStore = {
        get(name) {
            const key = keys[name];
            const value = key ? storage.get(key) : null;
            return typeof value === 'string' ? value : null;
        },
        set(name, value) {
            const key = keys[name];
            return key ? storage.set(key, value) : false;
        },
    };
    function normalizeScale(raw: unknown) {
        const value = Number(raw);
        return Number.isFinite(value) && value > 0 ? Math.max(0.65, Math.min(1.5, value)) : 1;
    }
    return {
        scores,
        get scale() {
            return normalizeScale(storage.get(LOCAL_STORAGE_KEY_VR_SCALE));
        },
        setScale(value: number) {
            storage.set(LOCAL_STORAGE_KEY_VR_SCALE, normalizeScale(value));
        },
        get cheats() {
            return readObject(storage.get(LOCAL_STORAGE_KEY_VR_CHEATS));
        },
        setCheats(value: unknown) {
            storage.set(LOCAL_STORAGE_KEY_VR_CHEATS, JSON.stringify(value));
        },
    };
}
