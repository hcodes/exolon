// Trace only the exposed edges of the recovered 8 by 8 Spectrum ink mask.
// Screen coordinates point down: keeping ink to the right gives clockwise
// outer boundaries and counterclockwise holes for Canvas's nonzero fill rule.
export function traceContours(bitmap) {
    const edges = [];
    const outgoing = new Map();
    const solid = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8 && Boolean(bitmap[y] & (128 >> x));
    const add = (x, y, nextX, nextY, direction) => {
        const start = y * 9 + x;
        const edge = { start, end: nextY * 9 + nextX, direction, visited: false };
        edges.push(edge);
        if (!outgoing.has(start)) outgoing.set(start, []);
        outgoing.get(start).push(edge);
    };
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (!solid(x, y)) continue;
            if (!solid(x, y - 1)) add(x, y, x + 1, y, 0);
            if (!solid(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
            if (!solid(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
            if (!solid(x - 1, y)) add(x, y + 1, x, y, 3);
        }
    }
    const loops = [];
    for (const first of edges) {
        if (first.visited) continue;
        const walk = [first.start];
        let edge = first;
        do {
            edge.visited = true;
            walk.push(edge.end);
            // At a diagonal touch, turn right to keep 4-neighbour ink
            // components separate instead of crossing through the corner.
            const candidates = outgoing.get(edge.end);
            const nextDirection = [1, 0, 3, 2].map((turn) => (edge.direction + turn) % 4);
            const next = nextDirection
                .map((direction) =>
                    candidates.find((candidate) => candidate.direction === direction),
                )
                .find(Boolean);
            if (!next || (next.visited && next !== first))
                throw new Error('Invalid source contour boundary');
            edge = next;
        } while (edge !== first);
        // A connected region can surround a hole touching the exterior at one
        // corner. Split repeated vertices into simple loops, retaining their
        // orientation rather than producing a self-touching polygon.
        const path = [];
        const positions = new Map();
        for (const vertex of walk) {
            const previous = positions.get(vertex);
            if (previous === undefined) {
                positions.set(vertex, path.length);
                path.push(vertex);
                continue;
            }
            const loop = path.slice(previous).map((point) => [point % 9, Math.floor(point / 9)]);
            const corners = loop.filter((point, index) => {
                const before = loop[(index + loop.length - 1) % loop.length];
                const after = loop[(index + 1) % loop.length];
                return !(
                    (before[0] === point[0] && point[0] === after[0]) ||
                    (before[1] === point[1] && point[1] === after[1])
                );
            });
            loops.push([...corners, corners[0]]);
            for (const removed of path.splice(previous + 1)) positions.delete(removed);
        }
    }
    return loops;
}
