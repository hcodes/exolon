import classNames from 'classnames';
import { Button } from '../Button/index.tsx';
import './index.css';
import type { GameState } from '../../types/game.ts';

export function Bonus({ state }: { state: GameState }) {
    const bonus = state.bonus;
    if (!bonus) return null;
    return (
        <>
            <span class="bonus__eyebrow">EXOLON BONUS SCREEN</span>
            <h2 class="bonus__heading">Stage complete.</h2>
            <p
                id="bonus-summary"
                class="bonus__summary"
            >{`Lives: ${bonus.lifePoints || 0} · Bravery: ${bonus.braveryPoints || 0} · Total: ${(bonus.lifePoints || 0) + (bonus.braveryPoints || 0)}`}</p>
            <ol class="bonus__list" aria-label="Bonus points">
                {[0, 1000, 0, 3000, 0, 5000, 0, 7000].map((points, index) => (
                    <li
                        key={index}
                        data-bonus-index={index}
                        class={classNames('bonus__item', {
                            bonus__item_active: index === (bonus.cursor & 7),
                        })}
                    >
                        <span>{String(points).padStart(5, '0')} POINTS</span>
                        <b class="bonus__pointer">◀</b>
                    </li>
                ))}
            </ol>
            <Button variant="primary" id="bonus-stop" disabled={!bonus.armed}>
                Stop selector
            </Button>
            <p id="bonus-hint" class="bonus__hint">
                {bonus.armed ? 'M / Space — stop' : 'Release fire, then stop the pointer'}
            </p>
        </>
    );
}
