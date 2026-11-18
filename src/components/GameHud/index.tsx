import './index.css';
import { SCREEN_COUNT, STAGE_SCREEN_COUNT } from '../../constants/game.ts';
import type { GameState } from '../../types/game.ts';
import type { ApplicationMode } from '../../types/ui.ts';

export function GameHud({ state, mode }: { state: GameState; mode: ApplicationMode }) {
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    return (
        <>
            <span id="stage-label">
                {mode === 'title'
                    ? 'EXOLON / 1987'
                    : `${pad(state.stage || 1)} / STAGE · SCREEN ${state.level || 1} OF ${STAGE_SCREEN_COUNT}${state.exoskeleton ? ' · EXOLON' : ''}`}
            </span>
            <div class="hud__item">
                SCORE{' '}
                <strong class="hud__value" id="score">
                    {pad(state.score, 6)}
                </strong>
            </div>
            <div class="hud__item">
                LIVES{' '}
                <strong class="hud__value" id="lives">
                    {pad(state.lives)}
                </strong>
            </div>
            <div class="hud__item">
                AMMO{' '}
                <strong class="hud__value" id="ammo">
                    {pad(state.ammo)}
                </strong>
            </div>
            <div class="hud__item">
                GRENADES{' '}
                <strong class="hud__value" id="grenades">
                    {pad(state.grenades)}
                </strong>
            </div>
            <div class="hud__item hud__sector">
                {'SCREEN '}
                <strong class="hud__value" id="sector">
                    {pad((state.screenIndex || 0) + 1, 3)} / {SCREEN_COUNT}
                </strong>
            </div>
        </>
    );
}
