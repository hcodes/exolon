import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceModulePath } from '../browser/reference-mode.ts';

test('private module paths accept roots with or without a trailing separator', () => {
    for (const root of ['/tmp/reex-reference', '/tmp/reex-reference/'])
        assert.equal(
            referenceModulePath(root, 'http://127.0.0.1:8091/reex/entries/main.js?v=test'),
            '/tmp/reex-reference/entries/main.js',
        );
});
test('private module paths reject escaped directories and non-JavaScript files', () => {
    assert.equal(
        referenceModulePath('/tmp/reex-reference/', 'http://127.0.0.1:8091/%2e%2e%2fother.js'),
        null,
    );
    assert.equal(
        referenceModulePath('/tmp/reex-reference/', 'http://127.0.0.1:8091/data/world.json'),
        null,
    );
});
