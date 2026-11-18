"""Capture the original small bullet impact ($a970/$a926/$aad6).

Requires the temporary machine68k0.5.2 environment and validated recovered RAM.
Only the framebuffer address is relocated; no drawing instructions are patched.
"""
import argparse
import hashlib
import json
from pathlib import Path
import machine68k as m68k


def extract(ram):
    digest = hashlib.sha256(ram).hexdigest()
    if digest != '8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7':
        raise ValueError('Unsupported Amiga RAM')
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(0, ram)
    display = 0x120000
    memory.w32(0x103d4, display)

    def run(start):
        cpu.w_sr(0x2700)
        cpu.w_sp(0xff0)
        memory.w32(0xff0, 0x700)
        cpu.w_pc(start)
        for _ in range(100000):
            if cpu.r_pc() == 0x700:
                return
            cpu.execute(1)
        raise RuntimeError(f'Original routine did not terminate: {cpu.r_pc():x}')

    # Original ten-slot pool, empty markers501 and end marker500.
    for i in range(10):
        memory.w16(0xf810 + i * 4, 501)
    memory.w16(0xf810 + 40, 500)
    memory.w16(0x103dc, 105)
    memory.w16(0x103de, 120)
    run(0xa970)
    frames = []
    for tick in range(1, 10):
        memory.w_block(display, bytes(32000))
        run(0xa926)
        planes = memory.r_block(display, 32000)
        pixels = bytes(sum(((planes[p * 8000 + y * 40 + x // 8] >> (7 - x % 8)) & 1) << p
                           for p in range(4))
                       for y in range(184) for x in range(320))
        frames.append({'tick': tick, 'sha256': hashlib.sha256(pixels).hexdigest(),
                       'active': memory.r16(0xf810) != 501})
    return {'sourceRamSha256': digest, 'x': 105, 'y': 80, 'frames': frames}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ram', type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.ram.read_bytes()), indent=2))
