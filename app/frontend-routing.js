const CASUAL_FILLER_PATTERN = /\b(?:no|nope|nah|just|generally|actually|i'?m|im|i am|asking|so|well|um|uh|like)\b/g;
const LIVE_SIGNAL_PATTERN = /\b(latest|current|currently|today|tonight|now|recent|new|news|update|updates|as of|live|real[-\s]?time|open now|near me|nearby|weather|price|stock|crypto|score|sources?|cite|citation|web|search)\b/i;
const PLACE_SIGNAL_PATTERN = /\b(museum|museums|landmark|landmarks|attraction|attractions|restaurant|restaurants|hotel|hotels|near me|nearby|directions|map|places to visit|tourist|tourism)\b/i;
const SAFETY_SIGNAL_PATTERN = /\b(medical|medicine|diagnosis|symptom|dose|dosage|drug|treatment|legal|lawyer|contract|court|tax|investment|financial advice|self[-\s]?harm|suicide|weapon|malware)\b/i;
const CURRENT_ROLE_PATTERN = /\b(ceo|cfo|cto|president|prime minister|chief minister|governor|mayor|minister|captain|coach|founder|founded|head of|leader)\b/i;
const SIMPLE_STABLE_PATTERN = /^(?:what\s+is|what'?s|who\s+is|who\s+was|how\s+does|how\s+do|explain|define|tell\s+me\s+about)\s+[\w\s.'-]{2,80}\??$/i;
const CAPABILITY_QUESTION_PATTERN = /^(?:do|can|are|will)\s+you\b|^do\s+you\s+understand\s+[A-Za-z][A-Za-z\s-]{1,40}\??$/i;

export function normalizeCasualConversationText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .replace(CASUAL_FILLER_PATTERN, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isCasualConversationQuery(text) {
    const t = normalizeCasualConversationText(text);
    if (!t) return false;
    if (/^(?:hi|hello|hey|yo|sup|thanks|thank you|good morning|good afternoon|good evening)$/.test(t)) return true;
    if (/\b(how are you|how are you doing|how you doing|how is your day|how's your day|what'?s up|are you there|you there)\b/.test(t)) return true;
    if (/^(?:thanks|thank you|thank u|appreciate it)\b/.test(t)) return true;
    return false;
}

export function isSimpleStableQuestion(text, context = {}) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    if (!raw || raw.length > 120) return false;
    if (isCasualConversationQuery(raw)) return true;
    if (
        context.requiresSources ||
        context.liveIntent ||
        context.explicitWeb ||
        context.strictLatest ||
        context.currentInfo ||
        LIVE_SIGNAL_PATTERN.test(lower) ||
        SAFETY_SIGNAL_PATTERN.test(lower) ||
        PLACE_SIGNAL_PATTERN.test(lower) ||
        CURRENT_ROLE_PATTERN.test(lower)
    ) {
        return false;
    }
    return SIMPLE_STABLE_PATTERN.test(raw) || CAPABILITY_QUESTION_PATTERN.test(raw);
}

export function isFastSimpleQuery(text, context = {}) {
    return isCasualConversationQuery(text) || isSimpleStableQuestion(text, context);
}

export function decideFrontendRoute(text, context = {}) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    const turnSource = String(context.turnSource || context.source || '').toLowerCase();
    const base = {
        route: 'chat_direct',
        reason: 'default_direct_chat',
        risk: String(context.risk || 'low_risk'),
        requiresSources: false,
        minimalThinking: false,
        speakResponse: turnSource === 'converse',
        sourcePolicy: 'none'
    };

    if (!raw) {
        return {
            ...base,
            route: 'clarify',
            reason: 'empty_message',
            minimalThinking: true
        };
    }

    if (context.toolAction) {
        return {
            ...base,
            route: 'tool_action',
            reason: String(context.toolReason || 'tool_action_requested'),
            sourcePolicy: 'tool'
        };
    }

    if (isCasualConversationQuery(raw)) {
        return {
            ...base,
            route: 'fast_simple',
            reason: 'casual_conversation',
            risk: 'low_risk',
            minimalThinking: true
        };
    }

    if (context.safetySensitive || SAFETY_SIGNAL_PATTERN.test(lower)) {
        return {
            ...base,
            route: 'safety_sensitive',
            reason: 'safety_sensitive_query',
            risk: 'high_risk',
            requiresSources: false,
            sourcePolicy: 'safety'
        };
    }

    if (context.placeGrounded || PLACE_SIGNAL_PATTERN.test(lower)) {
        return {
            ...base,
            route: 'place_grounded',
            reason: 'place_query_requires_evidence',
            risk: context.risk || 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'place_grounded'
        };
    }

    if (
        context.requiresSources ||
        context.liveIntent ||
        context.explicitWeb ||
        context.strictLatest ||
        context.currentInfo ||
        context.liveRetrieval ||
        LIVE_SIGNAL_PATTERN.test(lower)
    ) {
        return {
            ...base,
            route: 'live_required',
            reason: 'source_or_freshness_required',
            requiresSources: true,
            sourcePolicy: 'required'
        };
    }

    if (context.ambiguousContext) {
        return {
            ...base,
            route: 'clarify',
            reason: 'ambiguous_context',
            minimalThinking: true
        };
    }

    if (isSimpleStableQuestion(raw, context)) {
        return {
            ...base,
            route: 'fast_simple',
            reason: 'simple_stable_question',
            risk: 'low_risk',
            minimalThinking: true
        };
    }

    return base;
}

export function shouldUseMinimalThinking(text, intent = '', context = {}) {
    const normalizedIntent = String(intent || '');
    return isFastSimpleQuery(text, context) ||
        ['fast_simple', 'casual_conversation', 'fast_explainer'].includes(normalizedIntent);
}
