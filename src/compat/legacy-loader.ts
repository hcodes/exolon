import type { LegacyGames } from './legacy-bridge.ts';

declare const __REEX_LEGACY_CHUNKS__: Record<keyof LegacyGames, string>;
const pending: Partial<Record<keyof LegacyGames, Promise<unknown>>> = {};
export const supportsVrGame = false;

function loadGame<Key extends keyof LegacyGames>(
    name: Key,
): Promise<NonNullable<LegacyGames[Key]>> {
    const available = window.__reexLegacy.games[name];
    if (available) return Promise.resolve(available);
    const existing = pending[name];
    if (existing) return existing as Promise<NonNullable<LegacyGames[Key]>>;
    const request = new Promise<NonNullable<LegacyGames[Key]>>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(__REEX_LEGACY_CHUNKS__[name], document.baseURI).href;
        script.async = true;
        const finish = () => {
            script.onload = script.onerror = null;
            if (script.parentNode) script.parentNode.removeChild(script);
            delete pending[name];
        };
        script.onload = () => {
            const module = window.__reexLegacy.games[name];
            finish();
            if (module) resolve(module);
            else reject(new Error('Game module did not register: ' + name));
        };
        script.onerror = () => {
            finish();
            reject(new Error('Could not load game: ' + name));
        };
        document.head.appendChild(script);
    });
    pending[name] = request;
    return request;
}

export function loadClassicGame(): Promise<typeof import('../components/App/index.tsx')> {
    return loadGame('classic');
}
export function loadAmigaGame(): Promise<typeof import('../components/AmigaGame/index.tsx')> {
    return loadGame('amiga');
}
export function loadAtariGame(): Promise<typeof import('../components/AtariGame/index.tsx')> {
    return loadGame('atari');
}
export function loadVrGame(): Promise<typeof import('../components/VrGame/index.tsx')> {
    return Promise.reject(new Error('Exolon VR requires a modern browser with WebGL 2.'));
}
