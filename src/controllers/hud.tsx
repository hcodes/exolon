import { render } from 'preact';
import { GameHud } from '../components/GameHud/index.tsx';
import { Bonus } from '../components/Bonus/index.tsx';
import type { GameState } from '../types/game.ts';
import type { ApplicationMode } from '../types/ui.ts';
import { gameElement } from '../utils/dom.ts';

export function createHud(document: Document, onBonusStop: () => void) {
    const hud = gameElement(document, 'hud'),
        bonus = gameElement(document, 'bonus-screen');
    // Delegation survives declarative creation/removal of the bonus button.
    const stop = (event: MouseEvent) => {
        if ((event.target as Element | null)?.closest('#bonus-stop')) onBonusStop();
    };
    bonus.addEventListener('click', stop);
    return {
        render(state: GameState, mode: ApplicationMode) {
            render(<GameHud state={state} mode={mode} />, hud);
            const visible = state.status === 'bonus' && mode === 'playing';
            bonus.hidden = !visible;
            render(visible ? <Bonus state={state} /> : null, bonus);
        },
        destroy() {
            bonus.removeEventListener('click', stop);
            render(null, hud);
            render(null, bonus);
        },
    };
}
