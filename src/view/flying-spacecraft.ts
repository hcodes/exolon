import type { Palette } from '../types/graphics.ts';
type Coordinates = readonly (readonly [number, number])[];
type Paint = CanvasRenderingContext2D['fillStyle'];
// Modern mechanical interpretations of the original 16x16 ship families.
// Their open crescent / segmented barrel silhouettes follow source bases 1/20.
const TAU = Math.PI * 2;

function polygon(c: CanvasRenderingContext2D, points: Coordinates, fill: Paint) {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = fill;
    c.fill();
}

function line(c: CanvasRenderingContext2D, points: Coordinates, stroke: Paint, width = 0.35) {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.stroke();
}

function gradient(
    c: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colors: readonly string[],
) {
    const fill = c.createLinearGradient(x0, y0, x1, y1);
    colors.forEach((color, i) => fill.addColorStop(i / (colors.length - 1), color));
    return fill;
}

function ellipse(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    fill: Paint,
) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, TAU);
    c.fillStyle = fill;
    c.fill();
}

function crescent(c: CanvasRenderingContext2D, p: Palette, frame: number) {
    // The right half stays open: the original is a C-shaped shield craft.
    c.beginPath();
    c.moveTo(2.4, -7.2);
    c.bezierCurveTo(-3.5, -8.2, -7.5, -4.9, -7.5, 0);
    c.bezierCurveTo(-7.5, 4.9, -3.3, 8, 2.8, 7.1);
    c.lineTo(1.2, 5.2);
    c.lineTo(-0.4, 5.2);
    c.lineTo(-1.2, 3.8);
    c.bezierCurveTo(-3.3, 1.9, -3.3, -1.8, -1.1, -3.8);
    c.lineTo(-0.4, -5.2);
    c.lineTo(1.2, -5.2);
    c.closePath();
    c.fillStyle = gradient(c, -6, -5, 2, 7, [p.light, p.base, p.shade]);
    c.fill();

    // Recessed inner rim and separate upper / lower cheek armour.
    line(
        c,
        [
            [0.6, -5.7],
            [-1.4, -4.9],
            [-3.5, -2.7],
            [-4, 0],
            [-3.3, 2.8],
            [-1.3, 4.9],
            [0.9, 5.7],
        ],
        p.deep,
        0.75,
    );
    polygon(
        c,
        [
            [-5.9, -3.7],
            [-3.6, -6.1],
            [-0.7, -6.5],
            [-1.4, -5.2],
            [-3.9, -3.2],
        ],
        p.light,
    );
    polygon(
        c,
        [
            [-6.6, 1.2],
            [-5, 4.8],
            [-2.4, 6.4],
            [1.6, 6.6],
            [0.8, 5.7],
            [-2.4, 5.2],
            [-4.8, 2.8],
        ],
        p.shade,
    );
    line(
        c,
        [
            [-6.1, -3.3],
            [-6.8, -0.3],
            [-6.4, 2.1],
        ],
        p.highlight,
        0.45,
    );
    line(
        c,
        [
            [-5.3, -4.8],
            [-3.9, -4.4],
            [-3.5, -3.7],
        ],
        p.deep,
        0.35,
    );
    line(
        c,
        [
            [-5.8, 3.4],
            [-4.1, 2.9],
            [-3.6, 3.4],
        ],
        p.deep,
        0.35,
    );

    // An inset forward sensor and small cooling slots sit inside the solid bow.
    polygon(
        c,
        [
            [-6.1, -1.6],
            [-5, -2.1],
            [-4.6, -1.2],
            [-4.7, 1.7],
            [-5.8, 1.3],
        ],
        p.deep,
    );
    line(
        c,
        [
            [-5.6, -1.1],
            [-5.4, 0.8],
        ],
        p.highlight,
        0.4,
    );
    for (const y of [-3.2, 2.4, 3.3])
        line(
            c,
            [
                [-4.8, y],
                [-3.8, y + 0.2],
            ],
            p.deep,
            0.3,
        );

    // Broken field-emitter plates echo the flickering source perimeter dots.
    const phase = frame & 3;
    const segments = [
        [-1.23, -0.98],
        [-0.7, -0.48],
        [-0.14, 0.08],
        [0.43, 0.64],
        [0.98, 1.2],
    ];
    for (let i = 0; i < segments.length; i++) {
        if ((i + phase) % 4 === 2) continue;
        const offset = (((phase + i) % 3) - 1) * 0.04;
        const [start, end] = segments[i];
        c.beginPath();
        c.arc(-0.5, 0, 7.2, start + offset, end + offset);
        c.strokeStyle = (i + phase) % 3 ? p.base : p.highlight;
        c.lineWidth = 0.65;
        c.stroke();
    }
    ellipse(c, 4.4 + (phase & 1) * 0.7, phase < 2 ? -2.5 : 2.2, 0.32, 0.32, p.highlight);
    line(
        c,
        [
            [-0.6, -7.1],
            [1.4, -7.1],
        ],
        p.highlight,
        0.4,
    );
    line(
        c,
        [
            [-0.6, 7],
            [1.6, 7],
        ],
        p.light,
        0.35,
    );
}

function barrel(c: CanvasRenderingContext2D, p: Palette, frame: number) {
    // A left-facing stepped nose, separated ring sections and a broad rear shell.
    polygon(
        c,
        [
            [-7.6, -0.8],
            [-6.6, -1.6],
            [-5.5, -1.6],
            [-5.5, 1.6],
            [-6.6, 1.6],
            [-7.6, 0.8],
        ],
        gradient(c, 0, -1.6, 0, 1.6, [p.light, p.base, p.shade]),
    );
    polygon(
        c,
        [
            [-5.7, -2.6],
            [-4.5, -3.2],
            [-3.7, -2.5],
            [-3.7, 2.5],
            [-4.5, 3.2],
            [-5.7, 2.6],
        ],
        gradient(c, -5.7, 0, -3.7, 0, [p.light, p.base, p.shade]),
    );
    polygon(
        c,
        [
            [-2.9, -3.6],
            [-1.8, -4.1],
            [-0.4, -3.6],
            [-0.4, 3.6],
            [-1.8, 4.1],
            [-2.9, 3.6],
        ],
        gradient(c, -2.9, 0, -0.4, 0, [p.light, p.base, p.shade]),
    );
    line(
        c,
        [
            [-5.1, -2.1],
            [-5.1, 2.1],
        ],
        p.highlight,
        0.3,
    );
    line(
        c,
        [
            [-2.2, -3],
            [-2.2, 3],
        ],
        p.highlight,
        0.35,
    );
    line(
        c,
        [
            [-4.3, -1.3],
            [-4.3, 1.3],
        ],
        p.deep,
        0.35,
    );

    // Outer struts bridge over the dark gaps, keeping the characteristic rings.
    polygon(
        c,
        [
            [-5.5, -6.2],
            [-2.9, -6.2],
            [-2.4, -5.1],
            [-5.5, -5.1],
        ],
        p.base,
    );
    polygon(
        c,
        [
            [-1.4, -5.6],
            [0.3, -5.6],
            [0.9, -4.4],
            [-1.4, -4.4],
        ],
        p.light,
    );
    polygon(
        c,
        [
            [-5.5, 5.1],
            [-2.4, 5.1],
            [-2.9, 6.2],
            [-5.5, 6.2],
        ],
        p.shade,
    );
    polygon(
        c,
        [
            [-1.4, 4.4],
            [0.9, 4.4],
            [0.3, 5.6],
            [-1.4, 5.6],
        ],
        p.base,
    );
    line(
        c,
        [
            [-5.1, -5.8],
            [-3.3, -5.8],
        ],
        p.highlight,
        0.3,
    );

    c.beginPath();
    c.moveTo(1, -5.5);
    c.lineTo(4.1, -5.5);
    c.bezierCurveTo(6.6, -4.8, 7.3, -2.2, 7.3, 0);
    c.bezierCurveTo(7.3, 2.3, 6.4, 4.8, 4.1, 5.5);
    c.lineTo(1, 5.5);
    c.closePath();
    c.fillStyle = gradient(c, 1, -5.5, 6.8, 5.5, [p.light, p.base, p.shade]);
    c.fill();
    polygon(
        c,
        [
            [1.4, -4.7],
            [3.8, -4.7],
            [5.2, -3.2],
            [1.4, -3.2],
        ],
        p.light,
    );
    polygon(
        c,
        [
            [1.4, 3.1],
            [5.7, 2.9],
            [4.1, 5],
            [1.4, 5],
        ],
        p.shade,
    );
    line(
        c,
        [
            [1.7, -2.7],
            [5.5, -2.7],
            [6.2, -1.4],
        ],
        p.deep,
        0.35,
    );
    line(
        c,
        [
            [1.7, 2.8],
            [5.4, 2.8],
        ],
        p.deep,
        0.35,
    );
    line(
        c,
        [
            [1.5, -4.2],
            [1.5, 4.2],
        ],
        p.highlight,
        0.4,
    );

    // Framed sensor aperture, cooling ribs and the source's notched rear rim.
    polygon(
        c,
        [
            [2.1, -1.8],
            [4.7, -1.8],
            [5.4, -0.8],
            [5.4, 1],
            [2.1, 1],
        ],
        p.deep,
    );
    polygon(
        c,
        [
            [2.5, -1.3],
            [4.5, -1.3],
            [4.9, -0.7],
            [2.5, -0.3],
        ],
        p.highlight,
    );
    for (const y of [-3.9, -2.6, 1.7, 3]) {
        line(
            c,
            [
                [5.7, y],
                [6.5, y + 0.15],
            ],
            p.deep,
            0.5,
        );
    }
    for (const y of [-3.5, -1.2, 1.2, 3.5]) {
        polygon(
            c,
            [
                [6.1, y - 0.45],
                [7.5, y - 0.45],
                [7.5, y + 0.45],
                [6.5, y + 0.45],
            ],
            p.deep,
        );
        line(
            c,
            [
                [6.7, y - 0.2],
                [7.4, y - 0.2],
            ],
            p.light,
            0.25,
        );
    }
    const phase = frame & 3;
    for (const [i, y] of [-6.9, 6.9].entries()) {
        const x = [-6.7, -5.7, -6.1, -6.9][(phase + i) & 3];
        line(
            c,
            [
                [x, y],
                [x + 0.55, y],
            ],
            p.highlight,
            0.5,
        );
    }
    ellipse(c, 0.25, phase & 1 ? -6 : 6, 0.35, 0.25, p.light);
}

/** Draw at the 16x16 source sprite centre. Returns false for other families. */
export function drawFlyingSpacecraft(
    c: CanvasRenderingContext2D,
    sprite: number,
    palette: Palette,
    frame = 0,
) {
    if (sprite !== 1 && sprite !== 20) return false;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.rect(-8, -8, 16, 16);
    c.clip();
    if (sprite === 1) crescent(c, palette, frame);
    else barrel(c, palette, frame);
    c.restore();
    return true;
}
