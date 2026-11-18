"""Original Amiga rocket smoke: $9886 emission and $98dc drawing/lifetime.

Run offline in the temporary machine68k0.5.2 environment with verified recovered
RAM. Framebuffers and shifted-sprite atlases are relocated to scratch memory.
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
        for _ in range(300000):
            if cpu.r_pc() == 0x700:
                return
            cpu.execute(1)
        raise RuntimeError(f'Original routine did not terminate: {cpu.r_pc():x}')

    # Original six-frame smoke tables reference five reusable bullet atlases.
    native_atlases = [0x2246c, 0x22bec, 0x2336c, 0x23aec, 0x2426c]
    scratch = {}
    for i, address in enumerate(native_atlases):
        scratch[address] = 0x180000 + i * 0x800
        memory.w32(0x1041c, 0x16120 + i * 48)
        memory.w32(0x10418, scratch[address])
        memory.w16(0x10414, 15)
        memory.w16(0x10416, 5)
        memory.w16(0x10420, 1)
        run(0xa260)
    for offset in range(12):
        address = memory.r32(0xfb00 + offset * 4)
        memory.w32(0xfb00 + offset * 4, scratch[address])

    result = {'sourceRamSha256': digest, 'start': [96, 120], 'directions': {}}
    for direction in [1, -1]:
        for i in range(20):
            memory.w16(0xfa98 + i * 4, 501)
        memory.w16(0xfa98 + 80, 500)
        memory.w8(0xfafe, 7)
        memory.w8(0xf9f8, int(direction < 0))
        x, y = 96, 120
        frames = []
        for tick in range(13):
            # The real rocket calls emitter before advancing its original arc.
            if tick < 7:
                memory.w16(0xf9f0, x)
                memory.w16(0xf9f2, y + 40)
                run(0x9886)
                x += direction * memory.r16(0xf9fa + tick * 4)
                delta_y = memory.r16(0xf9fc + tick * 4)
                y += delta_y - 65536 if delta_y >= 32768 else delta_y
            memory.w_block(display, bytes(32000))
            run(0x98dc)
            planes = memory.r_block(display, 32000)
            pixels = bytes(sum(((planes[p * 8000 + at // 8] >> (7 - at % 8)) & 1) << p
                               for p in range(4)) for at in range(320 * 184))
            slots = [{'x': memory.r16(0xfa98 + i * 4),
                      'y': memory.r16(0xfa9a + i * 4) - 40,
                      'life': memory.r8(0xfaea + i)}
                     for i in range(20) if memory.r16(0xfa98 + i * 4) != 501]
            frames.append({'tick': tick + 1, 'sha256': hashlib.sha256(pixels).hexdigest(),
                           'slots': slots})
        result['directions'][str(direction)] = frames
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ram', type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.ram.read_bytes()), indent=2))
