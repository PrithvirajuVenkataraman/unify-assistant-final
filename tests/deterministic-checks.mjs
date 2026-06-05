import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import currentFactsHandler, { __test as currentFacts } from '../api/current-facts.js';

const scienceCode = fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8');
const appHtml = fs.readFileSync(new URL('../index.full_with_map_preview.html', import.meta.url), 'utf8');
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

const hexSpeech = science.normalizeScienceSpeech('0xFF equals 255.');
assert.equal(hexSpeech, 'hex F F equals 255.');

const sciSpeech = science.normalizeScienceSpeech('Force uses 9.1093837e-31 kg and 2.3e15 m/s^2.');
assert.match(sciSpeech, /9\.1093837 times 10 to the -31 kilograms/);
assert.match(sciSpeech, /2\.3 times 10 to the 15 meters per second squared/);

const chemSpeech = science.normalizeScienceSpeech('C2H6 + O2 -> CO2 + H2O');
assert.match(chemSpeech, /C 2 H 6/);
assert.match(chemSpeech, /yields/);

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

const converseStateSetter = appHtml.match(
    /function setConverseSessionState\(state\)\s*\{([\s\S]*?)\n\s*\}/
)?.[1] || '';
assert.ok(converseStateSetter, 'Converse state setter exists');
assert.doesNotMatch(
    converseStateSetter,
    /showTemporaryMessage/,
    'routine Converse states must not create chat messages'
);

assert.match(appHtml, /const conversationTurns = new Map\(\)/);
assert.match(appHtml, /function createConversationTurn\(/);
assert.match(appHtml, /replaceMessageId:\s*messageId/);
assert.match(appHtml, /window\.__lastUserMessage = previousLastUserMessage/);
assert.match(appHtml, /if \(isConverse\) rate \*= 0\.95/);
assert.match(appHtml, /playbackRate(?:\.value)? = converseMode \? 0\.95 : 1/);
assert.match(appHtml, /async function startBargeInMonitor\(/);
assert.match(appHtml, /echoCancellation:\s*true/);
assert.match(appHtml, /converseSession\.micOwner = 'barge_in'/);

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
