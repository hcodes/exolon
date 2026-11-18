import test from 'node:test';
import assert from 'node:assert/strict';
import { readGameIdentity, LAUNCH_CHOICES } from '../../src/utils/game-launch.ts';
import { GRAPHICS_MODES } from '../../src/constants/graphics.ts';
import { PLATFORM_CHOICES } from '../../src/constants/platforms.ts';

test('Amiga is a separate game identity and never a graphics or Split mode', () => {
    assert.equal(readGameIdentity('?game=amiga&graphics=c64&level=41'), 'amiga');
    assert.equal(readGameIdentity('?graphics=amiga'), 'classic');
    assert.equal(readGameIdentity('?game=unknown'), 'classic');
    assert.equal(readGameIdentity(''), 'classic');
    assert.equal(
        GRAPHICS_MODES.some((mode: string) => mode === 'amiga'),
        false,
    );
    assert.equal(
        PLATFORM_CHOICES.some((choice) => (choice.mode as string) === 'amiga'),
        false,
    );
    assert.deepEqual(
        LAUNCH_CHOICES.map((choice) => choice.mode),
        ['retro', 'c64', 'cpc', 'sharp-mz800', 'amiga', 'atari-st', 'remastered', 'vr'],
    );
    assert.equal(
        LAUNCH_CHOICES.find((choice) => choice.mode === 'amiga')?.image,
        './assets/images/amiga/loading.png',
    );
});

test('Atari ST has its own game identity, banner and independent presentation', () => {
    assert.equal(readGameIdentity('?game=atari-st&level=10'), 'atari-st');
    assert.equal(readGameIdentity('?graphics=atari-st'), 'classic');
    assert.equal(LAUNCH_CHOICES.find((choice) => choice.mode === 'amiga')?.name, 'Amiga 500');
    assert.equal(LAUNCH_CHOICES.find((choice) => choice.mode === 'atari-st')?.name, 'Atari ST');
    assert.equal(
        LAUNCH_CHOICES.find((choice) => String(choice.mode) === 'atari-st')?.image,
        './assets/images/atari-st/loading.png',
    );
    assert.equal(
        GRAPHICS_MODES.some((mode) => String(mode) === 'atari-st'),
        false,
    );
});

test('VR has a separate modern game identity and the final launch banner', () => {
    assert.equal(readGameIdentity('?game=vr&graphics=c64&level=41'), 'vr');
    assert.equal(readGameIdentity('?graphics=vr'), 'classic');
    assert.deepEqual(LAUNCH_CHOICES.at(-1), {
        mode: 'vr',
        query: 'vr',
        name: 'Exolon VR (In progress)',
        image: './assets/images/vr/banner.png',
    });
    assert.equal(
        GRAPHICS_MODES.some((mode) => String(mode) === 'vr'),
        false,
    );
    assert.equal(
        PLATFORM_CHOICES.some((choice) => String(choice.mode) === 'vr'),
        false,
    );
});

test('modern and legacy registries keep VR outside legacy game generation', async () => {
    const configuration = await import('../../rolldown.config.mjs');
    assert.deepEqual(Object.keys(configuration.gameEntries), [
        'classic',
        'amiga',
        'atari-st',
        'vr',
    ]);
    assert.deepEqual(Object.keys(configuration.legacyGameEntries), [
        'classic',
        'amiga',
        'atari-st',
    ]);
});
