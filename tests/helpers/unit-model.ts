import { createState } from '../../src/model/state.ts';
import type { GameState, Player } from '../../src/types/game.ts';

export type StateDetails = Omit<Partial<GameState>, 'player'> & { player?: Partial<Player> };

/** Keep presentation fixtures valid model snapshots while overriding only observed fields. */
export function modelState(detail: StateDetails = {}): GameState {
    const base = createState({ id: 0, tiles: Array(768).fill(null) });
    return { ...base, ...detail, player: { ...base.player, ...detail.player } };
}
