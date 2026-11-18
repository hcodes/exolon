"""Offline gameplay-star references from unchanged original Amiga $c18e.

Uses machine68k0.5.2 and validated recovered RAM. A fixed seed and the browser's
existing static point-field isolate the original animated overlay and its mask;
this does not reproduce a full gameplay RNG or physical chipset trace.
"""
import argparse
import hashlib
import json
from pathlib import Path
import machine68k as m68k


def extract(ram):
    if hashlib.sha256(ram).hexdigest() != "8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7":
        raise ValueError("Unsupported recovered Amiga RAM")
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(0, ram)
    display = 0x100000
    memory.w32(0x103D4, display)
    memory.w16(0xF07A, 501)
    memory.w8(0xF079, 0)
    memory.w32(0xF060, 0x19871201)
    memory.w32(0xF064, 0x12345678)
    base = bytearray(64000)
    inks = [1, 3, 7, 2, 4, 8, 6, 14, 5, 9, 12, 10, 13, 13]
    random = 7919
    for index in range(100):
        random = (random * 1664525 + 1013904223) & 0xffffffff
        x = random % 320
        random = (random * 1664525 + 1013904223) & 0xffffffff
        y = random % 176
        if not base[y * 320 + x]:
            base[y * 320 + x] = inks[index % len(inks)]
    # Occupied-pixel mask canaries: original overlay must preserve these colors.
    masked = bytearray(base)
    for index in range(184 * 320):
        if index % 29 == 0:
            masked[index] = 1 + index % 15

    def planar(pixels):
        result = bytearray(32000)
        for index, ink in enumerate(pixels):
            for plane in range(4):
                if ink & (1 << plane):
                    result[plane * 8000 + index // 8] |= 1 << (7 - index % 8)
        return bytes(result)

    def run():
        cpu.w_sr(0x2700)
        cpu.w_sp(0xFF0)
        memory.w32(0xFF0, 0x700)
        cpu.w_pc(0xC18E)
        for _ in range(100000):
            if cpu.r_pc() == 0x700:
                return
            cpu.execute(1)
        raise RuntimeError(f"Source star routine did not terminate: {cpu.r_pc():x}")

    def pixels():
        planes = memory.r_block(display, 32000)
        return bytes(sum(((planes[p * 8000 + index // 8] >> (7 - index % 8)) & 1) << p
                         for p in range(4)) for index in range(184 * 320))

    result = {"sourceRamSha256": hashlib.sha256(ram).hexdigest(),
              "staticFieldSeed": 0, "randomSeed": 0x19871201,
              "randomSeedHigh": 0x12345678, "window": [0, 0, 320, 184],
              "frames": {}, "maskedFrames": {}}
    try:
        for name, background in [("frames", base), ("maskedFrames", masked)]:
            memory.w16(0xF07A, 501)
            memory.w8(0xF079, 0)
            memory.w32(0xF060, 0x19871201)
            memory.w32(0xF064, 0x12345678)
            initial = planar(background)
            for tick in range(65):
                memory.w_block(display, initial)
                if tick:
                    run()
                result[name][str(tick)] = hashlib.sha256(pixels()).hexdigest()
        return result
    finally:
        machine.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ram", type=Path)
    print(json.dumps(extract(parser.parse_args().ram.read_bytes()), indent=2))
