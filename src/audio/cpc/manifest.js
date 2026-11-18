import { CPC_GAME_OVER } from '../compressed/recordings.ts';

// Original CPC sound programs rendered offline at the CPC's 1 MHz AY clock.
// Source addresses, event mappings and capture limitations: originals/audio/cpc/provenance.json.
const asset = name => new URL(`./${name}.wav`, import.meta.url);

export const CPC_AUDIO = Object.freeze({
    title: new URL('./title.m4a', import.meta.url),
    gameOver: new URL('./game-over.m4a', import.meta.url),
    gameOverTiming: CPC_GAME_OVER,
    effects: Object.freeze({
        shot: asset('shot'),
        grenade: asset('grenade'),
        rocket: asset('rocket'),
        explosion: asset('explosion'),
        'enemy-destroyed': asset('enemy-destroyed'),
        turret: asset('explosion'),
        mine: asset('explosion'),
        death: asset('explosion'),
        teleport: asset('teleport'),
        'refill-ammo': asset('refill-ammo'),
        'refill-grenades': asset('refill-grenades'),
        suit: asset('refill-ammo'),
        crusher: asset('crusher'),
        bonus: asset('bonus'),
    }),
});
