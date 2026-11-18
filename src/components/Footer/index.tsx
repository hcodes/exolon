import { Notifications } from '../Notifications/index.tsx';
import { PlatformSelect } from '../PlatformSelect/index.tsx';
import { Select } from '../Select/index.tsx';
import { Input } from '../Input/index.tsx';
import { Checkbox } from '../Checkbox/index.tsx';
import { SettingsGroup } from '../SettingsGroup/index.tsx';
import { SoundControls } from '../SoundControls/index.tsx';
import { SettingsPanel } from '../SettingsPanel/index.tsx';
import { HomePanel } from '../HomePanel/index.tsx';
import { Button } from '../Button/index.tsx';
import './index.css';
import { TvHelp } from '../TvHelp/index.tsx';
import { TitleMenu } from '../TitleMenu/index.tsx';
import { Toolbar } from '../Toolbar/index.tsx';
import { TouchControls } from '../TouchControls/index.tsx';
import { CheatSettings } from '../CheatSettings/index.tsx';

export function Footer() {
    return (
        <footer class="game-footer" aria-label="Game controls">
            <div class="game-footer__options">
                <HomePanel>
                    <Toolbar>
                        <Button id="platforms" variant="secondary">
                            Platforms
                        </Button>
                        <TitleMenu />
                    </Toolbar>
                </HomePanel>
                <SettingsPanel>
                    <SettingsGroup label="Graphics">
                        <PlatformSelect />
                        <label class="game-footer__graphics-choice">
                            <Checkbox id="monochrome" />
                            Grayscale
                        </label>
                        <div id="split-options" class="game-footer__split-options" hidden>
                            <label class="game-footer__graphics-choice">
                                Left
                                <Select
                                    id="split-left"
                                    class="game-footer__graphics-select"
                                    aria-label="Left graphics"
                                ></Select>
                            </label>
                            <label class="game-footer__graphics-choice">
                                Right
                                <Select
                                    id="split-right"
                                    class="game-footer__graphics-select"
                                    aria-label="Right graphics"
                                ></Select>
                            </label>
                        </div>
                    </SettingsGroup>
                    <SettingsGroup label="Audio">
                        <SoundControls />
                    </SettingsGroup>
                    <CheatSettings />
                </SettingsPanel>
            </div>
            <div class="hud" id="hud" hidden />
            <div class="game-footer__overlay" id="overlay" hidden>
                <h2 id="overlay-title" class="game-footer__overlay-title"></h2>
                <p
                    id="overlay-copy"
                    class="game-footer__overlay-copy game-footer__overlay-text"
                ></p>
                <form class="game-footer__name-entry" id="name-entry" novalidate hidden>
                    <label htmlFor="player-name">Hall of Fame name</label>
                    <Input
                        id="player-name"
                        name="nickname"
                        type="text"
                        maxLength={8}
                        required
                        autoComplete="off"
                        enterKeyHint="done"
                        autoCapitalize="characters"
                        spellcheck={false}
                        aria-describedby="name-hint"
                    />
                    <p class="game-footer__overlay-text" id="name-hint">
                        Up to 8 letters or numbers. Remastered supports international letters. Press
                        Enter to save.
                    </p>
                    <Button variant="primary" id="save-name" type="submit">
                        Save name
                    </Button>
                </form>
            </div>
            <div class="bonus" id="bonus-screen" hidden />
            <Notifications />
            <TvHelp />
            <TouchControls />
        </footer>
    );
}
