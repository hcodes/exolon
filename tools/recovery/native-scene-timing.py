"""Reproduce native-scene-pacing.json platform entries from original code.

Requires the optional offline machine68k 0.5.2 environment. Example commands:
  python tools/recovery/native-scene-timing.py amiga --disk Disk.1 --ram ram.bin
  python tools/recovery/native-scene-timing.py atari-st --main main.bin --source-files files

JSON is written to stdout; redirect it outside the original input files. These
are core-cycle samples, excluding DMA, IRQ, audio interrupts, OS-call overhead
and VBL waits. Neutral entry, deterministic RNG and the native invulnerability
gate isolate scene workloads. Later actors and player actions can cost more.
Browser baselines use max(3, ceil(min(cycles) * palHz / cpuHz)) refreshes; these
samples do not establish hardware-exact frame schedules. No CPU or disk code
from this tool is used by regular builds or browser gameplay.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import machine68k as m68k


AMIGA_RAM_SHA256 = "8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7"
AMIGA_DISK_SHA256 = "54260a1b4f95b18b115ef69d5f90cbc7a584e74c28572e7296e80196989ee8d1"
AMIGA_BYPASSED = [0xEE52, 0x9582, 0x958E, 0xA016, 0x8AE0, 0xEE84, 0xE034]
SEED = 0x19871201
SEED_HIGH = 0x12345678
TOS_RANDOM_SOURCE = (
    "https://github.com/th-otto/tos1x/blob/"
    "7c6680d96642220710bddca825817d29ba86cdab/listings/tos102de.s#L1458-L1476"
)


def checked_bytes(path, expected_hash, expected_size=None):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError(f"Unsupported original source checksum: {path}")
    if expected_size is not None and len(data) != expected_size:
        raise ValueError(f"Unsupported original source size: {path}")
    return data


def columns_before_terminator(values):
    if 100 not in values:
        raise ValueError("Original piston columns lack their terminator")
    return values[:values.index(100)]


def amiga_survey(disk_path, ram_path, steps):
    disk = checked_bytes(disk_path, AMIGA_DISK_SHA256, 901120)
    ram = checked_bytes(ram_path, AMIGA_RAM_SHA256, 0x80000)
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem

    def run(start, end=0x700):
        cpu.w_sr(0x2700)
        cpu.w_sp(0xFF0)
        memory.w32(0xFF0, end)
        cpu.w_pc(start)
        cycles = 0
        for _ in range(3000000):
            pc = cpu.r_pc()
            if pc == end:
                return cycles
            if pc == 0xEE52:
                source = cpu.r32_reg(m68k.Register.A1)
                target = memory.r32(0xFBBA)
                length = cpu.r32_reg(m68k.Register.D7)
                if not (0 < length <= len(ram) and source + length <= len(disk)
                        and target + length <= len(ram)):
                    raise ValueError("Invalid original Amiga disk request")
                memory.w_block(target, disk[source:source + length])
            cycles += cpu.execute(1).cycles
        raise RuntimeError(f"Original Amiga probe did not finish at ${cpu.r_pc():x}")

    try:
        memory.w_block(0, ram)
        # Same explicit host-service bypasses as amiga-timing.py. Gameplay,
        # resource loading decisions, drawing and five world loaders are native.
        for address in AMIGA_BYPASSED:
            memory.w16(address, 0x4E75)
        run(0x8000, 0x869C)
        run(0x9690)
        stage_snapshot = memory.r_block(0, 0x80000)
        screens = []
        for stage, loader in enumerate([None, 0x93BC, 0x9440, 0x9488, 0x94EE]):
            memory.w_block(0, stage_snapshot)
            if loader is not None:
                run(loader)
            stage_snapshot = memory.r_block(0, 0x80000)
            for local in range(25):
                index = stage * 25 + local
                memory.w_block(0, stage_snapshot)
                memory.w16(0xFBB2, index)
                memory.w16(0xFBB0, local * 920)
                memory.w16(0xF9E4, 176)
                run(0xC93A)
                # Seed after native screen setup, matching the saved survey.
                memory.w32(0xF060, SEED)
                memory.w32(0xF064, SEED_HIGH)
                memory.w8(0xFBFC, 1)
                memory.w8(0xFBE4, 15)
                memory.w16(0xF9E4, 176)
                memory.w32(0xF976, 0)
                cycles = []
                for _ in range(steps):
                    memory.w8(0xFBC6, 0)
                    memory.w16(0xFBEA, 0)  # Original post-death protection gate.
                    cycles.append(run(0x869C, 0x873A))
                    if memory.r16(0xFBB2) != index:
                        raise RuntimeError("Amiga probe unexpectedly changed screens")
                offset = 0x11C94 + index * 3
                columns = columns_before_terminator(list(ram[offset:offset + 3]))
                screens.append({"screenIndex": index, "pistonColumns": columns,
                                "cycles": cycles})
        return {"sourceSha256": AMIGA_RAM_SHA256, "cpuHz": 7093790, "palHz": 50,
                "seed": [SEED, SEED_HIGH], "stepsPerScene": steps, "screens": screens,
                "sourceDiskSha256": AMIGA_DISK_SHA256,
                "bypassed": [hex(address) for address in AMIGA_BYPASSED]}
    finally:
        machine.cleanup()


def canonical_atari_files(source_root):
    inventory_path = (Path(__file__).resolve().parents[2] / "originals" / "graphics"
                      / "atari-st" / "canonical-inputs.json")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    return {entry["name"]: checked_bytes(source_root / entry["name"], entry["sha256"],
                                          entry["size"]) for entry in inventory}


def atari_survey(main_path, source_root, steps):
    # Import the existing offline host adapters, retaining original instructions
    # and resource reads. Only its deterministic OS Random fixture is replaced.
    spec = importlib.util.spec_from_file_location(
        "atari_st_code", Path(__file__).with_name("atari-st-code.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    text = checked_bytes(main_path, module.TEXT_SHA256, module.TEXT_SIZE)
    files = canonical_atari_files(source_root)

    class TimingProbe(module.NativeProbe):
        def __init__(self):
            super().__init__(text, files)
            self.seed = SEED

        def step(self):
            pc = self.cpu.r_pc()
            if (self.memory.r16(pc) == 0x4E4E
                    and self.memory.r16(self.cpu.r_sp()) == 0x11):
                # Original TOS Random: update32-bit state, return upper24bits.
                self.seed = (self.seed * 3141592621 + 1) & 0xFFFFFFFF
                self.cpu.w_reg(m68k.Register.D0, self.seed >> 8)
                self.cpu.w_pc(pc + 2)
                return 0
            return super().step()

    probe = TimingProbe()
    cpu, memory = probe.cpu, probe.memory
    try:
        probe.run(0, 0x106D8)
        memory.w32(cpu.r_sp(), 0x700)
        probe.run(0x1810, 0x700)
        startup = memory.r_block(0, 0x100000)
        screens = []
        for stage, loader in enumerate([0x143A, 0x14EE, 0x1582, 0x15D2, 0x1644]):
            memory.w_block(0, startup)
            cpu.w_sr(0x2700)
            cpu.w_sp(0xF0000)
            memory.w32(cpu.r_sp(), 0x700)
            probe.run(loader, 0x700)
            bank = memory.r_block(0, 0x100000)
            for index in range(stage * 25, (stage + 1) * 25):
                memory.w_block(0, bank)
                cpu.w_sr(0x2700)
                cpu.w_sp(0xF0000)
                memory.w32(cpu.r_sp(), 0x700)
                # Native ST setup also consumes OS Random; seed before setup.
                probe.seed = SEED
                memory.w16(0x18930, index)
                memory.w16(0x1892E, (index % 25) * 920)
                memory.w32(0x186F4, 0)
                probe.run(0x5860, 0x700)
                columns = columns_before_terminator(
                    [memory.r16(0x186B0 + i * 2) for i in range(3)])
                cycles = []
                for _ in range(steps):
                    memory.w8(0x18B09, 0)
                    memory.w16(0x18B32, 0)  # Retain the original death routine/gate.
                    cycles.append(probe.run(0x6D8, 0x10774))
                    probe.step()  # Original BSR into VBL service/buffer flip.
                    for _ in range(1000):
                        if cpu.r_pc() == 0x106D8:
                            break
                        probe.step()
                    else:
                        raise RuntimeError("Original Atari ST display flip did not return")
                    if memory.r16(0x18930) != index:
                        raise RuntimeError("Atari ST probe unexpectedly changed screens")
                screens.append({"screenIndex": index, "pistonColumns": columns,
                                "cycles": cycles})
        return {"sourceSha256": module.TEXT_SHA256, "cpuHz": 8010612, "palHz": 50,
                "seed": SEED, "stepsPerScene": steps, "screens": screens,
                "tosRandomSource": TOS_RANDOM_SOURCE}
    finally:
        probe.cleanup()


def positive_steps(value):
    steps = int(value)
    if steps <= 0:
        raise argparse.ArgumentTypeError("steps must be positive")
    return steps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="platform", required=True)
    amiga = subparsers.add_parser("amiga", help="Execute original Amiga scene workloads")
    amiga.add_argument("--disk", type=Path, required=True)
    amiga.add_argument("--ram", type=Path, required=True)
    amiga.add_argument("--steps", type=positive_steps, default=16)
    atari = subparsers.add_parser("atari-st", help="Execute original Atari ST scene workloads")
    atari.add_argument("--main", type=Path, required=True)
    atari.add_argument("--source-files", type=Path, required=True)
    atari.add_argument("--steps", type=positive_steps, default=8)
    args = parser.parse_args()
    if args.platform == "amiga":
        result = amiga_survey(args.disk, args.ram, args.steps)
    else:
        result = atari_survey(args.main, args.source_files, args.steps)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
