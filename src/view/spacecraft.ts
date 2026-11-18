import type { Palette } from '../types/graphics.ts';
type Coordinates = readonly (readonly [number, number])[];
type Paint = CanvasRenderingContext2D['fillStyle'];
// Original Canvas artwork in the recovered ship's 88 x 64 coordinate space.
// The front-facing hull, antenna span and coloured side pods follow block 2.
export function drawSpacecraft(
    c: CanvasRenderingContext2D,
    { cyan, white, yellow, red }: { cyan: Palette; white: Palette; yellow: Palette; red: Palette },
) {
    const path = (points: Coordinates) => {
        c.beginPath();
        points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
    };
    const polygon = (points: Coordinates, fill: Paint) => {
        path(points);
        c.fillStyle = fill;
        c.fill();
    };
    const line = (points: Coordinates, color: Paint, width = 0.5) => {
        c.beginPath();
        c.strokeStyle = color;
        c.lineWidth = width;
        points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
    };
    const gradient = (x: number, y: number, x1: number, y1: number, colors: readonly string[]) => {
        const paint = c.createLinearGradient(x, y, x1, y1);
        colors.forEach((color, index) => paint.addColorStop(index / (colors.length - 1), color));
        return paint;
    };
    const box = (x: number, y: number, width: number, height: number, fill: Paint, radius = 0) => {
        const r = Math.min(radius, width / 2, height / 2);
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + width - r, y);
        c.quadraticCurveTo(x + width, y, x + width, y + r);
        c.lineTo(x + width, y + height - r);
        c.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        c.lineTo(x + r, y + height);
        c.quadraticCurveTo(x, y + height, x, y + height - r);
        c.lineTo(x, y + r);
        c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
        c.fillStyle = fill;
        c.fill();
    };
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: Paint) => {
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        c.fillStyle = fill;
        c.fill();
    };
    const rivet = (x: number, y: number, tint = white.light) => {
        ellipse(x, y, 0.38, 0.38, '#062938');
        ellipse(x - 0.08, y - 0.08, 0.18, 0.18, tint);
    };
    const mirror = (draw: () => void) => {
        draw();
        c.save();
        c.translate(88, 0);
        c.scale(-1, 1);
        draw();
        c.restore();
    };

    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';

    // Telescopic aerials and the crossbeam sit behind the armoured shoulders.
    mirror(() => {
        line(
            [
                [0, 22],
                [28, 22],
            ],
            white.shade,
            0.95,
        );
        line(
            [
                [0, 21.7],
                [28, 21.7],
            ],
            white.light,
            0.35,
        );
        for (let x = 9; x < 27; x += 2) box(x, 22.1, 0.65, 1.25, white.base);
    });
    for (const x of [29, 59]) {
        box(x - 0.45, 0.2, 0.9, 22, gradient(x - 0.5, 0, x + 0.5, 0, [white.light, white.shade]));
        box(x - 0.7, 6.5, 1.4, 1.5, white.base, 0.25);
        box(x - 0.9, 15, 1.8, 1.7, white.base, 0.25);
        box(x - 1.2, 20, 2.4, 3, white.shade, 0.4);
        line(
            [
                [x - 0.9, 20.4],
                [x + 0.9, 20.4],
            ],
            white.highlight,
            0.35,
        );
        line(
            [
                [x - 1, 22],
                [x + (x < 44 ? 5 : -5), 25],
            ],
            white.base,
            0.7,
        );
        for (let y = 9; y < 15; y += 2)
            line(
                [
                    [x, y],
                    [x + (x < 44 ? 1.5 : -1.5), y],
                ],
                white.light,
                0.4,
            );
    }
    mirror(() => {
        box(9, 21, 5, 2, white.shade, 0.35);
        box(10, 21, 1, 2, white.light);
        line(
            [
                [13, 22.3],
                [23, 26],
            ],
            white.base,
            0.6,
        );
        line(
            [
                [15, 22.3],
                [23, 27.6],
            ],
            '#143a48',
            0.65,
        );
    });

    // The underframe remains visible between separate hull and engine plates.
    polygon(
        [
            [23, 24],
            [65, 24],
            [74, 32],
            [68, 43],
            [61, 49],
            [44, 63.4],
            [27, 49],
            [20, 43],
            [14, 32],
        ],
        cyan.deep,
    );
    polygon(
        [
            [25, 25],
            [63, 25],
            [64, 47],
            [44, 63],
            [24, 47],
        ],
        gradient(24, 25, 65, 57, [cyan.light, cyan.base, cyan.shade]),
    );
    mirror(() => {
        // White shoulder covers carry a folded edge and a recessed intake.
        polygon(
            [
                [23.5, 24],
                [19, 26],
                [14.3, 32],
                [17.5, 40],
                [23.7, 36.7],
                [27, 27],
            ],
            white.shade,
        );
        polygon(
            [
                [23.3, 24.3],
                [19.3, 26.5],
                [15.5, 31.8],
                [18.2, 37],
                [23.3, 34.5],
                [26, 26.8],
            ],
            gradient(17, 25, 25, 38, [white.highlight, white.base, white.shade]),
        );
        line(
            [
                [19.2, 26.4],
                [23.5, 25.1],
                [25.5, 27.1],
            ],
            white.highlight,
            0.5,
        );
        polygon(
            [
                [17, 31.3],
                [20.8, 27.8],
                [21.8, 29],
                [18.1, 32.8],
            ],
            '#143a48',
        );
        for (let y = 29.8; y < 32; y += 0.75)
            line(
                [
                    [18.2, y + 1.2],
                    [20.6, y - 1],
                ],
                white.shade,
                0.35,
            );
        rivet(18.3, 33.7);
        rivet(23.3, 27.4);

        // Yellow side nacelles sit inside metal rails, with dark cooling slots.
        polygon(
            [
                [21, 28],
                [24, 29.6],
                [24, 44.8],
                [16, 41],
                [16, 33],
            ],
            cyan.deep,
        );
        polygon(
            [
                [20.5, 28.5],
                [23.3, 30],
                [23.3, 43.3],
                [17.2, 40.2],
                [16.7, 33],
            ],
            gradient(17, 30, 24, 41, [yellow.light, yellow.base, yellow.shade]),
        );
        line(
            [
                [20.2, 29.8],
                [17.5, 33.2],
                [17.9, 39],
            ],
            yellow.highlight,
            0.55,
        );
        for (let y = 34; y < 40; y += 1.25)
            line(
                [
                    [21.4, y],
                    [22.7, y + 0.6],
                ],
                yellow.deep,
                0.5,
            );
        polygon(
            [
                [19.3, 31.5],
                [21.4, 32.7],
                [19.7, 33.5],
            ],
            yellow.deep,
        );
        box(17.5, 40.1, 6.5, 1.2, white.shade, 0.25);

        // Engine plumbing, shrouds and a three-stage exhaust nozzle.
        c.save();
        c.translate(-7, 0);
        line(
            [
                [25.5, 36.5],
                [20, 37.5],
                [17.6, 40],
                [19, 42],
            ],
            white.shade,
            1.1,
        );
        line(
            [
                [25.4, 36.4],
                [20.1, 37.1],
                [18.1, 39.8],
            ],
            white.light,
            0.4,
        );
        polygon(
            [
                [17, 36.5],
                [21.3, 37.4],
                [22.7, 43],
                [16.5, 43],
            ],
            gradient(17, 37, 23, 43, [white.light, white.shade, white.deep]),
        );
        box(16.3, 41.9, 6.5, 1.4, '#0a2635', 0.35);
        box(16.6, 42, 5.9, 0.5, white.base, 0.2);
        // A solid throat opens into a flared metal bell at the source torch
        // position (y=56), so the flame leaves an actual visible aperture.
        polygon(
            [
                [17.4, 43.2],
                [21.8, 43.2],
                [21.4, 47.5],
                [23.2, 54.9],
                [22.8, 55.8],
                [16.4, 55.8],
                [16, 54.9],
                [17.8, 47.5],
            ],
            gradient(16, 44, 23.2, 44, [white.shade, white.light, white.base, white.deep]),
        );
        for (const x of [18.2, 19.6, 21]) {
            line(
                [
                    [x, 43.7],
                    [x, 47.5],
                    [x + (x - 19.6) * 0.8, 54.3],
                ],
                '#183d4d',
                0.4,
            );
        }
        line(
            [
                [17.8, 44],
                [17.8, 47.6],
                [16.6, 54.5],
            ],
            white.highlight,
            0.45,
        );
        ellipse(19.6, 55.2, 3.6, 1.1, white.shade);
        ellipse(19.6, 55.35, 2.8, 0.7, '#03121c');
        line(
            [
                [16.3, 55.8],
                [22.9, 55.8],
            ],
            white.light,
            0.45,
        );
        c.restore();
    });

    // Overlapping main armour panels, rather than a single cyan polygon.
    polygon(
        [
            [25.1, 24.2],
            [62.9, 24.2],
            [61.4, 29],
            [44, 33.2],
            [26.6, 29],
        ],
        gradient(25, 24, 62, 30, [cyan.light, cyan.base, cyan.shade]),
    );
    line(
        [
            [25.2, 24.3],
            [62.8, 24.3],
        ],
        white.light,
        0.65,
    );
    for (let x = 28; x <= 60; x += 4) {
        box(x, 25.1, 2, 1.1, cyan.deep, 0.15);
        line(
            [
                [x, 25],
                [x + 2, 25],
            ],
            cyan.highlight,
            0.25,
        );
    }
    mirror(() => {
        polygon(
            [
                [26.4, 29],
                [33.8, 32],
                [36.3, 43.3],
                [42.2, 48],
                [41.8, 58.8],
                [28.3, 48.3],
            ],
            gradient(26, 31, 42, 56, [cyan.light, cyan.base, cyan.shade]),
        );
        polygon(
            [
                [26.4, 29],
                [28.3, 48.3],
                [31.8, 50.5],
                [29.3, 34],
            ],
            cyan.shade,
        );
        line(
            [
                [27.4, 31],
                [29.4, 46.5],
                [40, 54.8],
            ],
            `${cyan.highlight}bb`,
            0.45,
        );
        line(
            [
                [29.8, 42.7],
                [35.2, 46.2],
                [35.4, 49.4],
            ],
            cyan.deep,
            0.55,
        );
        polygon(
            [
                [29.2, 35.2],
                [32, 36.5],
                [32.9, 42.1],
                [30, 40.7],
            ],
            cyan.deep,
        );
        for (let y = 36.5; y < 40.5; y += 1.15)
            line(
                [
                    [30.1, y],
                    [32, y + 0.9],
                ],
                cyan.shade,
                0.45,
            );
        polygon(
            [
                [31.9, 48.2],
                [34.5, 49.8],
                [34.7, 52],
                [32.2, 50.3],
            ],
            white.shade,
        );
        line(
            [
                [32.3, 48.8],
                [34, 49.9],
            ],
            white.light,
            0.35,
        );
        rivet(28.4, 32.3, cyan.light);
        rivet(30, 46, cyan.light);
        rivet(38.8, 53.4, cyan.light);
        line(
            [
                [36.6, 49.8],
                [39.1, 51.6],
            ],
            cyan.light,
            0.55,
        );
        line(
            [
                [36.7, 51],
                [38.3, 52.1],
            ],
            cyan.light,
            0.4,
        );
    });

    // Recessed canopy: side panes and the original narrow central viewport.
    const canopy: Coordinates = [
        [30.7, 29.5],
        [44, 32.4],
        [57.3, 29.5],
        [54.4, 42.5],
        [44, 49],
        [33.6, 42.5],
    ];
    polygon(canopy, cyan.deep);
    line([...canopy, canopy[0]], cyan.highlight, 0.7);
    polygon(
        [
            [32.4, 31.4],
            [40.7, 34],
            [40.8, 43.8],
            [35.1, 40.8],
        ],
        gradient(33, 31, 41, 43, ['#225e70', '#082c40', '#031b2e']),
    );
    polygon(
        [
            [55.6, 31.4],
            [47.3, 34],
            [47.2, 43.8],
            [52.9, 40.8],
        ],
        gradient(48, 33, 55, 43, ['#16465d', '#031b2e']),
    );
    c.save();
    path(canopy);
    c.clip();
    polygon(
        [
            [33, 31],
            [35.5, 31.5],
            [43, 46.5],
            [41, 46.1],
        ],
        '#b1f6ee25',
    );
    polygon(
        [
            [49.4, 32],
            [50.7, 31.7],
            [54, 41],
            [53.1, 42],
        ],
        '#a2efff1c',
    );
    c.restore();
    polygon(
        [
            [41.5, 33],
            [46.5, 33],
            [46.4, 45.6],
            [44, 47.5],
            [41.6, 45.6],
        ],
        gradient(41.5, 33, 46.5, 33, [cyan.light, cyan.shade, cyan.base]),
    );
    box(42.2, 34.1, 3.6, 10, '#031b2e', 0.4);
    box(42.6, 34.7, 2.8, 8.5, gradient(42.6, 35, 45, 43, ['#224e63', '#061f33']), 0.3);
    line(
        [
            [42.8, 35.1],
            [43.4, 35.1],
            [43.4, 40],
        ],
        '#90e8ef66',
        0.4,
    );
    line(
        [
            [33.3, 31.8],
            [35.4, 40.7],
            [40.7, 44],
        ],
        '#5ab6c080',
        0.35,
    );
    line(
        [
            [47.3, 44],
            [52.8, 40.7],
            [54.7, 32.3],
        ],
        '#5ab6c066',
        0.35,
    );

    // A narrow centre keel and inset service panel anchor the pointed nose.
    polygon(
        [
            [41.5, 48],
            [44, 49.6],
            [46.5, 48],
            [45.7, 60.2],
            [44, 63],
            [42.3, 60.2],
        ],
        gradient(41.5, 50, 46.5, 50, [cyan.light, cyan.base, cyan.shade]),
    );
    box(43, 51.3, 2, 6.2, cyan.deep, 0.45);
    line(
        [
            [43.6, 52],
            [43.6, 56.4],
        ],
        cyan.base,
        0.45,
    );
    polygon(
        [
            [43.4, 57.7],
            [44.6, 57.7],
            [45.1, 61.7],
            [44, 62.7],
            [42.9, 61.7],
        ],
        cyan.deep,
    );
    line(
        [
            [43.2, 58.4],
            [42.9, 61.4],
        ],
        cyan.light,
        0.4,
    );
    line(
        [
            [44.8, 58.4],
            [45.1, 61.4],
        ],
        cyan.base,
        0.4,
    );
    rivet(44, 50.2, cyan.light);

    // Raised red navigation beacon with a separate socket and glass highlight.
    box(40.3, 21.7, 7.4, 2.5, cyan.deep, 0.6);
    box(41.3, 20.7, 5.4, 2.8, gradient(41, 21, 47, 24, [red.light, red.base, red.shade]), 0.7);
    line(
        [
            [42, 21.2],
            [45.7, 21.2],
        ],
        red.highlight,
        0.4,
    );
    box(43.1, 20, 1.8, 0.7, red.base, 0.2);
    c.restore();
}

// A separate live pass keeps the detailed hull cached while exhaust follows
// the game's visual clock. Equal time and phase always produce the same flame.
export function drawSpacecraftEngines(c: CanvasRenderingContext2D, timeMs: number, phase = 0) {
    const time = timeMs * 0.001,
        outletY = 55.55;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [index, x] of [12.6, 75.4].entries()) {
        const offset = phase + index * 2.17;
        const pulse =
            0.5 + Math.sin(time * 9.7 + offset) * 0.3 + Math.sin(time * 23.3 + offset * 1.9) * 0.2;
        const sway = Math.sin(time * 13.1 + offset) * 0.32 + Math.sin(time * 31.7 + offset) * 0.12;
        const length = 13.8 + pulse * 2.2;

        // One continuous plume per nozzle, attached at its dark metal mouth.
        // The hot white root transitions into gold/orange without a second jet.
        const halo = c.createRadialGradient(x, outletY + 4, 0.5, x, outletY + 4, 7);
        halo.addColorStop(0, '#ffb74624');
        halo.addColorStop(1, '#ff642000');
        c.fillStyle = halo;
        c.beginPath();
        c.ellipse(x, outletY + 5, 5, 8, 0, 0, Math.PI * 2);
        c.fill();
        const fire = c.createLinearGradient(x, outletY, x, outletY + length);
        fire.addColorStop(0, '#fffdf1');
        fire.addColorStop(0.16, '#fff1a8f5');
        fire.addColorStop(0.42, '#ffc34de8');
        fire.addColorStop(0.72, '#ff7029bb');
        fire.addColorStop(1, '#ff392000');
        c.fillStyle = fire;
        c.beginPath();
        c.moveTo(x - 2.2, outletY);
        c.bezierCurveTo(
            x - 2.5,
            outletY + 3,
            x - 3 + sway,
            outletY + 5,
            x - 1.8 + sway,
            outletY + 8,
        );
        c.bezierCurveTo(
            x - 0.8 + sway,
            outletY + 11,
            x + sway * 2 - 0.4,
            outletY + length - 1,
            x + sway * 2,
            outletY + length,
        );
        c.bezierCurveTo(
            x + sway * 2 + 0.8,
            outletY + length - 2,
            x + 2.4 + sway,
            outletY + 7,
            x + 2.4,
            outletY + 4,
        );
        c.bezierCurveTo(x + 2.7, outletY + 2.5, x + 2.2, outletY + 1, x + 2.2, outletY);
        c.closePath();
        c.fill();

        const core = c.createLinearGradient(x, outletY, x, outletY + length * 0.75);
        core.addColorStop(0, '#ffffff');
        core.addColorStop(0.28, '#fff9d6');
        core.addColorStop(0.7, '#ffe7a0bd');
        core.addColorStop(1, '#ffc44400');
        c.fillStyle = core;
        c.beginPath();
        c.moveTo(x - 1.2, outletY);
        c.bezierCurveTo(
            x - 1.4,
            outletY + 3,
            x - 0.6 + sway,
            outletY + 7,
            x + sway,
            outletY + length * 0.75,
        );
        c.bezierCurveTo(x + 0.7 + sway, outletY + 7, x + 1.4, outletY + 3, x + 1.2, outletY);
        c.closePath();
        c.fill();

        // Combustion is visible inside the nozzle, with a warm rim reflection.
        c.save();
        c.beginPath();
        c.ellipse(x, 55.35, 2.65, 0.65, 0, 0, Math.PI * 2);
        c.clip();
        const chamber = c.createRadialGradient(x, 55.4, 0, x, 55.4, 2.8);
        chamber.addColorStop(0, '#fffdf2');
        chamber.addColorStop(0.5, '#ffe7a3');
        chamber.addColorStop(1, '#a64d21');
        c.fillStyle = chamber;
        c.fillRect(x - 2.8, 54.65, 5.6, 1.5);
        c.restore();
        c.strokeStyle = `rgba(255, 206, 128, ${0.35 + pulse * 0.25})`;
        c.lineWidth = 0.3;
        c.beginPath();
        c.ellipse(x, 55.5, 2.9, 0.75, 0, 0.08, Math.PI - 0.08);
        c.stroke();
    }
    c.restore();
}
