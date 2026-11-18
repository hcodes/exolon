"""Reproduce verified Exolon ST audio offline; no emulator enters the browser.

Requires machine68k0.5.2 and a C compiler (CC, default clang). Inputs must be the
supported SNDH and decrypted original GAME.PRG text from the ST recovery tool.
Example: /path/to/venv/bin/python tools/audio/atari-st.py Exolon.sndh original-main.bin
The checked-in Ayumi sources are MIT licensed; only header include names changed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import machine68k as m68k

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "originals/audio/atari-st"
SOURCE_SHA = "f7fedb6ff4835186dec8b8d8463173d5af6f7a3430bf20837aef8cb89ec15b38"
ORIGINAL_SHA = "2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638"
BASE = 0x10000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def trace(data, track, ticks, original=False):
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    memory.w_block(BASE, data)
    selected = 0
    registers = bytearray(16)
    write_order = []

    def on_access(mode, width, address, value):
        nonlocal selected
        if mode != "W":
            return
        address &= 0xffffff
        if address == 0xff8800:
            assert width == 0
            selected = value & 15
        elif address == 0xff8802:
            assert width == 0
            registers[selected] = value & 255
            write_order.append(selected)

    memory.set_trace_func(on_access)
    memory.set_trace_mode(True)

    def call(entry, irq=False):
        cpu.w_sr(0x2700)
        cpu.w_sp(0x80000)
        if irq:
            memory.w16(0x80000, 0x2700)
            memory.w32(0x80002, 0x700)
        else:
            memory.w32(0x80000, 0x700)
        cpu.w_pc(BASE + entry)
        for _ in range(10000):
            if cpu.r_pc() == 0x700:
                return
            cpu.execute(1)
        raise RuntimeError(f"Original replay did not return: PC={cpu.r_pc():x}")

    try:
        if original:
            cpu.w_reg(m68k.Register.D1, 1 if track == 1 else 7)
            call(0x21d0)
        else:
            cpu.w_reg(m68k.Register.D0, track)
            call(0)
        frames = bytearray()
        states = {}
        for tick in range(ticks):
            write_order.clear()
            call(0x2288 if original else 8, original)
            assert write_order == list(range(13, -1, -1)), write_order
            assert not any(value & 16 for value in registers[8:11])
            assert registers[11:14] == bytes(3)
            frames.extend(registers[:14])
            if not original and track == 1 and tick in (0, 5199, 10398):
                states[tick] = memory.r_block(BASE + 0x61a, 0xba)
        if states:
            differences = [i for i, (a, b) in enumerate(zip(states[0], states[5199])) if a != b]
            assert differences == [0x6d2 - 0x61a]
            assert states[0] == states[10398]
            assert frames[14:14 * (ticks - 10398)] == frames[14 * 10399:]
        if track == 2:
            assert max(i for i in range(ticks) if any(frames[i * 14 + 8:i * 14 + 11])) == 156
        return bytes(frames)
    finally:
        machine.cleanup()


def extract(sndh, original, output):
    if sha(sndh) != SOURCE_SHA or sha(original) != ORIGINAL_SHA:
        raise ValueError("Unsupported original SNDH or recovered executable revision")
    reference = json.loads((DEFAULT_OUTPUT / "provenance.json").read_text())
    verification = {"originalMainSha256": ORIGINAL_SHA, "initOffset": "0x21d0",
                    "irqTickOffset": "0x2288", "results": []}
    with tempfile.TemporaryDirectory(prefix="reex-atari-audio-") as directory:
        temporary = Path(directory)
        for track, ticks, kept, name in [(1, 12000, 10399, "title"), (2, 600, 158, "game-over")]:
            ripped = trace(sndh, track, ticks)
            native = trace(original, track, ticks, True)
            if ripped != native:
                raise ValueError(f"SNDH differs from original executable, subtune{track}")
            verification["results"].append({"subtune": track, "originalSelector": 1 if track == 1 else 7,
                                           "frames": ticks, "differentBytes": 0,
                                           "firstDifferentFrame": None, "sha256": sha(native)})
            (temporary / f"{name}.ym14").write_bytes(ripped[:kept * 14])
        (temporary / "original.sndh").write_bytes(sndh)
        (temporary / "native-driver.bin").write_bytes(original[0x21d0:0x2ee0])
        (temporary / "music-lifecycle.bin").write_bytes(original[:10] + original[0x8ce:0x8f8] + original[0x213c:0x21d0])
        (temporary / "original-verification.json").write_text(json.dumps(verification, indent=2) + "\n")
        shutil.copyfile(DEFAULT_OUTPUT / "LICENSE-ayumi.txt", temporary / "LICENSE-ayumi.txt")
        renderer = temporary / "render"
        subprocess.run([os.environ.get("CC", "clang"), "-O2", str(ROOT / "tools/audio/atari-st.ayumi.c"),
                        str(ROOT / "tools/audio/atari-st.c"), "-lm", "-o", str(renderer)], check=True)
        (temporary / "archive").mkdir()
        for name, ticks in [("title", 10399), ("game-over", 158)]:
            subprocess.run([str(renderer), str(temporary / f"{name}.ym14"),
                            str(temporary / f"{name}.wav"), str(ticks)], check=True)
            subprocess.run([str(renderer), str(temporary / f"{name}.ym14"),
                            str(temporary / "archive" / f"{name}-50hz.wav"), str(ticks), "50"], check=True)
        # Fail before changing any destination file if source traces or PCM diverge.
        for name, expected in reference["files"].items():
            data = (temporary / name).read_bytes()
            if len(data) != expected["bytes"] or sha(data) != expected["sha256"]:
                raise ValueError(f"Reproduction differs from verified output: {name}")
        output.mkdir(parents=True, exist_ok=True)
        for item in temporary.iterdir():
            if item.is_dir():
                shutil.copytree(item, output / item.name, dirs_exist_ok=True)
            elif item.name != "render":
                shutil.copyfile(item, output / item.name)
        (output / "provenance.json").write_text(json.dumps(reference, indent=2) + "\n")
    return reference


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sndh", type=Path)
    parser.add_argument("original_main", type=Path)
    parser.add_argument("output", type=Path, nargs="?", default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = extract(args.sndh.read_bytes(), args.original_main.read_bytes(), args.output)
    print(json.dumps({name: value for name, value in result["files"].items() if name.endswith(".wav")}))
