import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as runtime from '../../src/compat/legacy-runtime.ts';
const { legacyColor, legacyKeyboardValue } = runtime;

const bootstrap = ts.transpileModule(
    fs.readFileSync(new URL('../../src/entries/boot.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None } },
).outputText;
interface BootstrapNode {
    href?: string;
    src?: string;
    type?: string;
    noModule?: boolean;
}
function load(modules: boolean, search = '', before = '') {
    const children: BootstrapNode[] = [];
    const context = vm.createContext({
        location: { search },
        fetch() {},
        URL,
        URLSearchParams,
        Element: { prototype: { closest() {}, append() {} } },
        document: {
            head: { appendChild: (node: BootstrapNode) => children.push(node) },
            createElement: (tag: string) =>
                tag === 'script' && modules ? { noModule: false } : {},
        },
    });
    if (before) vm.runInContext(before, context);
    vm.runInContext(bootstrap, context);
    return children;
}
test('old browsers load a classic bundle and its stylesheet without requesting native modules', () => {
    const nodes = load(false);
    assert.equal(nodes[0].href, './legacy/index.css');
    assert.equal(nodes[1].src, './legacy/game.js');
    assert.equal(nodes[1].type, undefined);
});
test('modern browsers keep modules, with a reproducible forced legacy path', () => {
    assert.equal(load(true)[0].type, 'module');
    assert.equal(load(true)[0].src, './runtime/main.js');
    assert.equal(load(true, '?legacy=1')[1].src, './legacy/game.js');
    assert.equal(load(true, '?legacy=10')[0].type, 'module');
});
test('module-capable Safari automatically falls back when syntax or runtime support is too old', () => {
    for (const before of [
        'Function=function(){throw new SyntaxError("old syntax");}',
        'delete Array.prototype.at',
        'delete Object.fromEntries',
    ])
        assert.equal(
            load(true, '', before).some((node) => node.src === './legacy/game.js'),
            true,
            before,
        );
});
test('legacy keyboard events map keyCode to movement, fire, menus, name entry and slider keys', () => {
    for (const [keyCode, code, key] of [
        [37, 'ArrowLeft', 'ArrowLeft'],
        [32, 'Space', ' '],
        [77, 'KeyM', 'm'],
        [13, 'Enter', 'Enter'],
        [27, 'Escape', 'Escape'],
        [9, 'Tab', 'Tab'],
        [36, 'Home', 'Home'],
        [35, 'End', 'End'],
        [34, 'PageDown', 'PageDown'],
        [8, 'Backspace', 'Backspace'],
        [49, 'Digit1', '1'],
    ] as const) {
        assert.equal(legacyKeyboardValue({ keyCode }, 'code'), code);
        assert.equal(legacyKeyboardValue({ keyCode }, 'key'), key);
    }
    assert.equal(legacyKeyboardValue({ which: 81, shiftKey: true }, 'key'), 'Q');
    assert.equal(legacyKeyboardValue({ keyCode: 0 }, 'code'), '');
});
test('legacy Canvas colours preserve alpha instead of silently keeping the previous paint', () => {
    assert.equal(legacyColor('#aabbccff'), 'rgba(170,187,204,1)');
    assert.equal(legacyColor('#1230'), 'rgba(17,34,51,0)');
    assert.equal(legacyColor('#ff804080'), 'rgba(255,128,64,0.5019607843137255)');
    assert.equal(legacyColor('#aabbcc'), '#aabbcc');
    assert.equal(legacyColor('transparent'), 'transparent');
    const gradient = {};
    assert.equal(legacyColor(gradient), gradient);
});

test('legacy layout refreshes on the first frame after touch controls change their height', () => {
    const names = new Set<string>();
    const classes = {
        add: (name: string) => names.add(name),
        contains: (name: string) => names.has(name),
        toggle: (name: string, force: boolean) => (force ? names.add(name) : names.delete(name)),
    };
    const shell = { classList: classes, style: {} as Record<string, string> };
    const outer = {
        style: {} as Record<string, string>,
        querySelector: () => ({
            getBoundingClientRect: () => ({ height: names.has('game-app_touch') ? 51 : 39 }),
        }),
    };
    const display = { parentElement: outer, style: {} as Record<string, string>, clientWidth: 828 };
    const game = {
        parentElement: display,
        style: {} as Record<string, string>,
        dataset: { game: 'amiga' },
    };
    const options = { style: {} as Record<string, string> };
    const footer = {
        getBoundingClientRect: () => ({ height: names.has('game-app_touch') ? 153 : 141 }),
    };
    let nextFrame: FrameRequestCallback | undefined;
    const view = {
        innerWidth: 844,
        innerHeight: 390,
        document: {
            getElementById: () => game,
            querySelector: (selector: string) =>
                selector === '.game-app' ? shell : selector === 'footer' ? footer : options,
        },
        requestAnimationFrame: (callback: FrameRequestCallback) => {
            nextFrame = callback;
            return 1;
        },
        cancelAnimationFrame() {},
        setInterval: () => 1,
        clearInterval() {},
        addEventListener() {},
        removeEventListener() {},
    } as unknown as Window;
    const dispose = runtime.installLegacyLayout(view);
    names.add('game-app_touch');
    assert.equal(
        typeof nextFrame,
        'function',
        'layout must not wait250ms for its first post-mount correction',
    );
    nextFrame!(0);
    assert.equal(outer.style.height, '219px');
    assert.equal(
        display.style.height,
        '217px',
        'floating Settings must not reserve display height',
    );
    dispose();
});
