// Port of Exolon's 128K AY effect bytecode, sound_psg.asm C1DD-C217/BF7B-C0E7.
// Raffaele Cecco (1987), disassembled by Sergey Erokhin (2014), CC-BY-SA 3.0.
// https://bitbucket.org/esl/exolon-zx/ (asm/sound_psg.asm)
import { originalByte } from './original-data.js';

export const AY_CLOCK = 1773450;
export const EFFECT_RATE = 50;

export interface EffectState {
    active: boolean;
    pointer: number;
    noteTicks: number;
    volume: number;
    baseVolume: number;
    decayTicks: number;
    decayPeriod: number;
    decay: number;
    mixer: number;
    period: number;
    duration: number;
}
const effects: Record<string, number[]> = {
    shot: [0xc5a1], // snd_player_shot, original effect slot 15.
    turret: [0xc305], // snd_first_first_gun, original effect slot 6.
    explosion: [0xc305], // Also used for destroyable objects and mines.
    mine: [0xc305], // snd_first_first_gun on original mine detonation.
    'enemy-destroyed': [0xc33e], // snd_destroy_ball, original effect slot 8.
    rocket: [0xc2c7], // snd_shot_tworocket, original effect slot 7.
    teleport: [0xc462], // snd_teleport, original effect slot 13.
    'refill-ammo': [0xc218], // snd_got_white_box, original effect slot 2.
    'refill-grenades': [0xc23e], // snd_got_yellow_box, original effect slot 2.
    suit: [0xc218], // Original changing chamber uses the white box sound.
    death: [0xc305], // Native prototype reuses the destruction effect.
    grenade: [0xc366, 0xc3d8], // snd_Fire_Grenades, original slots 9 and 15.
};

const word = (address: number) => originalByte(address) | (originalByte(address + 1) << 8);

function readNote(state: EffectState, registers: Uint8Array) {
    for (let commands = 0; commands < 100; commands++) {
        let value = originalByte(state.pointer++);
        if (value === 0xff) {
            state.active = false;
            return;
        }
        if (value === 0xfe) {
            state.baseVolume = originalByte(state.pointer++);
            continue;
        }
        if (value === 0xfd) {
            state.decayPeriod = originalByte(state.pointer++);
            state.decayTicks = (state.decayPeriod >> 1) + 1;
            state.decay = originalByte(state.pointer++);
            continue;
        }
        if (value === 0xfc) {
            state.mixer = originalByte(state.pointer++);
            continue;
        }
        if (value === 0xfb) {
            // The original deliberately also consumes the noise value as a note.
            value = originalByte(state.pointer++);
            registers[6] = value;
        }
        if (value >= 0x60) {
            value -= 0x60;
            state.duration = originalByte(state.pointer++);
        }
        state.period = word(0xc6eb + value * 2);
        state.noteTicks = state.duration;
        state.volume = state.baseVolume;
        return;
    }
    throw new Error('Invalid original sound effect bytecode.');
}

/** Decode one original sound to complete AY register snapshots per driver step. */
export function decodeEffect(name: string): Uint8Array[] {
    const pointers = effects[name];
    if (!pointers) throw new RangeError(`Unknown Exolon effect: ${name}`);
    const states = pointers.map((pointer) => ({
        active: true,
        pointer,
        noteTicks: 1,
        volume: 15,
        baseVolume: 15,
        decayTicks: 0,
        decayPeriod: 0,
        decay: 1,
        mixer: 0x38,
        period: 0,
        duration: 1,
    }));
    const registers = new Uint8Array(11);
    const frames: Uint8Array[] = [];
    for (let frame = 0; frame < 1000; frame++) {
        registers[7] = 0xbf;
        let mask = 0xf6;
        let channel = 0;
        for (const state of states) {
            if (!state.active) continue;
            state.noteTicks = (state.noteTicks - 1) & 255;
            if (!state.noteTicks) readNote(state, registers);
            if (!state.active) {
                mask = ((mask << 1) | (mask >> 7)) & 255;
                continue;
            }
            state.decayTicks = (state.decayTicks - 1) & 255;
            if (!state.decayTicks) {
                state.decayTicks = state.decayPeriod;
                if (state.volume) state.volume = (state.volume - state.decay) & 255;
            }
            if (channel < 3) {
                registers[7] &= mask | state.mixer;
                registers[channel * 2] = state.period & 255;
                registers[channel * 2 + 1] = state.period >> 8;
                registers[8 + channel] = state.volume;
            }
            mask = ((mask << 1) | (mask >> 7)) & 255;
            channel++;
        }
        frames.push(registers.slice());
        if (!states.some((state) => state.active)) return frames;
    }
    throw new Error('Original sound effect did not terminate.');
}
