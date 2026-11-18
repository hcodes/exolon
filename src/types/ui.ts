export type ApplicationMode = 'title' | 'playing' | 'paused' | 'over' | 'won' | 'error';
export type GraphicsMode =
    'retro' | 'remastered' | 'split' | 'c64' | 'cpc' | 'sharp-mz800' | 'gameboy' | 'gameboy-color';
export type RenderMode = Exclude<GraphicsMode, 'split'>;
export type SplitSide = 'left' | 'right';
export interface SplitPair {
    left: RenderMode;
    right: RenderMode;
}
export type PreferenceName =
    | 'graphics'
    | 'settingsCollapsed'
    | 'splitPair'
    | 'monochrome'
    | 'cheats'
    | 'bestScore'
    | 'playerRecord'
    | 'highScores';
export interface PreferenceStore {
    get(name: PreferenceName): string | null | undefined;
    set(name: PreferenceName, value: unknown): boolean;
}
