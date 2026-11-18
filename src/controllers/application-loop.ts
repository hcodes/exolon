import { createClock } from '../lib/clock.ts';
import { step } from '../model/state.ts';
import { normalizePlayerName } from '../model/high-scores.ts';
import { SCREEN_COUNT, SIMULATION_INTERVAL } from '../constants/game.ts';
import { isTvBrowser } from '../utils/tv.ts';
import { isPs4Browser } from '../utils/ps4.ts';
import type { createInput } from '../input/index.ts';
import type { createAudio } from '../view/audio.ts';
import type { createRenderer } from '../view/renderer.ts';
import type { createApplicationSession } from './application-session.ts';
import type { createTitleNavigation } from './title-navigation.ts';
import type { createSplitControl } from './split.ts';
import type { createScoreAttract } from '../model/high-scores.ts';

interface ApplicationLoopOptions {
    window: Window;
    input: ReturnType<typeof createInput>;
    audio: ReturnType<typeof createAudio>;
    attract: ReturnType<typeof createScoreAttract>;
    splitControl: ReturnType<typeof createSplitControl>;
    status: HTMLElement;
    nameForm: HTMLFormElement;
    nameInput: HTMLInputElement;
    getSession(): ReturnType<typeof createApplicationSession>;
    getRenderer(): ReturnType<typeof createRenderer> | undefined;
    getTitleNavigation(): ReturnType<typeof createTitleNavigation>;
    isPickingPlatform(): boolean;
    isDisposed(): boolean;
    pollGamepad(): void;
    updateHud(): void;
    consumeBonusFire(): boolean;
    onRender(now: number): void;
}

export function createApplicationLoop(options: ApplicationLoopOptions) {
    const {
        window,
        input,
        audio,
        attract,
        splitControl,
        status,
        nameForm,
        nameInput,
        getSession,
        getRenderer,
        getTitleNavigation,
        isPickingPlatform,
        isDisposed,
        pollGamepad,
        updateHud,
        consumeBonusFire,
        onRender,
    } = options;
    let frameId: number | undefined;
    let disposed = false;
    function tick() {
        const session = getSession();
        if (!session.running) return;
        const commands = input.sample();
        if (consumeBonusFire()) commands.fire = true;
        const result = step(session.state, commands);
        session.state = result.state;
        input.handleEvents(result.events);
        audio.handle(result.events);
        getRenderer()!.addEvents(result.events, session.state);
        updateHud();
        if (session.state.status === 'won') {
            session.pause(
                'Mission complete.',
                `All ${SCREEN_COUNT} screens completed. Your score: ${session.state.score}.`,
                'won',
            );
        } else if (session.state.status === 'over') {
            session.pause('', '', 'over');
        } else if (result.events.some((event) => event.type === 'stage')) {
            status.textContent = `STAGE ${session.state.stage} / COMPLETION BONUS`;
        } else if (result.events.some((event) => event.type === 'screen')) {
            status.textContent = `STAGE ${session.state.stage} / SCREEN ${session.state.screenIndex + 1} OF ${SCREEN_COUNT}`;
        }
    }
    const tv = isTvBrowser(window.navigator.userAgent);
    const clock = createClock(tick, SIMULATION_INTERVAL, {
        pauseOnStall: !tv && !isPs4Browser(window.navigator.userAgent),
    });
    const renderInterval = 1000 / 30;
    let previousRender: number | null = null;

    function frame(now: number) {
        if (disposed || isDisposed()) return;
        const renderer = getRenderer(),
            session = getSession();
        if (!renderer || !session.state) {
            if (isPickingPlatform()) pollGamepad();
            frameId = window.requestAnimationFrame(frame);
            return;
        }
        pollGamepad();
        if (disposed || isDisposed()) return;
        if (isPickingPlatform()) {
            attract.suspend();
            frameId = window.requestAnimationFrame(frame);
            return;
        }
        if (session.running && !clock.frame(now)) session.pause();
        // Poll input and advance the platform clock on every RAF; cap only TV drawing.
        if (!tv || previousRender === null || now - previousRender + 1e-7 >= renderInterval) {
            previousRender =
                previousRender === null
                    ? now
                    : previousRender +
                      Math.floor((now - previousRender + 1e-7) / renderInterval) * renderInterval;
            if (!getTitleNavigation().frame(now, renderer))
                renderer.render(session.state, now, clock.fraction, {
                    paused: session.mode === 'paused',
                    nameEntry: !nameForm.hidden,
                    playerName: nameForm.hidden ? null : normalizePlayerName(nameInput.value, ''),
                });
            onRender(now);
        }
        splitControl.refresh();
        frameId = window.requestAnimationFrame(frame);
    }

    return {
        clock,
        start() {
            if (!disposed && frameId === undefined) frameId = window.requestAnimationFrame(frame);
        },
        destroy() {
            if (disposed) return;
            disposed = true;
            if (frameId !== undefined) window.cancelAnimationFrame(frameId);
            frameId = undefined;
            clock.destroy();
        },
    };
}
