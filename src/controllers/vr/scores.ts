import { createScoreController } from '../scores.ts';
import type { GameState } from '../../types/game.ts';
import type { PreferenceStore } from '../../types/ui.ts';

export function createVrRunScores(storage: PreferenceStore) {
    const records = createScoreController(storage);
    let submitted = false;
    function canSubmit(state: GameState) {
        return !submitted && (state.status === 'over' || state.status === 'won');
    }
    return {
        records,
        canSubmit,
        reset() {
            submitted = false;
        },
        submit(name: string, state: GameState) {
            if (!canSubmit(state)) return false;
            submitted = true;
            records.submit(name, state);
            return true;
        },
    };
}
