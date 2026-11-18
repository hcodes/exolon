"""Offline Hall of Fame pixel references from the original 68000 routines.

Requires machine68k 0.5.2 in a temporary environment. Input is the validated RAM
from tools/recovery/amiga.mjs. No CPU/chipset emulator is added to the browser.
"""
import argparse
import hashlib
import json
from pathlib import Path

import machine68k as m68k

SOURCE_SHA256 = "8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7"


def extract(ram):
    if hashlib.sha256(ram).hexdigest() != SOURCE_SHA256:
        raise ValueError("Unsupported recovered Amiga RAM")
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(0, ram)
    # Relocate framebuffer pointers to scratch RAM; execute unchanged routines.
    scroll, background, display = 0x100000, 0x108000, 0x110000
    for address, value in [(0x103C8, scroll), (0x103CC, background),
                           (0x103D0, display), (0x103D4, display), (0xF02A, scroll)]:
        memory.w32(address, value)

    def run(start, end=0x700):
        cpu.w_sr(0x2700)
        cpu.w_sp(0xFF0)
        memory.w32(0xFF0, end)
        cpu.w_pc(start)
        for _ in range(1_000_000):
            if cpu.r_pc() == end:
                return
            cpu.execute(1)
        raise RuntimeError(f"Source routine did not terminate: ${cpu.r_pc():x}")

    def region(left, top, width, height):
        planes = memory.r_block(display, 32000)
        return bytes(
            sum(((planes[p * 8000 + y * 40 + x // 8] >> (7 - x % 8)) & 1) << p
                for p in range(4))
            for y in range(top, top + height)
            for x in range(left, left + width)
        )

    palette = []
    for index in range(16):
        color = memory.r16(0x11290 + index * 2) * 2  # Native $c802 conversion.
        palette.append([(color >> shift & 15) * 17 for shift in [8, 4, 0]])

    def digest(pixels):
        return hashlib.sha256(pixels).hexdigest()

    def rgba(pixels):
        return bytes(channel for ink in pixels for channel in [*palette[ink], 255])

    try:
        run(0x8AB4)  # Clear native buffers.
        run(0x8B62)  # Draw original background and logo.
        memory.w8(0x10312, 8)
        memory.w32(0x1030E, 0xFEE8)
        logo = region(80, 8, 176, 40)
        result = {
            "sourceRamSha256": SOURCE_SHA256,
            "logoSha256": digest(logo),
            "window": {"x": 80, "y": 54, "width": 160, "height": 138},
            "frames": {},
            "logoRgbaSha256": digest(rgba(logo)),
            "rgbaFrames": {},
            "fullRgbaFrames": {},
            "menuRgbaFrames": {},
        }
        for frame in range(201):
            if frame in [0, 8, 9, 16, 17, 145, 146, 147, 153, 154, 200]:
                pixels = region(80, 54, 160, 138)
                result["frames"][str(frame)] = digest(pixels)
                result["rgbaFrames"][str(frame)] = digest(rgba(pixels))
                result["fullRgbaFrames"][str(frame)] = digest(rgba(region(0, 0, 320, 200)))
            if frame < 200:
                run(0x8C62)
        # Native title text/logo and $96f0 star lifecycle, fixed hardware RNG seed.
        memory.w32(0x103C8, display)
        memory.w32(0xF02A, display)
        run(0x8AB4)
        cpu.w32_reg(m68k.Register.A0, 0xFC0F)
        run(0x87BA)
        cpu.w32_reg(m68k.Register.A0, display + 0x2DA)
        run(0x8CF2)
        memory.w32(0xF060, 0x19871201)
        memory.w32(0xF064, 0x12345678)
        for slot in range(10):
            memory.w16(0xF7E6 + slot * 4, 501)
            memory.w8(0xF7DB + slot, 0)
        memory.w16(0xF80E, 500)
        for frame in range(101):
            if frame in [0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 24, 40, 100]:
                result["menuRgbaFrames"][str(frame)] = digest(rgba(region(0, 0, 320, 200)))
            if frame < 100:
                run(0x96F0)
        # Original Game Over box and padded text; stop before the delay/music stop.
        memory.w_block(display, bytes(32000))
        run(0x88FE, 0x8932)
        box = region(96, 72, 128, 48)
        memory.w_block(display, bytes([255]) * 32000)
        run(0x88FE, 0x8932)
        if box != region(96, 72, 128, 48):
            raise ValueError("Game Over window is not opaque over its background")
        result["gameOver"] = {"window": {"x": 96, "y": 72, "width": 128, "height": 48},
                              "pixelsSha256": digest(box), "rgbaByStage": []}
        for stage in range(5):
            colors = []
            for index in range(16):
                color = memory.r16(0x111F0 + stage * 32 + index * 2) * 2
                colors.append([(color >> shift & 15) * 17 for shift in [8, 4, 0]])
            result["gameOver"]["rgbaByStage"].append(digest(bytes(channel for ink in box for channel in [*colors[ink], 255])))
        return result
    finally:
        machine.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ram", type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.ram.read_bytes()), indent=2))
