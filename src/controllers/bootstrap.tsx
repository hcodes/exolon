import { GRAPHICS_MODES } from '../constants/graphics.ts';
import { startAnalytics } from '../services/analytics.ts';
import { render } from 'preact';
import { PlatformLanding } from '../components/PlatformLanding/index.tsx';
import { createAtariStSound } from '../games/atari-st/controllers/audio.ts';
import type { NativeSound } from '../games/16bit/controllers/application.ts';
import { createAmigaSound } from '../games/amiga/controllers/audio.ts';
import {
    loadClassicGame,
    loadAmigaGame,
    loadAtariGame,
    loadVrGame,
    supportsVrGame,
} from '../services/game-loader.ts';
import { unlockAudioContext, disposeAudioContext } from '../services/audio-context.ts';
import { readGameIdentity } from '../utils/game-launch.ts';
import { readLaunchOptions } from '../utils/settings.ts';
import { preferences } from '../services/preferences.ts';
import { createEventScope } from '../lib/events.ts';

export interface MountOptions {
    onMount?: () => void | (() => void);
}

export function mountGame(options: MountOptions = {}) {
    const root = document.getElementById('app');
    if (!root) return () => {};
    if (root.hasAttribute('data-prerendered')) {
        root.textContent = '';
        root.removeAttribute('data-prerendered');
    }
    startAnalytics();
    const container = root;
    const events = createEventScope(window);
    let destroyed = false;
    let transition = 0;
    let pendingAudio: NativeSound | undefined;
    let pendingContext: AudioContext | undefined;

    function clearLaunchStatus() {
        for (const id of ['platform-status', 'platform-launch-status']) {
            const status = document.getElementById(id);
            if (!status) continue;
            status.textContent = '';
            if (id === 'platform-launch-status') status.hidden = true;
        }
    }
    function cancelPending(mode?: string) {
        transition++;
        pendingAudio?.dispose();
        pendingAudio = undefined;
        disposeAudioContext(pendingContext);
        pendingContext = undefined;
        clearLaunchStatus();
        if (mode) {
            const url = new URL(window.location.href);
            url.searchParams.delete('game');
            url.searchParams.set('graphics', mode);
            window.history.replaceState(null, '', url);
        }
    }
    function launchError(name: string, previousMode: string | undefined, message?: string) {
        const select = document.getElementById('graphics-mode') as HTMLSelectElement | null;
        if (select && previousMode) select.value = previousMode;
        for (const id of ['platform-status', 'platform-launch-status']) {
            const status = document.getElementById(id);
            if (status) {
                status.textContent =
                    message ||
                    `${name} could not be loaded. Choose another platform or reload to retry.`;
                status.hidden = false;
            }
        }
    }
    function previousMode() {
        return (
            document.getElementById('game')?.dataset.game ||
            (document.getElementById('graphics-mode') as HTMLSelectElement | null)?.value
        );
    }
    function showPlatforms() {
        if (destroyed) return;
        cancelPending();
        const identity = readGameIdentity(window.location.search);
        const preferred =
            identity === 'classic'
                ? readLaunchOptions(window.location.search, preferences.get('graphics'))
                      .graphicsMode
                : identity;
        render(
            <PlatformLanding
                preferred={preferred}
                onChoose={choosePlatform}
                onMount={options.onMount}
            />,
            container,
        );
    }
    function choosePlatform(mode: string) {
        if (destroyed) return;
        if (mode === 'amiga' || mode === 'atari-st') showNative(mode);
        else if (mode === 'vr') showVr();
        else if (GRAPHICS_MODES.some((value) => value === mode)) showClassic(mode);
    }
    function showClassic(mode: string) {
        const previous = previousMode();
        cancelPending();
        const revision = transition;
        const context = unlockAudioContext(window);
        pendingContext = context;
        function mountClassicGame({ App }: Awaited<ReturnType<typeof loadClassicGame>>) {
            if (destroyed || revision !== transition) {
                disposeAudioContext(context);
                return;
            }
            pendingContext = undefined;
            const url = new URL(window.location.href);
            url.searchParams.delete('game');
            url.searchParams.set('graphics', mode);
            window.history.replaceState(null, '', url);
            render(
                <App
                    skipPlatformPicker
                    audioContext={context}
                    onMount={options.onMount}
                    onChooseAmiga={showAmiga}
                    onChooseAtariSt={showAtariSt}
                    onChooseClassic={cancelPending}
                    onPlatforms={showPlatforms}
                />,
                container,
            );
        }
        function handleClassicLoadError() {
            disposeAudioContext(context);
            if (destroyed || revision !== transition) return;
            pendingContext = undefined;
            launchError('Game', previous);
        }
        void loadClassicGame().then(mountClassicGame).catch(handleClassicLoadError);
    }
    function showAmiga() {
        showNative('amiga');
    }
    function showAtariSt() {
        showNative('atari-st');
    }
    function showVr() {
        const previous = previousMode();
        cancelPending();
        if (!supportsVrGame) {
            launchError(
                'Exolon VR',
                previous,
                'Exolon VR requires a modern browser with WebGL 2. Choose another platform.',
            );
            return;
        }
        const revision = transition;
        const context = unlockAudioContext(window);
        pendingContext = context;
        function mountVrGame({ VrGame }: Awaited<ReturnType<typeof loadVrGame>>) {
            if (destroyed || revision !== transition) {
                disposeAudioContext(context);
                return;
            }
            pendingContext = undefined;
            const url = new URL(window.location.href);
            url.searchParams.set('game', 'vr');
            url.searchParams.delete('graphics');
            window.history.replaceState(null, '', url);
            render(
                <VrGame
                    audioContext={context}
                    onPlatforms={showPlatforms}
                    onMount={options.onMount}
                />,
                container,
            );
        }
        function handleVrLoadError() {
            disposeAudioContext(context);
            if (destroyed || revision !== transition) return;
            pendingContext = undefined;
            launchError('Exolon VR', previous);
        }
        void loadVrGame().then(mountVrGame).catch(handleVrLoadError);
    }
    function showNative(game: 'amiga' | 'atari-st') {
        const previous = previousMode();
        cancelPending();
        const revision = transition;
        const audio = game === 'amiga' ? createAmigaSound(window) : createAtariStSound(window);
        pendingAudio = audio;
        audio.unlock();
        const component =
            game === 'amiga'
                ? loadAmigaGame().then((module) => module.AmigaGame)
                : loadAtariGame().then((module) => module.AtariGame);
        function mountNativeGame(Game: Awaited<typeof component>) {
            if (destroyed || revision !== transition) {
                audio.dispose();
                return;
            }
            pendingAudio = undefined;
            const url = new URL(window.location.href);
            url.searchParams.set('game', game);
            url.searchParams.delete('graphics');
            window.history.replaceState(null, '', url);
            render(
                <Game
                    audio={audio}
                    onPlatforms={showPlatforms}
                    onChoosePlatform={choosePlatform}
                    onMount={options.onMount}
                />,
                container,
            );
        }
        function handleNativeLoadError() {
            audio.dispose();
            if (destroyed || revision !== transition) return;
            pendingAudio = undefined;
            launchError(game === 'amiga' ? 'Amiga' : 'Atari ST', previous);
        }
        void component.then(mountNativeGame).catch(handleNativeLoadError);
    }
    function handlePageHide() {
        cancelPending();
    }
    events.on(window, 'pagehide', handlePageHide);
    showPlatforms();
    function destroy() {
        destroyed = true;
        cancelPending();
        events.destroy();
        render(null, container);
    }
    return destroy;
}
