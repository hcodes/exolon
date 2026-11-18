import { ScreenNavigation } from '../ScreenNavigation/index.tsx';
import classNames from 'classnames';
import { Notifications } from '../Notifications/index.tsx';
import { PlatformSelect } from '../PlatformSelect/index.tsx';
import { FullscreenButton } from '../FullscreenButton/index.tsx';
import { HomeButton } from '../HomeButton/index.tsx';
import { Input } from '../Input/index.tsx';
import { SettingsToggle } from '../SettingsToggle/index.tsx';
import { useLayoutEffect } from 'preact/hooks';
import type { NativeSound } from '../../games/16bit/controllers/application.ts';

import { SettingsGroup } from '../SettingsGroup/index.tsx';
import { SoundControls } from '../SoundControls/index.tsx';
import { SettingsPanel } from '../SettingsPanel/index.tsx';
import { HomePanel } from '../HomePanel/index.tsx';
import { Toolbar } from '../Toolbar/index.tsx';
import { TouchControls } from '../TouchControls/index.tsx';
import { CheatSettings } from '../CheatSettings/index.tsx';
import { Button } from '../Button/index.tsx';
import { TvHelp } from '../TvHelp/index.tsx';
import { GamepadHint } from '../GamepadHint/index.tsx';
import { FpsCounter } from '../FpsCounter/index.tsx';
import './index.css';

export function NativeGame({
    audio,
    onPlatforms,
    onChoosePlatform,
    onMount,
    platform,
    createApplication,
}: {
    platform: 'amiga' | 'atari-st';
    createApplication: (options: {
        document: Document;
        window: Window & typeof globalThis;
        audio: NativeSound;
        onPlatforms: () => void;
    }) => { start(): Promise<void>; destroy(): void };
    audio: NativeSound;
    onPlatforms: () => void;
    onChoosePlatform?: (mode: string) => void;
    onMount?: () => void | (() => void);
}) {
    useLayoutEffect(() => {
        const disposeLayout = onMount?.();
        const app = createApplication({ document, window, audio, onPlatforms });
        void app.start();
        return () => {
            app.destroy();
            if (typeof disposeLayout === 'function') disposeLayout();
        };
    }, [audio, onPlatforms, onMount, createApplication]);
    return (
        <main
            class={classNames('game-app', 'game-app_native', `game-app_${platform}`)}
            data-ui="preact"
            data-game={platform}
        >
            <FullscreenButton />
            <HomeButton />
            <ScreenNavigation />
            <section
                class="game-viewport"
                aria-label={`${platform === 'amiga' ? 'Amiga' : 'Atari ST'} Exolon game`}
            >
                <div class="game-viewport__display">
                    <canvas
                        id="game"
                        class="game-viewport__canvas native-game__canvas"
                        width={320}
                        height={200}
                        tabIndex={0}
                        data-game={platform}
                        aria-label="Game screen. Arrows: move, jump or crouch. Space: fire."
                    />
                    <Input
                        id={`${platform}-player-name`}
                        class="native-game__name-input"
                        type="text"
                        maxLength={10}
                        autoComplete="off"
                        autoCapitalize={platform === 'atari-st' ? 'off' : 'characters'}
                        aria-label="Hall of Fame name"
                        hidden
                    />
                    <FpsCounter />
                </div>
                <SettingsToggle />
            </section>
            <footer class="game-footer" aria-label="Game controls">
                <div class="game-footer__options game-footer__options_amiga">
                    <HomePanel>
                        <Toolbar pauseVariant="amiga">
                            <Button id="platforms" variant="secondary">
                                Platforms
                            </Button>
                            <nav class="native-game__menu" aria-label="Game menu">
                                <Button id="new-game" disabled>
                                    Loading…
                                </Button>
                                <Button id="show-scores" variant="secondary" disabled>
                                    Scores
                                </Button>
                            </nav>
                        </Toolbar>
                    </HomePanel>
                    <SettingsPanel>
                        <SettingsGroup label="Graphics">
                            <PlatformSelect value={platform} onChoose={onChoosePlatform} />
                        </SettingsGroup>
                        <SettingsGroup label="Audio">
                            <SoundControls />
                        </SettingsGroup>
                        <CheatSettings />
                    </SettingsPanel>
                </div>
                <Notifications />
                <TvHelp />
                <TouchControls />
            </footer>
            <GamepadHint />
        </main>
    );
}
