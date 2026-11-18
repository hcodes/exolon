import type { GameState } from './game.ts';
import type { ApplicationMode } from './ui.ts';
import type { AttractPage } from '../model/high-scores.ts';

export interface ApplicationSessionView {
    readonly state: GameState | undefined;
    readonly running: boolean;
    readonly mode: ApplicationMode;
    readonly menuPage: AttractPage;
}
