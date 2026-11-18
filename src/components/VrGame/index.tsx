import { ScreenNavigation } from '../ScreenNavigation/index.tsx';
import { useLayoutEffect } from 'preact/hooks';
import { createVrApplication } from '../../controllers/vr/application.ts';
import { Button } from '../Button/index.tsx';
import { Input } from '../Input/index.tsx';
import { FullscreenButton } from '../FullscreenButton/index.tsx';
import { HomeButton } from '../HomeButton/index.tsx';
import { SettingsToggle } from '../SettingsToggle/index.tsx';
import { SettingsPanel } from '../SettingsPanel/index.tsx';
import { HomePanel } from '../HomePanel/index.tsx';
import { SettingsGroup } from '../SettingsGroup/index.tsx';
import { Toolbar } from '../Toolbar/index.tsx';
import { SoundControls } from '../SoundControls/index.tsx';
import { TouchControls } from '../TouchControls/index.tsx';
import { CheatSettings } from '../CheatSettings/index.tsx';
import { GamepadHint } from '../GamepadHint/index.tsx';
import { FpsCounter } from '../FpsCounter/index.tsx';
import './index.css';

export function VrGame({
    audioContext,
    onPlatforms,
    onMount,
}: {
    audioContext?: AudioContext;
    onPlatforms: () => void;
    onMount?: () => void | (() => void);
}) {
    useLayoutEffect(() => {
        const disposeLayout = onMount?.();
        const application = createVrApplication({ document, window, audioContext, onPlatforms });
        void application.start();
        return () => {
            application.destroy();
            if (typeof disposeLayout === 'function') disposeLayout();
        };
    }, [audioContext, onPlatforms, onMount]);
    return (
        <main class="game-app vr-game" data-ui="preact" data-game="vr">
            <FullscreenButton />
            <HomeButton />
            <ScreenNavigation vr />
            <h1 class="visually-hidden">Exolon VR · Remastered diorama</h1>
            <section class="vr-game__viewport" aria-label="Exolon VR three-dimensional diorama">
                <canvas
                    id="game"
                    class="vr-game__canvas"
                    width={1100}
                    height={720}
                    tabIndex={0}
                    data-game="vr"
                    data-mode="title"
                    data-ready="false"
                    aria-label="Exolon VR. Arrows move, jump or crouch. Space fires. Escape returns to title. Pause pauses."
                />
                <SettingsToggle />
                <FpsCounter />
                <form id="vr-name-entry" class="vr-game__name-entry" hidden>
                    <label class="vr-game__name-label" for="vr-player-name">
                        Your name
                    </label>
                    <Input
                        id="vr-player-name"
                        class="vr-game__name-input"
                        maxLength={8}
                        autoComplete="off"
                        autoCapitalize="characters"
                    />
                    <Button id="vr-name-save" type="submit">
                        Save score
                    </Button>
                    <Button id="vr-name-cancel" type="button" variant="secondary">
                        Cancel
                    </Button>
                </form>
            </section>
            <footer class="game-footer" aria-label="VR game controls">
                <div class="vr-game__entry">
                    <SettingsGroup label="Enter immersive VR">
                        <Button id="vr-enter" class="vr-game__enter-button" disabled>
                            Enter VR
                        </Button>
                    </SettingsGroup>
                </div>
                <HomePanel>
                    <Toolbar>
                        <Button id="vr-platforms" variant="secondary">
                            Platforms
                        </Button>
                        <Button id="new-game" disabled>
                            Start game
                        </Button>
                        <Button id="vr-scores" variant="secondary" disabled>
                            Scores
                        </Button>
                    </Toolbar>
                </HomePanel>
                <SettingsPanel>
                    <SettingsGroup label="VR view">
                        <div class="vr-game__view-controls">
                            <Button id="vr-recenter" variant="secondary" disabled>
                                Recenter
                            </Button>
                            <label class="vr-game__scale-label" for="vr-scale">
                                Scale
                            </label>
                            <Input
                                id="vr-scale"
                                class="vr-game__scale"
                                type="range"
                                min="0.65"
                                max="1.5"
                                step="0.05"
                                value="1"
                                disabled
                            />
                        </div>
                    </SettingsGroup>
                    <SettingsGroup label="Audio">
                        <SoundControls />
                    </SettingsGroup>
                    <CheatSettings />
                </SettingsPanel>
                <Button id="vr-name-open" type="button" variant="secondary" hidden>
                    Save your name
                </Button>
                <p id="vr-status" class="vr-game__status" role="status">
                    Preparing the Remastered diorama…
                </p>
                <p class="vr-game__help">
                    Quest 3S · Enter VR to leave the browser window · Left stick: move, jump /
                    crouch · Right controller: trigger — rocket, B — bullets, A — start / resume /
                    jump · Left Y: pause / resume
                </p>
                <TouchControls />
            </footer>
            <GamepadHint />
        </main>
    );
}
