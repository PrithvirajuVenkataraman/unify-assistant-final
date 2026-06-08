export function createApplicationState(initial = {}) {
    const state = {
        activeFeature: null,
        pendingClarification: null,
        request: {
            active: false,
            requestId: null
        },
        preferences: {
            responseLength: 'normal',
            responseFormat: 'paragraph',
            responseStyle: 'balanced'
        },
        ...initial
    };

    return {
        get snapshot() {
            return structuredClone(state);
        },
        setActiveFeature(feature) {
            state.activeFeature = feature || null;
        },
        setPendingClarification(pending) {
            state.pendingClarification = pending ? structuredClone(pending) : null;
        },
        setRequest(request) {
            state.request = { ...state.request, ...(request || {}) };
        },
        setPreferences(preferences) {
            state.preferences = { ...state.preferences, ...(preferences || {}) };
        },
        resetConversationState() {
            state.activeFeature = null;
            state.pendingClarification = null;
            state.request = { active: false, requestId: null };
        }
    };
}
