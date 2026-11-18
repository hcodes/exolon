import type { HeroPose, Point } from '../types/graphics.ts';
type Paint = CanvasRenderingContext2D['fillStyle'];
type HeroLeg = HeroPose['legs'][number];
// Original Canvas artwork, proportioned after Exolon's human pressure suit.
// Joint positions come from the gait solver; no animation state lives here.
const TAU = Math.PI * 2;
const INK = '#1a2731';

function shape(
    c: CanvasRenderingContext2D,
    fill: Paint,
    draw: () => void,
    stroke: string | null = INK,
    width = 0.4,
) {
    c.beginPath();
    draw();
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
        c.strokeStyle = stroke;
        c.lineWidth = width;
        c.stroke();
    }
}

function ellipse(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    fill: Paint,
    rotation = 0,
) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, rotation, 0, TAU);
    c.fillStyle = fill;
    c.fill();
}

function seam(c: CanvasRenderingContext2D, color: Paint, width: number, draw: () => void) {
    c.beginPath();
    draw();
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
}

function fabric(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    x1: number,
    y1: number,
    far = false,
) {
    const gradient = c.createLinearGradient(x, y, x1, y1);
    gradient.addColorStop(0, far ? '#c0b9a6' : '#fff0cd');
    gradient.addColorStop(0.45, far ? '#a9ad9e' : '#ded8bf');
    gradient.addColorStop(1, far ? '#718387' : '#98a6a1');
    return gradient;
}

function normal(a: Point, b: Point) {
    const distance = Math.max(0.01, Math.hypot(b.x - a.x, b.y - a.y));
    return { x: -(b.y - a.y) / distance, y: (b.x - a.x) / distance };
}

// A single soft contour spans thigh and calf so the knee bends inside a suit,
// rather than looking like two rigid rods connected by a mechanical hinge.
function drawLeg(c: CanvasRenderingContext2D, leg: HeroLeg, armored: boolean) {
    const { hip: h, knee: k, ankle: a, far } = leg;
    const thigh = normal(h, k);
    const calf = normal(k, a);
    const knee = { x: (thigh.x + calf.x) / 2, y: (thigh.y + calf.y) / 2 };
    const hipWidth = 1.45;
    const kneeWidth = 1.16;
    const ankleWidth = 0.87;
    const outer = (point: Point, direction: Point, width: number): [number, number] => [
        point.x + direction.x * width,
        point.y + direction.y * width,
    ];
    const inner = (point: Point, direction: Point, width: number): [number, number] => [
        point.x - direction.x * width,
        point.y - direction.y * width,
    ];
    shape(c, fabric(c, h.x - 1.5, h.y, a.x + 2, a.y, far), () => {
        c.moveTo(...outer(h, thigh, hipWidth));
        c.quadraticCurveTo(
            h.x + thigh.x * 1.95 + (k.x - h.x) * 0.55,
            h.y + thigh.y * 1.95 + (k.y - h.y) * 0.55,
            ...outer(k, knee, kneeWidth),
        );
        c.quadraticCurveTo(
            k.x + calf.x * 1.5 + (a.x - k.x) * 0.48,
            k.y + calf.y * 1.5 + (a.y - k.y) * 0.48,
            ...outer(a, calf, ankleWidth),
        );
        c.quadraticCurveTo(a.x, a.y + 0.6, ...inner(a, calf, ankleWidth));
        c.quadraticCurveTo(
            k.x - calf.x * 1.02 + (a.x - k.x) * 0.48,
            k.y - calf.y * 1.02 + (a.y - k.y) * 0.48,
            ...inner(k, knee, kneeWidth),
        );
        c.quadraticCurveTo(
            h.x - thigh.x * 1.55 + (k.x - h.x) * 0.45,
            h.y - thigh.y * 1.55 + (k.y - h.y) * 0.45,
            ...inner(h, thigh, hipWidth),
        );
        c.quadraticCurveTo(h.x, h.y - 1.1, ...outer(h, thigh, hipWidth));
    });
    // The shaded fabric gathers on the inside of a bent knee.
    seam(c, far ? '#52676b' : '#657773', 0.4, () => {
        c.moveTo(k.x - 0.8, k.y - 0.7);
        c.quadraticCurveTo(k.x + 0.15, k.y - 0.2, k.x + 0.85, k.y - 0.55);
        c.moveTo(k.x - 0.62, k.y + 0.25);
        c.quadraticCurveTo(k.x + 0.1, k.y + 0.6, k.x + 0.7, k.y + 0.25);
    });
    seam(c, far ? '#d0cbb5' : '#fff5d9', 0.38, () => {
        c.moveTo(h.x + thigh.x * 0.8, h.y + 0.5);
        c.quadraticCurveTo(
            (h.x + k.x) / 2 + thigh.x,
            (h.y + k.y) / 2,
            k.x + knee.x * 0.65,
            k.y - 0.9,
        );
        c.moveTo(k.x + calf.x * 0.7, k.y + 1.3);
        c.quadraticCurveTo(
            (k.x + a.x) / 2 + calf.x * 0.8,
            (k.y + a.y) / 2,
            a.x + calf.x * 0.5,
            a.y - 1,
        );
    });
    if (armored) {
        ellipse(c, k.x + 0.2, k.y, 1.25, 1.55, far ? '#6e8585' : '#b7c3b4', -0.2);
        seam(c, '#e0e5cb', 0.35, () => {
            c.moveTo(k.x - 0.55, k.y - 0.7);
            c.quadraticCurveTo(k.x + 0.25, k.y - 1, k.x + 0.8, k.y - 0.4);
        });
    }
    drawBoot(c, a, leg.footAngle, far);
}

function drawBoot(c: CanvasRenderingContext2D, ankle: Point, angle: number, far: boolean) {
    c.save();
    c.translate(ankle.x, ankle.y);
    c.rotate(angle);
    shape(c, far ? '#6c7d7e' : '#c4ccba', () => {
        c.moveTo(-1.1, -1.3);
        c.quadraticCurveTo(-0.1, -0.9, 0.85, -1.25);
        c.lineTo(1.05, -0.3);
        c.quadraticCurveTo(1.7, 0.3, 2.5, 0.35);
        c.quadraticCurveTo(3.1, 0.55, 3.05, 1.35);
        c.quadraticCurveTo(2.5, 1.8, 0.5, 1.8);
        c.lineTo(-1.9, 1.65);
        c.quadraticCurveTo(-2.2, 0.6, -1.55, -0.15);
        c.closePath();
    });
    seam(c, '#334a52', 0.55, () => {
        c.moveTo(-1.8, 1.4);
        c.quadraticCurveTo(0.8, 1.8, 2.75, 1.3);
    });
    seam(c, far ? '#b1b8a5' : '#f5ecd1', 0.4, () => {
        c.moveTo(-0.7, -0.3);
        c.quadraticCurveTo(0.7, 0.15, 1.5, 0.65);
    });
    c.restore();
}

function drawBackpack(c: CanvasRenderingContext2D, armored: boolean) {
    seam(c, '#abb6a9', 0.55, () => {
        c.moveTo(-4.6, -5.8);
        c.quadraticCurveTo(-5.5, -10.9, -3.8, -14.6);
    });
    ellipse(c, -3.8, -14.6, 0.4, 0.4, '#efe2be');
    shape(c, fabric(c, -6.5, -5, -2.5, -4), () => {
        c.moveTo(-3.75, -8.1);
        c.quadraticCurveTo(-5.4, -8.55, -6.15, -6.7);
        c.quadraticCurveTo(-6.75, -4, -6.3, -0.15);
        c.quadraticCurveTo(-5.8, 1.8, -3.7, 1.1);
        c.lineTo(-2.9, -0.1);
        c.lineTo(-2.95, -6.7);
        c.quadraticCurveTo(-3.1, -7.6, -3.75, -8.1);
    });
    seam(c, '#647978', 0.5, () => {
        c.moveTo(-5.25, -6.1);
        c.quadraticCurveTo(-5.65, -3.8, -5.2, -0.5);
    });
    seam(c, armored ? '#e99c69' : '#d4caae', 0.6, () => {
        c.moveTo(-6.15, -3.1);
        c.quadraticCurveTo(-4.8, -2.5, -3.6, -2.95);
    });
    // A recessed bell follows the pack's curve without enlarging its silhouette.
    shape(
        c,
        '#6d8180',
        () => {
            c.moveTo(-5.8, 0.55);
            c.quadraticCurveTo(-5.1, 0.85, -4.35, 0.65);
            c.lineTo(-4.65, 1.7);
            c.quadraticCurveTo(-5.4, 1.9, -6, 1.4);
        },
        '#344b52',
        0.3,
    );
    seam(c, '#222f39', 0.6, () => {
        c.moveTo(-5.8, 1.45);
        c.quadraticCurveTo(-5.2, 1.7, -4.7, 1.55);
    });
}

// This modern exhaust is purely visual; the model decides when thrust is active.
function drawExhaust(c: CanvasRenderingContext2D, thrust: number, timeMs: number) {
    const amount = Math.max(0, Math.min(1, thrust));
    if (!(amount > 0)) return;
    const pulse = Math.sin(timeMs * 0.035);
    const flicker = Math.sin(timeMs * 0.057 + 1.4);
    const length = 9.7 + pulse * 0.6 + flicker * 0.35;
    const tail = flicker * 0.35;
    c.save();
    c.translate(-5.3, 1.5);
    c.rotate(0.25);
    c.scale(0.75 + amount * 0.25, 0.3 + amount * 0.7);
    c.globalAlpha *= amount;
    const halo = c.createRadialGradient(0, 2.8, 0.3, 0, 2.8, 4.8);
    halo.addColorStop(0, '#ffdd7c65');
    halo.addColorStop(0.45, '#ff82312b');
    halo.addColorStop(1, '#ff682000');
    ellipse(c, 0, 3.3, 3.4, 5.8, halo);
    const fire = c.createLinearGradient(0, 0, tail, length);
    fire.addColorStop(0, '#fff4b5');
    fire.addColorStop(0.2, '#ffd867');
    fire.addColorStop(0.55, '#ff8b32');
    fire.addColorStop(1, '#e8532c');
    shape(
        c,
        fire,
        () => {
            c.moveTo(-0.68, -0.1);
            c.bezierCurveTo(-1.7, 1.9, -1.6, 3.9, -0.85, 5.5);
            c.quadraticCurveTo(-1.1 - pulse * 0.13, 7, tail, length);
            c.quadraticCurveTo(0.1 + tail, 7, 0.85, 6.1);
            c.bezierCurveTo(0.4, 4.5, 1.8, 2.7, 0.65, -0.1);
        },
        null,
    );
    shape(
        c,
        '#ffe6a0',
        () => {
            c.moveTo(-0.48, 0);
            c.bezierCurveTo(-1.05, 1.9, -0.85, 3.7, -0.3, 4.5);
            c.quadraticCurveTo(-0.45, 5.1, 0.12 + tail * 0.4, length * 0.7);
            c.quadraticCurveTo(0.2, 4.4, 0.65, 3.3);
            c.quadraticCurveTo(0.9, 1.5, 0.43, 0);
        },
        null,
    );
    shape(
        c,
        '#fffbea',
        () => {
            c.moveTo(-0.35, -0.1);
            c.quadraticCurveTo(-0.65, 1.6, -0.1, 2.8);
            c.lineTo(0.05, 4.6 + pulse * 0.3);
            c.quadraticCurveTo(0.7, 1.8, 0.3, -0.1);
        },
        null,
    );
    c.restore();
}

function drawTorso(c: CanvasRenderingContext2D, armored: boolean) {
    shape(c, fabric(c, -3.5, -5, 3.6, -2), () => {
        c.moveTo(-2.2, -6.5);
        c.quadraticCurveTo(-3.6, -6.1, -3.65, -4.4);
        c.quadraticCurveTo(-3.8, -1, -2.6, 1.3);
        c.quadraticCurveTo(-3.4, 2.4, -2.9, 3.7);
        c.quadraticCurveTo(-0.1, 5, 2.8, 3.7);
        c.lineTo(2.45, 1.25);
        c.quadraticCurveTo(3.05, -1.6, 2.95, -4.3);
        c.quadraticCurveTo(2.4, -5.8, 0.85, -6.35);
        c.quadraticCurveTo(-0.5, -7, -2.2, -6.5);
    });
    // A ribbed waist and overlapping folds read as a flexible pressure suit.
    shape(
        c,
        '#546968',
        () => {
            c.moveTo(-2.7, 1.4);
            c.quadraticCurveTo(0.1, 2.1, 2.5, 1.35);
            c.lineTo(2.65, 2.65);
            c.quadraticCurveTo(0.1, 3.4, -2.9, 2.6);
        },
        null,
    );
    seam(c, '#c1c4ad', 0.35, () => {
        c.moveTo(-2.5, 1.9);
        c.quadraticCurveTo(0.1, 2.6, 2.35, 1.9);
        c.moveTo(-2.6, 2.5);
        c.quadraticCurveTo(0.1, 3, 2.4, 2.5);
    });
    seam(c, '#fff0d0', 0.48, () => {
        c.moveTo(-2.8, -4.9);
        c.quadraticCurveTo(-3.3, -2.4, -2.1, -0.8);
        c.moveTo(-2.15, 0.6);
        c.quadraticCurveTo(-0.3, 0.85, 0.8, 0.3);
    });
    seam(c, '#8d9b92', 0.4, () => {
        c.moveTo(-1.8, -4.9);
        c.quadraticCurveTo(-1.3, -2.6, -0.9, -0.8);
    });
    if (armored) {
        shape(c, '#8daba5', () => {
            c.moveTo(-2.2, -5.65);
            c.quadraticCurveTo(0.6, -6.05, 2.4, -4.65);
            c.lineTo(1.8, -1.25);
            c.quadraticCurveTo(-0.5, -0.75, -2.1, -1.7);
        });
        seam(c, '#d0d9bf', 0.55, () => {
            c.moveTo(-1.5, -5);
            c.quadraticCurveTo(0.6, -5.15, 1.75, -4.25);
        });
        seam(c, '#394e55', 0.8, () => {
            c.moveTo(-2.8, -5.8);
            c.quadraticCurveTo(-1.1, -2.6, 1.8, 0.95);
        });
    } else {
        seam(c, '#8a7661', 0.7, () => {
            c.moveTo(-2.5, -6);
            c.quadraticCurveTo(-2, -2.9, -0.6, -0.1);
        });
    }
    ellipse(c, 0.3, -3.9, 0.6, 0.7, '#dc9364');
    seam(c, '#f5d1a1', 0.28, () => {
        c.moveTo(0.1, -4.2);
        c.lineTo(0.55, -4.2);
    });
}

function drawHelmet(c: CanvasRenderingContext2D, armored: boolean, death: boolean) {
    // An open-front C profile is the defining silhouette of the original suit.
    shape(c, fabric(c, -3.6, -12, 3.5, -5.5), () => {
        c.moveTo(4.05, -11.1);
        c.quadraticCurveTo(3.2, -13.15, 0.6, -13.1);
        c.bezierCurveTo(-2.6, -13.2, -3.9, -11.1, -3.65, -8.35);
        c.quadraticCurveTo(-3.4, -5.75, -0.85, -5.25);
        c.quadraticCurveTo(1.7, -4.8, 3.45, -6.3);
        c.lineTo(3.95, -7.5);
        c.quadraticCurveTo(2.5, -6.85, 1.1, -7.4);
        c.quadraticCurveTo(-0.3, -7.8, -0.1, -9.2);
        c.quadraticCurveTo(0.2, -10.9, 2, -10.8);
        c.closePath();
    });
    seam(c, '#fff5db', 0.55, () => {
        c.moveTo(-2.8, -10.3);
        c.quadraticCurveTo(-2.1, -12.65, 0.6, -12.5);
        c.quadraticCurveTo(2.4, -12.4, 3.2, -11.6);
    });
    shape(
        c,
        '#34494c',
        () => {
            c.moveTo(1.15, -10.7);
            c.quadraticCurveTo(-0.5, -10.2, 0.05, -8.35);
            c.quadraticCurveTo(0.6, -7.3, 1.8, -7.4);
            c.lineTo(2.65, -8.6);
            c.lineTo(2.6, -10.7);
        },
        null,
    );
    if (armored) {
        shape(
            c,
            '#203b46',
            () => {
                c.moveTo(0.9, -10.7);
                c.quadraticCurveTo(2.5, -11.15, 3.75, -10.6);
                c.quadraticCurveTo(4.35, -8.9, 3.6, -7.45);
                c.quadraticCurveTo(1.9, -6.95, 0.7, -7.9);
                c.quadraticCurveTo(-0.2, -9.1, 0.9, -10.7);
            },
            '#758e8c',
            0.3,
        );
        seam(c, '#a8c4b5', 0.5, () => {
            c.moveTo(1.2, -10.25);
            c.quadraticCurveTo(2.5, -10.5, 3.25, -10.1);
        });
        seam(c, '#577b80', 0.5, () => {
            c.moveTo(1, -9.6);
            c.lineTo(0.75, -8.55);
        });
    } else {
        shape(
            c,
            '#d6ae87',
            () => {
                c.moveTo(1.65, -10.65);
                c.quadraticCurveTo(2.85, -10.7, 2.85, -9.7);
                c.lineTo(3.45, -9.15);
                c.quadraticCurveTo(3.7, -8.85, 3.1, -8.75);
                c.lineTo(3.05, -8.05);
                c.quadraticCurveTo(2.1, -7.35, 1.35, -8.1);
                c.lineTo(1.2, -9.8);
            },
            null,
        );
        seam(c, '#f0c79a', 0.4, () => {
            c.moveTo(2.35, -10.25);
            c.quadraticCurveTo(2.6, -9.8, 2.5, -9.45);
        });
        seam(c, '#473f3b', 0.28, () => {
            c.moveTo(2.5, death ? -9.55 : -9.65);
            c.lineTo(2.88, death ? -9.55 : -9.7);
        });
    }
    seam(c, '#5e7472', 0.55, () => {
        c.moveTo(-1.95, -6.15);
        c.quadraticCurveTo(0.45, -5.1, 2.55, -6.2);
    });
}

function drawArm(
    c: CanvasRenderingContext2D,
    shoulder: Point,
    elbow: Point,
    hand: Point,
    far: boolean,
) {
    // Cloth sleeves and gloves use rounded joins with a narrow elbow fold.
    seam(c, INK, 3.15, () => {
        c.moveTo(shoulder.x, shoulder.y);
        c.quadraticCurveTo(elbow.x - 0.7, elbow.y - 1.1, elbow.x, elbow.y);
        c.quadraticCurveTo(elbow.x + 1, elbow.y + 0.5, hand.x, hand.y);
    });
    seam(c, far ? '#a3ac9c' : '#ded9bf', 2.45, () => {
        c.moveTo(shoulder.x, shoulder.y);
        c.quadraticCurveTo(elbow.x - 0.7, elbow.y - 1.1, elbow.x, elbow.y);
        c.quadraticCurveTo(elbow.x + 1, elbow.y + 0.5, hand.x, hand.y);
    });
    seam(c, far ? '#c1c4ab' : '#fff0ce', 0.55, () => {
        c.moveTo(shoulder.x - 0.45, shoulder.y - 0.3);
        c.quadraticCurveTo(elbow.x - 0.7, elbow.y - 0.9, elbow.x, elbow.y - 0.65);
        c.quadraticCurveTo(elbow.x + 1.4, elbow.y, hand.x - 0.9, hand.y - 0.5);
    });
    seam(c, '#6e7d74', 0.4, () => {
        c.moveTo(elbow.x - 0.7, elbow.y + 0.15);
        c.quadraticCurveTo(elbow.x, elbow.y - 0.2, elbow.x + 0.45, elbow.y - 0.9);
    });
    ellipse(c, hand.x, hand.y, 0.95, 0.85, far ? '#748982' : '#a9b5a5', -0.2);
}

function drawRaisedArm(
    c: CanvasRenderingContext2D,
    shoulder: Point,
    elbow: Point,
    hand: Point,
    far: boolean,
) {
    const sleeve = () => {
        c.moveTo(shoulder.x, shoulder.y);
        c.quadraticCurveTo(
            shoulder.x + (elbow.x - shoulder.x) * 0.8,
            shoulder.y + (elbow.y - shoulder.y) * 0.2,
            elbow.x,
            elbow.y,
        );
        c.quadraticCurveTo(
            elbow.x + (hand.x - elbow.x) * 0.3,
            elbow.y + (hand.y - elbow.y) * 0.65,
            hand.x,
            hand.y,
        );
    };
    seam(c, INK, 3.15, sleeve);
    seam(c, far ? '#a3ac9c' : '#ded9bf', 2.45, sleeve);
    seam(c, far ? '#c1c4ab' : '#fff0ce', 0.48, () => {
        c.moveTo(shoulder.x - 0.25, shoulder.y - 0.55);
        c.quadraticCurveTo(elbow.x - 0.45, shoulder.y - 1.6, elbow.x - 0.45, elbow.y);
        c.quadraticCurveTo(elbow.x - 0.5, hand.y + 2.1, hand.x - 0.35, hand.y + 0.5);
    });
    seam(c, '#6e7d74', 0.4, () => {
        c.moveTo(elbow.x - 0.65, elbow.y + 0.5);
        c.quadraticCurveTo(elbow.x, elbow.y + 0.2, elbow.x + 0.65, elbow.y + 0.5);
    });
    ellipse(c, hand.x, hand.y, 0.95, 1.1, far ? '#8fa293' : '#c5cbb0', -0.15);
    ellipse(
        c,
        hand.x + (far ? 0.7 : -0.7),
        hand.y + 0.45,
        0.4,
        0.65,
        far ? '#8fa293' : '#c5cbb0',
        -0.3,
    );
    seam(c, far ? '#c1c8ad' : '#eee8cb', 0.35, () => {
        c.moveTo(hand.x - 0.45, hand.y - 0.35);
        c.quadraticCurveTo(hand.x, hand.y - 0.6, hand.x + 0.4, hand.y - 0.35);
    });
}

function drawRifle(c: CanvasRenderingContext2D, armored: boolean) {
    shape(c, '#42595b', () => {
        c.moveTo(1.7, -2.55);
        c.lineTo(7.5, -2.55);
        c.quadraticCurveTo(8, -2.4, 7.9, -1.1);
        c.lineTo(5.3, -1.05);
        c.lineTo(4.8, 0.6);
        c.lineTo(3.7, 0.35);
        c.lineTo(3.8, -1);
        c.lineTo(1.5, -1.2);
    });
    seam(c, '#bfc7ae', 0.7, () => {
        c.moveTo(2.1, -2.45);
        c.lineTo(7.6, -2.45);
    });
    seam(c, '#647e7d', 1.05, () => {
        c.moveTo(7, -2);
        c.lineTo(10.8, -2);
    });
    seam(c, '#d3d8bd', 0.3, () => {
        c.moveTo(7.6, -2.35);
        c.lineTo(10.6, -2.35);
    });
    seam(c, '#263b44', 1.65, () => {
        c.moveTo(10.75, -2.45);
        c.lineTo(10.75, -1.6);
    });
    if (armored) {
        seam(c, '#6a8580', 1, () => {
            c.moveTo(7, -0.15);
            c.lineTo(10.8, -0.15);
        });
        seam(c, '#c5d2b9', 0.3, () => {
            c.moveTo(7.6, -0.45);
            c.lineTo(10.6, -0.45);
        });
        seam(c, '#263b44', 1.45, () => {
            c.moveTo(10.75, -0.55);
            c.lineTo(10.75, 0.25);
        });
    }
}

export function drawAstronaut(
    c: CanvasRenderingContext2D,
    pose: HeroPose,
    { armored = false, death = false, thrust = 0, timeMs = 0 } = {},
) {
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const dying = death || pose.kind === 'death';
    if (!dying && thrust > 0) {
        c.save();
        c.translate(pose.body.x, pose.body.y);
        c.rotate(pose.body.lean);
        drawExhaust(c, thrust, timeMs);
        c.restore();
    }
    const legs = [...pose.legs].sort((a, b) => Number(b.far) - Number(a.far));
    legs.forEach((leg) => drawLeg(c, leg, armored));
    c.translate(pose.body.x, pose.body.y);
    const lean = pose.body.lean;
    const rotatePoint = (x: number, y: number) => ({
        x: x * Math.cos(lean) - y * Math.sin(lean),
        y: x * Math.sin(lean) + y * Math.cos(lean),
    });
    if (dying) {
        drawRaisedArm(
            c,
            rotatePoint(-2.5, -4.9),
            rotatePoint(-6.4, -9.4),
            rotatePoint(-5.9, -15.6),
            true,
        );
    } else {
        const farShoulder = rotatePoint(1.45, -4.7);
        drawArm(c, farShoulder, { x: 3.25, y: -1.9 }, { x: 7, y: -1 }, true);
    }
    c.save();
    c.rotate(lean);
    drawBackpack(c, armored);
    drawTorso(c, armored);
    drawHelmet(c, armored, dying);
    c.restore();
    if (dying) {
        drawRaisedArm(
            c,
            rotatePoint(1.9, -4.8),
            rotatePoint(6.2, -9.2),
            rotatePoint(5.3, -15.4),
            false,
        );
    } else {
        drawRifle(c, armored);
        const shoulder = rotatePoint(-2.4, -4.6);
        drawArm(c, shoulder, { x: -0.8, y: -0.4 }, { x: 4.25, y: -0.05 }, false);
        // Fingers close around the fore-end above the far sleeve.
        seam(c, '#c5cbb0', 0.75, () => {
            c.moveTo(6.5, -0.8);
            c.quadraticCurveTo(7, -1.6, 7.5, -1.3);
        });
    }
    c.restore();
}
