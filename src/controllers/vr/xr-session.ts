import { createEventScope } from '../../lib/events.ts';

interface ImmersiveSession extends EventTarget {
    end(): Promise<void>;
    visibilityState: string;
}

export function createXrSessionControl<Session extends ImmersiveSession>(options: {
    request(): Promise<Session>;
    mount(session: Session): Promise<void>;
    onSession(session: Session | null): void;
    onPause(): void;
    onError(error: unknown): void;
    onSetupCancelled?(): void;
}) {
    let active: Session | null = null;
    let mounting: Session | null = null;
    let setup: Promise<void> | undefined;
    let pending = false;
    let revision = 0;
    let disposed = false;
    let scope = createEventScope(undefined);
    async function end(session: Session) {
        try {
            await session.end();
        } catch {
            /* A browser may have ended it already. */
        }
    }
    async function exit() {
        revision++;
        pending = false;
        const session = active ?? mounting;
        const pendingSetup = setup;
        active = null;
        mounting = null;
        scope.destroy();
        scope = createEventScope(undefined);
        if (session) {
            options.onPause();
            options.onSession(null);
            await end(session);
        }
        // A cancelled renderer setup can still be using GPU resources.
        await pendingSetup?.catch(() => {});
    }
    return {
        get active() {
            return active;
        },
        async enter() {
            if (disposed || pending || active || setup) return;
            pending = true;
            const token = ++revision;
            let session: Session | undefined;
            let mounted = false;
            try {
                session = await options.request();
                if (disposed || token !== revision) {
                    await end(session);
                    return;
                }
                const candidate = session;
                let ended = false;
                const listeners = createEventScope(undefined);
                function handleEnd() {
                    ended = true;
                    listeners.destroy();
                    if (mounting === candidate) mounting = null;
                    if (active !== candidate) return;
                    active = null;
                    options.onPause();
                    options.onSession(null);
                }
                function handleVisibility() {
                    if (candidate.visibilityState !== 'visible') options.onPause();
                }
                listeners.on(candidate, 'end', handleEnd);
                listeners.on(candidate, 'visibilitychange', handleVisibility);
                mounting = candidate;
                scope.destroy();
                scope = listeners;
                try {
                    mounted = true;
                    setup = options.mount(candidate);
                    await setup;
                } catch (error) {
                    listeners.destroy();
                    throw error;
                } finally {
                    setup = undefined;
                    if (mounting === candidate) mounting = null;
                }
                if (disposed || token !== revision || ended) {
                    listeners.destroy();
                    await end(candidate);
                    options.onSetupCancelled?.();
                    return;
                }
                active = candidate;
                options.onSession(candidate);
            } catch (error) {
                if (session) await end(session);
                if (mounted) options.onSetupCancelled?.();
                if (!disposed && token === revision) options.onError(error);
            } finally {
                if (token === revision) pending = false;
            }
        },
        exit,
        destroy() {
            disposed = true;
            return exit();
        },
    };
}
