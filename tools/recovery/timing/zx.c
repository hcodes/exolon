/* Offline Exolon Spectrum timing probe. The game/CPU are never browser code.
 * Build: clang -std=c11 -O2 tools/recovery/timing/zx.c -o /tmp/exolon-zx-timing
 * Run with --help. Core license and upstream documentation remain in z80.h.
 * ULA replay models explicit buses and retained-address idle contention;
 * this is not an assertion of exhaustive undocumented hardware fidelity.
 */
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHIPS_IMPL
#include "third-party/z80.h"

#define MAX_TICKS 15000000
#define FRAME_COUNT 50
#define MEMORY_SHA256 "2ee3509dc114d70a2bd2d7e22ada889d93088091964380e4b2583341e41617b5"
#define CORE_SHA256 "6ca70ffd91b1bdbaf00f7a41e7092b326145fd1c95dcdd7bb01183370de734f3"
static uint8_t memory[65536];
static uint64_t trace[MAX_TICKS + 8];
static uint8_t busy[MAX_TICKS + 8];
static long long boundaries[FRAME_COUNT + 1];
static int variant = 128, phase = 0, frame = 0;
static const char *mode = "walk";

/* Small standalone SHA-256 implementation keeps the probe dependency-free. */
static uint32_t rotate(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }
static void sha256(const uint8_t *bytes, size_t length, char hex[65]) {
    static const uint32_t constants[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    };
    uint32_t hash[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
                        0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    size_t padded = ((length + 9 + 63) / 64) * 64;
    uint64_t bit_length = (uint64_t)length * 8;
    for (size_t block = 0; block < padded; block += 64) {
        uint32_t words[64] = {0};
        for (size_t j = 0; j < 64; j++) {
            size_t at = block + j;
            uint8_t byte = at < length ? bytes[at] : at == length ? 0x80 : 0;
            if (at >= padded - 8) byte = (uint8_t)(bit_length >> ((padded - 1 - at) * 8));
            words[j / 4] |= (uint32_t)byte << (24 - (j % 4) * 8);
        }
        for (unsigned j = 16; j < 64; j++) {
            uint32_t x = words[j-15], y = words[j-2];
            words[j] = words[j-16] + (rotate(x,7)^rotate(x,18)^(x>>3)) + words[j-7]
                       + (rotate(y,17)^rotate(y,19)^(y>>10));
        }
        uint32_t a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];
        for (unsigned j = 0; j < 64; j++) {
            uint32_t t1 = h + (rotate(e,6)^rotate(e,11)^rotate(e,25))
                          + ((e&f)^(~e&g)) + constants[j] + words[j];
            uint32_t t2 = (rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c));
            h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
        }
        hash[0]+=a;hash[1]+=b;hash[2]+=c;hash[3]+=d;
        hash[4]+=e;hash[5]+=f;hash[6]+=g;hash[7]+=h;
    }
    for (unsigned j = 0; j < 8; j++) snprintf(hex+j*8,9,"%08x",hash[j]);
}

static uint8_t *verified_file(const char *path, const char *expected, size_t *size) {
    FILE *file = fopen(path, "rb");
    if (!file) { perror(path); return NULL; }
    if (fseek(file, 0, SEEK_END)) { fclose(file); return NULL; }
    long length = ftell(file);
    if (length < 0 || length > 1024*1024 || fseek(file, 0, SEEK_SET)) {
        fprintf(stderr, "Invalid input size: %s\n", path); fclose(file); return NULL;
    }
    uint8_t *bytes = malloc((size_t)length + 1);
    if (!bytes) { fclose(file); return NULL; }
    if (fread(bytes, 1, (size_t)length, file) != (size_t)length || ferror(file)) {
        fclose(file); free(bytes); return NULL;
    }
    fclose(file);
    char digest[65];
    sha256(bytes, (size_t)length, digest);
    if (strcmp(digest, expected)) {
        fprintf(stderr, "Unsupported SHA-256 for %s: %s\n", path, digest);
        free(bytes); return NULL;
    }
    *size = (size_t)length;
    return bytes;
}

static bool contended(uint16_t address) { return address >= 0x4000 && address < 0x8000; }
static int delay(long long time) {
    int frame_length = variant == 48 ? 69888 : 70908;
    int line_length = variant == 48 ? 224 : 228;
    int start = variant == 48 ? 14335 : 14361;
    int offset = (int)((time + phase) % frame_length) - start;
    if (offset < 0 || offset >= line_length*192 || offset % line_length >= 128) return 0;
    static const int pattern[8] = {6,5,4,3,2,1,0,0};
    return pattern[offset % 8];
}
static uint8_t keyboard(uint16_t address) {
    uint8_t value = 255;
    if ((address & 255) != 254 || !frame) return value;
    unsigned row = address >> 8;
    if ((!strcmp(mode,"walk") || !strcmp(mode,"walkjump")) && !(row & 0x20)) value &= ~1;
    if (!strcmp(mode,"crouch") && !(row & 2)) value &= ~1;
    if ((!strcmp(mode,"jump") || !strcmp(mode,"walkjump")) && frame == 3 && !(row & 4)) value &= ~1;
    if (!strcmp(mode,"shot") && !(row & 128)) value &= ~4;
    return value;
}

static void replay(long long count) {
    for (long long j = 0; j < count; j++) {
        uint64_t pins = trace[j];
        if ((pins & Z80_MREQ) && (pins & (Z80_RD|Z80_WR)) && !(pins & Z80_RFSH)) {
            long long start = pins & Z80_M1 ? j : j-1;
            int length = pins & Z80_M1 ? 4 : 3;
            for (int n = 0; n < length; n++) if (start+n >= 0) busy[start+n] = 1;
        } else if (pins & Z80_IORQ) {
            for (int n = -1; n < 3; n++) if (j+n >= 0) busy[j+n] = 1;
        }
    }
    long long ticks=0,waits=0,last=0,last_wait=0,last_raw=0;
    int output_frame = 0;
    puts("REPLAY,frame,elapsedT,rawT,waitT");
    for (long long j = 0; j < count; j++) {
        if (output_frame <= FRAME_COUNT && j == boundaries[output_frame]) {
            if (output_frame) printf("REPLAY,%d,%lld,%lld,%lld\n", output_frame-1,
                                     ticks-last,j-last_raw,waits-last_wait);
            last=ticks;last_raw=j;last_wait=waits;output_frame++;
        }
        uint64_t pins=trace[j],next=trace[j+1];
        uint16_t address=Z80_GET_ADDR(pins),next_address=Z80_GET_ADDR(next);
        int extra = 0;
        /* Retained idle address approximates no-MREQ cycles; see research caveat. */
        if (!busy[j] && contended(address)) extra = delay(ticks);
        if ((pins & (Z80_MREQ|Z80_M1|Z80_RD)) == (Z80_MREQ|Z80_M1|Z80_RD)
            && contended(address)) extra = delay(ticks);
        /* Data-memory RD/WR appears at T2; its T1 is the preceding tick. */
        if ((next & Z80_MREQ) && (next & (Z80_RD|Z80_WR))
            && !(next & (Z80_M1|Z80_RFSH)) && contended(next_address)) extra = delay(ticks);
        if (next & Z80_IORQ) {
            bool high_contended = contended(next_address);
            long long time = ticks;
            int added = high_contended ? delay(time) : 0;
            time += added+1;
            if (!(next_address & 1)) added += delay(time);
            else if (high_contended) for (int n = 0; n < 3; n++) {
                int wait = delay(time);added += wait;time += wait+1;
            }
            extra = added;
        }
        ticks += 1+extra;waits += extra;
    }
}

static void usage(FILE *stream) {
    fputs("Usage: zx --memory RAM.bin --core third-party/z80.h [--mode walk]\n"
          "          [--variant 48|128] [--contention none|memory|ula] [--phase 0]\n"
          "Modes: stand, walk, crouch, shot, jump, walkjump. Runs 50 complete loops.\n"
          "CSV reports raw cycles; ula appends REPLAY rows. See research/motion-zx.json.\n", stream);
}
int main(int argc, char **argv) {
    const char *memory_path=NULL,*core_path=NULL,*contention="ula";
    for (int j = 1; j < argc; j += 2) {
        if (!strcmp(argv[j],"--help")) { usage(stdout); return 0; }
        if (j+1 >= argc) { usage(stderr); return 1; }
        const char *key=argv[j],*value=argv[j+1];
        if (!strcmp(key,"--memory")) memory_path=value;
        else if (!strcmp(key,"--core")) core_path=value;
        else if (!strcmp(key,"--mode")) mode=value;
        else if (!strcmp(key,"--contention")) contention=value;
        else if (!strcmp(key,"--variant") || !strcmp(key,"--phase")) {
            char *end;errno=0;long number=strtol(value,&end,10);
            if (errno || !value[0] || *end || number < 0 || number > 70908) { usage(stderr); return 1; }
            if (!strcmp(key,"--variant")) variant=(int)number;else phase=(int)number;
        } else { usage(stderr); return 1; }
    }
    if (!memory_path || !core_path || (variant != 48 && variant != 128)
        || phase >= (variant == 48 ? 69888 : 70908)
        || (strcmp(contention,"none") && strcmp(contention,"memory") && strcmp(contention,"ula"))
        || (strcmp(mode,"stand") && strcmp(mode,"walk") && strcmp(mode,"crouch")
            && strcmp(mode,"shot") && strcmp(mode,"jump") && strcmp(mode,"walkjump"))) {
        usage(stderr);return 1;
    }
    size_t length;
    uint8_t *bytes=verified_file(memory_path,MEMORY_SHA256,&length);
    if (!bytes) return 1;
    if (length != sizeof(memory)) { free(bytes);return 1; }
    memcpy(memory,bytes,length);free(bytes);
    bytes=verified_file(core_path,CORE_SHA256,&length);
    if (!bytes) return 1;
    free(bytes);
    memory[0x386e]=variant == 48 ? 255 : 0x37;
    z80_t cpu;z80_init(&cpu);
    cpu.af=cpu.bc=cpu.de=cpu.hl=cpu.af2=cpu.bc2=cpu.de2=cpu.hl2=cpu.ix=cpu.iy=cpu.ir=0;
    uint64_t pins=z80_prefetch(&cpu,0x6d60);
    bool started=false;
    long long ticks=0,waits=0,last=0,last_wait=0,last_raw=0,raw;
    puts("frame,elapsedT,rawT,waitT,x,y,jump");
    for (raw=0;raw<MAX_TICKS;raw++) {
        pins=z80_tick(&cpu,pins);ticks++;trace[raw]=pins;
        uint16_t address=Z80_GET_ADDR(pins);
        if ((pins & (Z80_M1|Z80_MREQ|Z80_RD)) == (Z80_M1|Z80_MREQ|Z80_RD)) {
            if (address == 0x6da1 && !started) {
                pins=z80_prefetch(&cpu,0x758a);started=true;continue;
            }
            if (address == 0x75be) {
                boundaries[frame]=raw;
                if (frame) printf("%d,%lld,%lld,%lld,%u,%u,%u\n",frame-1,ticks-last,
                                  raw-last_raw,waits-last_wait,memory[0x82f5],memory[0x82f6],memory[0x82f7]);
                last=ticks;last_raw=raw;last_wait=waits;
                if (++frame > FRAME_COUNT) break;
            }
        }
        if (pins & Z80_MREQ) {
            if (!(pins & Z80_RFSH) && (pins & (Z80_RD|Z80_WR)) && contended(address)
                && !strcmp(contention,"memory")) {
                int extra=delay(ticks-1);ticks+=extra;waits+=extra;
            }
            if (pins & Z80_RD) { Z80_SET_DATA(pins,memory[address]); }
            else if (pins & Z80_WR) memory[address]=Z80_GET_DATA(pins);
        } else if ((pins & Z80_IORQ) && (pins & Z80_RD)) { Z80_SET_DATA(pins,keyboard(address)); }
    }
    if (frame != FRAME_COUNT+1) {
        fprintf(stderr,"Native program exceeded its %d tick budget.\n",MAX_TICKS);return 1;
    }
    if (!strcmp(contention,"ula")) replay(raw+1);
    return 0;
}
