export const CONVERSE_STATES = Object.freeze({
    listening: 'listening',
    submitting: 'submitting',
    responding: 'responding',
    speaking: 'speaking',
    interruptible: 'interruptible',
    recovering: 'recovering'
});

export function normalizeConverseState(state) {
    const value = String(state || '').trim().toLowerCase();
    return Object.values(CONVERSE_STATES).includes(value) ? value : CONVERSE_STATES.listening;
}

export function createConverseStateTracker(initialState = CONVERSE_STATES.listening) {
    let snapshot = {
        state: normalizeConverseState(initialState),
        reason: 'initial',
        updatedAt: Date.now()
    };
    return {
        getSnapshot() {
            return { ...snapshot };
        },
        setState(state, reason = '') {
            snapshot = {
                state: normalizeConverseState(state),
                reason: String(reason || '').trim(),
                updatedAt: Date.now()
            };
            return { ...snapshot };
        }
    };
}
