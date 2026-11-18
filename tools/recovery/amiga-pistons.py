"""Original Amiga piston late-load, animation and opaque-blit references.

Requires temporary machine68k0.5.2, validated Disk.1 and recovered startup RAM.
Only disk I/O is replaced with the original requested byte copy; gameplay code
and its drawing routine execute unchanged. No CPU is included in the browser.
"""
import argparse
import hashlib
import json
from pathlib import Path
import machine68k as m68k


def extract(disk, ram):
    if hashlib.sha256(disk).hexdigest() != "54260a1b4f95b18b115ef69d5f90cbc7a584e74c28572e7296e80196989ee8d1":
        raise ValueError("Unsupported Amiga disk")
    if hashlib.sha256(ram).hexdigest() != "8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7":
        raise ValueError("Unsupported recovered Amiga RAM")
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(0, ram)
    memory.w16(0xEE52, 0x4E75)
    display = 0x120000
    memory.w32(0x103D4, display)
    reads = []

    def run(start, end=0x700):
        cpu.w_sr(0x2700)
        cpu.w_sp(0xFF0)
        memory.w32(0xFF0, end)
        cpu.w_pc(start)
        for _ in range(1000000):
            if cpu.r_pc() == end: return
            if cpu.r_pc() == 0xEE52:
                source = cpu.r32_reg(m68k.Register.A1)
                target = memory.r32(0xFBBA)
                size = cpu.r32_reg(m68k.Register.D7)
                if not (source + size <= len(disk) and target + size <= len(ram)):
                    raise ValueError("Invalid original disk read")
                memory.w_block(target, disk[source:source + size])
                reads.append({"source": source, "target": target, "bytes": size})
            cpu.execute(1)
        raise RuntimeError(f"Source piston routine did not terminate: {cpu.r_pc():x}")

    def reset(height=0, phase=0):
        for address, value in [(0xF932, 6), (0xF934, 100), (0xF936, 100), (0xF938, 500)]:
            memory.w16(address, value)
        memory.w_block(0xF93A, bytes([phase, 0, 0, height, 0, 0]))
        memory.w32(0xF060, 0)
        memory.w32(0xF064, 0)

    def image_hash():
        planes = memory.r_block(display, 32000)
        pixels = bytes(sum(((planes[p * 8000 + y * 40 + x // 8] >> (7 - x % 8)) & 1) << p
                           for p in range(4))
                       for y in range(127, 176) for x in range(96, 128))
        return hashlib.sha256(pixels).hexdigest()

    try:
        run(0x8660, 0x867E)
        result = {"sourceRamSha256": hashlib.sha256(ram).hexdigest(), "reads": reads,
                  "lateSpriteSha256": hashlib.sha256(memory.r_block(0x18102, 768)).hexdigest(),
                  "window": [96, 127, 32, 49], "backgroundInk": 15,
                  "framesByHeight": {}, "timeline": []}
        for height in [0, 8, 16, 24, 32, 40, 48]:
            reset(height, 1 if height else 0)
            memory.w_block(display, bytes([255]) * 32000)
            run(0xA3A6)
            result["framesByHeight"][str(height)] = image_hash()
        reset()
        for tick in range(1, 17):
            drawn = memory.r8(0xF93D)
            memory.w_block(display, bytes([255]) * 32000)
            run(0xA3A6)
            result["timeline"].append({"tick": tick, "drawnHeight": drawn,
                                       "height": memory.r8(0xF93D), "phase": memory.r8(0xF93A),
                                       "pixelsSha256": image_hash()})
        return result
    finally:
        machine.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("disk", type=Path)
    parser.add_argument("ram", type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.disk.read_bytes(), args.ram.read_bytes()), indent=2))
