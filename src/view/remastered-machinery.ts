import type { Rectangle, CanvasPaint, VectorPath, Palette } from '../types/graphics.ts';
// New vector drawings following the silhouettes, colour splits and construction
// of the recovered Exolon objects (R. Cecco / S. Erokhin, CC BY-SA 3.0).
// This module supplies static artwork only: animated gun barrels remain in the
// renderer, anchored at their original model coordinates.
import { spectrumPalette } from './palette.ts';

const WHITE = spectrumPalette(71);
const GREEN = spectrumPalette(68);
const CYAN = spectrumPalette(69);
const YELLOW = spectrumPalette(70);
const PURPLE = spectrumPalette(67);
const RED = spectrumPalette(66);
const TAU = Math.PI * 2;

function path(c: CanvasRenderingContext2D, points: VectorPath) {
    c.beginPath();
    points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
}

function fill(c: CanvasRenderingContext2D, points: VectorPath, paint: CanvasPaint) {
    path(c, points);
    c.fillStyle = paint;
    c.fill();
}

function line(c: CanvasRenderingContext2D, points: VectorPath, color: CanvasPaint, width = 0.4) {
    c.beginPath();
    points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
}

function gradient(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    x1: number,
    y1: number,
    colors: string[],
) {
    const paint = c.createLinearGradient(x, y, x1, y1);
    colors.forEach((color, index) => paint.addColorStop(index / (colors.length - 1), color));
    return paint;
}

function roundBox(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    paint: CanvasPaint,
    radius = 0.6,
) {
    const r = Math.min(radius, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
    c.fillStyle = paint;
    c.fill();
}

function oval(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    paint: CanvasPaint,
) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, TAU);
    c.fillStyle = paint;
    c.fill();
}

function rivet(c: CanvasRenderingContext2D, x: number, y: number, color = WHITE.light) {
    oval(c, x, y, 0.43, 0.43, '#16312f');
    oval(c, x - 0.1, y - 0.1, 0.19, 0.19, color);
}

function panel(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    palette: Palette,
    radius = 0.7,
) {
    roundBox(
        c,
        x,
        y,
        w,
        h,
        gradient(c, x, y, x + w * 0.25, y + h, [
            palette.light,
            palette.base,
            palette.shade,
            palette.deep,
        ]),
        radius,
    );
    line(
        c,
        [
            [x + radius, y + 0.45],
            [x + w - radius, y + 0.45],
        ],
        palette.highlight,
        0.45,
    );
    if (w > 4 && h > 3)
        line(
            c,
            [
                [x + 0.6, y + radius],
                [x + 0.6, y + h - radius],
            ],
            palette.light,
            0.35,
        );
}

function coupling(c: CanvasRenderingContext2D, y: number, height: number) {
    // White compression rings join the dynamic yellow barrel at x=16.
    roundBox(
        c,
        16,
        y + 1,
        3.3,
        height - 2,
        gradient(c, 16, y, 16, y + height, [WHITE.light, WHITE.base, WHITE.shade, WHITE.deep]),
        0.55,
    );
    panel(c, 19.3, y + 0.3, 4.8, height - 0.6, WHITE, 0.65);
    line(
        c,
        [
            [20.4, y + 1],
            [20.4, y + height - 1],
        ],
        WHITE.highlight,
        0.55,
    );
    line(
        c,
        [
            [22.5, y + 1],
            [22.5, y + height - 1],
        ],
        WHITE.deep,
        0.55,
    );
}

function groundGun(c: CanvasRenderingContext2D) {
    // 48×40: green receiver, cyan breech cap, white stand; barrel y=11.8.
    fill(
        c,
        [
            [26, 18],
            [36, 18],
            [37.2, 25],
            [25, 25],
        ],
        gradient(c, 26, 19, 37, 25, [GREEN.base, GREEN.shade, GREEN.deep]),
    );
    for (let yy = 21; yy < 25; yy += 1.5)
        line(
            c,
            [
                [26, yy],
                [36, yy],
            ],
            GREEN.light,
            0.35,
        );
    fill(
        c,
        [
            [25, 25.4],
            [35.8, 25.4],
            [43, 29],
            [43.5, 39.7],
            [20.7, 39.7],
            [20.7, 29.2],
        ],
        gradient(c, 21, 25, 44, 40, [WHITE.highlight, WHITE.base, WHITE.shade, WHITE.deep]),
    );
    line(
        c,
        [
            [21.8, 29.3],
            [42, 29.3],
        ],
        WHITE.highlight,
        0.6,
    );
    roundBox(c, 22, 31, 19.4, 8.3, '#163040', 0.5);
    roundBox(
        c,
        23.4,
        31.5,
        17,
        7.8,
        gradient(c, 23, 31, 40, 40, [WHITE.light, WHITE.base, WHITE.shade]),
        0.4,
    );
    line(
        c,
        [
            [25.2, 32.3],
            [25.2, 38.8],
        ],
        WHITE.highlight,
        0.55,
    );
    for (const xx of [22.4, 40.8]) rivet(c, xx, 30.1);

    coupling(c, 7.6, 8.4);
    // Folded green casing follows the source's broad, upright receiver.
    fill(
        c,
        [
            [26.4, 3.2],
            [34.5, 3.2],
            [35.9, 5.2],
            [39.8, 5.2],
            [39.8, 18.7],
            [36.4, 21],
            [27.4, 21],
            [24.1, 18],
            [24.1, 7.2],
        ],
        gradient(c, 25, 4, 41, 22, [
            GREEN.highlight,
            GREEN.light,
            GREEN.base,
            GREEN.shade,
            GREEN.deep,
        ]),
    );
    oval(
        c,
        27.7,
        12.5,
        4.2,
        6.8,
        gradient(c, 24, 8, 32, 16, [GREEN.light, GREEN.base, GREEN.shade]),
    );
    oval(c, 27.7, 12.5, 2.6, 5.3, GREEN.deep);
    oval(c, 27.3, 12.2, 1.8, 4.6, GREEN.base);
    line(
        c,
        [
            [27.1, 8.4],
            [27.1, 15.9],
        ],
        GREEN.light,
        0.45,
    );
    line(
        c,
        [
            [26.8, 4],
            [34.1, 4],
            [35.4, 6.1],
        ],
        GREEN.highlight,
        0.6,
    );
    roundBox(c, 32.4, 7, 5.8, 11.6, GREEN.deep, 0.7);
    for (let yy = 8.2; yy < 18; yy += 2.3) {
        line(
            c,
            [
                [33.3, yy],
                [37.4, yy],
            ],
            GREEN.shade,
            0.8,
        );
        line(
            c,
            [
                [33.3, yy + 0.5],
                [37.4, yy + 0.5],
            ],
            GREEN.light,
            0.35,
        );
    }
    // Distinct cyan rear cover is a visible identity cue in the original gun.
    c.beginPath();
    c.moveTo(40.7, 6.4);
    c.bezierCurveTo(45.1, 7.1, 47.7, 9.3, 47.7, 12.4);
    c.bezierCurveTo(47.7, 15.7, 45.7, 18.5, 40.7, 19.2);
    c.closePath();
    c.fillStyle = gradient(c, 41, 6, 47, 20, [CYAN.light, CYAN.base, CYAN.shade, CYAN.deep]);
    c.fill();
    panel(c, 39, 5.8, 1.7, 14.2, GREEN, 0.35);
    line(
        c,
        [
            [42.5, 8.1],
            [44.6, 9.1],
        ],
        CYAN.highlight,
        0.5,
    );
    line(
        c,
        [
            [43.5, 16.9],
            [45, 15.8],
        ],
        CYAN.deep,
        0.6,
    );
    for (const [x, y] of [
        [25.7, 7.6],
        [25.7, 17.4],
        [37.5, 6.3],
        [36.5, 19.6],
    ])
        rivet(c, x, y, GREEN.highlight);
}

function upperGun(c: CanvasRenderingContext2D) {
    // 48×16: white horizontal receiver on a low green wedge mounting.
    fill(
        c,
        [
            [10.2, 15.8],
            [22.2, 9],
            [38.3, 9],
            [40.4, 11],
            [40.4, 15.8],
        ],
        gradient(c, 16, 9, 33, 17, [GREEN.light, GREEN.base, GREEN.shade, GREEN.deep]),
    );
    line(
        c,
        [
            [12.8, 15.2],
            [23, 9.7],
            [37.8, 9.7],
        ],
        GREEN.highlight,
        0.5,
    );
    roundBox(c, 25.8, 11.1, 12.1, 3.3, GREEN.deep, 0.45);
    line(
        c,
        [
            [27, 11.7],
            [36.7, 11.7],
        ],
        GREEN.light,
        0.4,
    );
    for (const xx of [27.4, 36.3]) rivet(c, xx, 12.8, GREEN.highlight);

    coupling(c, 0.2, 7.3);
    fill(
        c,
        [
            [25.4, 0.4],
            [42.7, 0.4],
            [46.4, 2],
            [47.6, 4],
            [45.4, 6.3],
            [40.6, 7.5],
            [25.4, 7.5],
            [23.5, 6.1],
            [23.5, 1.9],
        ],
        gradient(c, 25, 0, 43, 9, [
            WHITE.highlight,
            WHITE.light,
            WHITE.base,
            WHITE.shade,
            WHITE.deep,
        ]),
    );
    line(
        c,
        [
            [25.8, 1],
            [42.5, 1],
            [45.2, 2.3],
        ],
        WHITE.highlight,
        0.5,
    );
    roundBox(c, 26.1, 1.8, 13.7, 4.1, '#263c48', 0.4);
    for (let xx = 27.1; xx < 39; xx += 2.2) {
        line(
            c,
            [
                [xx, 2.3],
                [xx, 5.5],
            ],
            WHITE.light,
            0.7,
        );
        line(
            c,
            [
                [xx + 0.6, 2.3],
                [xx + 0.6, 5.5],
            ],
            WHITE.shade,
            0.4,
        );
    }
    panel(c, 41, 1.7, 2, 4.6, WHITE, 0.5);
    oval(c, 45.4, 3.9, 1, 1.6, WHITE.deep);
    oval(c, 45.2, 3.5, 0.4, 0.7, WHITE.light);
}

function leftMuzzle(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    palette: Palette,
) {
    panel(c, x, y, width, height, palette, 0.8);
    oval(c, x + 0.8, y + height / 2, 0.85, height * 0.34, '#122c31');
    line(
        c,
        [
            [x + 1.3, y + 0.7],
            [x + width - 0.8, y + 0.7],
        ],
        palette.highlight,
        0.4,
    );
}

function doubleLauncher(c: CanvasRenderingContext2D) {
    // 32×24: TWO white tubes, green muzzle/receiver sleeves, yellow rear dome.
    panel(c, 0.5, 19, 26.7, 2.6, YELLOW, 0.5);
    panel(c, 2, 16.6, 23.8, 1.5, YELLOW, 0.4);
    for (let xx = 3; xx < 26; xx += 2.8) {
        line(
            c,
            [
                [xx, 18.2],
                [xx, 19],
            ],
            YELLOW.shade,
            0.8,
        );
        line(
            c,
            [
                [xx + 0.4, 21.6],
                [xx + 0.4, 23.3],
            ],
            YELLOW.base,
            0.75,
        );
    }
    c.beginPath();
    c.moveTo(24.6, 1.2);
    c.bezierCurveTo(29, 1.5, 31.5, 4.6, 31.5, 7.7);
    c.bezierCurveTo(31.5, 11.2, 29.5, 13.8, 24.6, 14.5);
    c.closePath();
    c.fillStyle = gradient(c, 24, 1, 32, 16, [
        YELLOW.highlight,
        YELLOW.base,
        YELLOW.shade,
        YELLOW.deep,
    ]);
    c.fill();
    for (const yy of [0.6, 8.6]) {
        panel(c, 7, yy + 0.9, 10, 5.1, WHITE, 0.45);
        leftMuzzle(c, 1, yy, 6.7, 6.4, GREEN);
        panel(c, 16, yy, 8.5, 6.4, GREEN, 0.55);
        for (let xx = 18; xx < 24; xx += 2)
            line(
                c,
                [
                    [xx, yy + 1.1],
                    [xx, yy + 5.3],
                ],
                GREEN.deep,
                0.6,
            );
        panel(c, 24, yy + 0.6, 1.7, 5.2, YELLOW, 0.35);
    }
}

function lowerGun(c: CanvasRenderingContext2D) {
    // 48×16: one yellow left-facing barrel, long green receiver, yellow rails.
    panel(c, 16.2, 10.9, 31.2, 2.6, YELLOW, 0.4);
    panel(c, 17.1, 8.4, 29.4, 1.4, YELLOW, 0.3);
    panel(c, 17.1, 14.4, 29.4, 1.1, YELLOW, 0.3);
    for (let xx = 18.3; xx < 47; xx += 2.5) {
        line(
            c,
            [
                [xx, 9.9],
                [xx, 10.7],
            ],
            YELLOW.shade,
            0.75,
        );
        line(
            c,
            [
                [xx, 13.6],
                [xx, 14.3],
            ],
            YELLOW.base,
            0.75,
        );
    }
    roundBox(
        c,
        6,
        2.1,
        13.6,
        3.5,
        gradient(c, 6, 2, 6, 6, [YELLOW.light, YELLOW.base, YELLOW.shade]),
        0.45,
    );
    leftMuzzle(c, 1, 0.9, 6.8, 5.9, YELLOW);
    panel(c, 16.3, 0.7, 30.7, 6.5, GREEN, 1.2);
    roundBox(c, 20, 2.2, 20.7, 3.4, GREEN.shade, 0.4);
    for (let xx = 21; xx < 41; xx += 3.2) {
        line(
            c,
            [
                [xx, 2.9],
                [xx + 1.4, 2.9],
            ],
            GREEN.light,
            0.6,
        );
        line(
            c,
            [
                [xx, 4.7],
                [xx + 1.4, 4.7],
            ],
            GREEN.deep,
            0.65,
        );
    }
    for (const xx of [18.3, 44.5]) rivet(c, xx, 3.8, GREEN.highlight);
}

function whiteRocket(c: CanvasRenderingContext2D) {
    // 32×48: the standing white rocket and its open, braced launch stand.
    panel(c, 8.2, 44.1, 23.4, 3.7, WHITE, 0.5);
    line(
        c,
        [
            [9.2, 44.7],
            [30.8, 44.7],
        ],
        WHITE.highlight,
        0.6,
    );
    // Open steel bracing remains visible below and to the right of the nozzle.
    line(
        c,
        [
            [21, 32.7],
            [30.7, 43.3],
        ],
        WHITE.shade,
        1.5,
    );
    line(
        c,
        [
            [21.5, 33],
            [30.8, 43],
        ],
        WHITE.light,
        0.45,
    );
    line(
        c,
        [
            [23.2, 35],
            [22.6, 43.7],
            [28.6, 40.6],
            [25.8, 38],
        ],
        WHITE.shade,
        0.65,
    );
    fill(
        c,
        [
            [14.6, 35.1],
            [16.6, 35.1],
            [18.3, 42.6],
            [12, 42.6],
        ],
        gradient(c, 12, 35, 18, 44, [WHITE.light, WHITE.base, WHITE.shade]),
    );
    line(
        c,
        [
            [14.8, 36.1],
            [13.2, 41.5],
        ],
        WHITE.highlight,
        0.4,
    );

    // Broad fins are distinct from the narrow missile body and launch rails.
    fill(
        c,
        [
            [11.8, 21.5],
            [11.8, 29.1],
            [5.8, 29.1],
            [5.8, 26.2],
        ],
        gradient(c, 6, 22, 12, 30, [WHITE.light, WHITE.base, WHITE.shade]),
    );
    fill(
        c,
        [
            [20.2, 21.5],
            [25.5, 27.2],
            [25.5, 29.1],
            [20.2, 29.1],
        ],
        gradient(c, 20, 22, 26, 30, [WHITE.base, WHITE.shade, WHITE.deep]),
    );
    line(
        c,
        [
            [6.4, 26.4],
            [11.2, 22.6],
        ],
        WHITE.highlight,
        0.45,
    );
    line(
        c,
        [
            [20.7, 22.6],
            [24.8, 27.4],
        ],
        WHITE.light,
        0.4,
    );
    roundBox(
        c,
        12,
        16.6,
        8.1,
        15.8,
        gradient(c, 12, 17, 20, 17, [WHITE.light, WHITE.highlight, WHITE.base, WHITE.shade]),
        0.45,
    );
    line(
        c,
        [
            [13.2, 18],
            [13.2, 30.3],
        ],
        WHITE.highlight,
        0.55,
    );
    line(
        c,
        [
            [17.8, 18],
            [17.8, 30],
        ],
        '#6f8b94',
        0.35,
    );
    for (const yy of [20.2, 27.8])
        line(
            c,
            [
                [14.6, yy],
                [17, yy],
            ],
            WHITE.shade,
            0.4,
        );
    // Long tapered nose is the primary silhouette cue, not a rectangular box.
    c.beginPath();
    c.moveTo(15.5, 5.2);
    c.bezierCurveTo(14.6, 8.4, 12.8, 10.5, 12, 15.8);
    c.lineTo(20, 15.8);
    c.bezierCurveTo(18.6, 10.1, 16.5, 8.1, 15.5, 5.2);
    c.closePath();
    c.fillStyle = gradient(c, 12, 9, 20, 11, [
        WHITE.light,
        WHITE.highlight,
        WHITE.base,
        WHITE.shade,
    ]);
    c.fill();
    line(
        c,
        [
            [15.4, 7.2],
            [13.7, 13.7],
        ],
        WHITE.highlight,
        0.45,
    );
    panel(c, 11.9, 15.7, 8.3, 1.1, WHITE, 0.2);
    fill(
        c,
        [
            [13, 31.7],
            [19, 31.7],
            [20.1, 34.9],
            [11.9, 34.9],
        ],
        gradient(c, 12, 32, 20, 35, [WHITE.light, WHITE.shade, WHITE.deep]),
    );
    roundBox(c, 11.5, 34.5, 9, 1.5, WHITE.shade, 0.25);
    line(
        c,
        [
            [12, 34.7],
            [20, 34.7],
        ],
        WHITE.light,
        0.4,
    );
    roundBox(c, 13.1, 35.5, 5.6, 1.1, '#182c39', 0.2);
}

function beaconColumn(c: CanvasRenderingContext2D) {
    // 32×40: purple pedestal with broad feet and a white support for the orb.
    fill(
        c,
        [
            [8.7, 31.9],
            [8.7, 39.8],
            [1, 39.8],
            [1, 35.5],
            [4.5, 35.5],
            [4.5, 33.8],
        ],
        gradient(c, 1, 33, 9, 40, [PURPLE.light, PURPLE.base, PURPLE.shade]),
    );
    fill(
        c,
        [
            [23.1, 31.9],
            [27.5, 33.8],
            [27.5, 35.5],
            [31.5, 35.5],
            [31.5, 39.8],
            [23.1, 39.8],
        ],
        gradient(c, 23, 33, 32, 40, [PURPLE.base, PURPLE.shade, PURPLE.deep]),
    );
    line(
        c,
        [
            [1.9, 35.7],
            [8, 32.7],
        ],
        PURPLE.highlight,
        0.5,
    );
    line(
        c,
        [
            [24, 32.8],
            [30.2, 36.2],
        ],
        PURPLE.light,
        0.45,
    );
    roundBox(
        c,
        9.1,
        15.4,
        13.8,
        24.4,
        gradient(c, 9, 16, 23, 16, [
            PURPLE.light,
            PURPLE.highlight,
            PURPLE.base,
            PURPLE.shade,
            PURPLE.deep,
        ]),
        0.6,
    );
    line(
        c,
        [
            [11.1, 17],
            [11.1, 38.8],
        ],
        PURPLE.highlight,
        0.6,
    );
    line(
        c,
        [
            [19.6, 17],
            [19.6, 38.7],
        ],
        PURPLE.deep,
        0.45,
    );
    for (const yy of [22.2, 30.7])
        line(
            c,
            [
                [12.7, yy],
                [18, yy],
            ],
            PURPLE.shade,
            0.4,
        );
    panel(c, 9, 12.1, 14.1, 3.3, WHITE, 0.5);
    panel(c, 14.8, 0.2, 2.4, 6, WHITE, 0.15);
    fill(
        c,
        [
            [14.8, 5.8],
            [17.2, 5.8],
            [18, 8.5],
            [21.9, 11.8],
            [10.4, 11.8],
            [14, 8.5],
        ],
        gradient(c, 11, 7, 22, 7, [
            WHITE.light,
            WHITE.highlight,
            WHITE.base,
            WHITE.shade,
            WHITE.deep,
        ]),
    );
    line(
        c,
        [
            [15.1, 1],
            [15.1, 6.5],
            [12, 10.6],
        ],
        WHITE.highlight,
        0.45,
    );
    line(
        c,
        [
            [10.1, 15.7],
            [22.1, 15.7],
        ],
        PURPLE.deep,
        0.6,
    );
}

function beaconHead(c: CanvasRenderingContext2D) {
    // Source block31: white radial antenna over a green 16px orb, not a panel.
    for (const points of [
        [
            [1.5, 3.3],
            [10.6, 7.7],
        ],
        [
            [21.4, 7.7],
            [30.5, 3.3],
        ],
        [
            [7.7, 0.8],
            [12.7, 5.8],
        ],
        [
            [19.3, 5.8],
            [24.3, 0.8],
        ],
        [
            [1.2, 9.4],
            [9.1, 10.6],
        ],
        [
            [22.9, 10.6],
            [30.8, 9.4],
        ],
    ]) {
        line(c, points, WHITE.shade, 1.2);
        line(c, points, WHITE.highlight, 0.65);
    }
    panel(c, 15.2, 0.3, 1.6, 11.7, WHITE, 0.15);
    panel(c, 13, 13.1, 6, 1.7, WHITE, 0.2);
    panel(c, 14.4, 14.7, 3.2, 2.1, WHITE, 0.2);
    for (const xx of [4.8, 25.2]) panel(c, xx, 22.2, 2, 5.2, WHITE, 0.25);
    for (const xx of [7.2, 23.2])
        for (const yy of [19.5, 28.8]) panel(c, xx, yy, 1.6, 1.5, WHITE, 0.2);
    c.save();
    c.beginPath();
    c.arc(16, 24, 7.9, 0, TAU);
    c.clip();
    const paint = c.createRadialGradient(12.8, 20.5, 0.4, 17, 25.5, 10.4);
    paint.addColorStop(0, '#bcff9a');
    paint.addColorStop(0.25, GREEN.light);
    paint.addColorStop(0.55, GREEN.base);
    paint.addColorStop(0.83, GREEN.shade);
    paint.addColorStop(1, GREEN.deep);
    c.fillStyle = paint;
    c.fillRect(8, 16, 16, 16);
    // Dark irregular divisions preserve the source orb's mottled face.
    for (const points of [
        [
            [9, 21],
            [12, 21.5],
            [13, 18],
            [16, 17.3],
        ],
        [
            [15.5, 19],
            [16, 22],
            [20, 21],
            [23, 23],
        ],
        [
            [9, 26],
            [12, 24],
            [15, 25],
            [14, 29],
            [17, 32],
        ],
        [
            [18, 25],
            [21, 26],
            [19.5, 29],
            [23, 30],
        ],
    ])
        line(c, points, GREEN.deep, 1.35);
    line(
        c,
        [
            [11, 19.9],
            [12.5, 18.7],
            [14, 18.1],
        ],
        '#edffe0',
        0.5,
    );
    c.restore();
    c.beginPath();
    c.arc(16, 24, 7.75, 0, TAU);
    c.strokeStyle = GREEN.deep;
    c.lineWidth = 0.45;
    c.stroke();
}

function grille(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    palette: Palette,
) {
    roundBox(c, x, y, w, h, '#10231e', 0.15);
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    for (let xx = x - h; xx < x + w + h; xx += 2.2) {
        line(
            c,
            [
                [xx, y],
                [xx + h, y + h],
            ],
            palette.light,
            0.45,
        );
        line(
            c,
            [
                [xx, y + h],
                [xx + h, y],
            ],
            palette.base,
            0.45,
        );
    }
    c.restore();
}

function materialContainer(c: CanvasRenderingContext2D) {
    // Source block40: red contents, green mesh rim and tapered bowl, white foot.
    fill(
        c,
        [
            [10, 30],
            [22, 30],
            [23.7, 33],
            [30, 35.4],
            [31.5, 39.8],
            [0.5, 39.8],
            [1.5, 35.4],
            [8.3, 33],
        ],
        gradient(c, 2, 32, 30, 40, [WHITE.highlight, WHITE.light, WHITE.base, WHITE.shade]),
    );
    panel(c, 8.7, 32.2, 14.6, 7.5, WHITE, 0.35);
    grille(c, 10, 33.5, 12, 5.4, WHITE);
    line(
        c,
        [
            [2.8, 36],
            [7.2, 34.2],
        ],
        WHITE.highlight,
        0.6,
    );
    line(
        c,
        [
            [25, 34.6],
            [29.5, 37],
        ],
        WHITE.deep,
        0.45,
    );

    fill(
        c,
        [
            [1.7, 14.4],
            [30.3, 14.4],
            [25.7, 27.6],
            [22, 30.7],
            [10, 30.7],
            [6.3, 27.6],
        ],
        gradient(c, 3, 17, 30, 22, [
            GREEN.highlight,
            GREEN.light,
            GREEN.base,
            GREEN.shade,
            GREEN.deep,
        ]),
    );
    fill(
        c,
        [
            [10.1, 15.1],
            [22.4, 15.1],
            [21, 29.7],
            [11.4, 29.7],
        ],
        gradient(c, 10, 16, 23, 28, [GREEN.light, GREEN.base, GREEN.shade]),
    );
    line(
        c,
        [
            [7.8, 16.5],
            [9.7, 27.5],
            [11.6, 29.5],
        ],
        GREEN.deep,
        0.65,
    );
    line(
        c,
        [
            [24.1, 16.5],
            [22.2, 27.5],
        ],
        GREEN.deep,
        0.7,
    );
    line(
        c,
        [
            [10.7, 16.3],
            [12, 28.2],
        ],
        GREEN.highlight,
        0.45,
    );
    for (const [x, y] of [
        [8.1, 16.6],
        [23.7, 16.6],
        [11.8, 28.4],
        [20.4, 28.4],
    ])
        rivet(c, x, y, GREEN.light);

    // Separate irregular pieces keep the load readable as red material.
    for (const [cx, cy, rx, ry] of [
        [6.1, 5.4, 3, 2.3],
        [11.4, 3.7, 3.8, 2.8],
        [18, 3.1, 3.6, 2.7],
        [24.6, 5.1, 4, 2.8],
        [17.1, 6.4, 4.6, 2.4],
    ]) {
        c.beginPath();
        c.moveTo(cx - rx, cy + ry * 0.5);
        c.bezierCurveTo(
            cx - rx * 0.8,
            cy - ry * 0.8,
            cx - rx * 0.1,
            cy - ry,
            cx + rx * 0.35,
            cy - ry * 0.65,
        );
        c.bezierCurveTo(
            cx + rx * 0.9,
            cy - ry,
            cx + rx,
            cy + ry * 0.2,
            cx + rx * 0.65,
            cy + ry * 0.65,
        );
        c.bezierCurveTo(cx + rx * 0.2, cy + ry, cx - rx * 0.7, cy + ry, cx - rx, cy + ry * 0.5);
        c.closePath();
        c.fillStyle = gradient(c, cx - rx, cy - ry, cx + rx, cy + ry, [
            RED.light,
            RED.base,
            RED.shade,
            RED.deep,
        ]);
        c.fill();
        line(
            c,
            [
                [cx - rx * 0.55, cy - ry * 0.2],
                [cx - rx * 0.05, cy - ry * 0.55],
                [cx + rx * 0.3, cy - ry * 0.3],
            ],
            '#ffb0a1',
            0.4,
        );
    }
    panel(c, 0.4, 8.7, 31.2, 6.2, GREEN, 0.4);
    grille(c, 1.8, 10, 28.4, 3.5, GREEN);
    line(
        c,
        [
            [1.2, 9.1],
            [30.8, 9.1],
        ],
        GREEN.highlight,
        0.55,
    );
    line(
        c,
        [
            [1.4, 14.5],
            [30.6, 14.5],
        ],
        GREEN.deep,
        0.45,
    );
}

function dialColumn(c: CanvasRenderingContext2D) {
    // 40×64: a front-facing analogue dial, thin stalk and white instrument base.
    fill(
        c,
        [
            [13.2, 41],
            [25.3, 41],
            [30.8, 46.6],
            [30.8, 63.9],
            [8.9, 63.9],
            [8.9, 46.7],
        ],
        gradient(c, 9, 41, 31, 65, [WHITE.highlight, WHITE.base, WHITE.shade, WHITE.deep]),
    );
    line(
        c,
        [
            [10.1, 47.1],
            [14, 42.1],
            [25.1, 42.1],
        ],
        WHITE.highlight,
        0.6,
    );
    roundBox(c, 16.7, 46, 11.2, 16.4, WHITE.deep, 0.7);
    roundBox(
        c,
        17.6,
        46.7,
        9.6,
        14.9,
        gradient(c, 18, 47, 27, 63, [WHITE.base, WHITE.shade, WHITE.deep]),
        0.4,
    );
    roundBox(c, 19.1, 50.7, 5.5, 8.9, '#294252', 0.55);
    line(
        c,
        [
            [19.7, 58.8],
            [19.7, 51.4],
            [24, 51.4],
        ],
        WHITE.light,
        0.45,
    );
    for (const yy of [47.9, 60.4]) rivet(c, 22.1, yy);
    line(
        c,
        [
            [12, 48],
            [12, 62.7],
        ],
        WHITE.highlight,
        0.5,
    );
    roundBox(
        c,
        18.4,
        26,
        3.1,
        15.3,
        gradient(c, 18, 26, 22, 26, [WHITE.light, WHITE.base, WHITE.shade, WHITE.deep]),
        0.5,
    );
    for (const yy of [29.7, 37.2]) roundBox(c, 18, yy, 3.9, 1, WHITE.shade, 0.2);

    oval(
        c,
        20,
        13,
        17.2,
        12.9,
        gradient(c, 7, 2, 32, 26, [WHITE.highlight, WHITE.light, WHITE.shade, WHITE.deep]),
    );
    oval(c, 20, 13, 15.6, 11.4, '#304957');
    oval(
        c,
        20,
        12.8,
        14.7,
        10.6,
        gradient(c, 10, 3, 31, 24, ['#f4f6dd', '#d9e4d6', '#a7bebf', '#66838f']),
    );
    for (let tick = 0; tick < 12; tick++) {
        const angle = (tick * TAU) / 12 - Math.PI / 2,
            major = tick % 3 === 0;
        const rx = major ? 11.1 : 12,
            ry = major ? 7.9 : 8.6;
        line(
            c,
            [
                [20 + Math.cos(angle) * rx, 12.8 + Math.sin(angle) * ry],
                [20 + Math.cos(angle) * 13.2, 12.8 + Math.sin(angle) * 9.4],
            ],
            '#435e67',
            major ? 0.7 : 0.4,
        );
    }
    // One unequivocal upward pointer, matching the recovered dial's central hand.
    fill(
        c,
        [
            [20, 5.5],
            [17.8, 13.8],
            [20, 12.8],
            [22.2, 13.8],
        ],
        '#243c47',
    );
    line(
        c,
        [
            [20, 7],
            [20, 11.5],
        ],
        '#f4fff1',
        0.4,
    );
    oval(c, 20, 13, 1.1, 1.1, WHITE.deep);
    oval(c, 19.8, 12.8, 0.5, 0.5, WHITE.highlight);
    c.beginPath();
    c.ellipse(20, 12.8, 16.3, 12, 0, Math.PI * 1.05, Math.PI * 1.78);
    c.strokeStyle = '#ffffffbb';
    c.lineWidth = 0.55;
    c.stroke();
}

const DRAWINGS = new Map([
    [5, { width: 48, height: 40, draw: groundGun }],
    [15, { width: 40, height: 64, draw: dialColumn }],
    [16, { width: 32, height: 48, draw: whiteRocket }],
    [26, { width: 32, height: 24, draw: doubleLauncher }],
    [31, { width: 32, height: 32, draw: beaconHead }],
    [32, { width: 32, height: 40, draw: beaconColumn }],
    [40, { width: 32, height: 40, draw: materialContainer }],
    [44, { width: 48, height: 16, draw: upperGun }],
    [45, { width: 48, height: 16, draw: lowerGun }],
]);

/** Returns true for supported source block IDs; never alters the map or model. */
export function drawRemasteredMachinery(
    c: CanvasRenderingContext2D,
    item: Rectangle & { block: number },
) {
    const drawing = DRAWINGS.get(item.block);
    if (!drawing) return false;
    c.save();
    try {
        c.translate(item.x, item.y);
        c.scale(item.w / drawing.width, item.h / drawing.height);
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.beginPath();
        c.rect(0, 0, drawing.width, drawing.height);
        c.clip();
        drawing.draw(c);
    } finally {
        c.restore();
    }
    return true;
}
