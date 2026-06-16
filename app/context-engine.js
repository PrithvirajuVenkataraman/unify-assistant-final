const INTENT_TERMS = Object.freeze({
    acknowledgements: ['yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah', 'ok', 'okay', 'sure', 'alright', 'fine', 'thanks', 'thank you', 'got it', 'cool', 'hmm', 'uh huh'],
    cancelCommands: ['cancel', 'never mind', 'nevermind', 'stop', 'reset', 'start over', 'forget that', 'clear context'],
    questionLeads: ['who', 'what', 'when', 'where', 'why', 'how', 'which'],
    requestStarters: ['who', 'what', 'when', 'where', 'why', 'how', 'explain', 'tell', 'give', 'show', 'plan', 'create', 'write', 'compare', 'calculate', 'translate', 'remember', 'open', 'start'],
    settingTargets: ['response', 'answer', 'dark', 'light', 'medical', 'support', 'news', 'memory', 'history', 'camera', 'vision', 'ocr', 'translator'],
    featureTargets: ['weather', 'forecast', 'trip', 'itinerary', 'travel', 'translate', 'translator', 'camera', 'ocr', 'scan', 'vision', 'remember', 'memory', 'export', 'delete all data'],
    followUpReferences: ['it', 'its', 'this', 'that', 'they', 'them', 'those', 'these', 'same', 'earlier', 'previous', 'above'],
    followUpPhrases: ['more', 'continue', 'explain further', 'tell me more', 'what about', 'how about', 'then what', 'what next', 'further'],
    correctionOpeners: ['no', 'nah', 'nope', 'actually', 'wait', 'sorry'],
    correctionIntents: ['i meant', 'that is', 'that was', 'you misunderstood'],
    correctionPhrases: ['that is wrong', "that's wrong", 'you got that wrong', 'not what i meant', 'i meant'],
    switchActions: ['change', 'switch', 'new', 'different', 'another'],
    switchTargets: ['topic', 'subject'],
    switchPhrases: ['anyway', 'moving on', 'on another note', "let's talk about", 'lets talk about', "let's discuss about", 'lets discuss about'],
    resumePhrases: ['back to', 'return to', 'resume', 'continue with', 'earlier', 'previous topic', 'again about', 'regarding'],
    pronounTargets: ['it', 'its', 'this', 'that', 'this one', 'that one', 'the company', 'the person', 'the topic'],
    entityQuestionLeads: ['who', 'what'],
    entityDescriptionLeads: ['tell me about', 'about', 'regarding'],
    entityPrepositions: ['in', 'to', 'for']
});
const ACKNOWLEDGEMENTS = exactPhrasePattern(INTENT_TERMS.acknowledgements);
const CANCEL_COMMANDS = exactPhrasePattern(INTENT_TERMS.cancelCommands);
const REQUEST_STARTERS = leadingWordPattern(INTENT_TERMS.requestStarters);
const REQUEST_STARTERS_WITH_STOP = leadingWordPattern([...INTENT_TERMS.requestStarters, 'stop']);
const QUESTION_LEADS = leadingWordPattern(INTENT_TERMS.questionLeads);
const FOLLOW_UP_SIGNALS = containsPhrasePattern([...INTENT_TERMS.followUpReferences, ...INTENT_TERMS.followUpPhrases]);
const CORRECTION_SIGNALS = correctionPattern();
const EXPLICIT_SWITCH = switchPattern();
const EXPLICIT_RESUME = containsPhrasePattern(INTENT_TERMS.resumePhrases);
const SETTINGS_COMMAND = commandTargetPattern(['set', 'change', 'switch', 'turn', 'enable', 'disable'], INTENT_TERMS.settingTargets);
const FEATURE_COMMAND = containsPhrasePattern(INTENT_TERMS.featureTargets);

const TOKEN_FILTER_WORDS = [
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'is', 'are', 'am', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'would', 'will',
    'should', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'i', 'me', 'my', 'you', 'your',
    'we', 'our', 'they', 'their', 'he', 'she', 'it', 'this', 'that', 'these', 'those', 'please',
    'tell', 'show', 'give', 'explain', 'about', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'from'
];
const STOP_WORDS = new Set(TOKEN_FILTER_WORDS);
const ENTITY_PATTERNS = Object.freeze([
    new RegExp(`\\b(?:${phraseAlternation(INTENT_TERMS.entityQuestionLeads)})\\s+is\\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,70})`, 'i'),
    new RegExp(`\\b(?:${phraseAlternation(INTENT_TERMS.entityDescriptionLeads)})\\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,70})`, 'i'),
    new RegExp(`\\b(?:${phraseAlternation(INTENT_TERMS.entityPrepositions)})\\s+([A-Z][A-Za-z .'-]{1,50})`)
]);

export function createConversationEngine(options = {}) {
    const maxTurns = clamp(options.maxTurns, 12, 4, 30);
    const maxContextChars = clamp(options.maxContextChars, 9000, 1000, 24000);
    const maxThreads = clamp(options.maxThreads, 8, 2, 20);
    const state = {
        activeThreadId: '',
        threads: new Map(),
        turns: [],
        pending: null,
        preferences: { 
            responseLength: 'normal', 
            responseFormat: 'paragraph', 
            responseStyle: 'balanced',
            customSystemPrompt: ''
        } 
    };

    return {
        getState: () => snapshotState(state),
        restoreState: snapshot => restoreState(state, snapshot, { maxTurns, maxThreads }),
        setPending: pending => setPending(state, pending),
        clearPending: reason => clearPending(state, reason),
        reset: () => resetState(state),
        resolve: input => resolveInput(state, input, { maxThreads }),
        recordTurn: turn => recordTurn(state, turn, { maxTurns }),
        discardTurn: turnId => discardTurn(state, turnId),
        buildContext: options => buildContext(state, { maxTurns, maxContextChars, ...options }),
        setPreferences: preferences => {
            state.preferences = { ...state.preferences, ...sanitizePreferences(preferences) };
            return { ...state.preferences };
        }
    };
}

export function classifyInput(message, pending = null, activeThread = null) {
    const originalMessage = cleanText(message);
    const lower = originalMessage.toLowerCase();
    const tokens = tokenize(originalMessage);
    const isCancel = CANCEL_COMMANDS.test(lower);
    const isSetting = SETTINGS_COMMAND.test(lower);
    const isFeatureCommand = FEATURE_COMMAND.test(lower);
    const isAcknowledgement = ACKNOWLEDGEMENTS.test(lower);
    const isExplicitSwitch = EXPLICIT_SWITCH.test(lower);
    const isCorrection = CORRECTION_SIGNALS.test(originalMessage);
    const isFollowUp = isCorrection || FOLLOW_UP_SIGNALS.test(lower) || (isAcknowledgement && Boolean(activeThread));
    const pendingMatch = pending ? matchesPending(originalMessage, pending) : false;
    const hasSubstantiveIntent = tokens.length >= 1 && !isAcknowledgement;
    const startsClearRequest = REQUEST_STARTERS.test(originalMessage);
    const topic = deriveTopic(originalMessage);
    const topicOverlap = activeThread ? countOverlap(tokens, tokenize(activeThread.topic)) : 0;
    const clearNewIntent = !isCancel &&
        !isSetting &&
        hasSubstantiveIntent &&
        (
            isExplicitSwitch ||
            isFeatureCommand ||
            (startsClearRequest && !isFollowUp && Boolean(pending)) ||
            (startsClearRequest && !isFollowUp && topicOverlap === 0) ||
            (!pendingMatch && !isFollowUp && topicOverlap === 0)
        );

    return {
        originalMessage,
        tokens,
        topic,
        isCancel,
        isSetting,
        isFeatureCommand,
        isAcknowledgement,
        isExplicitSwitch,
        isFollowUp,
        isCorrection,
        pendingMatch,
        clearNewIntent
    };
}

function resolveInput(state, input, limits) {
    const originalMessage = cleanText(input?.message ?? input);
    const activeThread = state.threads.get(state.activeThreadId) || null;
    const classification = classifyInput(originalMessage, state.pending, activeThread);
    let cancelledPendingState = null;
    let decisionReason = 'normal_request';
    let confidence = 0.72;

    if (classification.isCancel) {
        cancelledPendingState = clearPending(state, 'user_cancelled');
        state.activeThreadId = '';
        return resolution(originalMessage, originalMessage, null, 'reset_or_cancel', 1, cancelledPendingState);
    }

    if (classification.isSetting) {
        decisionReason = 'explicit_setting_command';
        confidence = 0.98;
    } else if (EXPLICIT_RESUME.test(originalMessage)) {
        const resumedThread = findReferencedThread(state, originalMessage);
        if (resumedThread) {
            cancelledPendingState = clearPending(state, 'superseded_by_explicit_thread_resume');
            state.activeThreadId = resumedThread.id;
            resumedThread.updatedAt = Date.now();
            return resolution(
                originalMessage,
                resolvePronouns(originalMessage, resumedThread.entity || resumedThread.topic),
                resumedThread,
                'explicit_thread_resume',
                0.97,
                cancelledPendingState
            );
        }
    } else if (classification.clearNewIntent) {
        cancelledPendingState = clearPending(state, 'superseded_by_new_intent');
        const thread = createThread(state, classification.topic || originalMessage, limits.maxThreads);
        decisionReason = 'clear_new_intent';
        confidence = classification.isExplicitSwitch || classification.isFeatureCommand ? 0.98 : 0.88;
        return resolution(originalMessage, originalMessage, thread, decisionReason, confidence, cancelledPendingState);
    } else if (classification.pendingMatch && state.pending) {
        decisionReason = 'pending_clarification_answer';
        confidence = 0.96;
        return resolution(originalMessage, originalMessage, activeThread, decisionReason, confidence, null);
    } else if (classification.isFollowUp && activeThread) { 
        if (!shouldResolveAgainstActiveThread(originalMessage, classification, activeThread)) {
            const thread = createThread(state, classification.topic || originalMessage, limits.maxThreads);
            return resolution(originalMessage, originalMessage, thread, 'new_intent_low_context_confidence', 0.66, null);
        }
        const resolved = resolvePronouns(originalMessage, activeThread.entity || activeThread.topic); 
        decisionReason = classification.isCorrection ? 'conversation_repair' : 'contextual_follow_up'; 
        confidence = FOLLOW_UP_SIGNALS.test(originalMessage) ? 0.92 : 0.78; 
        return resolution(originalMessage, resolved, activeThread, decisionReason, confidence, null);
    }

    const thread = activeThread || createThread(state, classification.topic || originalMessage, limits.maxThreads);
    return resolution(originalMessage, originalMessage, thread, decisionReason, confidence, cancelledPendingState);
}

function discardTurn(state, turnId) {
    const id = cleanText(turnId);
    if (!id) return 0;
    const before = state.turns.length;
    state.turns = state.turns.filter(turn => turn.id !== id && turn.turnId !== id);
    return before - state.turns.length;
}

function recordTurn(state, turn, limits) {
    const role = turn?.role === 'assistant' ? 'assistant' : 'user';
    const text = cleanText(turn?.text);
    if (!text || turn?.aborted || turn?.error || turn?.control) return null;

    const threadId = cleanText(turn?.threadId) || state.activeThreadId;
    if (!threadId || !state.threads.has(threadId)) return null;
    const thread = state.threads.get(threadId);
    const record = {
        id: cleanText(turn?.id) || `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        turnId: cleanText(turn?.turnId),
        role,
        text: text.slice(0, 4000),
        source: cleanText(turn?.source) || 'text',
        threadId,
        createdAt: Number(turn?.createdAt) || Date.now()
    };
    state.turns.push(record);
    state.turns = state.turns.slice(-limits.maxTurns * 3);
    thread.updatedAt = record.createdAt;
    if (role === 'user' && !ACKNOWLEDGEMENTS.test(text)) {
        const entity = deriveEntity(text);
        if (entity) thread.entity = entity;
        const topic = deriveTopic(text);
        if (topic) thread.topic = topic;
    }
    return { ...record };
}

function buildContext(state, options = {}) {
    const threadId = cleanText(options.threadId) || state.activeThreadId;
    if (!threadId) return [];
    const maxTurns = clamp(options.maxTurns, 12, 2, 30);
    const maxChars = clamp(options.maxContextChars, 9000, 500, 24000);
    const selected = state.turns.filter(turn => turn.threadId === threadId).slice(-maxTurns);
    const out = [];
    let chars = 0;
    for (let i = selected.length - 1; i >= 0; i -= 1) {
        const turn = selected[i];
        const cost = turn.text.length + 20;
        if (out.length && chars + cost > maxChars) break;
        chars += cost;
        out.unshift({ role: turn.role, text: turn.text });
    }
    return out;
}

function setPending(state, pending) {
    if (!pending || typeof pending !== 'object') {
        state.pending = null;
        return null;
    }
    state.pending = {
        type: cleanText(pending.type) || 'clarification',
        expected: cleanText(pending.expected) || 'free_text',
        options: Array.isArray(pending.options) ? pending.options.map(cleanText).filter(Boolean).slice(0, 10) : [],
        threadId: cleanText(pending.threadId) || state.activeThreadId,
        createdAt: Date.now()
    };
    return { ...state.pending };
}

function clearPending(state, reason = 'cleared') {
    if (!state.pending) return null;
    const previous = { ...state.pending, reason };
    state.pending = null;
    return previous;
}

function matchesPending(message, pending) {
    const text = cleanText(message);
    if (!text) return false;
    if (pending.expected === 'number') {
        const match = text.match(/^\s*(\d{1,2})\s*$/);
        if (!match) return false;
        const value = Number(match[1]);
        return pending.options.length ? value >= 1 && value <= pending.options.length : value >= 1;
    }
    if (pending.expected === 'yes_no') return /^(yes|yeah|yep|sure|ok|okay|no|nope|nah)$/i.test(text);
    if (pending.expected === 'name') return /^[A-Za-z][A-Za-z '-]{1,70}$/.test(text);
    if (pending.expected === 'location') {
        const startsNewRequest = REQUEST_STARTERS_WITH_STOP.test(text);
        return !startsNewRequest &&
            !FEATURE_COMMAND.test(text) &&
            !SETTINGS_COMMAND.test(text) &&
            text.split(/\s+/).length <= 6;
    }
    return ACKNOWLEDGEMENTS.test(text) || tokenize(text).length <= 8;
}

function findReferencedThread(state, message) {
    const messageTokens = tokenize(message);
    let best = null;
    let bestScore = 0;
    for (const thread of state.threads.values()) {
        const referenceTokens = tokenize(`${thread.topic} ${thread.entity || ''}`);
        const score = countOverlap(messageTokens, referenceTokens);
        if (score > bestScore) {
            best = thread;
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : null;
}

function createThread(state, topic, maxThreads) {
    const normalized = deriveTopic(topic) || cleanText(topic).toLowerCase().slice(0, 80) || 'general';
    const existing = [...state.threads.values()].find(thread => thread.topic === normalized);
    if (existing) {
        existing.updatedAt = Date.now();
        state.activeThreadId = existing.id;
        return existing;
    }
    const thread = {
        id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        topic: normalized,
        entity: deriveEntity(topic),
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    state.threads.set(thread.id, thread);
    state.activeThreadId = thread.id;
    if (state.threads.size > maxThreads) {
        const oldest = [...state.threads.values()]
            .filter(item => item.id !== thread.id)
            .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (oldest) {
            state.threads.delete(oldest.id);
            state.turns = state.turns.filter(turn => turn.threadId !== oldest.id);
        }
    }
    return thread;
}

function resetState(state) {
    state.activeThreadId = '';
    state.threads.clear();
    state.turns = [];
    state.pending = null;
}

function restoreState(state, snapshot, limits) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    state.activeThreadId = String(source.activeThreadId || '');
    state.threads = new Map(
        (Array.isArray(source.threads) ? source.threads : [])
            .slice(-limits.maxThreads)
            .map(thread => [String(thread.id || ''), { ...thread }])
            .filter(([id]) => id)
    );
    state.turns = (Array.isArray(source.turns) ? source.turns : [])
        .slice(-limits.maxTurns)
        .map(turn => ({ ...turn }));
    state.pending = source.pending ? { ...source.pending } : null;
    state.preferences = {
        responseLength: 'normal',
        responseFormat: 'paragraph',
        responseStyle: 'balanced',
        customSystemPrompt: '',
        ...sanitizePreferences(source.preferences)
    };
    if (!state.threads.has(state.activeThreadId)) state.activeThreadId = '';
    return snapshotState(state);
}

function resolution(originalMessage, resolvedMessage, thread, decisionReason, confidence, cancelledPendingState) {
    return {
        originalMessage,
        resolvedMessage,
        activeThread: thread ? { ...thread } : null,
        decisionReason,
        confidence,
        cancelledPendingState
    };
}

function deriveTopic(text) {
    const tokens = tokenize(text);
    return tokens.slice(0, 8).join(' ');
}

function deriveEntity(text) {
    const raw = cleanText(text);
    for (const pattern of ENTITY_PATTERNS) {
        const match = raw.match(pattern);
        if (match?.[1]) return cleanText(match[1]).replace(/[?.!,;]+$/g, '').slice(0, 80);
    }
    return '';
}

function resolvePronouns(text, entity) {
    if (!entity) return text;
    return cleanText(text).replace(
        containsPhrasePattern(INTENT_TERMS.pronounTargets, 'g'),
        entity
    );
}

function shouldResolveAgainstActiveThread(message, classification, activeThread) {
    if (!activeThread) return false;
    if (classification?.isCorrection) return true;
    const raw = cleanText(message);
    const tokens = Array.isArray(classification?.tokens) ? classification.tokens : tokenize(raw);
    const topicTokens = tokenize(`${activeThread.topic || ''} ${activeThread.entity || ''}`);
    const overlap = countOverlap(tokens, topicTokens);
    const hasEntity = Boolean(cleanText(activeThread.entity));
    const hasTopicAnchor = hasEntity || topicTokens.length > 0;
    const explicitReference = FOLLOW_UP_SIGNALS.test(raw);
    const bareShortQuestion = QUESTION_LEADS.test(raw) && tokens.length <= 3 && overlap === 0;
    const namedLikeNewTopic = new RegExp(`^(?:${phraseAlternation(INTENT_TERMS.entityQuestionLeads)})\\s+is\\s+[A-Za-z0-9][A-Za-z0-9 .'-]{2,}\\??$`, 'i').test(raw) && overlap === 0;

    if (namedLikeNewTopic || bareShortQuestion) return false;
    if (overlap > 0) return true;
    if (explicitReference && hasTopicAnchor && tokens.length <= 5) return true;
    return explicitReference && tokens.length <= 3 && hasTopicAnchor;
}

function tokenize(text) {
    return cleanText(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token.length > 1 && !STOP_WORDS.has(token))
        .slice(0, 24);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseAlternation(phrases) {
    return phrases
        .map(phrase => escapeRegExp(phrase).replace(/\s+/g, '\\s+'))
        .join('|');
}

function exactPhrasePattern(phrases) {
    return new RegExp(`^(?:${phraseAlternation(phrases)})$`, 'i');
}

function containsPhrasePattern(phrases, extraFlags = '') {
    const flags = `i${extraFlags}`.replace(/(.)(?=.*\1)/g, '');
    return new RegExp(`\\b(?:${phraseAlternation(phrases)})\\b`, flags);
}

function leadingWordPattern(words) {
    return new RegExp(`^(?:${phraseAlternation(words)})\\b`, 'i');
}

function commandTargetPattern(commands, targets) {
    return new RegExp(`\\b(?:${phraseAlternation(commands)})\\s+(?:${phraseAlternation(targets)})\\b`, 'i');
}

function correctionPattern() {
    const opener = phraseAlternation(INTENT_TERMS.correctionOpeners);
    const intent = phraseAlternation(INTENT_TERMS.correctionIntents);
    const phrase = phraseAlternation(INTENT_TERMS.correctionPhrases);
    return new RegExp(`^(?:${opener})[,\\s]+(?:${intent})|\\b(?:${phrase})\\b`, 'i');
}

function switchPattern() {
    const action = phraseAlternation(INTENT_TERMS.switchActions);
    const target = phraseAlternation(INTENT_TERMS.switchTargets);
    const phrase = phraseAlternation(INTENT_TERMS.switchPhrases);
    return new RegExp(`\\b(?:${action})\\s+(?:${target})\\b|\\b(?:${phrase})\\b`, 'i');
}

function countOverlap(a, b) {
    const right = new Set(b);
    return a.reduce((count, token) => count + (right.has(token) ? 1 : 0), 0);
}

function sanitizePreferences(preferences) {
    if (!preferences || typeof preferences !== 'object') return {};
    const out = {};
    if (['short', 'normal', 'detailed'].includes(preferences.responseLength)) out.responseLength = preferences.responseLength;
    if (['paragraph', 'bullet', 'steps'].includes(preferences.responseFormat)) out.responseFormat = preferences.responseFormat;
    const responseStyle = preferences.responseStyle || preferences.supportMode;
    if (['balanced', 'witty', 'chatty', 'supportive', 'debate'].includes(responseStyle)) {
        out.responseStyle = responseStyle;
    }
    const customSystemPrompt = cleanText(preferences.customSystemPrompt).slice(0, 1200);
    if (customSystemPrompt) out.customSystemPrompt = customSystemPrompt;
    return out;
}

function snapshotState(state) {
    return {
        activeThreadId: state.activeThreadId,
        threads: [...state.threads.values()].map(thread => ({ ...thread })),
        turns: state.turns.map(turn => ({ ...turn })),
        pending: state.pending ? { ...state.pending } : null,
        preferences: { ...state.preferences }
    };
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}
