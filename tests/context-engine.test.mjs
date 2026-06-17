import assert from 'node:assert/strict';
import { createConversationEngine } from '../app/context-engine.js';

function token(index) {
    return String.fromCharCode(97 + index).repeat(4);
}
 
function titleToken(index) {
    const value = token(index);
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const TOPIC = Object.freeze({
    primary: token(0),
    secondary: token(1),
    namedEntity: `${titleToken(2)} ${titleToken(3)}`,
    temporary: token(4),
    pendingBypass: `${token(5)} ${token(6)}`
});

const SAMPLE = Object.freeze({
    usefulUser: `${token(7)} ${token(8)}`,
    usefulAssistant: `${token(9)} ${token(10)}`,
    failedAssistant: `${token(11)} ${token(12)}`,
    interruptedUser: `${token(13)} ${token(14)}`,
    interruptedAssistant: `${token(15)} ${token(16)}`
});

const PROMPT = Object.freeze({
    introduce: topic => `Tell me about ${topic}`,
    explain: topic => `Explain ${topic}`,
    followUp: 'Tell me more about it',
    acknowledgement: 'okay',
    namedEntityQuestion: entity => `Who is ${entity}?`,
    repair: 'No, I meant explain its practical use',
    resume: topic => `Go back to ${topic}`,
    temporarySwitch: topic => `Switch to a temporary topic about ${topic}`,
    listRequest: 'Give me 10 Python tips'
});

const PENDING_SCENARIOS = Object.freeze([
    { type: 'weather_location', expected: 'location' },
    { type: 'travel_location', expected: 'location' },
    { type: 'translator_input', expected: 'free_text' },
    { type: 'screen_suggestion', expected: 'free_text' },
    { type: 'location_choice', expected: 'number', options: ['One', 'Two'] },
    { type: 'transport_confirmation', expected: 'yes_no' }
]);

function recordExchange(engine, threadId, userText, assistantText, source = 'text') {
    engine.recordTurn({ role: 'user', text: userText, threadId, source });
    engine.recordTurn({ role: 'assistant', text: assistantText, threadId });
}

function resolveAndRecordTopic(engine, topic, source = 'text') {
    const result = engine.resolve({ message: PROMPT.introduce(topic) });
    assert.equal(result.decisionReason, 'clear_new_intent');
    recordExchange(engine, result.activeThread.id, result.resolvedMessage, `${topic} summary.`, source);
    return result.activeThread.id;
}

function assertUsesThread(result, threadId, message = 'expected active thread') {
    assert.equal(result.activeThread.id, threadId, message);
}

function assertDoesNotUseThread(result, threadId, message = 'expected new thread') {
    assert.notEqual(result.activeThread.id, threadId, message);
}

const engine = createConversationEngine({ maxTurns: 8, maxContextChars: 600 });

let result = engine.resolve({ message: PROMPT.introduce(TOPIC.primary) });
assert.equal(result.decisionReason, 'clear_new_intent');
const primaryThread = result.activeThread.id;
recordExchange(engine, primaryThread, result.resolvedMessage, `${TOPIC.primary} is a gas giant.`);

result = engine.resolve({ message: PROMPT.followUp });
assert.equal(result.decisionReason, 'contextual_follow_up');
assert.match(result.resolvedMessage, new RegExp(TOPIC.primary, 'i'));
assertUsesThread(result, primaryThread);

engine.setPending({ type: 'weather_location', expected: 'location', threadId: primaryThread });
result = engine.resolve({ message: PROMPT.explain(TOPIC.secondary) });
assert.equal(result.decisionReason, 'clear_new_intent');
assert.equal(result.cancelledPendingState.reason, 'superseded_by_new_intent');
assertDoesNotUseThread(result, primaryThread);

engine.setPending({ type: 'location_choice', expected: 'number', options: ['Paris', 'Texas'] });
result = engine.resolve({ message: '2' });
assert.equal(result.decisionReason, 'pending_clarification_answer');

engine.setPending({ type: 'location_choice', expected: 'number', options: ['Paris', 'Texas'] });
result = engine.resolve({ message: PROMPT.listRequest });
assert.equal(result.decisionReason, 'clear_new_intent');
assert.equal(result.cancelledPendingState.type, 'location_choice');

result = engine.resolve({ message: PROMPT.acknowledgement });
assert.notEqual(result.decisionReason, 'clear_new_intent');

const currentThread = engine.getState().activeThreadId;
recordExchange(engine, currentThread, SAMPLE.usefulUser, SAMPLE.usefulAssistant);
engine.recordTurn({ role: 'assistant', text: SAMPLE.failedAssistant, threadId: currentThread, error: true });
assert.equal(engine.buildContext().some(turn => turn.text === SAMPLE.failedAssistant), false);

engine.recordTurn({ id: 'interrupted_user', turnId: 'turn_interrupted', role: 'user', text: SAMPLE.interruptedUser, threadId: currentThread });
engine.recordTurn({ id: 'interrupted_answer', turnId: 'turn_interrupted', role: 'assistant', text: SAMPLE.interruptedAssistant, threadId: currentThread });
assert.equal(engine.discardTurn('turn_interrupted'), 2);
assert.equal(engine.buildContext().some(turn => [SAMPLE.interruptedUser, SAMPLE.interruptedAssistant].includes(turn.text)), false);

const before = engine.getState();
engine.buildContext();
assert.deepEqual(engine.getState(), before, 'building regeneration context must not mutate state');

engine.resolve({ message: PROMPT.temporarySwitch(TOPIC.temporary) });
engine.recordTurn({ role: 'user', text: `${TOPIC.temporary} temporary question` });
engine.restoreState(before);
assert.deepEqual(engine.getState(), before, 'restoring a regeneration snapshot must recover the exact conversation state');

const mixedInputEngine = createConversationEngine({ maxTurns: 12, maxContextChars: 1200 });
const mixedPrimaryThread = resolveAndRecordTopic(mixedInputEngine, TOPIC.primary);

let mixed = mixedInputEngine.resolve({ message: PROMPT.followUp });
assert.equal(mixed.decisionReason, 'contextual_follow_up');
assertUsesThread(mixed, mixedPrimaryThread);
assert.match(mixed.resolvedMessage, new RegExp(TOPIC.primary, 'i'));
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: mixed.activeThread.id,
    source: 'converse'
});
assert.equal(mixedInputEngine.getState().turns.at(-1).source, 'converse');

mixed = mixedInputEngine.resolve({ message: PROMPT.explain(TOPIC.secondary) });
const secondaryThread = mixed.activeThread.id;
assertDoesNotUseThread(mixed, mixedPrimaryThread);
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: secondaryThread,
    source: 'vtt'
});

mixed = mixedInputEngine.resolve({ message: PROMPT.followUp });
assertUsesThread(mixed, secondaryThread);
assert.doesNotMatch(mixed.resolvedMessage, new RegExp(TOPIC.primary, 'i'));

mixed = mixedInputEngine.resolve({ message: PROMPT.namedEntityQuestion(TOPIC.namedEntity) });
assert.equal(mixed.decisionReason, 'clear_new_intent');
assert.doesNotMatch(mixed.resolvedMessage, new RegExp(TOPIC.secondary, 'i'));
assertDoesNotUseThread(mixed, secondaryThread);
const entityThread = mixed.activeThread.id;
recordExchange(mixedInputEngine, entityThread, mixed.resolvedMessage, `${TOPIC.namedEntity} was a mathematician.`);

mixed = mixedInputEngine.resolve({ message: PROMPT.followUp });
assert.equal(mixed.decisionReason, 'contextual_follow_up');
assert.match(mixed.resolvedMessage, new RegExp(TOPIC.namedEntity, 'i'));

mixed = mixedInputEngine.resolve({ message: PROMPT.repair });
assert.equal(mixed.decisionReason, 'conversation_repair');
assertUsesThread(mixed, entityThread);

mixed = mixedInputEngine.resolve({ message: PROMPT.resume(TOPIC.primary) });
assert.equal(mixed.decisionReason, 'explicit_thread_resume');
assertUsesThread(mixed, mixedPrimaryThread);

const topicBeforeAcknowledgement = mixedInputEngine.getState().threads
    .find(thread => thread.id === mixedPrimaryThread).topic;
mixed = mixedInputEngine.resolve({ message: PROMPT.acknowledgement });
mixedInputEngine.recordTurn({
    role: 'user',
    text: PROMPT.acknowledgement,
    threadId: mixed.activeThread.id,
    source: 'converse'
});
assert.equal(
    mixedInputEngine.getState().threads.find(thread => thread.id === mixedPrimaryThread).topic,
    topicBeforeAcknowledgement,
    'acknowledgements must not replace the active topic'
);

for (const pending of PENDING_SCENARIOS) {
    mixedInputEngine.setPending({ ...pending, threadId: mixedPrimaryThread });
    const switched = mixedInputEngine.resolve({ message: PROMPT.explain(TOPIC.pendingBypass) });
    assert.equal(switched.decisionReason, 'clear_new_intent', `${pending.type} must not intercept a new spoken intent`);
    assert.equal(switched.cancelledPendingState.type, pending.type);
}

const contextCopilotEngine = createConversationEngine({ maxTurns: 12, maxContextChars: 1200 });
let copilot = contextCopilotEngine.resolve({ message: 'Tell me about ISRO' });
assert.equal(copilot.decisionReason, 'clear_new_intent');
const isroThread = copilot.activeThread.id;
recordExchange(contextCopilotEngine, isroThread, copilot.resolvedMessage, 'ISRO summary.');

copilot = contextCopilotEngine.resolve({ message: 'latest on it' });
assert.equal(copilot.decisionReason, 'contextual_follow_up');
assert.match(copilot.resolvedMessage, /\bISRO\b/i);
recordExchange(contextCopilotEngine, isroThread, copilot.resolvedMessage, 'ISRO latest summary.');

copilot = contextCopilotEngine.resolve({ message: 'Tell me about NASA' });
assert.equal(copilot.decisionReason, 'clear_new_intent');
const nasaThread = copilot.activeThread.id;
assertDoesNotUseThread(copilot, isroThread);
recordExchange(contextCopilotEngine, nasaThread, copilot.resolvedMessage, 'NASA summary.');

copilot = contextCopilotEngine.resolve({ message: 'compare it with ISRO' });
assert.equal(copilot.decisionReason, 'contextual_follow_up');
assertUsesThread(copilot, nasaThread);
assert.match(copilot.resolvedMessage, /\bNASA\b/i);
assert.match(copilot.resolvedMessage, /\bISRO\b/i);

copilot = contextCopilotEngine.resolve({ message: 'no, I meant its latest mission' });
assert.equal(copilot.decisionReason, 'conversation_repair');
assertUsesThread(copilot, nasaThread);
assert.match(copilot.resolvedMessage, /\bNASA\b/i);

copilot = contextCopilotEngine.resolve({ message: 'go back to ISRO' });
assert.equal(copilot.decisionReason, 'explicit_thread_resume');
assertUsesThread(copilot, isroThread);

copilot = contextCopilotEngine.resolve({ message: 'who is Ada Lovelace?' });
assert.equal(copilot.decisionReason, 'clear_new_intent');
assertDoesNotUseThread(copilot, isroThread);
assert.doesNotMatch(copilot.resolvedMessage, /\bISRO\b/i);
const adaThread = copilot.activeThread.id;

const adaTopicBeforeAcknowledgement = contextCopilotEngine.getState().threads
    .find(thread => thread.id === adaThread).topic;
copilot = contextCopilotEngine.resolve({ message: 'okay' });
assert.notEqual(copilot.decisionReason, 'clear_new_intent');
contextCopilotEngine.recordTurn({ role: 'user', text: 'okay', threadId: copilot.activeThread.id });
assert.equal(
    contextCopilotEngine.getState().threads.find(thread => thread.id === adaThread).topic,
    adaTopicBeforeAcknowledgement,
    'Context Copilot acknowledgement must not overwrite active topic'
);

for (const scenario of [
    {
        anchor: 'UNICEF',
        standalone: 'Who is Marie Curie?',
        followup: 'show examples',
        followupMatch: /\bunicef\b/i
    },
    {
        anchor: 'quantum computing',
        standalone: 'What is photosynthesis?',
        followup: 'what about cost?',
        followupMatch: /\bquantum\b/i
    }
]) {
    const engineForScenario = createConversationEngine({ maxTurns: 10, maxContextChars: 1000 });
    let generic = engineForScenario.resolve({ message: `Tell me about ${scenario.anchor}` });
    const anchorThread = generic.activeThread.id;
    recordExchange(engineForScenario, anchorThread, generic.resolvedMessage, `${scenario.anchor} summary.`);

    generic = engineForScenario.resolve({ message: scenario.standalone });
    assert.equal(generic.decisionReason, 'clear_new_intent');
    assertDoesNotUseThread(generic, anchorThread, `${scenario.standalone} must not inherit ${scenario.anchor}`);
    const standaloneThread = generic.activeThread.id;
    recordExchange(engineForScenario, standaloneThread, generic.resolvedMessage, `${scenario.standalone} summary.`);

    generic = engineForScenario.resolve({ message: scenario.followup });
    assert.equal(generic.decisionReason, 'contextual_follow_up');
    assert.doesNotMatch(generic.resolvedMessage, scenario.followupMatch, 'follow-up after new standalone topic must not jump back to the old topic');
    assertUsesThread(generic, standaloneThread);
}

console.log('context-engine-tests-ok');
