"""Reproduce ST page goldens with the original68000 drawing routines.

Usage: python atari-st-pages.py SOURCE_FILES ORIGINAL_MAIN_BIN OUTPUT_DIRECTORY
Requires machine68k only for this offline research probe. Runtime assets and
normal builds do not execute68000 code. VT52/GEMDOS output is drawn using the
verified TOS8x8 font; palette traps are captured; audio and VBL waits are skipped.
"""

from pathlib import Path
import machine68k as m, json, hashlib, struct, sys
import zlib, binascii

def png(path, w, h, pixels, palette):

    def chunk(t, b):
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', binascii.crc32(t + b) & 4294967295)
    rows = b''.join((bytes([0]) + bytes((channel for ink in pixels[y * w:(y + 1) * w] for channel in [*palette[ink], 255])) for y in range(h)))
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))

def decode(b, w, h, p=4):
    a = []
    for y in range(h):
        for x in range(w):
            v = 0
            for z in range(p):
                k = y * (w // 16) * p * 2 + x // 16 * p * 2 + z * 2 + x % 16 // 8
                if k < len(b):
                    v |= (b[k] >> 7 - x % 8 & 1) << z
            a.append(v)
    return a
if len(sys.argv) != 4:
    raise SystemExit('Usage: python atari-st-pages.py SOURCE_FILES ORIGINAL_MAIN_BIN OUTPUT_DIRECTORY')
SOURCE = Path(sys.argv[1])
MAIN = Path(sys.argv[2])
R = Path(sys.argv[3])
R.mkdir(parents=True, exist_ok=True)
B = 65536
REPO = Path(__file__).resolve().parents[2]
FONT = REPO / 'originals/graphics/atari-st/tos-system-8x8.fnt'
font_source = FONT.read_bytes()
assert hashlib.sha256(font_source).hexdigest() == '8bb21d897c7204a22b3d21a63072de3da5243230763475f725e534a6b1f704a6'
font = font_source[602:]
main = MAIN.read_bytes()
assert hashlib.sha256(main).hexdigest() == '2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638'
for record in json.loads((REPO / 'originals/graphics/atari-st/canonical-inputs.json').read_text()):
    raw = (SOURCE / record['name']).read_bytes()
    assert len(raw) == record['size'] and hashlib.sha256(raw).hexdigest() == record['sha256']
initial = bytearray(1048576)
initial[B:B + len(main)] = main
for name, addr, size in [('LOGO.DAT', 306794, 3548), ('BITS.DAT', 298496, 768), ('XDEATH.DAT', 355366, 34589)]:
    raw = (SOURCE / name).read_bytes()[:size]
    initial[addr:addr + len(raw)] = raw
initial[103476:103478] = bytes([0, 9])
x = m.Machine(m.CPUType.M68000, 16384)
c, mem = (x.cpu, x.mem)
state = {}
pal = []
log = []
cycles = 0

def init():
    global pal
    mem.w_block(0, bytes(initial))
    for name, addr in [('SIDEBAR.DAT', 234686), ('BIGTWINK.DAT', 310594)]:
        mem.w_block(addr, (SOURCE / name).read_bytes())
    for a, v in [(103428, 589824), (103432, 557056), (103436, 524288), (103440, 589824), (103444, 589824)]:
        mem.w32(a, v)
    c.w_sr(9984)
    c.w_sp(983040)
    state.update(x=0, y=0, fg=2, bg=0)
    mem.w_block(589824, bytes(32000))
    mem.w_block(557056, bytes(32000))
    mem.w_block(524288, bytes(32000))
    pal = list(struct.unpack('>16H', mem.r_block(107052, 32)))

def put(x, y, ink):
    if not (0 <= x < 320 and 0 <= y < 200):
        return
    a = 589824 + y * 160 + x // 16 * 8
    mask = 1 << 15 - x % 16
    for p in range(4):
        v = mem.r16(a + p * 2)
        mem.w16(a + p * 2, v | mask if ink & 1 << p else v & ~mask)

def tty(b):
    i = 0
    while i < len(b):
        ch = b[i]
        i += 1
        if ch == 27:
            cmd = b[i]
            i += 1
            if cmd == 98:
                state['fg'] = b[i] & 15
                i += 1
            elif cmd == 99:
                state['bg'] = b[i] & 15
                i += 1
            elif cmd == 89:
                state['y'] = (b[i] - 32) * 8
                state['x'] = (b[i + 1] - 32) * 8
                i += 2
            elif cmd == 69:
                for y in range(200):
                    for x in range(320):
                        put(x, y, state['bg'])
                state.update(x=0, y=0)
            else:
                raise Exception(cmd)
        elif ch == 8:
            state['x'] -= 8
        else:
            for y in range(8):
                bits = font[y * 256 + ch]
                for x in range(8):
                    put(state['x'] + x, state['y'] + y, state['fg'] if bits & 1 << 7 - x else state['bg'])
            state['x'] += 8

def ret():
    c.w_pc(mem.r32(c.r_sp()))
    c.w_sp(c.r_sp() + 4)

def step():
    global pal, cycles
    p = c.r_pc()
    if p in [B + 8598, B + 8656, B + 8756, B + 28312, B + 28382, B + 28452]:
        ret()
        return
    ins = mem.r16(p)
    if ins in [20033, 20046, 20045]:
        sp = c.r_sp()
        fn = mem.r16(sp)
        if ins == 20033 and fn == 9:
            tty(mem.r_cstr(mem.r32(sp + 2)).encode('latin1'))
        elif ins == 20046 and fn == 6:
            pal = list(struct.unpack('>16H', mem.r_block(mem.r32(sp + 2), 32)))
        elif ins == 20046 and fn == 17:
            c.w_reg(m.Register.D0, 0)
        else:
            raise Exception(('trap', hex(p), hex(ins), fn))
        c.w_pc(p + 2)
        return
    cycles += c.execute(1).cycles

def run(start, end=1792, maxi=3000000):
    c.w_sp(983040)
    mem.w32(983040, 1792)
    c.w_pc(B + start)
    for i in range(maxi):
        if c.r_pc() == end:
            return i
        step()
    raise Exception(('timeout', hex(c.r_pc())))

def save(name, addr=589824):
    raw = mem.r_block(addr, 32000)
    pixels = decode(raw, 320, 200)
    palette = [[round((v >> s & 7) * 255 / 7) for s in (8, 4, 0)] for v in pal]
    rgba = bytes((channel for v in pixels for channel in [*palette[v], 255]))
    png(R / f'source-{name}.png', 320, 200, pixels, palette)
    (R / f'source-{name}.indices.bin').write_bytes(bytes(pixels))
    (R / f'source-{name}.rgba.bin').write_bytes(rgba)
    return dict(width=320, height=200, rgbaSha256=hashlib.sha256(rgba).hexdigest(), indicesSha256=hashlib.sha256(bytes(pixels)).hexdigest(), paletteWords=pal, pc=hex(c.r_pc()))
out = {}
init()
run(5880, B + 6020)
out['title'] = save('title')
(R / 'title-state.bin').write_bytes(mem.r_block(0, 1048576))
init()
run(3844, B + 3974)
out['bonusRoulette'] = save('bonus-roulette')
init()
mem.w_block(589824, bytes(32000))
run(3534, B + 3666)
out['braveryEmptyStage'] = save('bravery')
init()
run(3722, B + 3822)
out['ending'] = save('ending')
init()
run(2522, B + 2626)
out['name'] = save('name')
init()
run(2180, B + 2264)
out['gameOverEmptyStage'] = save('game-over')
init()
pal = list(struct.unpack('>16H', mem.r_block(107212, 32)))
run(2766, B + 2894)
out['scores0'] = save('scores-0', 524288)
timings = []
for i in range(1, 146):
    cycles = 0
    run(3214)
    timings.append(cycles)
    if i in [1, 8, 9, 16, 145]:
        out[f'scores{i}'] = save(f'scores-{i}', 524288)
(R / 'scores-cycles.json').write_text(json.dumps({'cyclesNoOs': [timings[i - 1] for i in [1, 8, 9, 16, 17, 145]], 'steps': [1, 8, 9, 16, 17, 145], 'cpuHz': 8010612, 'palHz': 50, 'timingNote': 'Cycles excludeTOS9 fontprinting cost and_frclockwait; eachloopwaitsbeforeflip, soceil(cycles/160212) PALintervals approximately2 exceptprintingstep.'}, indent=2) + '\n')
(R / 'source-pages.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=2))
