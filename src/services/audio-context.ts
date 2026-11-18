interface AudioContextHost {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
}

// Audio authorization belongs to the user gesture, before an application import.
export function unlockAudioContext(view: AudioContextHost): AudioContext | undefined {
    const Audio = view.AudioContext || view.webkitAudioContext;
    if (!Audio) return;
    let context: AudioContext | undefined;
    try {
        context = new Audio();
        void Promise.resolve(context.resume()).catch(() => {});
        return context;
    } catch {
        disposeAudioContext(context);
        return;
    }
}

export function disposeAudioContext(context: AudioContext | undefined): void {
    if (!context || context.state === 'closed') return;
    try {
        void Promise.resolve(context.close()).catch(() => {});
    } catch {
        // Closing an abandoned context must not prevent another platform launch.
    }
}
