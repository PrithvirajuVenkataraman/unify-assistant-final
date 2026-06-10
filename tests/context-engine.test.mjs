import assert from 'node:assert/strict';
import { createConversationEngine } from '../app/context-engine.js';

const engine = createConversationEngine({ maxTurns: 8, maxContextChars: 600 });

let result = engine.resolve({ message: 'Tell me about Saturn' });
assert.equal(result.decisionReason, 'clear_new_intent');
const saturnThread = result.activeThread.id;
engine.recordTurn({ role: 'user', text: result.resolvedMessage, threadId: saturnThread });
engine.recordTurn({ role: 'assistant', text: 'Saturn is a gas giant.', threadId: saturnThread });

result = engine.resolve({ message: 'Tell me more about it' });
assert.equal(result.decisionReason, 'contextual_follow_up');
assert.match(result.resolvedMessage, /Saturn/i);
assert.equal(result.activeThread.id, saturnThread);

engine.setPending({ type: 'weather_location', expected: 'location', threadId: saturnThread });
result = engine.resolve({ message: 'Explain photosynthesis' });
assert.equal(result.decisionReason, 'clear_new_intent');
assert.equal(result.cancelledPendingState.reason, 'superseded_by_new_intent');
assert.notEqual(result.activeThread.id, saturnThread);

engine.setPending({ type: 'location_choice', expected: 'number', options: ['Paris', 'Texas'] });
result = engine.resolve({ message: '2' });
assert.equal(result.decisionReason, 'pending_clarification_answer');

engine.setPending({ type: 'location_choice', expected: 'number', options: ['Paris', 'Texas'] });
result = engine.resolve({ message: 'Give me 10 Python tips' });
assert.equal(result.decisionReason, 'clear_new_intent');
assert.equal(result.cancelledPendingState.type, 'location_choice');

result = engine.resolve({ message: 'okay' });
assert.notEqual(result.decisionReason, 'clear_new_intent');

const currentThread = engine.getState().activeThreadId;
engine.recordTurn({ role: 'user', text: 'Useful turn', threadId: currentThread });
engine.recordTurn({ role: 'assistant', text: 'Useful response', threadId: currentThread });
engine.recordTurn({ role: 'assistant', text: 'Failed response', threadId: currentThread, error: true });
assert.equal(engine.buildContext().some(turn => turn.text === 'Failed response'), false);

engine.recordTurn({ id: 'interrupted_user', turnId: 'turn_interrupted', role: 'user', text: 'Interrupted question', threadId: currentThread });
engine.recordTurn({ id: 'interrupted_answer', turnId: 'turn_interrupted', role: 'assistant', text: 'Partial answer', threadId: currentThread });
assert.equal(engine.discardTurn('turn_interrupted'), 2);
assert.equal(engine.buildContext().some(turn => /Interrupted question|Partial answer/.test(turn.text)), false);

const before = engine.getState();
engine.buildContext();
assert.deepEqual(engine.getState(), before, 'building regeneration context must not mutate state');

engine.resolve({ message: 'Switch to a temporary topic about Mars' });
engine.recordTurn({ role: 'user', text: 'Temporary Mars question' });
engine.restoreState(before);
assert.deepEqual(engine.getState(), before, 'restoring a regeneration snapshot must recover the exact conversation state');

const mixedInputEngine = createConversationEngine({ maxTurns: 12, maxContextChars: 1200 });
let mixed = mixedInputEngine.resolve({ message: 'Tell me about Saturn' });
const mixedSaturnThread = mixed.activeThread.id;
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: mixedSaturnThread,
    source: 'text'
});
mixedInputEngine.recordTurn({
    role: 'assistant',
    text: 'Saturn has a prominent ring system.',
    threadId: mixedSaturnThread
});

mixed = mixedInputEngine.resolve({ message: 'Tell me more about it' });
assert.equal(mixed.decisionReason, 'contextual_follow_up');
assert.equal(mixed.activeThread.id, mixedSaturnThread);
assert.match(mixed.resolvedMessage, /Saturn/i);
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: mixed.activeThread.id,
    source: 'converse'
});
assert.equal(mixedInputEngine.getState().turns.at(-1).source, 'converse');

mixed = mixedInputEngine.resolve({ message: 'Explain photosynthesis' });
const photosynthesisThread = mixed.activeThread.id;
assert.notEqual(photosynthesisThread, mixedSaturnThread);
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: photosynthesisThread,
    source: 'vtt'
});

mixed = mixedInputEngine.resolve({ message: 'Tell me more about it' });
assert.equal(mixed.activeThread.id, photosynthesisThread);
assert.doesNotMatch(mixed.resolvedMessage, /Saturn/i);

mixed = mixedInputEngine.resolve({ message: 'No, I meant explain its practical use' });
assert.equal(mixed.decisionReason, 'conversation_repair');
assert.equal(mixed.activeThread.id, photosynthesisThread);

mixed = mixedInputEngine.resolve({ message: 'Go back to Saturn' });
assert.equal(mixed.decisionReason, 'explicit_thread_resume');
assert.equal(mixed.activeThread.id, mixedSaturnThread);

const topicBeforeAcknowledgement = mixedInputEngine.getState().threads
    .find(thread => thread.id === mixedSaturnThread).topic;
mixed = mixedInputEngine.resolve({ message: 'okay' });
mixedInputEngine.recordTurn({
    role: 'user',
    text: 'okay',
    threadId: mixed.activeThread.id,
    source: 'converse'
});
assert.equal(
    mixedInputEngine.getState().threads.find(thread => thread.id === mixedSaturnThread).topic,
    topicBeforeAcknowledgement,
    'acknowledgements must not replace the active topic'
);

for (const pending of [
    { type: 'weather_location', expected: 'location' },
    { type: 'travel_location', expected: 'location' },
    { type: 'translator_input', expected: 'free_text' },
    { type: 'screen_suggestion', expected: 'free_text' },
    { type: 'location_choice', expected: 'number', options: ['One', 'Two'] },
    { type: 'transport_confirmation', expected: 'yes_no' }
]) {
    mixedInputEngine.setPending({ ...pending, threadId: mixedSaturnThread });
    const switched = mixedInputEngine.resolve({ message: 'Explain quantum computing' });
    assert.equal(switched.decisionReason, 'clear_new_intent', `${pending.type} must not intercept a new spoken intent`);
    assert.equal(switched.cancelledPendingState.type, pending.type);
}

console.log('context-engine-tests-ok');
