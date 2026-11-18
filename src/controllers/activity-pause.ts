import type { EventScope } from '../lib/events.ts';

interface ActivityPauseOptions {
    document: Document;
    events: EventScope;
    isRunning(): boolean;
    pause(): void;
    resume(): void;
    canResume(): boolean;
    isEnabled?(): boolean;
}

export function createActivityPause({
    document,
    events,
    isRunning,
    pause,
    resume,
    canResume,
    isEnabled = () => true,
}: ActivityPauseOptions) {
    const view = document.defaultView;
    let resumeOnReturn = false;

    function revokeResume() {
        resumeOnReturn = false;
    }
    function suspend() {
        if (!isEnabled() || !isRunning()) return;
        pause();
        // Explicit pauses revoke permission; only this suspension may restore it.
        resumeOnReturn = true;
    }
    function handleReturn() {
        if (!resumeOnReturn || document.hidden || !document.hasFocus()) return;
        revokeResume();
        if (isEnabled() && canResume()) resume();
    }
    function handleVisibilityChange() {
        if (document.hidden) suspend();
        else handleReturn();
    }
    events.on(view, 'blur', suspend);
    events.on(view, 'focus', handleReturn);
    events.on(document, 'visibilitychange', handleVisibilityChange);
    events.on(view, 'pagehide', revokeResume);
    events.on(view, 'gamepaddisconnected', revokeResume);
    return { revokeResume };
}
