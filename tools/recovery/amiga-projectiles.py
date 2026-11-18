"""Original Amiga heavy-projectile art and destruction-pool references.

Requires temporary machine68k0.5.2 and validated recovered RAM. Original RNG
initialization uses fixed seeds instead of hardware clocks. No CPU runs in the game.
"""
import argparse
import hashlib
import json
from pathlib import Path
import machine68k as m68k


def extract(ram):
    if hashlib.sha256(ram).hexdigest() != "8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7":
        raise ValueError("Unsupported Amiga RAM")
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(0, ram)
    display, atlas, style = 0x120000, 0x180000, 0x190000
    memory.w32(0x103D4, display)

    def run(start, end=0x700):
        cpu.w_sr(0x2700)
        cpu.w_sp(0xFF0)
        memory.w32(0xFF0, end)
        cpu.w_pc(start)
        for _ in range(3000000):
            if cpu.r_pc() == end:
                return
            cpu.execute(1)
        raise RuntimeError(f"Original routine did not terminate: {cpu.r_pc():x}")

    def pairs(address, count):
        def signed(value): return value - 65536 if value >= 32768 else value
        return [[signed(memory.r16(address + i * 4)), signed(memory.r16(address + i * 4 + 2))]
                for i in range(count)]

    def image_hash(left, top, width, height):
        planes = memory.r_block(display, 32000)
        pixels = bytes(sum(((planes[p * 8000 + y * 40 + x // 8] >> (7 - x % 8)) & 1) << p
                           for p in range(4))
                       for y in range(top, top + height) for x in range(left, left + width))
        return hashlib.sha256(pixels).hexdigest()

    def particles():
        result = []
        for slot in range(210):
            x = memory.r16(0x10422 + slot * 4)
            if x in [500, 501]: continue
            index = memory.r16(0x10928 + slot * 2)
            result.append({"x": x, "y": memory.r16(0x10424 + slot * 4) - 40,
                           "direction": index, "style": memory.r16(0x10784 + slot * 2)})
        return result

    result = {"sourceRamSha256": hashlib.sha256(ram).hexdigest(),
              "seed": [0x19871201, 0x12345678], "rocketArt": {}, "rocketEdges": [], "debrisArt": [],
              "velocities": pairs(0x11060, 48), "offsets": {}, "bursts": {}}
    try:
        # Original $83c2..$840c generates the three reusable offset tables.
        memory.w32(0xF060, result["seed"][0])
        memory.w32(0xF064, result["seed"][1])
        run(0x83C2, 0x840C)
        for name, address, count in [("wide", 0x10ACC, 125), ("compact", 0x10CC0, 100), ("vertical", 0x10E50, 125)]:
            result["offsets"][name] = pairs(address, count)
        # Original shift-atlas builder and projectile blitter; choose aligned X96.
        for direction, address in [("right", 0x16060), ("left", 0x16090)]:
            memory.w32(0x1041C, address)
            memory.w32(0x10418, atlas)
            memory.w16(0x10414, 15)
            memory.w16(0x10416, 5)
            memory.w16(0x10420, 1)
            run(0xA260)
            memory.w_block(display, bytes(32000))
            memory.w16(0x103DC, 96)
            memory.w16(0x103DE, 120)
            cpu.w32_reg(m68k.Register.A5, atlas)
            run(0xD850)
            result["rocketArt"][direction] = image_hash(96, 80, 16, 6)
        for x, direction in [(5, 1), (315, -1)]:
            memory.w16(0xF9F0, x)
            memory.w16(0xF9F2, 180)
            memory.w32(0xF9F4, 0xF9FA)
            memory.w8(0xF9F8, int(direction < 0))
            memory.w8(0xF9EE, 1)
            run(0xC0CA, 0xC152)
            result["rocketEdges"].append({"startX": x, "startY": 140, "direction": direction,
                                          "x": memory.r16(0xF9F0), "y": memory.r16(0xF9F2) - 40})
        for variant in range(4):
            memory.w_block(display, bytes(32000))
            memory.w16(0x103DC, 96)
            memory.w16(0x103DE, 120)
            memory.w16(style, variant)
            cpu.w32_reg(m68k.Register.A3, style)
            cpu.w32_reg(m68k.Register.A5, 0x285EC)
            run(0xD5D4)
            result["debrisArt"].append(image_hash(96, 80, 32, 9))
        profiles = [("barrier", 0x10ACC, 125, 3), ("turret0", 0x10CC0, 100, 40),
                    ("turret1", 0x10ACC, 125, 50), ("pod", 0x10ACC, 125, 2),
                    ("launcher", 0x10CC0, 100, 2), ("laserWall", 0x10E50, 125, 160)]
        for name, table, count, variant in profiles:
            run(0xCB56, 0xCB6A)
            memory.w16(0x1076A, 500)
            cpu.w32_reg(m68k.Register.A2, table)
            cpu.w32_reg(m68k.Register.D6, 96)
            cpu.w32_reg(m68k.Register.D7, 104)
            cpu.w32_reg(m68k.Register.D1, count - 1)
            cpu.w32_reg(m68k.Register.D4, variant)
            run(0xBEDC)
            frames = {"0": particles()}
            for tick in range(1, 33):
                memory.w_block(display, bytes(32000))
                run(0xBF3C)
                if tick in [1, 2, 4, 8, 16, 32]: frames[str(tick)] = particles()
            result["bursts"][name] = frames
        # $ead8 is the actual mine activation path after the tile scan.
        # Keep armor enabled so the unchanged source returns without death control.
        run(0xCB56, 0xCB6A)
        memory.w16(0x1076A, 500)
        memory.w_block(0xF84E, bytes([254] * 5 + [255]))
        memory.w16(0xF9E2, 84)
        memory.w16(0xF9E4, 176)
        memory.w8(0xF974, 1)
        memory.w8(0x121C, 0xA2)
        cpu.w32_reg(m68k.Register.A0, 0x121D)
        cpu.w32_reg(m68k.Register.D1, 0)
        run(0xEAD8)
        mine = {"player": [84, 176], "tile": memory.r8(0x121C),
                "frames": {"0": particles()}}
        for tick in range(1, 33):
            memory.w_block(display, bytes(32000))
            run(0xBF3C)
            if tick in [1, 2, 4, 8, 16, 32]: mine["frames"][str(tick)] = particles()
        result["mine"] = mine
        return result
    finally:
        machine.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ram", type=Path)
    parser.add_argument("--constants", type=Path)
    args = parser.parse_args()
    result = extract(args.ram.read_bytes())
    if args.constants:
        args.constants.write_text("/** Original Amiga $11060 velocities and $83c2 seeded offset tables; see research/amiga-projectiles.json. */\nexport const AMIGA_DEBRIS = " + json.dumps({"velocities": result["velocities"], "offsets": result["offsets"]}, indent=4) + " as const;\n")
    print(json.dumps(result, indent=2))
