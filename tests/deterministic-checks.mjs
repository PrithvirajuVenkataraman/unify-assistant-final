import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import currentFactsHandler, { __test as currentFacts } from '../api/current-facts.js';

const SOURCE = Object.freeze({ 
    science: fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8'), 
    appHtml: fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    visionApi: fs.readFileSync(new URL('../api/vision.js', import.meta.url), 'utf8'),
    speechInput: fs.readFileSync(new URL('../app/speech-input.js', import.meta.url), 'utf8') 
}); 

const SAMPLE = Object.freeze({
    sciA: '6.022e23',
    sciB: '1.602176634e-19 C',
    sciC: '9.1093837e-31 kg',
    sciD: '2.3e15 m/s^2',
    sciCOut: '9.1093837 times 10 to the -31 kilograms',
    sciDOut: '2.3 times 10 to the 15 meters per second squared',
    hexIn: '0xFF',
    hexOut: 'hex F F',
    decimal: '255',
    chem: 'C2H6 + O2 -> CO2 + H2O',
    chemOut: 'C 2 H 6',
    relationOut: 'yields',
    liveQuery: 'q q'
});

const FEATURE_CONTRACTS = Object.freeze({
    composer: {
        required: [
            /id="send-message-btn"/,
            /id="voice-to-text-btn"/,
            /async function sendTextInput\(submission = \{\}\)/,
            /function clearSubmittedPromptBox\(/,
            /clearSubmittedPromptBox\(outgoingText, normalizedOutgoingText\)/,
            /submission\?\.source \|\| input\.dataset\.inputSource/
        ],
        forbidden: [
            /id="converse-mode-btn"/,
            /speechSynthesis|SpeechSynthesisUtterance|\/api\/speech/,
            /minimumThinkMs|new Promise\(resolve => setTimeout\(resolve,\s*250\)\)/
        ]
    },
    conversationState: {
        required: [
            /const conversationTurns = new Map\(\)/,
            /function createConversationTurn\(/,
            /replaceMessageId:\s*messageId/,
            /window\.__lastUserMessage = previousLastUserMessage/,
            /JarvisConversation\?\.resolve/,
            /clearSupersededConversationState/,
            /originalUserText:\s*String\(contextResolution\.originalMessage/,
            /contextSnapshot:\s*Array\.isArray\(conversationContext\)/
        ]
    },
    selectionHelper: {
        required: [
            /data-selection-action="explain"/,
            /data-selection-action="verify"/,
            /intent:\s*`selection_\$\{normalizedAction\}`/
        ],
        forbidden: [/function buildGroundedAskPrompt/]
    },
    customInstructions: {
        required: [
            /let customSystemPrompt = ''/,
            /id="custom-system-prompt-input"/,
            /function setCustomSystemPrompt\(/,
            /customSystemPrompt/
        ],
        forbidden: [/class="response-style-card"/]
    },
    spinnerOnlyLoading: {
        required: [
            /<span id="chat-thinking-text" class="sr-only">Generating answer<\/span>/
        ],
        forbidden: [
            /id="chat-thinking-phase"/,
            /I'll stop here because the response appears to have been cut off/
        ]
    },
    visionMode: { 
        required: [ 
            /waitForContinuousVisionReady/, 
            /what am i holding/,
            /function isWebsiteUiVisionIntent/,
            /visible branding, logo, page title, header, or app chrome/,
            /extractVisibleDomainFromVisionDetails/,
            /Do not guess or use web search/
        ] 
    }, 
    helpAndVoice: {
        required: [
            /const supportedLanguages = Object\.freeze/,
            /filipino: \{ name: 'Filipino'/,
            /spanish: \{ name: 'Spanish'/,
            /malayalam: \{ name: 'Malayalam'/
        ],
        forbidden: [
            /<label for="speech-language-select" class="font-bold">Voice input<\/label>/,
            /id="speech-language-select"/,
            /Availability depends on your browser and device speech recognizer/,
            /Privacy and answer quality/,
            /real-time facts are not externally verified/
        ]
    },
    ocrCamera: {
        required: [
            /class="ocr-camera-text-action"/,
            /class="ocr-camera-text-action ocr-camera-primary-action"/,
            /class="camera-ocr-text-result"/,
            /const framesToAttempt = isMathOcrTask \? variantFrames\.slice\(0, 1\) : variantFrames/
        ],
        forbidden: [
            /onclick="closeCameraMode\(\)" class="px-6 py-3 rounded-xl bg-white/,
            /onclick="switchCameraLens\(\)" class="px-4 py-3 rounded-xl bg-slate-200/,
            /id="capture-btn" onclick="captureAndProcessOCR\(\)" class="flex-1 px-6 py-3 rounded-xl bg-emerald-600/
        ]
    },
    interruptionAndFeedback: {
        required: [
            /stopActiveGeneration\('converse_interruption'\)/,
            /assistant-message-interrupted/,
            /function addFeedbackButtons\(query, response, assistantMessageId = ''\)/,
            /targetMessage\.insertAdjacentElement\('afterend', feedbackDiv\)/,
            /return messageId;/
        ]
    },
    regeneration: {
        required: [
            /let regenerationInProgress = false/,
            /function commitRegenerationCandidate\(/,
            /function discardRegenerationCandidate\(/,
            /activeResponseRenderContext\.replacementCandidate = \{/
        ],
        forbidden: [
            /priorUserPrompt:\s*String\(meta\?\.priorUserPrompt \|\| window\.__lastUserMessage/
        ]
    },
    backgroundTripEvents: {
        required: [/detached: true\s*\}\);\s*maybeNotifyTripEvent/]
    }
});

function assertContracts(source, contracts) {
    for (const [group, contract] of Object.entries(contracts)) {
        for (const pattern of contract.required || []) {
            assert.match(source, pattern, `${group}: expected source to match ${pattern}`);
        }
        for (const pattern of contract.forbidden || []) {
            assert.doesNotMatch(source, pattern, `${group}: expected source not to match ${pattern}`);
        }
    }
}

const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SOURCE.science, sandbox);
const science = sandbox.JarvisScienceFormat;

assert.ok(science, 'science formatter is exposed');

const sciHtml = science.enhancePlainText(`${SAMPLE.sciA} mol^-1 ${SAMPLE.sciB}.`);
assert.match(sciHtml, /science-value-sci/);
assert.match(sciHtml, new RegExp(SAMPLE.sciA.replace('.', '\\.')));
assert.match(sciHtml, new RegExp(SAMPLE.sciB.replace('.', '\\.')));

const hexText = science.normalizeScienceText(`${SAMPLE.hexIn} ${SAMPLE.decimal}.`);
assert.equal(hexText, `${SAMPLE.hexOut} ${SAMPLE.decimal}.`);

const sciText = science.normalizeScienceText(`${SAMPLE.sciC} ${SAMPLE.sciD}.`);
assert.match(sciText, new RegExp(SAMPLE.sciCOut.replace('.', '\\.')));
assert.match(sciText, new RegExp(SAMPLE.sciDOut.replace('.', '\\.')));

const chemText = science.normalizeScienceText(SAMPLE.chem);
assert.match(chemText, new RegExp(SAMPLE.chemOut.replaceAll(' ', '\\s+')));
assert.match(chemText, new RegExp(SAMPLE.relationOut));

assert.equal(currentFacts.liveDisabledResponse.disabled, true);
assert.equal(currentFacts.liveDisabledResponse.success, false);

const disabledApi = await callJsonHandler(currentFactsHandler, {
    method: 'POST',
    url: '/api/current-facts',
    headers: { 'content-type': 'application/json' },
    body: { query: SAMPLE.liveQuery }
});
assert.equal(disabledApi.statusCode, 503);
assert.equal(disabledApi.body.disabled, true);
assert.equal(disabledApi.body.resolved, false);

assert.match(SOURCE.appHtml, /let responseStyle = 'balanced'/);
assert.match(SOURCE.appHtml, /\['balanced', 'witty', 'chatty', 'supportive', 'debate'\]/);
assert.match(SOURCE.appHtml, /preserveTranscript \|\| isLikelyCodeInput/);
assert.match(SOURCE.appHtml, /app\/bootstrap\.js/); 
assertContracts(SOURCE.appHtml, FEATURE_CONTRACTS); 
assert.match(SOURCE.visionApi, /function shouldEscalateMathOcrSolve/);
assert.match(SOURCE.visionApi, /pipeline:\s*'fast-math-ocr-solve'/);
assert.match(SOURCE.visionApi, /pipeline:\s*'planner-critic-solver'/);
assert.match(SOURCE.speechInput, /try English or another language/);

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
