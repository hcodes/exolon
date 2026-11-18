import type { createGameMenusControl } from './game-menus.ts';
import type { createInput } from '../input/index.ts';
import type { createGamepadNotifications } from './gamepad-notifications.ts';
import type { createPlatformPicker } from './platform-picker.ts';
import type { createControlMenuController } from './control-menu.ts';
import type { createScoreAttract } from '../model/high-scores.ts';
import type { ApplicationSessionView } from '../types/application.ts';

interface GamepadNavigationOptions {
    menus: ReturnType<typeof createGameMenusControl>;
    document: Document;
    input: ReturnType<typeof createInput>;
    gamepadNotifications: ReturnType<typeof createGamepadNotifications>;
    platformPicker: ReturnType<typeof createPlatformPicker>;
    controlMenu: ReturnType<typeof createControlMenuController>;
    attract: ReturnType<typeof createScoreAttract>;
    nameForm: HTMLFormElement;
    saveName: HTMLButtonElement;
    session: ApplicationSessionView;
    play(reset?: boolean): void;
    pause(heading?: string, copy?: string): void;
    showTitle(): void;
    openScores(): void;
    closeScores(): void;
    triggerBonus(): void;
}

export function createGamepadNavigation(options: GamepadNavigationOptions) {
    const {
        menus,
        document,
        input,
        gamepadNotifications,
        platformPicker,
        controlMenu,
        attract,
        nameForm,
        saveName,
        session,
        play,
        pause,
        showTitle,
        openScores,
        closeScores,
        triggerBonus,
    } = options;
    let gamepadSession = false;
    function poll() {
        const pad = input.pollGamepad(!document.hidden && document.hasFocus());
        gamepadNotifications.update(pad);
        if (pad.lost) menus.revokeResume();
        if (pad.lost && session.running && gamepadSession) {
            pause('Gamepad disconnected.', 'Connect a controller or continue with the keyboard.');
            return;
        }
        if (pad.status !== 'ready') return;
        if (platformPicker.active) {
            platformPicker.gamepad(
                Number(pad.commands.right || pad.commands.duck) - Number(pad.commands.left),
                pad.pressed.confirm || pad.pressed.pause,
            );
            return;
        }
        if (menus.gamepad(pad)) return;
        if (session.mode === 'title' && pad.activity) attract.activity();
        if (session.mode === 'title' && controlMenu.pad(pad)) return;
        if (
            session.running &&
            (Object.values(pad.commands).some(Boolean) || pad.pressed.launchRocket)
        )
            gamepadSession = true;
        if (!nameForm.hidden && (pad.pressed.confirm || pad.pressed.pause)) {
            saveName.click();
            return;
        }
        if (pad.pressed.pause) {
            gamepadSession = true;
            if (session.running) pause();
            else if (['title', 'paused', 'over', 'won'].includes(session.mode))
                play(session.mode === 'title');
            return;
        }
        if (session.mode === 'title') {
            if (pad.pressed.confirm || pad.commands.fire) {
                gamepadSession = true;
                play(true);
                return;
            }
            if (pad.pressed.back && session.menuPage !== 'title') {
                closeScores();
                return;
            }
            if (pad.pressed.scores) {
                if (session.menuPage === 'scores') closeScores();
                else openScores();
                return;
            }
        } else if (['paused', 'over', 'won'].includes(session.mode)) {
            if (pad.pressed.confirm || (session.mode === 'paused' && pad.commands.fire)) {
                gamepadSession = true;
                play();
            } else if (pad.pressed.back) showTitle();
        } else if (session.running && session.state?.status === 'bonus' && pad.pressed.confirm)
            triggerBonus();
    }

    return {
        poll,
        setSession(value: boolean) {
            gamepadSession = value;
        },
    };
}
