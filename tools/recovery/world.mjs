// Encoding cross-checked against Sergey Erokhin (ESL)'s Exolon disassembly.
// https://github.com/rusarh/exolon-esl (CC BY-SA 3.0); see research/behavior.md.
import { traceContours } from '../graphics/contours.mjs';

const BASE = 0x6d60;
const BLOCK_NAMES = [
    'beam-bottom',
    'beam-top',
    'ship',
    'red-planet',
    'small-planet',
    'turret',
    'red-ground',
    'red-ground',
    'red-ground',
    'red-ground',
    'red-ground',
    'gate',
    'mine',
    'yellow-tower',
    'red-ground',
    'radar-tower',
    'rocket-tower',
    'teleport',
    'ammo-box',
    'ammo-box',
    'grenade-box',
    'sphere-pod',
    'pump',
    'green-ground',
    'white-column',
    'green-column',
    'double-barrel',
    'purple-column',
    'jump-platform',
    'changing-room',
    'green-planet',
    'beacon',
    'beacon-base',
    'yellow-ground',
    'yellow-column',
    'small-planet',
    'small-planet',
    'cyan-planet',
    'white-ground',
    'sphere-home',
    'wagon',
    'red-hill',
    'stage-gate',
    'flash',
    'turret-top',
    'turret-base',
    'mushroom',
    'yellow-barrel',
    'diagonal-left',
    'diagonal-right',
    'four-barrels',
    'high-voltage',
    'yellow-ground',
    'transparent-column',
    'green-ground',
    'yellow-brick',
    'green-ground',
    'green-ground',
    'green-ground',
    'green-ground',
    'green-ground',
    'green-ground',
];

function recoverTrajectory(memory, address) {
    const trajectory = [];
    const signed = (value) => (value > 127 ? value - 256 : value);
    for (let budget = 0; budget < 2048; budget++) {
        const opcode = checkedByte(memory, address++);
        if (opcode === 0xc3) return trajectory;
        if (opcode === 0xc4) {
            const count = checkedByte(memory, address++);
            const dx = signed(checkedByte(memory, address++));
            const dy = signed(checkedByte(memory, address++));
            for (let i = 0; i < count; i++) trajectory.push([dx, dy]);
        } else trajectory.push([signed(opcode), signed(checkedByte(memory, address++))]);
    }
    throw new Error('Enemy trajectory instruction limit exceeded');
}

function recoverEnemies(memory) {
    const enemies = [];
    for (let address = 0xa677; checkedByte(memory, address) !== 255; address += 5) {
        if (enemies.length >= 125) throw new Error('Unterminated enemy definition table');
        enemies.push({
            screen: memory[address],
            sprite: memory[address + 3],
            delay: memory[address + 4],
            trajectory: recoverTrajectory(memory, word(memory, address + 1)),
        });
    }
    return enemies;
}

export function browserWorld(world) {
    const contours = [[]];
    const shapes = new Map([[Array(8).fill(0).join(','), 0]]);
    const shapeFor = (bitmap) => {
        const key = bitmap.join(',');
        if (!shapes.has(key)) {
            shapes.set(key, contours.length);
            contours.push(traceContours(bitmap));
        }
        return shapes.get(key);
    };
    const screens = world.screens.map((screen) => ({
        ...screen,
        tiles: screen.tiles.map((tile) => {
            if (!tile) return null;
            return {
                collision: tile.collision,
                block: tile.block,
                instance: tile.instance,
                color: tile.color,
                overlay: tile.overlay,
                glyph: tile.glyph,
                ink: tile.bitmap.some((byte) => byte !== 0),
                shape: shapeFor(tile.bitmap),
            };
        }),
    }));
    const pump = world.pump
        ? {
              ...world.pump,
              tiles: world.pump.tiles.map((tile) => ({
                  x: tile.x,
                  y: tile.y,
                  color: tile.color,
                  ink: tile.bitmap.some((byte) => byte !== 0),
                  shape: shapeFor(tile.bitmap),
              })),
          }
        : undefined;
    return { ...world, screens, contours, ...(pump ? { pump } : {}) };
}

export function relocateGame(payload) {
    if (payload.length !== 0x92a0) throw new Error('Unexpected game payload size');
    if (payload[0] !== 0xf3 || payload[1] !== 0x31 || payload[2] !== 0 || payload[3] !== 0) {
        throw new Error('Unexpected game entry signature');
    }
    const memory = new Uint8Array(65536);
    memory.set(payload, BASE);
    return memory;
}

function checkedByte(memory, address) {
    if (address < BASE || address >= memory.length)
        throw new Error(`Invalid data address: ${address}`);
    return memory[address];
}

function word(memory, address) {
    return checkedByte(memory, address) | (checkedByte(memory, address + 1) << 8);
}

export function readPlacements(memory, address) {
    const placements = [];
    while (checkedByte(memory, address) !== 255) {
        if (address + 2 >= memory.length) throw new Error('Truncated screen record');
        placements.push({ y: memory[address], x: memory[address + 1], block: memory[address + 2] });
        address += 3;
    }
    return placements;
}

export function decodeBlock(memory, address, origin) {
    const cells = [];
    const actions = [];
    const state = { x: origin.x, y: origin.y, font: 0x2530, color: 0, collision: 1, overlay: 0 };
    let budget = 50000;
    const emit = (glyph) => {
        if (state.x < 32 && state.y < 24) {
            const bitmapAddress = state.font + glyph * 8;
            // ROM font is used only for space in zone blocks; no ROM is shipped.
            if (bitmapAddress < BASE && glyph !== 32) throw new Error('Unexpected ROM glyph');
            const bitmap =
                bitmapAddress < BASE
                    ? Array(8).fill(0)
                    : Array.from({ length: 8 }, (_, i) => checkedByte(memory, bitmapAddress + i));
            cells.push({
                x: state.x,
                y: state.y,
                glyph,
                font: state.font,
                color: state.color,
                collision: state.collision,
                overlay: state.overlay,
                bitmap,
            });
        }
    };
    const execute = (start, depth) => {
        if (depth > 16) throw new Error('Block recursion limit exceeded');
        let pc = start;
        const loops = [];
        const next = () => checkedByte(memory, pc++);
        while (--budget > 0) {
            const op = next();
            if (op <= 0x60) {
                emit(op);
                state.x = (state.x + 1) & 255;
            } else if (op < 0x90) {
                state.y = (state.y + op - 0x78) & 255;
                state.x = (state.x + next()) & 255;
            } else if (op < 0xcf) {
                state.y = (state.y + 1) & 255;
                state.x = (state.x + op - 0xaf) & 255;
            } else if (op < 0xdf) {
                const color = op - 0xcf;
                state.color = (state.color & 0x38) | (color < 8 ? color : (color - 8) | 0x40);
            } else if (op === 0xdf) {
                state.y = next();
                state.x = next();
            } else if (op === 0xe0) {
                state.color = next();
            } else if (op === 0xe1) {
                const count = next();
                loops.push({ pc, count: count || 256, color: state.color });
            } else if (op === 0xe2) {
                const loop = loops.at(-1);
                if (!loop) throw new Error('Unmatched block loop');
                state.color = loop.color;
                if (--loop.count) pc = loop.pc;
                else loops.pop();
            } else if (op === 0xe3) {
                const target = word(memory, pc);
                pc += 2;
                const { x, y, color } = state;
                execute(target, depth + 1);
                Object.assign(state, { x, y, color });
            } else if (op === 0xe4 || op === 0xe5) {
                const count = next() || 256;
                const glyph = next();
                for (let i = 0; i < count; i++) {
                    emit(glyph);
                    const axis = op === 0xe4 ? 'x' : 'y';
                    state[axis] = (state[axis] + 1) & 255;
                }
            } else if (op === 0xe6) {
                state.font = word(memory, pc);
                pc += 2;
            } else if (op === 0xe7) {
                const font = state.font;
                state.font = 0xd7e0;
                emit(32);
                state.font = font;
                state.x = (state.x + 1) & 255;
            } else if (op === 0xe8) {
                state.collision = next();
            } else if (op === 0xe9 || op === 0xea) {
                state.overlay = op === 0xea ? 255 : 0;
            } else if (op === 0xeb) {
                actions.push({ x: state.x, y: state.y, type: next() });
            } else {
                return;
            }
        }
        throw new Error('Block instruction limit exceeded');
    };
    execute(address, 0);
    return { cells, actions };
}

export function recoverWorld(memory) {
    const screens = [];
    for (let id = 0; id < 125; id++) {
        const address = word(memory, 0xc7f4 + id * 2);
        const placements = readPlacements(memory, address);
        const tiles = Array(768).fill(null);
        const actions = [];
        for (const [instance, placement] of placements.entries()) {
            if (placement.block >= 62) throw new Error(`Invalid block in screen ${id}`);
            const blockAddress = word(memory, 0x852e + placement.block * 2);
            const decoded = decodeBlock(memory, blockAddress, placement);
            for (const cell of decoded.cells)
                tiles[cell.y * 32 + cell.x] = { ...cell, block: placement.block, instance };
            for (const action of decoded.actions) {
                actions.push({ ...action, block: placement.block, instance });
                if (action.x < 32 && action.y < 22) {
                    const offset = action.y * 32 + action.x;
                    const previous = tiles[offset];
                    tiles[offset] = {
                        ...previous,
                        x: action.x,
                        y: action.y,
                        collision: action.type,
                        block: placement.block,
                        instance,
                        bitmap: previous?.bitmap || Array(8).fill(0),
                    };
                }
            }
        }
        const objects = tiles.flatMap((tile, offset) =>
            tile && tile.collision >= 2 && offset < 704
                ? [
                      {
                          id: offset,
                          type: tile.collision,
                          x: offset % 32,
                          y: offset >> 5,
                          block: tile.block,
                          instance: tile.instance,
                      },
                  ]
                : [],
        );
        screens.push({ id, address, placements, tiles, actions, objects });
    }
    // Original moving pump mask: 24 by 32, three MSB-first bytes per row.
    const pump = { width: 24, height: 32, tiles: [] };
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 3; x++) {
            pump.tiles.push({
                x,
                y,
                color: 68,
                bitmap: Array.from({ length: 8 }, (_, row) =>
                    checkedByte(memory, 0xf880 + (y * 8 + row) * 3 + x),
                ),
            });
        }
    }
    return { screens, enemies: recoverEnemies(memory), blockNames: BLOCK_NAMES, pump };
}
