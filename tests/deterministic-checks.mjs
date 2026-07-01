import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import currentFactsHandler, { __test as currentFacts } from '../api/current-facts.js';
import { __test as searchTest } from '../api/search.js';
import { classifyFreeLiveIntent, routeMessage } from '../api/_lib/latest/router.js';
import { clearItems, saveItems } from '../api/_lib/latest/latest-cache.js';

const SOURCE = Object.freeze({ 
    science: fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8'), 
    readme: fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
    appHtml: fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    styles: fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8'),
    apiIndex: fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8'),
    searchApi: fs.readFileSync(new URL('../api/search.js', import.meta.url), 'utf8'),
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

const LIVE_ROUTE_FIXTURES = Object.freeze({
    weather: ['weather', 'in', 'Testville'].join(' '),
    crypto: ['bitcoin', 'price', 'now'].join(' '),
    government: ['latest', 'government', 'news', 'in', 'Test Republic'].join(' '),
    disaster: ['earthquake', 'updates', 'today'].join(' '),
    sports: ['score', 'now', 'in', 'fixture league'].join(' '),
    places: ['places', 'to', 'visit', 'in', 'Sample Harbor'].join(' '),
    unsupported: ['restaurants', 'near', 'me', 'open', 'now'].join(' ')
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
            /\/api\/speech/,
            /minimumThinkMs|new Promise\(resolve => setTimeout\(resolve,\s*250\)\)/
        ]
    },
    conversationState: {
        required: [
            /const conversationTurns = new Map\(\)/,
            /function createConversationTurn\(/,
            /replaceMessageId:\s*messageId/,
            /function setLastVisibleUserMessage\(/,
            /function isInternalPromptText\(/,
            /setLastVisibleUserMessage\(rawPrompt\)/,
            /JarvisConversation\?\.resolve/,
            /clearSupersededConversationState/,
            /displayProcessingPrompt/,
            /useDisplayForContext/,
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
            /Do not guess or use web search/,
            /likely brand\/model only from visible evidence/
        ] 
    }, 
    helpAndVoice: {
        required: [
            /const supportedLanguages = Object\.freeze/,
            /filipino: \{ name: 'Filipino'/,
            /spanish: \{ name: 'Spanish'/,
            /malayalam: \{ name: 'Malayalam'/,
            /function parseOneShotTranslationRequest/,
            /function handleOneShotTranslation/,
            /const assistantTransformActions = Object\.freeze/,
            /Simplify/,
            /Explain deeper/,
            /Make shorter/,
            /Give examples/,
            /Turn into steps/,
            /const slashCommandChoices = Object\.freeze/,
            /Choose a command/,
            /function initSlashCommandPicker/,
            /function showChatExportFormatPicker/,
            /function exportChatHistoryText/,
            /function exportChatHistoryMarkdown/,
            /Ask JARVIS/,
            /Verify this/
        ],
        forbidden: [
            /<label for="speech-language-select" class="font-bold">Voice input<\/label>/,
            /id="speech-language-select"/,
            /Availability depends on your browser and device speech recognizer/,
            /Privacy and answer quality/,
            /real-time facts are not externally verified/,
            /Memory Vault/,
            /Data controls/,
            /Export Chat Only/,
            /Clear Chat/,
            /Clear Memory/,
            /Copy clean answer/,
            /Copy with sources/,
            /Export answer as Markdown/,
            /Voice shortcuts/,
            /Translator helper/,
            /Privacy & Data Center/,
            /function addMemoryVaultItemFromHelp/,
            /function editMemoryItem/,
            /function collectLocalDataSnapshot/,
            /function exportAllLocalDataJson/,
            /function clearLocalPreferencesData/,
            /Export All Data/,
            /Delete All Local Data/
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
            /function speakConverseReply\(text, turn\)/,
            /new SpeechSynthesisUtterance\(spokenText\)/,
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
assert.equal(routeMessage(LIVE_ROUTE_FIXTURES.weather).route, 'live_required');
assert.equal(routeMessage(LIVE_ROUTE_FIXTURES.crypto).route, 'live_required');
assert.equal(routeMessage(LIVE_ROUTE_FIXTURES.unsupported).route, 'llm');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.weather).category, 'weather');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.crypto).category, 'crypto');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.government).category, 'government');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.disaster).category, 'disasters');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.sports).category, 'sports');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.places).category, 'tourism_food_places');
assert.equal(classifyFreeLiveIntent(LIVE_ROUTE_FIXTURES.unsupported).category, 'stable_knowledge');
assert.equal(classifyFreeLiveIntent('Search the web for recent reviews of the Nothing Phone 3').category, 'web_search');
assert.equal(classifyFreeLiveIntent('recent reviews of Nothing Phone 3').category, 'web_search');
assert.equal(classifyFreeLiveIntent('Nothing Phone 3 reviews').category, 'web_search');
assert.equal(classifyFreeLiveIntent('Explain what Nothing OS is').category, 'stable_knowledge');
assert.equal(searchTest.extractSearchTargetQuery('Search the web for recent reviews of the Nothing Phone 3'), 'recent reviews of the Nothing Phone 3');
assert.deepEqual(searchTest.buildDeterministicSearchQueries('recent reviews of Nothing Phone 3'), [
    'Nothing Phone 3 reviews',
    'Nothing Phone 3 recent reviews',
    'Nothing Phone 3 latest reviews'
]);
assert.equal(searchTest.isRelatedToQuery('Nothing Phone 3 reviews', {
    title: 'Nothing Was the Same',
    description: 'Drake album released in 2013 with OVO production credits.',
    sourceLabel: 'Wikipedia'
}), false);
assert.equal(searchTest.isRelatedToQuery('Nothing Phone 3 reviews', {
    title: 'Nothing Phone 3 hands-on review',
    description: 'Early phone review with camera, battery, display, and Nothing OS impressions.',
    sourceLabel: 'Tech Review'
}), true);
assert.match(SOURCE.styles, /\.chat-bubble-user\s*\{[\s\S]*background:\s*transparent !important/);
assert.match(SOURCE.styles, /\.chat-bubble-assistant\s*\{[\s\S]*background:\s*transparent !important/);
assert.match(SOURCE.styles, /body\.dark \.chat-bubble-assistant\s*\{[\s\S]*background:\s*transparent !important[\s\S]*border:\s*none !important[\s\S]*padding:\s*0 !important/);
assert.match(SOURCE.styles, /body \.chat-row \.chat-bubble-user,\s*body \.chat-row \.chat-bubble-assistant,[\s\S]*border:\s*none !important[\s\S]*border-radius:\s*0 !important/);
assert.match(SOURCE.styles, /\.selection-helper-popover\s*\{[\s\S]*display:\s*none !important[\s\S]*visibility:\s*hidden !important[\s\S]*pointer-events:\s*none !important/);
assert.match(SOURCE.styles, /\.selection-helper-popover\.visible\s*\{[\s\S]*display:\s*flex !important[\s\S]*visibility:\s*visible !important/);
assert.match(SOURCE.styles, /Selection helper readability after the global monochrome override/);
assert.match(SOURCE.styles, /\.selection-helper-btn,\s*\.selection-helper-btn:hover,[\s\S]*background:\s*#000000 !important[\s\S]*color:\s*#ffffff !important/);
assert.match(SOURCE.styles, /\.assistant-thinking-pulse\s*\{/);
assert.match(SOURCE.styles, /@keyframes jarvis-thinking-pulse/);
assert.doesNotMatch(SOURCE.styles, /assistant-thinking-spinner/);
assert.match(SOURCE.styles, /\.assistant-message-text a\s*\{[\s\S]*color:\s*#ffffff !important/);
assert.match(SOURCE.styles, /\.assistant-action-menu\s*\{[\s\S]*position:\s*fixed/);
assert.match(SOURCE.styles, /\.assistant-action-menu\s*\{[\s\S]*z-index:\s*9999/);
assert.doesNotMatch(SOURCE.appHtml, /chat-bubble-user text-white px-4 py-3/);
assert.match(SOURCE.appHtml, /popover\.hidden = true/);
assert.match(SOURCE.appHtml, /popover\.hidden = false/);
assert.match(SOURCE.appHtml, /function isJarvisTechStackRequest/);
assert.match(SOURCE.appHtml, /openai\/gpt-oss-120b/);
assert.match(SOURCE.appHtml, /gemini-2\.5-flash-lite/);
assert.match(SOURCE.appHtml, /permanent-free public-source routing through Wikipedia, Wikidata, GDELT, RSS\/Atom, official shortcuts/);
assert.match(SOURCE.appHtml, /Britannica lookup, Reddit discussion lookup, and archive\.today snapshot lookup/);
assert.match(SOURCE.appHtml, /Gemini may help planning, ranking, and snippets/);
assert.match(SOURCE.appHtml, /No Serper, Brave, Tavily, paid API, or crawler is required/i);
assert.match(SOURCE.appHtml, /\/api\/extract-url/);
assert.match(SOURCE.appHtml, /crawl4ai_url_extract/);
assert.doesNotMatch(SOURCE.appHtml, /fetchPublicMediaFromWikimedia/);
assert.doesNotMatch(SOURCE.appHtml, /https:\/\/commons\.wikimedia\.org\/w\/api\.php/);
assert.doesNotMatch(SOURCE.appHtml, /Related public images/);
assert.doesNotMatch(SOURCE.appHtml, /data-public-media="true"/);
assert.doesNotMatch(SOURCE.appHtml, /function isIntercityRouteRequest\(text\)/);
assert.doesNotMatch(SOURCE.appHtml, /function parseRouteRequest\(text\)/);
assert.doesNotMatch(SOURCE.appHtml, /function isPersonalOriginPhrase\(value\)/);
assert.doesNotMatch(SOURCE.appHtml, /function resolveRouteEndpoint\(value, kind = 'place'\)/);
assert.doesNotMatch(SOURCE.appHtml, /function fetchOsrmDrivingRoute\(origin, destination\)/);
assert.doesNotMatch(SOURCE.appHtml, /function buildRouteGuidanceMessage\(routePlan\)/);
assert.doesNotMatch(SOURCE.appHtml, /pendingRouteDisambiguation/);
assert.doesNotMatch(SOURCE.appHtml, /tripState/);
assert.doesNotMatch(SOURCE.appHtml, /router\.project-osrm\.org/);
assert.doesNotMatch(SOURCE.appHtml, /Open Maps for current traffic, train\/bus schedules, and exact route/);
assert.doesNotMatch(SOURCE.readme, /Route and travel help/);
assert.match(SOURCE.appHtml, /function buildContextCopilotBadgeHtml/);
assert.match(SOURCE.appHtml, /function shouldShowContextCopilotBadge/);
assert.match(SOURCE.appHtml, /contextual_follow_up/);
assert.match(SOURCE.appHtml, /ambiguous_short_context/);
assert.match(SOURCE.appHtml, /function buildAmbiguousShortContextReply/);
assert.match(SOURCE.appHtml, /function createExplicitMemoryRecord/);
assert.match(SOURCE.appHtml, /function findRelevantSavedMemory/);
assert.doesNotMatch(SOURCE.appHtml, /function parseMemorySaveRequest/);
assert.doesNotMatch(SOURCE.appHtml, /function parseMemoryForgetRequest/);
assert.doesNotMatch(SOURCE.appHtml, /function showSavedMemoryVault/);
assert.doesNotMatch(SOURCE.appHtml, /Export All Data/);
assert.match(SOURCE.appHtml, /Relevant saved memory:/);
assert.doesNotMatch(SOURCE.appHtml, /alwaysShowContextCopilotBadge\s*=\s*true/);
assert.match(SOURCE.appHtml, /function splitReadableSentences\(text\)/);
assert.ok(SOURCE.appHtml.includes("char === '.' && /\\d/.test(prev) && /\\d/.test(next)"));
assert.match(SOURCE.appHtml, /if \(isUser && !rawDisplayText\.trim\(\)\) return/);
assert.doesNotMatch(SOURCE.appHtml, /rawText\.match\(\s*\/\[\^\.\!\?\]\+\[\.\!\?\]\+\/g/);
assert.match(SOURCE.appHtml, /const targeted = raw[\s\S]*\.replace\(\/\\bcief\\b\/gi, 'chief'\)/);
assert.match(SOURCE.appHtml, /\.replace\(\/\\brtamilnadu\\b\/gi, 'Tamil Nadu'\)/);
assert.doesNotMatch(SOURCE.appHtml, /customAutocorrectRules/);
assert.match(SOURCE.readme, /Standout Feature: Context Copilot/);
assert.match(SOURCE.readme, /local, deterministic, private, and free-for-life/);
assert.match(SOURCE.readme, /Exact Features/);
assert.match(SOURCE.readme, /Crawl4AI fallback/);
assert.match(SOURCE.readme, /Prompt-Based Translation/);
assert.match(SOURCE.readme, /Sidebar And Options/);
assert.match(SOURCE.readme, /Vision Analysis/);
assert.match(SOURCE.readme, /rename, pin, share, or delete/);
assert.match(SOURCE.readme, /Memory Manager/);
assert.doesNotMatch(SOURCE.readme, /Memory Vault/);
assert.doesNotMatch(SOURCE.readme, /Voice Shortcuts/);
assert.doesNotMatch(SOURCE.readme, /Universal Translator Helper/);
assert.doesNotMatch(SOURCE.readme, /Privacy & Data Center/);
assert.doesNotMatch(SOURCE.readme, /remember my passport is in the drawer/);
assert.doesNotMatch(SOURCE.readme, /export all local data/i);
assert.doesNotMatch(SOURCE.readme, /Public Images/);
assert.match(SOURCE.readme, /Verification/);
assert.doesNotMatch(SOURCE.readme, /OCR Uploads/);
assert.doesNotMatch(SOURCE.readme, /OCR_MAX_FILE_BYTES/);
assert.doesNotMatch(SOURCE.readme, /Vercel-safe 3 MB decoded file limit/);
assert.doesNotMatch(SOURCE.readme, /Environment Variables|Local Testing|npm run dev|CRAWL4AI_URL/);
assert.match(SOURCE.appHtml, /localStorage when memory persistence is enabled/);
assert.doesNotMatch(SOURCE.appHtml, /id="upload-file-btn"/);
assert.doesNotMatch(SOURCE.appHtml, /id="document-upload-input"/);
assert.doesNotMatch(SOURCE.appHtml, /fetch\('\/api\/ocr'/);
assert.doesNotMatch(SOURCE.appHtml, /function buildUploadedDocumentFromOcrResult/);
assert.doesNotMatch(SOURCE.appHtml, /function buildOcrUploadErrorMessage/);
assert.doesNotMatch(SOURCE.appHtml, /OCR_HOSTED_MAX_FILE_BYTES/);
assert.doesNotMatch(SOURCE.appHtml, /function estimateOcrUploadBodyBytes/);
assert.doesNotMatch(SOURCE.appHtml, /This upload may be too large for the hosted OCR endpoint/);
assert.doesNotMatch(SOURCE.appHtml, /OCR upload failed with HTTP 413/);
assert.doesNotMatch(SOURCE.appHtml, /async function handleUploadedDocumentFollowup/);
assert.doesNotMatch(SOURCE.appHtml, /handleComposerAction\('ocr'\)/);
assert.doesNotMatch(SOURCE.apiIndex, /\/api\/ocr/);
assert.doesNotMatch(SOURCE.apiIndex, /\/api\/media-search/);
assert.doesNotMatch(SOURCE.searchApi, /Tamil Nadu Chief Minister official/);
assert.doesNotMatch(SOURCE.searchApi, /profile_form_cm/);
assert.match(SOURCE.searchApi, /function buildSourceDerivedAnswer\(results, metadata = \{\}\)/);
assert.match(SOURCE.appHtml, /const directAnswer = cleanLiveAnswerText\(String\(answerData\?\.answer/);
assert.match(SOURCE.appHtml, /const answerEvidenceCount = Number\(answerData\?\.answerEvidenceCount \|\| 0\)/);
assert.match(SOURCE.appHtml, /if \(directAnswer && answerEvidenceCount > 0 && answerResults\.length\)/);
assert.match(SOURCE.appHtml, /function isCurrentRoleHolderLiveQuery\(text, liveIntent = null, entityIntent = null\)/);
assert.match(SOURCE.appHtml, /function isPublicSourceSearchAllowedWhenLiveDisabled\(text, liveIntent = null, entityIntent = null\)/);
assert.match(SOURCE.appHtml, /failClosed = roleHolderQuery \|\| \(forceFailClosed && shouldRequireVerifiedSources\(query, intent, entityIntent\)\)/);
assert.match(SOURCE.appHtml, /const publicSourceAllowed = isPublicSourceSearchAllowedWhenLiveDisabled\(initialQuery, initialIntent, initialEntityIntent\)/);
assert.match(SOURCE.appHtml, /if \(!LIVE_RETRIEVAL_ENABLED && !publicSourceAllowed\)/);
assert.doesNotMatch(SOURCE.appHtml, /async function fetchLiveSearchJson\(query, options = \{\}\)\s*\{\s*if \(!LIVE_RETRIEVAL_ENABLED\)/);
assert.match(SOURCE.appHtml, /const shouldDelayAssistantRender = false/);
assert.doesNotMatch(SOURCE.appHtml, /setManagedTimeout\(startAssistantRender, 500\)/);
assert.match(SOURCE.appHtml, /startAssistantRender\(\);/);
assert.match(SOURCE.appHtml, /return addChatMessage\(finalText, false, null, \{/);
assert.match(SOURCE.appHtml, /if \(roleHolderQuery\) \{[\s\S]*evidenceLevel === 'structured_claim'[\s\S]*Current holder not verified/);

const stackSandbox = {};
vm.createContext(stackSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'buildJarvisTechStackReply'), stackSandbox);
const stackReply = stackSandbox.buildJarvisTechStackReply();
assert.doesNotMatch(stackReply, /\b(?:index\.html|package\.json)\b/);
assert.doesNotMatch(stackReply, /\b(?:app|api)\/|\/api\/[a-z0-9-]+/i);
assert.doesNotMatch(stackReply, /\.(?:js|mjs|css|html)\b/i);

const routingSandbox = {
    window: { medicalMode: false },
    isRecipeRequest() {
        return false;
    }
};
vm.createContext(routingSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'isMedicalAdviceIntent'), routingSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'isMedicalEmergencyIntent'), routingSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'decideAnswerPath'), routingSandbox);
const clinicalPrompt = 'A patient on antidepressants eats aged cheese for dinner. Two hours later: pounding headache, flushing, sweating, blood pressure 220/120. The ER doc reaches for nitroprusside... then stops. Why?';
assert.equal(routingSandbox.isMedicalAdviceIntent(clinicalPrompt), true);
assert.equal(routingSandbox.decideAnswerPath({
    raw: clinicalPrompt,
    flags: {
        medicalAdvice: true,
        broadFactualWeb: true,
        currentInfo: true
    }
}), 'medical_advice');
assert.equal(routingSandbox.isMedicalAdviceIntent('Could this be a drug interaction or hypertensive crisis?'), true);
assert.doesNotMatch(SOURCE.appHtml, /function isRestaurantLookupIntent/);
assert.equal(routeMessage('restaurants near me open now').route, 'llm');
assert.equal(routeMessage('best restaurants in Chennai').route, 'llm');

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
assert.match(SOURCE.appHtml, /beginAssistantProcessing\(\);\s*showThinkingIndicator\('Thinking'\)/);
assert.match(SOURCE.appHtml, /app\/bootstrap\.js/); 
assertContracts(SOURCE.appHtml, FEATURE_CONTRACTS); 
assert.match(SOURCE.visionApi, /function shouldEscalateMathOcrSolve/);
assert.match(SOURCE.visionApi, /pipeline:\s*'fast-math-ocr-solve'/);
assert.match(SOURCE.visionApi, /pipeline:\s*'planner-critic-solver'/);
assert.doesNotMatch(SOURCE.visionApi, /llama-4-scout/);
assert.match(SOURCE.visionApi, /"brand": "visible or likely brand/);
assert.match(SOURCE.visionApi, /"model": "visible or likely product\/model/);
assert.match(SOURCE.visionApi, /"modelEvidence": \["visible clue supporting the brand\/model"\]/);
assert.match(SOURCE.visionApi, /"distinctiveFeatures": \["camera layout, logo, color, ports, UI, shape, or other useful visual details"\]/);
assert.match(SOURCE.visionApi, /infer brand\/model only from visible evidence/);
assert.match(SOURCE.visionApi, /Likely item:/);
assert.doesNotMatch(SOURCE.visionApi, /Confidence: \$\{confidence\}\./);
assert.match(SOURCE.visionApi, /function cleanVisionDisplayText/);
assert.match(SOURCE.appHtml, /id="continuous-vision-status"/);
assert.match(SOURCE.appHtml, /function updateContinuousVisionStatus/);
assert.match(SOURCE.appHtml, /function addVisionRecoveryMessage/);
assert.match(SOURCE.appHtml, /function buildVisionDiagnosticsHtml/);
assert.match(SOURCE.appHtml, /setVisionDetailLevel/);
assert.match(SOURCE.appHtml, /setVisionShowEvidence/);
assert.match(SOURCE.styles, /\.continuous-vision-preview\s*\{[\s\S]*background:\s*#000000\s*!important/);
assert.match(SOURCE.styles, /\.continuous-vision-preview-header\s*\{[\s\S]*background:\s*#000000\s*!important/);
assert.match(SOURCE.styles, /\.continuous-vision-status/);
assert.match(SOURCE.speechInput, /try English or another language/);
assert.match(SOURCE.chatGroqApi, /forceReview: false/);
assert.doesNotMatch(SOURCE.chatGroqApi, /forceReview: !isInternalSummary/);
assert.match(SOURCE.chatGroqApi, /reason === 'stable_factual_query'/);
assert.match(SOURCE.chatGroqApi, /unknown_general_knowledge_answer/);
assert.match(SOURCE.chatGroqApi, /async function buildCrawl4AiFallbackContext/);
assert.match(SOURCE.chatGroqApi, /\.slice\(0,\s*3\)/);
assert.match(SOURCE.chatGroqApi, /runVerifiedWebSearch\(query,\s*\{\s*limit:\s*6\s*\}\)/);
assert.match(SOURCE.chatGroqApi, /extractWithCrawl4Ai\(\{/);
assert.match(SOURCE.appHtml, /function buildVerificationResponseInstructions/);
assert.match(SOURCE.appHtml, /Verdict: likely accurate, partly accurate, unsupported, or incorrect/);
assert.match(SOURCE.appHtml, /Evidence used:/);
assert.match(SOURCE.appHtml, /How checked:/);
assert.match(SOURCE.appHtml, /Claims needing live\/source verification:/);
assert.match(SOURCE.appHtml, /Corrected answer:/);
assert.match(SOURCE.appHtml, /Sources: include every usable retrieved source as a markdown link/);
assert.match(SOURCE.appHtml, /async function buildVerificationEvidenceBundle\(originalQuestion\)/);
assert.match(SOURCE.appHtml, /fetchLiveSearchJson\(query,\s*\{[\s\S]*maxResults:\s*5[\s\S]*answer:\s*false/);
assert.match(SOURCE.appHtml, /Promise\.all\(extractionCandidates\.map\(item => fetchVerificationExtract\(item\.url,\s*query\)\)\)/);
assert.match(SOURCE.appHtml, /intent:\s*'verify_answer'/);
assert.match(SOURCE.appHtml, /evidenceSources:\s*evidenceBundle\.sources/);
assert.match(SOURCE.appHtml, /addChatMessage\(finalText,\s*false,\s*true/);
assert.match(SOURCE.appHtml, /verify:\s*'<svg/);
assert.match(SOURCE.appHtml, /getActionIconSvg\('verify'\)\}<span>Verify this<\/span>/);
assert.match(SOURCE.appHtml, /function positionAssistantActionMenu\(menu,\s*button\)/);
assert.match(SOURCE.appHtml, /window\.addEventListener\('resize',\s*closeAssistantActionMenus\)/);
assert.match(SOURCE.appHtml, /displayProcessingPrompt/);
assert.match(SOURCE.appHtml, /programmaticAction: 'verify_answer'/);
assert.match(SOURCE.appHtml, /Verifying answer/);
assert.match(SOURCE.appHtml, /Verify the previous answer for:/);
assert.match(SOURCE.appHtml, /function addVisibleInputHistory/);
assert.match(SOURCE.appHtml, /setLastVisibleUserMessage\(visible \|\| String\(options\?\.displayProcessingPrompt/);
assert.match(SOURCE.appHtml, /input\.value = isInternalPromptText\(historyValue\) \? '' : historyValue/);
assert.doesNotMatch(SOURCE.appHtml, /maybeShowReferenceImageForQuery/);
assert.doesNotMatch(SOURCE.appHtml, /fetchPublicMediaFromWikimedia\(query,\s*3\)/);
assert.doesNotMatch(SOURCE.appHtml, /dedupePublicMediaImages/);
assert.doesNotMatch(SOURCE.appHtml, /url\.searchParams\.set\('piprop',\s*'thumbnail\|name\|original'\)/);
assert.doesNotMatch(SOURCE.appHtml, /function formatPublicMediaTitle/);
assert.doesNotMatch(SOURCE.appHtml, /object-contain/);
assert.doesNotMatch(SOURCE.appHtml, /Â·/);
assert.match(SOURCE.appHtml, /function getStableBrowserFactAnswer/);
assert.match(SOURCE.appHtml, /function shouldSuppressDuplicateAssistantMessage/);
assert.match(SOURCE.appHtml, /normalizeDuplicateAnswerFingerprint/);
assert.match(SOURCE.searchApi, /function parseDiscoveryFactQuery/);
assert.match(SOURCE.searchApi, /stable_historical_fact/);
assert.match(SOURCE.chatGroqApi, /function isPenicillinDiscoveryQuestion/);
assert.match(SOURCE.chatGroqApi, /async function handleVerifyAnswerRequest/);
assert.match(SOURCE.chatGroqApi, /intent === 'verify_answer'/);
assert.match(SOURCE.chatGroqApi, /strategy:\s*'verify_answer_fast_path'/);
assert.match(SOURCE.chatGroqApi, /function normalizeVerifyGrounding/);
assert.match(SOURCE.chatGroqApi, /function ensureVerificationSourcesSection/);

const duplicateSandbox = {
    Date,
    window: { __lastUserMessage: 'Founder of penicillin' },
    activeResponseRenderContext: { turnId: 'turn-1' },
    getConversationTurn() {
        return { rawPrompt: 'Founder of penicillin' };
    }
};
vm.createContext(duplicateSandbox);
vm.runInContext("let lastAssistantPromptFingerprint = ''; let lastAssistantAnswerFingerprint = ''; let lastAssistantAnswerTimestamp = 0;", duplicateSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getStableBrowserFactAnswer'), duplicateSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeDuplicatePromptFingerprint'), duplicateSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeDuplicateAnswerFingerprint'), duplicateSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'shouldSuppressDuplicateAssistantMessage'), duplicateSandbox);
assert.match(duplicateSandbox.getStableBrowserFactAnswer('Founder of penicillin'), /Alexander Fleming/);
assert.equal(duplicateSandbox.shouldSuppressDuplicateAssistantMessage('Alexander Fleming discovered penicillin.\n\nSources:\n1. A', {}), false);
assert.equal(duplicateSandbox.shouldSuppressDuplicateAssistantMessage('Alexander Fleming discovered penicillin.\n\nSources:\n1. B', {}), true);

const riskSandbox = {};
vm.createContext(riskSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'analyzeAnswerRiskFlags'), riskSandbox);
const currentRoleRiskQuery = ['Who is the current', 'chief minister', 'of', 'Test Territory?'].join(' ');
const currentFlags = riskSandbox.analyzeAnswerRiskFlags(
    currentRoleRiskQuery,
    'The current chief minister is listed by a retrieved official source.'
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

const memorySandbox = {
    Date,
    memoryStore: {},
    AppState: { user: { memory: {} } },
    normalizeThing(value) {
        return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
    },
    levenshteinDistance(a, b) {
        a = String(a || '');
        b = String(b || '');
        const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
        for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
        for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
        for (let i = 1; i <= a.length; i += 1) {
            for (let j = 1; j <= b.length; j += 1) {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
        }
        return dp[a.length][b.length];
    }
};
vm.createContext(memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getMemoryRecordValue'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'inferMemoryRecordType'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeMemoryRecord'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'createExplicitMemoryRecord'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeMemoryStoreRecords'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'memorySearchTokens'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'scoreMemoryMatch'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'findRelevantSavedMemory'), memorySandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'buildRelevantSavedMemoryContext'), memorySandbox);
memorySandbox.memoryStore.keys = memorySandbox.createExplicitMemoryRecord('keys', 'on the kitchen counter', 'my keys are on the kitchen counter');
assert.equal(memorySandbox.memoryStore.keys.category, 'location');
assert.equal(memorySandbox.createExplicitMemoryRecord('insurance', 'renew this week', 'save note: renew this week', 'note').type, 'note');
assert.ok(memorySandbox.memoryStore.keys.createdAt);
assert.equal(memorySandbox.findRelevantSavedMemory('where are my key')[0].value, 'on the kitchen counter');
assert.equal(memorySandbox.findRelevantSavedMemory('tell me about Saturn').length, 0);
assert.match(memorySandbox.buildRelevantSavedMemoryContext('where are my keys'), /Relevant saved memory:\n- keys: on the kitchen counter/);

const translatorSandbox = {
    supportedLanguages: {
        tamil: { name: 'Tamil', nativeName: 'Tamil' },
        hindi: { name: 'Hindi', nativeName: 'Hindi' },
        spanish: { name: 'Spanish', nativeName: 'Spanish' }
    }
};
vm.createContext(translatorSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeTranslatorLanguageKey'), translatorSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'resolveTranslatorLanguage'), translatorSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'parseOneShotTranslationRequest'), translatorSandbox);
const tamilTranslationRequest = translatorSandbox.parseOneShotTranslationRequest('translate "hello" to Tamil');
assert.equal(tamilTranslationRequest.sourceText, 'hello');
assert.equal(tamilTranslationRequest.targetLanguage, 'tamil');
assert.equal(tamilTranslationRequest.rawTargetLanguage, 'Tamil');
const hindiTranslationRequest = translatorSandbox.parseOneShotTranslationRequest('say this in Hindi: I need help');
assert.equal(hindiTranslationRequest.sourceText, 'I need help');
assert.equal(hindiTranslationRequest.targetLanguage, 'hindi');
assert.equal(hindiTranslationRequest.rawTargetLanguage, 'Hindi');
assert.equal(translatorSandbox.parseOneShotTranslationRequest('what does "hola" mean in English').targetLanguage, 'english');

const visiblePromptSandbox = {
    window: {},
    inputHistory: [],
    lastVisibleUserMessage: ''
};
vm.createContext(visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'isInternalPromptText'), visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'setLastVisibleUserMessage'), visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getLastVisibleUserMessage'), visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'addVisibleInputHistory'), visiblePromptSandbox);
assert.equal(visiblePromptSandbox.isInternalPromptText('Check whether this answer is accurate and internally consistent.'), true);
assert.equal(visiblePromptSandbox.setLastVisibleUserMessage('Answer to verify:\nHidden answer'), false);
assert.equal(visiblePromptSandbox.setLastVisibleUserMessage('What is this phone?'), true);
assert.equal(visiblePromptSandbox.getLastVisibleUserMessage(), 'What is this phone?');
visiblePromptSandbox.addVisibleInputHistory('Original user request: secret');
visiblePromptSandbox.addVisibleInputHistory('What is this phone?');
assert.deepEqual(visiblePromptSandbox.inputHistory, ['What is this phone?']);

const visionFormatSandbox = {};
vm.createContext(visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'pickReadableVisionObjectMeta'), visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'pickReadableVisionObject'), visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'withReadableArticle'), visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'compactVisionTextMention'), visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeReadableVisionConfidence'), visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'cleanVisionDisplayText'), visionFormatSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'formatVisionJsonToReadableText'), visionFormatSandbox);
const richVisionText = visionFormatSandbox.formatVisionJsonToReadableText({
    answer: 'It appears to be an iPhone based on the rear camera cluster.',
    brand: 'Apple',
    model: 'iPhone 15 Pro',
    modelEvidence: ['triple rear camera layout', 'Apple logo visible'],
    distinctiveFeatures: ['titanium-like side rail', 'square camera bump'],
    uncertainty: 'Exact model is not fully certain from this angle.',
    objects: [{ label: 'smartphone', count: 1, confidence: 0.91 }]
});
assert.match(richVisionText, /Likely item: likely Apple iPhone 15 Pro \(smartphone\)/);
assert.match(richVisionText, /Evidence: triple rear camera layout; Apple logo visible/);
assert.match(richVisionText, /Visible details: titanium-like side rail; square camera bump/);
assert.match(richVisionText, /Uncertainty: Exact model is not fully certain/);
assert.doesNotMatch(richVisionText, /Confidence:/);
assert.doesNotMatch(richVisionText, /\bconfidence\b/i);
assert.doesNotMatch(richVisionText, /\bobjects\b/i);
const messyVisionText = visionFormatSandbox.cleanVisionDisplayText('{ "objects": [{ "label": "laptop", "confidence": 0.98 }], "textDetected": ["JARVIS"], "answer": "A Lenovo laptop is visible." }');
assert.doesNotMatch(messyVisionText, /\bobjects\b|confidence|textDetected|[{}[\]]/i);

const titleSandbox = {};
vm.createContext(titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'splitReadableSentences'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'deriveChatTitleFromText'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'isVagueChatTitlePrompt'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'deriveChatTitleFromAssistantText'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'deriveChatTitleFromMessages'), titleSandbox);
assert.equal(titleSandbox.deriveChatTitleFromMessages([
    { role: 'user', text: 'what is this' },
    { role: 'assistant', text: 'Likely item: likely Lenovo IdeaPad (laptop). Visible details: keyboard; JARVIS page.' }
]), 'Lenovo IdeaPad');
assert.equal(titleSandbox.deriveChatTitleFromMessages([
    { role: 'user', text: 'how do I learn JavaScript fast?' },
    { role: 'assistant', text: 'Start with DOM basics.' }
]), 'how do I learn JavaScript fast');

assert.match(SOURCE.appHtml, /trimmed === '\/'/);
assert.match(SOURCE.appHtml, /getSlashCommandPicker\(\) && trimmed !== ''/);
assert.match(SOURCE.appHtml, /CHAT_LEGACY_MIGRATION_DONE_KEY/);
assert.match(SOURCE.appHtml, /CHAT_DELETED_SESSION_IDS_KEY/);
assert.match(SOURCE.appHtml, /function getDeletedChatSessionIds\(\)/);
assert.match(SOURCE.appHtml, /function rememberDeletedChatSessionId\(sessionId\)/);
assert.match(SOURCE.appHtml, /function markLegacyChatMigrationDone\(\)/);
assert.match(SOURCE.appHtml, /function hasChatSessionsStorageRecord\(\)/);
assert.match(SOURCE.appHtml, /function clearLegacyHistoryForDeletedSession\(session\)/);
assert.match(SOURCE.appHtml, /if \(hasLegacyChatMigrationRun\(\)\) return;/);
assert.match(SOURCE.appHtml, /getDeletedChatSessionIds\(\)\.has\('legacy_default_chat'\)/);
assert.match(SOURCE.appHtml, /if \(hasChatSessionsStorageRecord\(\)\) \{[\s\S]*markLegacyChatMigrationDone\(\);[\s\S]*return;/);
assert.match(SOURCE.appHtml, /rememberDeletedChatSessionId\(session\.id\);[\s\S]*clearLegacyHistoryForDeletedSession\(session\);[\s\S]*session\.messages = \[\];[\s\S]*forgetActiveEmptyChatDraft\(\);[\s\S]*saveChatSessions\(\);[\s\S]*if \(wasActiveSession\) startNewChatSession\(\);/);

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
