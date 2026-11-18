import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, step } from '../../src/model/state.ts';
import { createAmigaState, stepAmiga } from '../../src/games/amiga/model/index.ts';
import { createAtariStState, stepAtariSt } from '../../src/games/atari-st/model/index.ts';

function classicState() {
    return createState({
        id: 0,
        placements: [],
        actions: [],
        objects: [],
        tiles: Array.from({ length: 768 }, (_, index) =>
            index >= 576 ? { collision: 1, block: 33 } : null,
        ),
    });
}

test('a direct classic rocket launches immediately without spending a bullet', () => {
    const initial = classicState();
    const launched = step(initial, { rocket: true });
    assert.equal(launched.state.ammo, 99);
    assert.equal(launched.state.grenades, 9);
    assert.ok(launched.events.some((event) => event.type === 'grenade'));
    assert.equal(
        launched.events.some((event) => event.type === 'shot'),
        false,
    );
    assert.equal(initial.grenades, 10);
    const blocked = step(launched.state, { rocket: true });
    assert.equal(blocked.state.grenades, 9, 'only one rocket may be active');
    const empty = classicState();
    empty.ammo = 0;
    empty.grenades = 0;
    assert.equal(step(empty, { rocket: true }).state.grenade, null);
    empty.cheats.infiniteRockets = true;
    assert.ok(step(empty, { rocket: true }).state.grenade);
    assert.equal(step(empty, { rocket: true }).state.grenades, 0);
    const simultaneous = step(classicState(), { fire: true, rocket: true });
    assert.equal(simultaneous.state.ammo, 98);
    assert.equal(simultaneous.state.grenades, 9);
});

for (const [name, create, advance] of [
    ['Amiga', createAmigaState, stepAmiga],
    ['Atari ST', createAtariStState, stepAtariSt],
] as const) {
    const world = {
        screens: [{ tiles: Array.from({ length: 920 }, (_, index) => (index >= 880 ? 0x79 : 0)) }],
    };
    test(`${name} direct rockets preserve ammo, active-projectile limits and infinite rockets`, () => {
        const initial = create(world);
        const launched = advance(initial, { rocket: true });
        assert.equal(launched.state.ammo, 99);
        assert.equal(launched.state.grenades, 8);
        assert.ok(launched.events.some((event) => event.type === 'grenade'));
        assert.equal(
            launched.events.some((event) => event.type === 'shot'),
            false,
        );
        assert.equal(initial.grenades, 9);
        assert.equal(advance(launched.state, { rocket: true }).state.grenades, 8);
        const empty = create(world);
        empty.ammo = 0;
        empty.grenades = 0;
        assert.equal(advance(empty, { rocket: true }).events.length, 0);
        empty.options.infiniteGrenades = true;
        const unlimited = advance(empty, { rocket: true });
        assert.ok(unlimited.events.some((event) => event.type === 'grenade'));
        assert.equal(unlimited.state.grenades, 0);
        const simultaneous = advance(create(world), { fire: true, rocket: true });
        assert.equal(simultaneous.state.ammo, 98);
        assert.equal(simultaneous.state.grenades, 8);
    });
}
