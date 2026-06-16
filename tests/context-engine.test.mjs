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
recordExchange(engine, currentThread, 'Useful turn', 'Useful response');
engine.recordTurn({ role: 'assistant', text: 'Failed response', threadId: currentThread, error: true });
assert.equal(engine.buildContext().some(turn => turn.text === 'Failed response'), false);

engine.recordTurn({ id: 'interrupted_user', turnId: 'turn_interrupted', role: 'user', text: 'Interrupted question', threadId: currentThread });
engine.recordTurn({ id: 'interrupted_answer', turnId: 'turn_interrupted', role: 'assistant', text: 'Partial answer', threadId: currentThread });
assert.equal(engine.discardTurn('turn_interrupted'), 2);
assert.equal(engine.buildContext().some(turn => /Interrupted question|Partial answer/.test(turn.text)), false);

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

console.log('context-engine-tests-ok');
