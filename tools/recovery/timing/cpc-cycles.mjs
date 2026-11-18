// CPC NOP durations (microseconds), Madram/Overlanders hardware-tested table:
// https://64nops.wordpress.com/2021/01/13/perfectly-accurate-z80-flags-and-cpc-timing/
// Most ceil(total T/4) values coincide, exceptions are explicitly decoded here.
export function cpcCycles(m, pc, t) {
    let op = m[pc],
        o = m[(pc + 1) & 65535],
        n = Math.ceil(t / 4);
    if (op === 0xdd || op === 0xfd) {
        if ((o & 0xcf) === 0xc5) n = 5;
        else if (o === 0x22 || o === 0x2a) n = 6;
        else if (o === 0xe3) n = 7;
        else if (o === 0x36) n = 6;
    } else if ((op & 0xcf) === 0xc5) n = 4;
    else if (op === 0x22 || op === 0x2a) n = 5;
    else if ((op & 0xc7) === 0xc0 && t > 5) n = 4;
    else if ((op & 0xc7) === 0xc7) n = 4;
    else if (op === 0xe3) n = 6;
    else if (op === 0x10 && t === 8) n = 3;
    else if (op === 0xed) {
        if ((o & 0xc6) === 0x40) n = 4;
        else if ((o & 0xc7) === 0x43) n = 6;
        else if (o === 0xa0 || o === 0xa8) n = 5;
        else if ((o === 0xb0 || o === 0xb8) && t === 16) n = 5;
    }
    return n * 4;
}
