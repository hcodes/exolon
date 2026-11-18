import { PLATFORM_IMAGES } from './assets.ts';

export const PLATFORM_CHOICES = [
    { mode: 'retro', query: 'zx-spectrum', name: 'ZX Spectrum', image: PLATFORM_IMAGES.retro },
    { mode: 'c64', query: 'c64', name: 'Commodore 64', image: PLATFORM_IMAGES.c64 },
    { mode: 'cpc', query: 'cpc', name: 'Amstrad CPC', image: PLATFORM_IMAGES.cpc },
    {
        mode: 'sharp-mz800',
        query: 'sharp-mz800',
        name: 'Sharp MZ-800',
        image: PLATFORM_IMAGES['sharp-mz800'],
    },
    {
        mode: 'remastered',
        query: 'remastered',
        name: 'Remastered',
        image: PLATFORM_IMAGES.remastered,
    },
] as const;
export type PlatformMode = (typeof PLATFORM_CHOICES)[number]['mode'];
