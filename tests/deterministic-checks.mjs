import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import currentFactsHandler, { __test as currentFacts } from '../api/current-facts.js';
import { routeMessage } from '../api/lib/router.js';
import { clearItems, saveItems } from '../api/lib/latest-cache.js';

const SOURCE = Object.freeze({ 
    science: fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8'), 
    readme: fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
    appHtml: fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    styles: fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8'),
    visionApi: fs.readFileSync(new URL('../api/vision.js', import.meta.url), 'utf8'),
    chatGroqApi: fs.readFileSync(new URL('../api/chat-groq.js', import.meta.url), 'utf8'),
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
            /aria-label="\$\{escapeHtml\(statusText\)\}"/,
            /class="assistant-thinking-pulse/
        ],
        forbidden: [
            /id="chat-thinking-phase"/,
            /assistant-thinking-spinner/,
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
            /Use Live Vision for camera-based questions/
        ],
        forbidden: [
            /OCR camera/,
            /id="camera-modal"/,
            /onclick="captureAndProcessOCR\(\)"/,
            /function openCameraMode\(/,
            /function captureAndProcessOCR\(/,
            /class="ocr-camera-text-action"/,
            /class="camera-ocr-text-result"/
        ]
    },
    interruptionAndFeedback: {
        required: [
            /let converseQueuedSubmissionSequence = 0/,
            /const queuedSubmissionId = \+\+converseQueuedSubmissionSequence/,
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
    },
    localClaimRiskFlags: {
        required: [
            /function analyzeAnswerRiskFlags\(userMessage, assistantText\)/,
            /Local review flags:\\n\$\{flags\}/
        ],
        forbidden: [
            /class="claim-risk-badge"/,
            /custom-autocorrect-input/,
            /jarvis_custom_autocorrect_rules/,
            /applyCustomAutocorrectRules/,
            /Autocorrect dictionary/
        ]
    },
    wakeGreetingAndAddressPreference: {
        required: [
            /let preferredAddress = AppState\.user\.preferredAddress/,
            /function normalizePreferredAddress\(value\)/,
            /function isWakeGreetingText\(text\)/,
            /function handlePreferredAddressRequest\(text\)/,
            /preferredAddress: getPreferredAddress\(\)/,
            /preferredAddress = normalizePreferredAddress\(data\.preferredAddress\) \|\| 'sir'/,
            /if \(handlePreferredAddressRequest\(compact\)\)/,
            /if \(isWakeGreetingText\(compact\)\)/
        ],
        forbidden: [
            /const greet = userName \? `Hi \$\{userName\}, how can I help today\?`/
        ]
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
assert.equal(routeMessage('guitar strings').route, 'llm');
assert.equal(routeMessage('guitar chords').route, 'llm');
assert.equal(routeMessage('explain transformer attention').route, 'llm');
assert.equal(routeMessage('latest OpenAI news').route, 'cached_latest');
assert.equal(routeMessage('latest React release').route, 'cached_latest');
assert.equal(routeMessage('weather today').route, 'live_required');
assert.equal(routeMessage('bitcoin price now').route, 'live_required');
assert.equal(routeMessage('restaurants near me').route, 'live_required');
assert.match(SOURCE.styles, /\.chat-bubble-user\s*\{[\s\S]*background:\s*transparent !important/);
assert.match(SOURCE.styles, /\.chat-bubble-assistant\s*\{[\s\S]*background:\s*transparent !important/);
assert.match(SOURCE.styles, /body\.dark \.chat-bubble-assistant\s*\{[\s\S]*background:\s*transparent !important[\s\S]*border:\s*none !important[\s\S]*padding:\s*0 !important/);
assert.match(SOURCE.styles, /body \.chat-row \.chat-bubble-user,\s*body \.chat-row \.chat-bubble-assistant,[\s\S]*border:\s*none !important[\s\S]*border-radius:\s*0 !important/);
assert.match(SOURCE.styles, /\.selection-helper-popover\s*\{[\s\S]*display:\s*none !important[\s\S]*visibility:\s*hidden !important[\s\S]*pointer-events:\s*none !important/);
assert.match(SOURCE.styles, /\.selection-helper-popover\.visible\s*\{[\s\S]*display:\s*flex !important[\s\S]*visibility:\s*visible !important/);
assert.match(SOURCE.styles, /\.assistant-thinking-pulse\s*\{/);
assert.match(SOURCE.styles, /@keyframes jarvis-thinking-pulse/);
assert.doesNotMatch(SOURCE.styles, /assistant-thinking-spinner/);
assert.match(SOURCE.styles, /\.assistant-message-text a\s*\{[\s\S]*color:\s*#ffffff !important/);
assert.doesNotMatch(SOURCE.appHtml, /chat-bubble-user text-white px-4 py-3/);
assert.match(SOURCE.appHtml, /popover\.hidden = true/);
assert.match(SOURCE.appHtml, /popover\.hidden = false/);
assert.match(SOURCE.appHtml, /function isJarvisTechStackRequest/);
assert.match(SOURCE.appHtml, /openai\/gpt-oss-120b/);
assert.match(SOURCE.appHtml, /gemini-2\.5-flash-lite/);
assert.match(SOURCE.appHtml, /free public-source aggregation through Wikipedia, GDELT, and official shortcuts first/);
assert.match(SOURCE.appHtml, /optionally Gemini-assisted for query planning, ranking, and snippets/);
assert.match(SOURCE.appHtml, /optional Serper via SERPER_API_KEY fallback/);
assert.match(SOURCE.appHtml, /function buildContextCopilotBadgeHtml/);
assert.match(SOURCE.appHtml, /function shouldShowContextCopilotBadge/);
assert.match(SOURCE.appHtml, /contextual_follow_up/);
assert.doesNotMatch(SOURCE.appHtml, /alwaysShowContextCopilotBadge\s*=\s*true/);
assert.match(SOURCE.appHtml, /function splitReadableSentences\(text\)/);
assert.ok(SOURCE.appHtml.includes("char === '.' && /\\d/.test(prev) && /\\d/.test(next)"));
assert.match(SOURCE.appHtml, /if \(isUser && !rawDisplayText\.trim\(\)\) return/);
assert.doesNotMatch(SOURCE.appHtml, /rawText\.match\(\s*\/\[\^\.\!\?\]\+\[\.\!\?\]\+\/g/);
assert.match(SOURCE.appHtml, /const targeted = raw\s*\.replace\(\/\\bcief\\b\/gi, 'chief'\)/);
assert.match(SOURCE.appHtml, /\.replace\(\/\\brtamilnadu\\b\/gi, 'Tamil Nadu'\)/);
assert.doesNotMatch(SOURCE.appHtml, /customAutocorrectRules/);
assert.match(SOURCE.readme, /Standout Feature: Context Copilot/);
assert.match(SOURCE.readme, /local, deterministic, private, and free-for-life/);
assert.match(SOURCE.appHtml, /localStorage when memory persistence is enabled/);
assert.doesNotMatch(SOURCE.appHtml, /handleComposerAction\('ocr'\)/);

clearItems();
saveItems([{
    title: 'OpenAI announces a new API update',
    url: 'https://openai.com/news/example-api-update',
    summary: 'A cached OpenAI update for freshness checks.',
    source: 'OpenAI News',
    publishedAt: new Date().toISOString()
}]);

const currentFactsApi = await callJsonHandler(currentFactsHandler, {
    method: 'POST',
    url: '/api/current-facts',
    headers: { 'content-type': 'application/json' },
    body: { query: 'latest OpenAI news' }
});
assert.equal(currentFactsApi.statusCode, 200);
assert.equal(currentFactsApi.body.disabled, false);
assert.equal(currentFactsApi.body.resolved, true);
assert.equal(currentFactsApi.body.sources[0].source, 'OpenAI News');

assert.match(SOURCE.appHtml, /let responseStyle = 'balanced'/);
assert.match(SOURCE.appHtml, /\['balanced', 'witty', 'chatty', 'supportive', 'debate'\]/);
assert.match(SOURCE.appHtml, /const normalizedOutgoingText = isLikelyCodeInput\(outgoingText\)/);
assert.match(SOURCE.appHtml, /app\/bootstrap\.js/); 
assertContracts(SOURCE.appHtml, FEATURE_CONTRACTS); 
assert.match(SOURCE.visionApi, /function shouldEscalateMathOcrSolve/);
assert.match(SOURCE.visionApi, /pipeline:\s*'fast-math-ocr-solve'/);
assert.match(SOURCE.visionApi, /pipeline:\s*'planner-critic-solver'/);
assert.match(SOURCE.speechInput, /try English or another language/);
assert.match(SOURCE.chatGroqApi, /forceReview: false/);
assert.doesNotMatch(SOURCE.chatGroqApi, /forceReview: !isInternalSummary/);

const riskSandbox = {};
vm.createContext(riskSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'analyzeAnswerRiskFlags'), riskSandbox);
const currentFlags = riskSandbox.analyzeAnswerRiskFlags(
    'Who is the current chief minister of Tamil Nadu?',
    'The current chief minister of Tamil Nadu is M. K. Stalin.'
).map(flag => flag.label);
assert.ok(currentFlags.includes('Current fact'));
assert.equal(riskSandbox.analyzeAnswerRiskFlags('hello', 'Hi there.').map(flag => flag.label).length, 0);
const numberFlags = riskSandbox.analyzeAnswerRiskFlags(
    'Plan my budget',
    'The total is ₹12000, with 15% for food and 20% for transport.'
).map(flag => flag.label);
assert.ok(numberFlags.includes('Numbers'));

const greetingSandbox = {};
vm.createContext(greetingSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizePreferredAddress'), greetingSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'isWakeGreetingText'), greetingSandbox);
assert.equal(greetingSandbox.normalizePreferredAddress('ma\'am'), 'mam');
assert.equal(greetingSandbox.normalizePreferredAddress('madam'), 'mam');
assert.equal(greetingSandbox.normalizePreferredAddress('sir'), 'sir');
assert.equal(greetingSandbox.isWakeGreetingText('jarvis'), true);
assert.equal(greetingSandbox.isWakeGreetingText('hey jarvis'), true);
assert.equal(greetingSandbox.isWakeGreetingText('hello'), true);
assert.equal(greetingSandbox.isWakeGreetingText('tell me about jarvis'), false);

const languageSandbox = {};
vm.createContext(languageSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'detectInputLanguageHint'), languageSandbox);
assert.equal(languageSandbox.detectInputLanguageHint('hola, can you help me?').includes('English-Spanish'), true);
assert.equal(languageSandbox.detectInputLanguageHint('hello தமிழ் help').includes('English-Tamil'), true);
assert.equal(languageSandbox.detectInputLanguageHint('தமிழ்'), 'Tamil');

console.log('deterministic-checks-ok'); 

function extractFunctionSource(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing function ${name}`);
    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `missing body for ${name}`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unterminated function ${name}`);
}

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
