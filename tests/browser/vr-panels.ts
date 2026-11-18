import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { serveReferenceModules } from './reference-mode.ts';

export async function checkVrPanels(browser: Browser, name: string) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await serveReferenceModules(page);
    await page.route('http://127.0.0.1:8091/', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body></body></html>',
        }),
    );
    try {
        await page.goto('http://127.0.0.1:8091/');
        const result = await page.evaluate(async () => {
            if (!document.createElement('canvas').getContext('webgl2')) return null;
            const { createVrView } = (await import(
                new URL('./games/vr/view/index.js', document.baseURI).href
            )) as typeof import('../../src/games/vr/view/index.ts');
            const canvas = document.createElement('canvas');
            document.body.append(canvas);
            const view = createVrView(canvas);
            const rows: {
                title: string;
                errors: number[];
                expected: string[];
                picked: (string | undefined)[];
                backing: number[];
                highlights: { changed: boolean; cleared: boolean; cached: boolean }[];
            }[] = [];
            try {
                view.renderer.setSize(800, 600, false);
                view.camera.aspect = 4 / 3;
                view.camera.updateProjectionMatrix();
                const menus = [
                    { title: 'Title', lines: ['Welcome'], count: 1 },
                    {
                        title: 'Scores',
                        lines: [
                            '1. A 900',
                            '2. B 800',
                            '3. C 700',
                            '4. D 600',
                            '5. E 500',
                            '6. F 400',
                        ],
                        count: 1,
                    },
                    { title: 'Pause', lines: ['Mission paused', 'Choose an action'], count: 6 },
                    { title: 'Title again', lines: ['Welcome'], count: 1 },
                ];
                for (const entry of menus) {
                    const actions = Array.from({ length: entry.count }, (_, index) => ({
                        id: `${entry.title}-${index}`,
                        label: `Action ${index + 1}`,
                    }));
                    view.panel(entry.title, entry.lines, actions);
                    const menu = view.rig.getObjectByName('menu-panel') as Mesh<
                        BufferGeometry,
                        MeshBasicMaterial
                    >;
                    view.camera.lookAt(menu.getWorldPosition(view.camera.position.clone()));
                    view.renderer.render(view.scene, view.camera);
                    const gl = view.renderer.getContext();
                    const glErrors: number[] = [];
                    for (let attempt = 0; attempt < 8; attempt++) {
                        const error = gl.getError();
                        if (error === gl.NO_ERROR) break;
                        glErrors.push(error);
                    }
                    const image = menu.material.map!.image as HTMLCanvasElement;
                    const context = image.getContext('2d')!;
                    const data = context.getImageData(200, 0, 1, image.height).data;
                    // Detect the actual blue action rectangles in the displayed
                    // texture instead of duplicating the panel's layout math.
                    const centers: number[] = [];
                    let start = -1;
                    for (let y = 0; y <= image.height; y++) {
                        const button =
                            y < image.height &&
                            data[y * 4] === 29 &&
                            data[y * 4 + 1] === 64 &&
                            data[y * 4 + 2] === 87;
                        if (button && start < 0) start = y;
                        if (!button && start >= 0) {
                            if (y - start >= 3) centers.push((start + y) / 2);
                            start = -1;
                        }
                    }
                    const picked = centers.map((y) => {
                        const origin = view.camera.position.clone();
                        const target = menu.localToWorld(
                            origin.clone().set(0, (0.5 - y / image.height) * 120, 0),
                        );
                        return view.pick(origin, target.sub(origin).normalize());
                    });
                    const pixel = (y: number) =>
                        Array.from(context.getImageData(200, Math.floor(y), 1, 1).data).join(',');
                    const normal = centers.map(pixel);
                    const highlights = actions.map((action, index) => {
                        view.hover([action.id]);
                        view.renderer.render(view.scene, view.camera);
                        const error = gl.getError();
                        if (error !== gl.NO_ERROR) glErrors.push(error);
                        const changed = centers.every((y, row) =>
                            row === index ? pixel(y) !== normal[row] : pixel(y) === normal[row],
                        );
                        const version = menu.material.map!.version;
                        view.hover([action.id]);
                        const cached = menu.material.map!.version === version;
                        view.hover([]);
                        const cleared = centers.every((y, row) => pixel(y) === normal[row]);
                        return { changed, cleared, cached };
                    });
                    rows.push({
                        title: entry.title,
                        errors: glErrors,
                        expected: actions.map((action) => action.id),
                        picked,
                        backing: [image.width, image.height],
                        highlights,
                    });
                }
                return rows;
            } finally {
                view.destroy();
            }
        });
        if (result === null) {
            console.log(`SKIP: ${name} VR panel uploads: WebGL 2 unavailable.`);
            return;
        }
        for (const row of result) {
            assert.deepEqual(row.errors, [], `${name}: ${row.title} uploads without WebGL errors`);
            assert.deepEqual(
                row.picked,
                row.expected,
                `${name}: every visible ${row.title} action row picks its own ID`,
            );
            assert.ok(
                row.highlights.length === row.expected.length &&
                    row.highlights.every(
                        ({ changed, cleared, cached }) => changed && cleared && cached,
                    ),
                `${name}: ${row.title} highlights only hovered rows, clears on miss and skips unchanged texture uploads`,
            );
        }
        assert.ok(
            result.every(
                (row) =>
                    row.backing[0] === result[0].backing[0] &&
                    row.backing[1] === result[0].backing[1],
            ),
            'GPU texture dimensions stay fixed across differently sized menus',
        );
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} VR title→scores→pause→title texture uploads and visible action picking.`,
        );
    } finally {
        await page.close();
    }
}
