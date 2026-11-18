import { GAMEBOY_GAME_OVER } from '../compressed/recordings.ts';

// Newly arranged Game Boy-inspired sound design, not an original port recording.
// Offline mono PCM; source, channel design and reproducibility: originals/audio/gameboy/provenance.json.
const asset = name => new URL(`./${name}.wav`, import.meta.url);

export const GAMEBOY_AUDIO = Object.freeze({
    title: new URL('./title.m4a', import.meta.url),
    gameOver: new URL('./game-over.m4a', import.meta.url),
    gameOverTiming: GAMEBOY_GAME_OVER,
    effects: Object.freeze({
        shot: asset('shot'),
        grenade: asset('grenade'),
        rocket: asset('rocket'),
        explosion: asset('explosion'),
        'enemy-destroyed': asset('enemy-destroyed'),
        turret: asset('turret'),
        mine: asset('mine'),
        death: asset('death'),
        teleport: asset('teleport'),
        'refill-ammo': asset('refill-ammo'),
        'refill-grenades': asset('refill-grenades'),
        suit: asset('suit'),
    }),
});
