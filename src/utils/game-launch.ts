import { PLATFORM_CHOICES } from '../constants/platforms.ts';

export type GameIdentity = 'classic' | 'amiga' | 'atari-st' | 'vr';
export function readGameIdentity(search: string): GameIdentity {
    const value = new URLSearchParams(search).get('game');
    return value === 'amiga' || value === 'atari-st' || value === 'vr' ? value : 'classic';
}
// Game identity is separate from the current game's Graphics/Split choices.
export const LAUNCH_CHOICES = [
    ...PLATFORM_CHOICES.slice(0, -1),
    {
        mode: 'amiga',
        query: 'amiga',
        name: 'Amiga 500',
        image: './assets/images/amiga/loading.png',
    } as const,
    {
        mode: 'atari-st',
        query: 'atari-st',
        name: 'Atari ST',
        image: './assets/images/atari-st/loading.png',
    } as const,
    PLATFORM_CHOICES[PLATFORM_CHOICES.length - 1],
    {
        mode: 'vr',
        query: 'vr',
        name: 'Exolon VR (In progress)',
        image: './assets/images/vr/banner.png',
    } as const,
] as const;
