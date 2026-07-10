const DEFAULT_FAILURE = Object.freeze({
    code: 'unknown_failure',
    stage: 'unknown',
    recoverable: false,
    userActions: [],
    debugReason: 'unknown'
});

function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function classifyFailure(input, context = {}) {
    if (input && typeof input === 'object' && input.code) {
        return {
            ...DEFAULT_FAILURE,
            ...input,
            userActions: Array.isArray(input.userActions) ? input.userActions.map(String) : []
        };
    }
    const details = context || {};
    const raw = compactText(`${input?.name || ''} ${input?.message || input || ''}`).toLowerCase();
    const stage = String(details.stage || 'request');
    if (details.aborted === true || /abort/.test(raw)) {
        return { code: 'aborted', stage, recoverable: false, userActions: [], debugReason: raw || 'aborted' };
    }
    if (/permission|notallowed|not allowed|denied/.test(raw)) {
        return { code: 'permission_blocked', stage, recoverable: true, userActions: ['retry'], debugReason: raw };
    }
    if (/speech|synthesis|voice/.test(raw) || details.speechBlocked === true) {
        return { code: 'speech_blocked', stage: 'speech', recoverable: true, userActions: ['enable_voice'], debugReason: raw || 'speech_blocked' };
    }
    if (/unsupported/.test(raw) || details.unsupportedTool === true) {
        return { code: 'unsupported_tool', stage, recoverable: false, userActions: [], debugReason: raw || 'unsupported_tool' };
    }
    if (details.retrievalEmpty === true) {
        return { code: 'retrieval_empty', stage: 'retrieval', recoverable: true, userActions: ['retry', 'web_search'], debugReason: 'retrieval_empty' };
    }
    if (details.emptyAnswer === true || /empty answer|model_empty|no response/.test(raw)) {
        return { code: 'model_empty', stage: 'model', recoverable: true, userActions: ['retry'], debugReason: raw || 'model_empty' };
    }
    if (/timeout|timed out|network|failed to fetch|service unavailable|temporar|rate limit|429|5\d\d/.test(raw)) {
        return { code: 'network_timeout', stage, recoverable: true, userActions: ['retry', 'web_search'], debugReason: raw || 'network_timeout' };
    }
    return { ...DEFAULT_FAILURE, stage, debugReason: raw || 'non_transient' };
}

export function getFallbackFailureReason(error, context = {}) {
    return classifyFailure(error, context).code;
}

export function shouldShowFailureFallbackCard(failureOrReason, userText, context = {}) {
    const failure = classifyFailure(failureOrReason, context);
    if (!failure.recoverable || !failure.userActions.length) return false;
    const text = compactText(userText).toLowerCase();
    if (!text) return false;
    if (context.fastSimple === true || context.casual === true) return false;
    if (/\b(how are you|what'?s up|hello|hi|thanks|thank you|are you there)\b/.test(text)) return false;
    if (/\b(what do you mean|clarify|did you mean|not sure|could you provide more context)\b/.test(text)) return false;
    return ['network_timeout', 'model_empty', 'retrieval_empty', 'permission_blocked'].includes(failure.code);
}
