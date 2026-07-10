import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSpeechInputController } from '../app/speech-input.js';

class FakeRecognition {
    static instances = [];

    constructor() {
        FakeRecognition.instances.push(this);
        this.lang = '';
        this.interimResults = false;
        this.continuous = false;
        this.maxAlternatives = 0;
        this.nextResultIndex = 0;
    }

    start() {
        this.onstart?.();
    }

    stop() {
        this.onend?.();
    }

    abort() {
        this.onend?.();
    }

    async emitResult(transcript, isFinal = true) {
        const result = [{ transcript }];
        result.isFinal = isFinal;
        const resultIndex = isFinal ? this.nextResultIndex++ : this.nextResultIndex;
        const results = [];
        results[resultIndex] = result;
        await this.onresult?.({
            resultIndex,
            results
        });
    }

    emitError(error) {
        this.onerror?.({ error });
    }

    end() {
        this.onend?.();
    }
}

const SAMPLE = Object.freeze({
    dictation: 'alpha beta',
    converse: 'gamma delta',
    interrupt: 'epsilon zeta',
    stale: 'eta theta'
});

function wait(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const finalEvents = [];
const interimEvents = [];
const states = [];
const errors = [];
const controller = createSpeechInputController({
    Recognition: FakeRecognition,
    language: 'en-IN',
    onInterim: text => interimEvents.push(text),
    onFinal: (text, event) => finalEvents.push({ text, ...event }),
    onState: state => states.push(state),
    onError: error => errors.push(error)
});

assert.equal(controller.getState().supported, true);
assert.equal(controller.toggleDictation(), true);
assert.equal(FakeRecognition.instances[0].lang, 'en-IN');
assert.equal(FakeRecognition.instances[0].continuous, true);
await FakeRecognition.instances[0].emitResult(SAMPLE.dictation, false);
assert.equal(interimEvents.at(-1), SAMPLE.dictation);
await FakeRecognition.instances[0].emitResult(SAMPLE.dictation, true);
assert.equal(finalEvents.at(-1).text, SAMPLE.dictation);
assert.equal(finalEvents.at(-1).autoSubmit, false);
assert.equal(finalEvents.at(-1).mode, 'dictation');
assert.ok(finalEvents.at(-1).transcriptId);
assert.equal(finalEvents.at(-1).sessionId, 1);
assert.equal(controller.getState().mode, 'dictation');
assert.equal(controller.getState().listening, true);
assert.equal(controller.getState().submittedResultIds.length, 1);
assert.equal(controller.toggleDictation(), false);
assert.equal(controller.getState().mode, 'idle');

assert.equal(controller.setLanguage('ta-IN'), 'en-US');
assert.equal(controller.toggleConverse(), true);
const converseRecognition = FakeRecognition.instances.at(-1);
assert.equal(converseRecognition.lang, 'en-US');
assert.equal(converseRecognition.continuous, true);
assert.equal(controller.getState().converseEnabled, true);

controller.setProcessing(true);
assert.equal(controller.getState().processing, true);
assert.equal(controller.getState().listening, true);
assert.equal(controller.getState().interruptible, true);
controller.stop({ disableConverse: true });
assert.equal(controller.getState().converseEnabled, false);
assert.equal(errors.length, 0);
assert.ok(states.length > 0);

let autoSubmitted = null;
let autoSubmitCount = 0;
let converseController;
converseController = createSpeechInputController({
    Recognition: FakeRecognition,
    converseSilenceMs: 5,
    converseMaxWaitMs: 50,
    onFinal: async (text, event) => {
        autoSubmitCount += 1;
        autoSubmitted = { text, ...event };
        converseController.setProcessing(true);
    }
});
converseController.toggleConverse();
const submittedRecognition = FakeRecognition.instances.at(-1);
await submittedRecognition.emitResult(SAMPLE.converse, true);
assert.equal(autoSubmitCount, 0, 'Converse final chunks should wait briefly for the full spoken question');
await wait(12);
assert.equal(autoSubmitted.text, SAMPLE.converse);
assert.equal(autoSubmitted.autoSubmit, true);
assert.equal(autoSubmitted.mode, 'converse');
assert.equal(autoSubmitted.source, 'converse');
assert.equal(autoSubmitted.transcriptFinal, true);
assert.equal(autoSubmitted.transcriptCompleteReason, 'silence');
assert.ok(autoSubmitted.sessionId);
assert.ok(autoSubmitted.transcriptId);
assert.equal(autoSubmitCount, 1);
assert.equal(converseController.getState().processing, true);
assert.equal(converseController.getState().listening, true);

await submittedRecognition.emitResult(SAMPLE.converse, true);
await wait(12);
assert.equal(autoSubmitCount, 1, 'duplicate or late final results must not submit twice');

await submittedRecognition.emitResult(SAMPLE.interrupt, true);
await wait(12);
assert.equal(autoSubmitCount, 2, 'a new finalized Converse result may interrupt an active response');
assert.equal(autoSubmitted.interrupt, true);

const instancesBeforeResume = FakeRecognition.instances.length;
converseController.setProcessing(false);
await Promise.resolve();
assert.equal(
    FakeRecognition.instances.length,
    instancesBeforeResume,
    'Converse recognition must remain active instead of restarting after each response'
);
assert.equal(converseController.getState().listening, true);
assert.equal(converseController.getState().restartRequested, false);

const activeRecognition = FakeRecognition.instances.at(-1);
converseController.setLanguage('hi-IN');
await Promise.resolve();
assert.equal(FakeRecognition.instances.at(-1).lang, 'en-US');
assert.notEqual(FakeRecognition.instances.at(-1), activeRecognition);
await activeRecognition.emitResult(SAMPLE.stale, true);
await wait(12);
assert.equal(autoSubmitCount, 2, 'stale final results from an old session must not submit');
await FakeRecognition.instances.at(-1).emitResult(SAMPLE.interrupt, true);
await wait(12);
assert.equal(autoSubmitCount, 2, 'rapid duplicate Converse transcripts must not submit across restarted sessions');

converseController.stop({ disableConverse: true });

let bufferedSubmit = null;
const bufferedController = createSpeechInputController({
    Recognition: FakeRecognition,
    converseSilenceMs: 5,
    converseMaxWaitMs: 50,
    onFinal: async (text, event) => {
        bufferedSubmit = { text, ...event };
    }
});
bufferedController.toggleConverse();
const bufferedRecognition = FakeRecognition.instances.at(-1);
await bufferedRecognition.emitResult('first part', true);
await bufferedRecognition.emitResult('second part', true);
assert.equal(bufferedSubmit, null);
await wait(12);
assert.equal(bufferedSubmit.text, 'first part second part');
assert.equal(bufferedSubmit.transcriptCompleteReason, 'silence');
bufferedController.stop({ disableConverse: true });

const fatalErrors = [];
const fatalController = createSpeechInputController({
    Recognition: FakeRecognition,
    onError: message => fatalErrors.push(message)
});
fatalController.toggleConverse();
FakeRecognition.instances.at(-1).emitError('not-allowed');
FakeRecognition.instances.at(-1).end();
await Promise.resolve();
assert.equal(fatalController.getState().converseEnabled, false);
assert.match(fatalErrors.at(-1), /permission was denied/i);

const unsupportedErrors = [];
const unsupportedController = createSpeechInputController({
    Recognition: undefined,
    onError: message => unsupportedErrors.push(message)
});
assert.equal(unsupportedController.toggleDictation(), false);
assert.match(unsupportedErrors.at(-1), /not supported/i);

const recoverableErrors = [];
const recoverableController = createSpeechInputController({
    Recognition: FakeRecognition,
    onError: message => recoverableErrors.push(message)
});
recoverableController.toggleConverse();
const noSpeechRecognition = FakeRecognition.instances.at(-1);
const beforeNoSpeechRestart = FakeRecognition.instances.length;
noSpeechRecognition.emitError('no-speech');
noSpeechRecognition.end();
await Promise.resolve();
assert.match(recoverableErrors.at(-1), /no speech was detected/i);
assert.equal(FakeRecognition.instances.length, beforeNoSpeechRestart + 1);
assert.equal(recoverableController.getState().converseEnabled, true);
recoverableController.stop({ disableConverse: true });

const source = fs.readFileSync(new URL('../app/speech-input.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance|AudioContext|new Audio\s*\(/);
assert.doesNotMatch(source, /setTimeout\s*\([^)]*startRecognition|scheduleConverseRestart/);
assert.match(source, /const toggleConverseController = controller\.toggleConverse/);
assert.match(source, /const toggled = toggleConverseController\(\)/);
assert.match(source, /stopActiveGeneration\?\.\('converse_stop'\)/);
assert.match(source, /interrupt:\s*processing/);
assert.match(source, /transcriptCompleteReason/);

console.log('speech-input-tests-ok');
