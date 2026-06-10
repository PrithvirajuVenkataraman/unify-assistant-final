import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import currentFactsHandler, { __test as currentFacts } from '../api/current-facts.js';

const scienceCode = fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8');
const appHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(scienceCode, sandbox);
const science = sandbox.JarvisScienceFormat;

assert.ok(science, 'science formatter is exposed');

const sciHtml = science.enhancePlainText('Avogadro constant is 6.022e23 mol^-1 and charge is 1.602176634e-19 C.');
assert.match(sciHtml, /science-value-sci/);
assert.match(sciHtml, /6\.022e23/);
assert.match(sciHtml, /1\.602176634e-19 C/);

const hexText = science.normalizeScienceText('0xFF equals 255.');
assert.equal(hexText, 'hex F F equals 255.');

const sciText = science.normalizeScienceText('Force uses 9.1093837e-31 kg and 2.3e15 m/s^2.');
assert.match(sciText, /9\.1093837 times 10 to the -31 kilograms/);
assert.match(sciText, /2\.3 times 10 to the 15 meters per second squared/);

const chemText = science.normalizeScienceText('C2H6 + O2 -> CO2 + H2O');
assert.match(chemText, /C 2 H 6/);
assert.match(chemText, /yields/);

assert.equal(currentFacts.liveDisabledResponse.disabled, true);
assert.equal(currentFacts.liveDisabledResponse.success, false);

const disabledApi = await callJsonHandler(currentFactsHandler, {
    method: 'POST',
    url: '/api/current-facts',
    headers: { 'content-type': 'application/json' },
    body: { query: 'What happened in the latest IPL match?' }
});
assert.equal(disabledApi.statusCode, 503);
assert.equal(disabledApi.body.disabled, true);
assert.equal(disabledApi.body.resolved, false);

assert.match(appHtml, /const conversationTurns = new Map\(\)/);
assert.match(appHtml, /function createConversationTurn\(/);
assert.match(appHtml, /replaceMessageId:\s*messageId/);
assert.match(appHtml, /window\.__lastUserMessage = previousLastUserMessage/);
assert.match(appHtml, /id="send-message-btn"/);
assert.match(appHtml, /id="voice-to-text-btn"/);
assert.doesNotMatch(appHtml, /id="converse-mode-btn"/);
assert.doesNotMatch(appHtml, /speechSynthesis|SpeechSynthesisUtterance|\/api\/speech/);
assert.doesNotMatch(appHtml, /minimumThinkMs|new Promise\(resolve => setTimeout\(resolve,\s*250\)\)/);
assert.match(appHtml, /async function sendTextInput\(submission = \{\}\)/);
assert.match(appHtml, /preserveTranscript \|\| isLikelyCodeInput/);
assert.match(appHtml, /submission\?\.source \|\| input\.dataset\.inputSource/);
assert.match(appHtml, /app\/bootstrap\.js/);
assert.match(appHtml, /JarvisConversation\?\.resolve/);
assert.match(appHtml, /clearSupersededConversationState/);
assert.match(appHtml, /data-selection-action="explain"/);
assert.match(appHtml, /data-selection-action="verify"/);
assert.match(appHtml, /intent:\s*`selection_\$\{normalizedAction\}`/);
assert.doesNotMatch(appHtml, /function buildGroundedAskPrompt/);
assert.match(appHtml, /let responseStyle = 'balanced'/);
assert.match(appHtml, /\['balanced', 'witty', 'chatty', 'supportive', 'debate'\]/);
assert.match(appHtml, /stopActiveGeneration\('converse_interruption'\)/);
assert.match(appHtml, /assistant-message-interrupted/);

assert.match(appHtml, /detached: true\s*\}\);\s*maybeNotifyTripEvent/);

assert.match(appHtml, /let regenerationInProgress = false/);
assert.match(appHtml, /function commitRegenerationCandidate\(/);
assert.match(appHtml, /function discardRegenerationCandidate\(/);
assert.match(appHtml, /activeResponseRenderContext\.replacementCandidate = \{/);
assert.doesNotMatch(
    appHtml,
    /priorUserPrompt:\s*String\(meta\?\.priorUserPrompt \|\| window\.__lastUserMessage/
);

assert.match(appHtml, /function addFeedbackButtons\(query, response, assistantMessageId = ''\)/);
assert.match(appHtml, /targetMessage\.insertAdjacentElement\('afterend', feedbackDiv\)/);
assert.match(appHtml, /return messageId;/);
assert.match(appHtml, /contextSnapshot:\s*Array\.isArray\(conversationContext\)/);

console.log('deterministic-checks-ok');

async function callJsonHandler(handler, req) {
    const res = {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) {
            this.headers[name] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    await handler(req, res);
    return res;
}
