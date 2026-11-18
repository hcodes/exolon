export function audioMode(mode: string): string {
    return mode === 'gameboy-color' ? 'gameboy' : mode === 'split' ? 'remastered' : mode;
}
