import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { __test as currentFacts } from '../api/current-facts.js';

const scienceCode = fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8');
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

const result = currentFacts.extractSportsResult('GT won by 7 wickets after RR 214/6 and GT 219/3.');
assert.ok(result?.answer);
assert.match(result.answer, /Gujarat Titans/);
assert.match(result.answer, /Rajasthan Royals/);

const weak = currentFacts.classifySourceCategory({
    title: 'IPL 2026 Fixtures, Live Score, Schedule, Points Table',
    description: 'All fixtures and standings'
});
assert.equal(weak, 'weak_preview_or_context');

const strong = currentFacts.classifySourceCategory({
    title: 'GT won by 7 wickets in IPL Qualifier 2',
    description: 'Gujarat Titans beat Rajasthan Royals'
});
assert.equal(strong, 'post_event_result');

const intent = currentFacts.classifyCurrentFact('What happened in the latest IPL match?');
assert.equal(intent.domain, 'sports');
assert.equal(intent.factType, 'result');

console.log('deterministic-checks-ok');
