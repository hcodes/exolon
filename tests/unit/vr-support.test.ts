import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseVr } from '../../src/utils/vr-support.ts';

test('VR availability requires a modern engine, secure context and WebXR without probing graphics unnecessarily', async () => {
    let queried = 0;
    let graphics = 0;
    const xr = {
        async isSessionSupported(mode: string) {
            assert.equal(mode, 'immersive-vr');
            queried++;
            return true;
        },
    };
    const hasWebGl2 = () => {
        graphics++;
        return true;
    };
    for (const options of [
        { modern: false, secure: true, xr },
        { modern: true, secure: false, xr },
        { modern: true, secure: true, xr: undefined },
        { modern: true, secure: true, xr: {} },
    ])
        assert.equal(await canUseVr({ ...options, hasWebGl2 }), false);
    assert.equal(queried, 0);
    assert.equal(graphics, 0);
});

test('VR availability awaits immersive support before checking WebGL 2', async () => {
    const calls: string[] = [];
    const options = {
        modern: true,
        secure: true,
        xr: {
            async isSessionSupported(mode: string) {
                calls.push(mode);
                return false;
            },
        },
        hasWebGl2() {
            calls.push('webgl2');
            return true;
        },
    };
    assert.equal(await canUseVr(options), false);
    assert.deepEqual(calls, ['immersive-vr']);
    calls.length = 0;
    options.xr.isSessionSupported = async (mode) => {
        calls.push(mode);
        return true;
    };
    assert.equal(await canUseVr(options), true);
    assert.deepEqual(calls, ['immersive-vr', 'webgl2']);
    options.hasWebGl2 = () => false;
    assert.equal(await canUseVr(options), false);
});

test('VR availability treats rejected and throwing browser probes as unsupported', async () => {
    const base = { modern: true, secure: true, hasWebGl2: () => true };
    assert.equal(
        await canUseVr({
            ...base,
            xr: {
                async isSessionSupported() {
                    throw new Error('Denied');
                },
            },
        }),
        false,
    );
    assert.equal(
        await canUseVr({
            ...base,
            xr: {
                isSessionSupported() {
                    throw new Error('Unavailable');
                },
            },
        }),
        false,
    );
    assert.equal(
        await canUseVr({
            ...base,
            xr: {
                async isSessionSupported() {
                    return true;
                },
            },
            hasWebGl2() {
                throw new Error('GPU unavailable');
            },
        }),
        false,
    );
});
