"""Recover original Atari ST Exolon code offline; requires machine68k 0.5.2.

Usage: python tools/recovery/atari-st-code.py Exolon.stx source-files output-dir
Add --probes to reproduce behavior, timing and ending fixtures as well.
Only canonical source inputs are accepted. No HDD adaptation is used. The
browser receives extracted data and never executes this CPU or disk code.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path

import machine68k as m68k

BASE = 0x10000
TEXT_SIZE = 0xCCCA
STX_SHA256 = "10a96cc93ab4c73a171f0e3408e99d2ff692a280bdb4f05eaf4e75f33e185ccf"
PROTECTED_SHA256 = "9adfe8193f1773c30c91249276f64e024f0df681490645cf3e6489eea9f10af4"
TEXT_SHA256 = "2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638"
PRG_SHA256 = "c7c03df04258f86ef00c9b1a35a0dda3127c1b682e12c94621479d9164eee6ba"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def bounded(data, at, count):
    require(at >= 0 and count >= 0 and at + count <= len(data), "Source bounds exceeded")
    return data[at:at + count]


def original_sectors(stx):
    require(sha256(stx) == STX_SHA256, "Unsupported original STX checksum")
    sectors = {}
    at = 16
    for _ in range(stx[10]):
        size, fuzzy, count, flags, _, _, _ = struct.unpack(
            "<IIHHHBB", bounded(stx, at, 16)
        )
        track_end = at + size
        require(size >= 16 and track_end <= len(stx), "Invalid STX track bounds")
        data_base = at + 16 + count * 16 + fuzzy
        require(data_base <= track_end, "Invalid STX data bounds")
        for index in range(count):
            offset, _, _, track, head, sector, exponent, _, status, _ = struct.unpack(
                "<IHHBBBBHBB", bounded(stx, at + 16 + index * 16, 16)
            )
            if status & 16:
                continue
            require(exponent <= 7, "Unsupported STX sector length")
            length = 128 << exponent
            require(data_base + offset + length <= track_end, "Invalid STX sector bounds")
            sectors[track, head, sector] = bounded(stx, data_base + offset, length)
        at = track_end
    require(at == len(stx), "Unexpected STX trailing data")
    return sectors


def original_files(sectors):
    """Read the canonical FAT12 inventory to verify supplied extracted files."""
    boot = sectors[0, 0, 1]
    bps, spc, reserved, copies, entries, total, _, fat_size, spt, heads = struct.unpack_from(
        "<HBHBHHBHHH", boot, 11
    )
    require((bps, spc, copies, entries, total, spt, heads) ==
            (512, 2, 2, 112, 880, 11, 1), "Unsupported FAT12 geometry")
    image = b"".join(sectors.get((track, 0, sector), bytes(bps))[:bps]
                     for track in range(total // spt) for sector in range(1, spt + 1))
    fat = bounded(image, reserved * bps, fat_size * bps)
    directory_at = (reserved + copies * fat_size) * bps
    data_at = directory_at + entries * 32
    files = {}

    def chain(cluster):
        result = bytearray()
        seen = set()
        while 2 <= cluster < 0xFF8:
            require(cluster not in seen, "FAT12 cycle")
            seen.add(cluster)
            result.extend(bounded(image, data_at + (cluster - 2) * spc * bps, spc * bps))
            value = int.from_bytes(bounded(fat, cluster * 3 // 2, 2), "little")
            cluster = value >> 4 if cluster & 1 else value & 0xFFF
        return bytes(result)

    def directory(data, prefix=""):
        for offset in range(0, len(data), 32):
            entry = bounded(data, offset, 32)
            if not entry[0]:
                break
            if entry[0] in (0xE5, 0x2E) or entry[11] & 8:
                continue
            name = entry[:8].decode("ascii").strip()
            extension = entry[8:11].decode("ascii").strip()
            if extension:
                name += "." + extension
            name = prefix + name
            content = chain(int.from_bytes(entry[26:28], "little"))
            if entry[11] & 16:
                directory(content, name + "/")
            else:
                size = int.from_bytes(entry[28:32], "little")
                require(size <= len(content), "Truncated FAT12 file")
                files[name] = content[:size]

    directory(bounded(image, directory_at, entries * 32))
    require(len(files) == 44, "Unexpected original file inventory")
    return files


def unrelocate(envelope):
    data = bytearray(envelope)
    header = struct.unpack(">H6IH", bounded(data, 0, 28))
    require(header == (0x601A, TEXT_SIZE, 0, 289272, 0, 0, 0, 0), "Unexpected inner TOS header")
    at = 28 + TEXT_SIZE
    offset = int.from_bytes(bounded(data, at, 4), "big")
    at += 4
    count = 0
    while offset:
        require(0 <= offset <= TEXT_SIZE - 4, "Invalid TOS relocation offset")
        count += 1
        position = 28 + offset
        value = (int.from_bytes(bounded(data, position, 4), "big") - BASE) & 0xFFFFFFFF
        data[position:position + 4] = value.to_bytes(4, "big")
        while True:
            delta = bounded(data, at, 1)[0]
            at += 1
            if delta == 1:
                offset += 254
            else:
                break
        if not delta:
            break
        offset += delta
    prg = bytes(data[:at])
    require(sha256(prg) == PRG_SHA256, "Recovered TOS program checksum mismatch")
    return prg, count


def recover_code(protected, sectors):
    require(sha256(protected) == PROTECTED_SHA256, "Unsupported protected program checksum")
    source = protected[28:]
    sector6 = sectors[0, 0, 6]
    require(sector6[:16] == b"Rob Northen Comp", "Missing original protection data")
    sector_key = 0
    for index in range(6):
        sector_key = (sector_key + int.from_bytes(sector6[index * 4:index * 4 + 4], "big")) & 0xFFFFFFFF
        sector_key = ((sector_key << 3) | (sector_key >> 29)) & 0xFFFFFFFF
    require(sector_key == 0xDE534692, "Unexpected original sector key")
    machine = m68k.Machine(m68k.CPUType.M68000, 16384)
    cpu, memory = machine.cpu, machine.mem
    try:
        memory.w_block(BASE, source)
        # Host TOS pointers. The protector's own instructions and data are retained.
        memory.w32(BASE + 0x44, 0xF000)
        memory.w32(0xF008, BASE)
        memory.w32(0x4C6, 0x70000)
        memory.w16(0x454, 1)
        memory.w32(0x456, 0x800)
        cpu.w_sr(0x2700)
        cpu.w_sp(0xF0000)
        cpu.w_pc(BASE + 0xEA)
        encrypted = True
        supervisor = True
        stacks = {True: 0xF0000, False: 0xE0000}
        dispatches = []
        envelope = None
        text = None
        for instruction in range(1000000):
            pc = cpu.r_pc()
            if pc == BASE + 0xD3E:
                envelope = memory.r_block(BASE + 0xDE8, len(source) - 0xDE8)
            if pc == BASE + 0x7EE:
                sector = cpu.r_reg(m68k.Register.D0)
                require(sector in (1, 6), "Unexpected protector sector request")
                memory.w_block(0x70000, sectors[0, 0, sector])
                # Physical timing succeeds; only the original sector bytes enter the key.
                cpu.w_reg(m68k.Register.D0, 100 if sector == 1 else 105)
                cpu.w_sr(cpu.r_sr() & ~4)
                cpu.w_pc(memory.r32(cpu.r_sp()))
                cpu.w_sp(cpu.r_sp() + 4)
                continue
            require(pc % 2 == 0, "Unmodeled odd-address exception")
            ciphertext = memory.r32(pc)
            previous = memory.r32(pc - 4) ^ 0xFFFFFFFF
            key = ((previous << 16) | (previous >> 16)) & 0xFFFFFFFF
            if encrypted:
                memory.w32(pc, ciphertext ^ key)
            size, instruction_text = cpu.disassemble(pc)
            if instruction_text == "dc.w $4afc; ILLEGAL":
                encrypted = not encrypted
                cpu.w_pc(pc + 2)
                memory.w32(pc, ciphertext)
                continue
            require("ILLEGAL" not in instruction_text and "opcode" not in instruction_text,
                    f"Unexpected protected instruction at {pc:x}: {instruction_text}")
            if instruction_text.startswith("trap"):
                require(memory.r16(cpu.r_sp()) == 0x1A, "Unexpected protector BIOS request")
                cpu.w_pc(pc + size)
                memory.w32(pc, ciphertext)
                continue
            if instruction_text.startswith("eori    #$2000, SR"):
                stacks[supervisor] = cpu.r_sp()
                supervisor = not supervisor
                cpu.w_sp(stacks[supervisor])
                cpu.w_pc(pc + size)
            else:
                cpu.execute(1)
            if cpu.r_pc() & 1:
                # Original address-error handler's word-sum dispatch, with the
                # current instruction still decoded until after this calculation.
                address = cpu.r_reg(m68k.Register.A4)
                total = 0
                while address < pc + 4:
                    total = (total + memory.r16(address)) & 0xFFFF
                    address += 2
                address += (total - 2) & 0xFFFE
                cpu.w_reg(m68k.Register.A4, address)
                cpu.w_pc(address)
                dispatches.append([pc, address])
            memory.w32(pc, ciphertext)
            if cpu.r_pc() == BASE and not encrypted:
                text = memory.r_block(BASE, TEXT_SIZE)
                break
            require((BASE <= cpu.r_pc() < BASE + len(source)) or
                    0x3DE <= cpu.r_pc() < 0x500, "Protection left supported code bounds")
        require(text is not None and envelope is not None, "Original protector did not finish")
        require(sha256(text) == TEXT_SHA256, "Recovered original text checksum mismatch")
        prg, relocation_count = unrelocate(envelope)
        ram = memory.r_block(0, 0x100000)
        report = {
            "sourceStxSha256": STX_SHA256,
            "sourceProtectedPrgSha256": PROTECTED_SHA256,
            "mainBytes": len(text), "mainSha256": sha256(text), "relocationBase": BASE,
            "sector6Checksum": hex(sector_key), "instructions": instruction + 1,
            "exceptionDispatches": dispatches,
            "hostHooks": ["BIOS/XBIOS26 disable interrupt",
                          "original STX track0 sector1/6 bytes + synthetic successful timing",
                          "TOS basepage and stack pointers"],
            "gameplayPatched": False, "tosPrgBytes": len(prg),
            "tosPrgSha256": sha256(prg), "relocations": relocation_count,
            "bssBytes": 289272,
        }
        return text, prg, ram, report
    finally:
        machine.cleanup()


class NativeProbe:
    """Original instructions with explicit host I/O hooks; no gameplay patches."""

    def __init__(self, text, files):
        require(sha256(text) == TEXT_SHA256, "Unsupported behavioral source text")
        self.machine = m68k.Machine(m68k.CPUType.M68000, 16384)
        self.cpu, self.memory = self.machine.cpu, self.machine.mem
        self.memory.w_block(BASE, text)
        self.memory.w8(0xFFFC00, 2)
        self.cpu.w_sr(0x2700)
        self.cpu.w_sp(0xF0000)
        self.files = {name.lower(): data for name, data in files.items()}
        self.reads = []

    def ret(self):
        self.cpu.w_pc(self.memory.r32(self.cpu.r_sp()))
        self.cpu.w_sp(self.cpu.r_sp() + 4)

    def step(self):
        cpu, memory = self.cpu, self.memory
        pc = cpu.r_pc()
        if pc in (BASE + 0x2196, BASE + 0x6E98, BASE + 0x6EDE, BASE + 0x6F24):
            self.ret()
            return 0
        if pc == BASE + 0x7D90:
            name = memory.r_cstr(memory.r32(0x18936)).split("\\")[-1].lower()
            target, size = memory.r32(0x1893A), memory.r32(0x1893E)
            require(name in self.files, f"Unknown original file request: {name}")
            memory.w_block(target, self.files[name][:size])
            self.reads.append([name, target, size])
            self.ret()
            return 0
        if memory.r16(pc) in (0x4E41, 0x4E4E, 0x4E4D):
            function = memory.r16(cpu.r_sp())
            if memory.r16(pc) == 0x4E4E:
                if function == 0x11:
                    cpu.w_reg(m68k.Register.D0, 0)  # Explicit deterministic OS RNG fixture.
                elif function == 2:
                    cpu.w_reg(m68k.Register.D0, 0x90000)
                elif function == 0x22:
                    cpu.w_reg(m68k.Register.D0, 0x5000)
            cpu.w_pc(pc + 2)
            return 0
        return cpu.execute(1).cycles

    def run(self, relative_start, end, limit=3000000, hooks=None):
        self.cpu.w_pc(BASE + relative_start)
        cycles = 0
        for _ in range(limit):
            pc = self.cpu.r_pc()
            if pc == end:
                return cycles
            if hooks and pc in hooks:
                hooks[pc]()
            else:
                cycles += self.step()
        raise RuntimeError(f"Original probe did not finish at ${self.cpu.r_pc():x}")

    def cleanup(self):
        self.machine.cleanup()


def probe_behavior(text):
    result = {"sourceMainSha256": TEXT_SHA256, "pistonCollision": []}
    for armor in (0, 1):
        for height in (0, 8, 16, 24, 32, 40, 48):
            probe = NativeProbe(text, {})
            try:
                memory = probe.memory
                memory.w16(0x18760, 100)
                memory.w16(0x18762, 176)
                memory.w8(0x186F2, armor)
                memory.w16(0x186B0, 6)
                memory.w16(0x186B2, 100)
                memory.w8(0x186BB, height)
                hits = []

                def hit():
                    hits.append(True)
                    probe.ret()

                probe.run(0x40AC, BASE + 0x4136, hooks={BASE + 0x3A22: hit})
                result["pistonCollision"].append(
                    {"armor": armor, "height": height, "deaths": len(hits)}
                )
            finally:
                probe.cleanup()
    probe = NativeProbe(text, {})
    try:
        cpu, memory = probe.cpu, probe.memory
        memory.w16(0x18762, 176)
        hunter = []
        for tick in range(1, 302):
            memory.w32(cpu.r_sp(), 0x700)
            probe.run(0x7AC, 0x700, hooks={BASE + 0x7FA: lambda: cpu.w_pc(0x700)})
            if tick in (299, 300, 301):
                hunter.append({"tick": tick, "counter": memory.r32(0x186F4),
                               "x": memory.r16(0x186F8), "y": memory.r16(0x186FA)})
        result["hunter"] = hunter
        result["stageEndIndices"] = [memory.r16(BASE + 0x13D0 + i * 2) for i in range(6)]
        return result
    finally:
        probe.cleanup()


def probe_timing_and_ending(text, files):
    probe = NativeProbe(text, files)
    try:
        cpu, memory = probe.cpu, probe.memory
        probe.run(0, BASE + 0x6D8)
        memory.w32(cpu.r_sp(), 0x700)
        probe.run(0x1810, 0x700)
        startup = memory.r_block(0, 0x100000)
        cycles = []
        for _ in range(5):
            cycles.append(probe.run(0x6D8, BASE + 0x774))
            probe.step()  # Original BSR to the VBL wait.
            for _ in range(1000):
                if cpu.r_pc() == BASE + 0x6D8:
                    break
                probe.step()  # Complete the original buffer flip between updates.
            else:
                raise RuntimeError("Original display flip did not return")
        cpu_hz = 8010612
        timing = {"sourceMainSha256": TEXT_SHA256, "cycles": cycles, "palHz": 50,
                  "cpuHz": cpu_hz, "clockAddress": "0x466", "clockVariable": "_frclock",
                  "clockHz": 50,
                  "clockSources": ["https://github.com/emutos/emutos/blob/master/tosvars.ld",
                                   "https://freemint.github.io/tos.hyp/en/bios_sysvars.html"],
                  "minPalFrames": [(value * 50 + cpu_hz - 1) // cpu_hz
                                                     for value in cycles],
                  "reads": list(probe.reads),
                  "limits": ["Core cycles only; video bus contention and IRQ costs excluded",
                             "Original VBL waits and OS call overhead excluded",
                             "TOS Random returns zero for this deterministic source fixture"]}
        memory.w_block(0, startup)
        cpu.w_sr(0x2700)
        cpu.w_sp(0xF0000)
        memory.w32(cpu.r_sp(), 0x700)
        memory.w16(0x18930, 124)
        memory.w16(0x18760, 190)
        memory.w8(0x18B09, 0x80)
        texts = []
        read_start = len(probe.reads)

        def text_output():
            texts.append(memory.r_cstr(cpu.r_reg(m68k.Register.A0)))
            probe.ret()

        probe.run(0x1348, 0x700, limit=10000000, hooks={BASE + 0x1016: text_output})
        ending = {"sourceMainSha256": TEXT_SHA256, "startIndex": 124,
                  "endIndex": memory.r16(0x18930), "ammo": memory.r16(0x19430),
                  "grenades": memory.r16(0x19432), "lives": memory.r16(0x19434),
                  "armor": memory.r8(0x186F2), "playerY": memory.r16(0x18762),
                  "texts": texts, "reads": probe.reads[read_start:]}
        return timing, ending
    finally:
        probe.cleanup()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stx", type=Path)
    parser.add_argument("source_files", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--probes", action="store_true", help="Reproduce behavioral fixtures")
    args = parser.parse_args()
    stx = args.stx.read_bytes()
    sectors = original_sectors(stx)
    expected = original_files(sectors)
    sources = {}
    for name, data in expected.items():
        path = args.source_files / name
        actual = path.read_bytes()
        require(actual == data, f"Extracted original file mismatch: {name}")
        sources[name] = actual
    # Keep the supplied source inventory and disk entirely outside output writes.
    output = args.output.resolve()
    source_root = args.source_files.resolve()
    require(not output.is_relative_to(source_root), "Output must be outside source files")
    require(not args.stx.resolve().is_relative_to(output), "Output must not contain the input disk")
    text, prg, ram, report = recover_code(sources["AUTO/GAME.PRG"], sectors)
    results = {"atari-st-recovery.json": report}
    if args.probes:
        results["atari-st-behavior.json"] = probe_behavior(text)
        timing, ending = probe_timing_and_ending(text, sources)
        results["atari-st-timing.json"] = timing
        results["atari-st-ending.json"] = ending
    require(args.stx.read_bytes() == stx, "Original disk changed during recovery")
    for name, data in sources.items():
        require((args.source_files / name).read_bytes() == data,
                f"Original source changed during recovery: {name}")
    output.mkdir(parents=True, exist_ok=True)
    (output / "original-main.bin").write_bytes(text)
    (output / "original-main.prg").write_bytes(prg)
    (output / "original-ram.bin").write_bytes(ram)
    for name, value in results.items():
        write_json(output / name, value)
    print(json.dumps({"output": str(output), "mainSha256": report["mainSha256"],
                      "tosPrgSha256": report["tosPrgSha256"], "probes": args.probes}, indent=2))


if __name__ == "__main__":
    main()
