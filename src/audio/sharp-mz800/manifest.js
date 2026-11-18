// Original Datelsoft MZ-800 SN76489 port writes rendered offline.
// Original programs, documented aliases and timing limits: originals/audio/sharp-mz800/provenance.json.
const asset = name => new URL(`./${name}.wav`, import.meta.url);

export const SHARP_AUDIO = Object.freeze({
    title: new URL('./title.m4a', import.meta.url),
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
    }),
});
