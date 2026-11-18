import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, PerspectiveCamera, Vector3 } from 'three';
import { createVrPresentation } from '../../src/games/vr/view/presentation.ts';

test('Quest diorama fills a broad view and exposes physical depth at default scale', () => {
    const rig = new Group();
    const camera = new PerspectiveCamera();
    const stage = createVrPresentation(rig, camera);
    const head = new PerspectiveCamera();
    head.position.set(3, 1.6, -2);
    head.rotation.y = 0.6;
    head.updateMatrixWorld(true);
    stage.recenter(head);
    const size = new Box3(new Vector3(-128, 0, -19), new Vector3(128, 176, 19))
        .applyMatrix4(rig.matrixWorld)
        .getSize(new Vector3());
    assert.ok(size.x >= 2.2 && size.x <= 3, 'Scene width is room-scale rather than a small screen');
    assert.ok(size.z > 0.6, 'Depth and a slight viewing angle expose more than a flat slab');
    const forward = head.getWorldDirection(new Vector3());
    forward.y = 0;
    forward.normalize();
    const offset = rig.position.clone().sub(head.position);
    assert.ok(Math.abs(offset.dot(forward) - 1.85) < 1e-6);
    const width = 256 * rig.scale.x;
    const angle = (2 * Math.atan(width / (2 * 1.85)) * 180) / Math.PI;
    assert.ok(
        angle > 60 && angle < 80,
        'Default angular width is larger without surrounding the viewer',
    );
    const position = rig.position.clone();
    const rotation = rig.quaternion.clone();
    head.position.x += 1;
    stage.setScale(1.2);
    assert.deepEqual(
        rig.position,
        position,
        'Scaling or viewer motion does not recenter the world',
    );
    assert.ok(rig.quaternion.equals(rotation));
});

test('VR preview restores a useful camera after immersive exit and clamps scale', () => {
    const rig = new Group();
    const camera = new PerspectiveCamera();
    const stage = createVrPresentation(rig, camera);
    stage.setScale(100);
    const maximum = rig.scale.x;
    stage.setScale(NaN);
    assert.equal(rig.scale.x, maximum);
    const head = new PerspectiveCamera();
    head.position.set(10, 1.7, -4);
    head.updateMatrixWorld(true);
    stage.recenter(head);
    stage.recenter();
    assert.equal(rig.position.x, 0);
    assert.equal(rig.position.z, 0);
    assert.ok(camera.position.z > 3);
    assert.equal(rig.scale.z / rig.scale.x, 2);
});

test('Default preview framing includes the whole menu and HUD after enlarging the diorama', () => {
    const rig = new Group();
    const camera = new PerspectiveCamera(43, 1280 / 630);
    createVrPresentation(rig, camera);
    camera.updateMatrixWorld(true);
    for (const x of [-128, 128])
        for (const y of [-28, 325]) {
            const projected = new Vector3(x, y, 18).applyMatrix4(rig.matrixWorld).project(camera);
            assert.ok(
                Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1,
                `Visible menu/HUD corner: ${projected.toArray()}`,
            );
        }
});
