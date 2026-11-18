import { C64_GAME_OVER } from '../compressed/recordings.ts';

// Original C64 programs rendered offline. See originals/audio/c64/provenance.json for call sites and aliases.
const asset = name => new URL(`./${name}.wav`, import.meta.url);

export const C64_AUDIO = Object.freeze({
    title: new URL('./title.m4a', import.meta.url),
    gameOver: new URL('./game-over.m4a', import.meta.url),
    gameOverTiming: C64_GAME_OVER,
    effects: Object.freeze({
        shot: asset('shot'),
        grenade: asset('grenade'),
        rocket: asset('turret'),
        explosion: asset('explosion'),
        'enemy-destroyed': asset('enemy-destroyed'),
        turret: asset('turret'),
        mine: asset('explosion'),
        death: asset('death'),
        teleport: asset('teleport'),
        'refill-ammo': asset('refill-ammo'),
        'refill-grenades': asset('refill-grenades'),
        suit: asset('refill-ammo'),
        crusher: asset('crusher'),
        bonus: asset('bonus'),
        impact: asset('impact'),
    }),
});
