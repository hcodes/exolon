"""Offline 68000 core-cycle probe, not a chipset or browser emulator.

Requires machine68k 0.5.2 in a temporary Python environment. Input RAM is produced
by tools/recovery/amiga.mjs. Reports lower bounds: DMA, IRQ/audio overhead and
VBL waiting are excluded. Never infer measured physical-device FPS from this.
"""

import argparse
import hashlib
import json
from pathlib import Path

import machine68k as m68k


def measure(disk, ram):
    expected_disk = "54260a1b4f95b18b115ef69d5f90cbc7a584e74c28572e7296e80196989ee8d1"
    expected_ram = "8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7"
    if hashlib.sha256(disk).hexdigest() != expected_disk:
        raise ValueError("Unsupported Amiga disk")
    if hashlib.sha256(ram).hexdigest() != expected_ram:
        raise ValueError("Unsupported recovered Amiga RAM")
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(0, ram)
    # Disk reads are copied below; bypass CIA setup, music initialization, title
    # presentation, interrupt installation and VBL wait. Keep gameplay unchanged.
    bypass = [0xEE52, 0x9582, 0x958E, 0xA016, 0x8AE0, 0xEE84, 0xE034]
    for address in bypass:
        memory.w16(address, 0x4E75)  # RTS

    def run(start, end):
        cpu.w_sr(0x2700)
        cpu.w_sp(0xFF0)
        memory.w32(0xFF0, end)
        cpu.w_pc(start)
        cycles = 0
        for _ in range(3_000_000):
            if cpu.r_pc() == end:
                return cycles
            if cpu.r_pc() == 0xEE52:
                source = cpu.r32_reg(m68k.Register.A1)
                target = memory.r32(0xFBBA)
                length = cpu.r32_reg(m68k.Register.D7)
                if not (0 < length <= 0x80000 and source + length <= len(disk)
                        and target + length <= 0x80000):
                    raise ValueError("Invalid original disk-read range")
                memory.w_block(target, disk[source:source + length])
            cycles += cpu.execute(1).cycles
        raise RuntimeError(f"Probe did not terminate at PC ${cpu.r_pc():x}")

    try:
        run(0x8000, 0x869C)  # Original initialization and graphics expansion.
        run(0x9690, 0x700)   # Original new game, including stage-zero resources.
        memory.w32(0xF060, 0x12345678)
        memory.w32(0xF064, 0x9ABCDEF0)
        memory.w16(0xFBB2, 0)
        memory.w16(0xFBB0, 0)
        run(0xC93A, 0x700)   # Native first-screen object setup.
        memory.w8(0xFBFC, 1)
        memory.w8(0xFBE4, 15)
        memory.w16(0xFBEA, 26)
        memory.w16(0xF9E4, 176)
        ticks = []
        for _ in range(20):
            memory.w8(0xFBC6, 0)  # Neutral controller.
            ticks.append(run(0x869C, 0x873A))
        copy_cycles = run(0xC6D4, 0x700)
        return {
            "probe": "machine68k 0.5.2, M68000 core cycles; no DMA/IRQ/VBL",
            "bypassed": [f"${address:x}" for address in bypass],
            "screen": 1,
            "copyCycles": copy_cycles,
            "gameplayCycles": ticks,
            "minimumCycles": min(ticks),
            "maximumCycles": max(ticks),
            "meanCycles": sum(ticks) / len(ticks),
        }
    finally:
        machine.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("disk", type=Path)
    parser.add_argument("ram", type=Path)
    args = parser.parse_args()
    print(json.dumps(measure(args.disk.read_bytes(), args.ram.read_bytes()), indent=2))
