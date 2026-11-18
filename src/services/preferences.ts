import type { PreferenceStore, PreferenceName } from '../types/ui.ts';
import { getLocalStorageItem, setLocalStorageItem } from '../lib/LocalStorage/index.ts';
import {
    LOCAL_STORAGE_KEY_EXOLON_GRAPHICS,
    LOCAL_STORAGE_KEY_EXOLON_SETTINGS_COLLAPSED,
    LOCAL_STORAGE_KEY_EXOLON_MONOCHROME,
    LOCAL_STORAGE_KEY_EXOLON_SPLIT_PAIR,
    LOCAL_STORAGE_KEY_EXOLON_CHEATS,
    LOCAL_STORAGE_KEY_EXOLON_BEST_SCORE,
    LOCAL_STORAGE_KEY_EXOLON_PLAYER_RECORD,
    LOCAL_STORAGE_KEY_EXOLON_HIGH_SCORES,
} from '../lib/LocalStorage/keys.ts';

const keys = Object.freeze({
    graphics: LOCAL_STORAGE_KEY_EXOLON_GRAPHICS,
    settingsCollapsed: LOCAL_STORAGE_KEY_EXOLON_SETTINGS_COLLAPSED,
    monochrome: LOCAL_STORAGE_KEY_EXOLON_MONOCHROME,
    splitPair: LOCAL_STORAGE_KEY_EXOLON_SPLIT_PAIR,
    cheats: LOCAL_STORAGE_KEY_EXOLON_CHEATS,
    bestScore: LOCAL_STORAGE_KEY_EXOLON_BEST_SCORE,
    playerRecord: LOCAL_STORAGE_KEY_EXOLON_PLAYER_RECORD,
    highScores: LOCAL_STORAGE_KEY_EXOLON_HIGH_SCORES,
});
// Logical names keep historical storage keys at the browser boundary.
export const preferences: PreferenceStore = {
    get(name: PreferenceName) {
        return getLocalStorageItem(keys[name]);
    },
    set(name: PreferenceName, value: unknown) {
        return setLocalStorageItem(keys[name], value);
    },
};
