import type { GamepadActions } from '../../input/gamepad.ts';
import type { VrSessionMode } from './session.ts';

export function readVrPreviewAction(
    mode: VrSessionMode,
    buttons: Pick<GamepadActions, 'pause' | 'back' | 'confirm' | 'scores'>,
    inputOwned: boolean,
): 'pause' | 'resume' | 'title' | 'start' | 'scores' | undefined {
    if (inputOwned) return;
    if (buttons.pause && mode === 'playing') return 'pause';
    if ((buttons.pause || buttons.confirm) && mode === 'paused') return 'resume';
    // During play the standard B button is the crouch command, not navigation.
    if (buttons.back && mode !== 'playing' && mode !== 'title') return 'title';
    if (buttons.confirm && ['title', 'over', 'won'].includes(mode)) return 'start';
    if (buttons.scores && mode !== 'playing') return 'scores';
}
