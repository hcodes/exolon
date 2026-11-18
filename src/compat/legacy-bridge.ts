import * as preact from 'preact';
import * as hooks from 'preact/hooks';
import * as jsxRuntime from 'preact/jsx-runtime';

export interface LegacyGames {
    classic?: typeof import('../components/App/index.tsx');
    amiga?: typeof import('../components/AmigaGame/index.tsx');
    atari?: typeof import('../components/AtariGame/index.tsx');
}

declare global {
    interface Window {
        __reexLegacy: {
            preact: typeof preact;
            hooks: typeof hooks;
            jsxRuntime: typeof jsxRuntime;
            games: LegacyGames;
        };
    }
}

// Every deferred IIFE uses these exact instances, including the hooks' Preact options.
export function installLegacyBridge() {
    window.__reexLegacy = { preact, hooks, jsxRuntime, games: {} };
}
