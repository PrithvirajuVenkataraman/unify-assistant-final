import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import currentFactsHandler, { __test as currentFacts } from '../api/current-facts.js';
import { __test as searchTest } from '../api/search.js';
import { __test as freeLiveProviderTest } from '../api/_lib/free-live/providers.js';
import { cleanQueryTarget, extractQueryTargetMetadata } from '../api/_lib/query-target-cleanup.js';
import { classifyFreeLiveIntent, routeMessage } from '../api/_lib/latest/router.js';
import { clearItems, saveItems } from '../api/_lib/latest/latest-cache.js';

const SOURCE = Object.freeze({ 
    science: fs.readFileSync(new URL('../science-format.js', import.meta.url), 'utf8'), 
    readme: fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
    appHtml: fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    styles: fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8'),
    apiIndex: fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8'),
    diagnosticsApi: fs.readFileSync(new URL('../api/diagnostics.js', import.meta.url), 'utf8'),
    searchApi: fs.readFileSync(new URL('../api/search.js', import.meta.url), 'utf8'),
    embeddingsApi: fs.readFileSync(new URL('../api/_lib/embeddings.js', import.meta.url), 'utf8'),
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
            /function applyCustomSystemPromptAndClose\(/,
            /class="help-modal-ok-btn"/,
            /customSystemPrompt/
        ],
        forbidden: [/class="response-style-card"/, /oninput="setCustomSystemPrompt\(this\.value, false\)"/]
    },
    spinnerOnlyLoading: {
        required: [
            /aria-label="\$\{escapeHtml\(phaseLabel\)\}"/,
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
assert.equal(classifyFreeLiveIntent('recent reviews of Framework Laptop 16').category, 'web_search');
assert.equal(classifyFreeLiveIntent('compare Alpha Fold X vs Beta Fold Y').category, 'web_search');
assert.equal(classifyFreeLiveIntent('price of Acme Speaker Mini').category, 'web_search');
assert.equal(classifyFreeLiveIntent('Explain what Nothing OS is').category, 'stable_knowledge');
assert.match(SOURCE.searchApi, /mode === 'rag'/);
assert.match(SOURCE.searchApi, /runEvidenceFirstWebRag\(query,\s*\{\s*limit\s*\}\)/);
assert.match(SOURCE.searchApi, /const EXA_SEARCH_URL = 'https:\/\/api\.exa\.ai\/search'/);
assert.match(SOURCE.searchApi, /function getExaApiKey\(\)/);
assert.match(SOURCE.searchApi, /searchExa\(normalizedQuery/);
assert.match(SOURCE.searchApi, /skipStructuredRoles:\s*true/);
assert.match(SOURCE.searchApi, /rankRagResultsWithEmbeddings\(normalizedQuery,\s*allResults\)/);
assert.match(SOURCE.searchApi, /embeddingEnhanced:\s*embeddingUsed/);
assert.match(SOURCE.embeddingsApi, /NVIDIA_API_KEY/);
assert.match(SOURCE.embeddingsApi, /integrate\.api\.nvidia\.com\/v1\/embeddings/);
assert.doesNotMatch(SOURCE.appHtml, /NVIDIA_API_KEY|integrate\.api\.nvidia\.com\/v1\/embeddings/);
assert.match(SOURCE.appHtml, /mode:\s*'rag'/);
assert.match(SOURCE.appHtml, /answerData\?\.verified === true/);
assert.equal(searchTest.extractSearchTargetQuery('Search the web for recent reviews of the Nothing Phone 3'), 'recent reviews of the Nothing Phone 3');
assert.deepEqual(searchTest.buildSearchQueryRewrite('compare Alpha Fold X vs Beta Fold Y'), {
    query: 'compare Alpha Fold X vs Beta Fold Y',
    subject: 'Alpha Fold X Beta Fold Y',
    dateContext: '',
    modifiers: [],
    freshnessNeeded: true,
    intent: 'comparison'
});
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
assert.equal(searchTest.isRelatedToQuery('Who is the CM of Tamil Nadu', {
    title: 'SteamOS',
    description: "SteamOS is a gaming-focused operating system released by Valve that incorporates the company's storefront.",
    sourceLabel: 'Wikipedia'
}), false);
assert.equal(searchTest.isRelatedToQuery('Who is the CM of Tamil Nadu', {
    title: 'Chief Minister of Tamil Nadu',
    description: 'The chief minister is the head of government of Tamil Nadu.',
    sourceLabel: 'Wikipedia'
}), true);
assert.equal(searchTest.isRelatedToQuery('recent reviews of Framework Laptop 16', {
    title: 'Framework design language',
    description: 'A general page about software frameworks and laptop stands.',
    sourceLabel: 'Reference'
}), false);
assert.equal(searchTest.isRelatedToQuery('recent reviews of Framework Laptop 16', {
    title: 'Framework Laptop 16 review',
    description: 'A recent review covering performance, battery, modular parts, and display quality.',
    sourceLabel: 'Tech Review'
}), true);
assert.equal(searchTest.isRelatedToQuery('price of Acme Speaker Mini', {
    title: 'Acme Speaker Mini price drops this week',
    description: 'Retail pricing and availability details for the compact speaker model.',
    sourceLabel: 'Shopping News'
}), true);
assert.doesNotMatch(SOURCE.searchApi, /nothing\s+phone|iphone|pixel|galaxy|oneplus/i);
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
assert.doesNotMatch(SOURCE.appHtml, /Follow-up understood/);
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
assert.doesNotMatch(SOURCE.readme, /Local Testing|npm run dev/);
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
assert.match(SOURCE.appHtml, /if \(\(!failClosed \|\| answerData\?\.verified === true\) && directAnswer && answerEvidenceCount > 0 && answerResults\.length\)/);
assert.match(SOURCE.appHtml, /function isCurrentRoleHolderLiveQuery\(text, liveIntent = null, entityIntent = null\)/);
assert.match(SOURCE.appHtml, /function isPublicSourceSearchAllowedWhenLiveDisabled\(text, liveIntent = null, entityIntent = null\)/);
assert.match(SOURCE.appHtml, /failClosed = roleHolderQuery \|\| shouldRequireVerifiedSources\(query, intent, entityIntent\)/);
assert.match(SOURCE.appHtml, /const publicSourceAllowed = isPublicSourceSearchAllowedWhenLiveDisabled\(initialQuery, initialIntent, initialEntityIntent\)/);
assert.match(SOURCE.appHtml, /if \(!LIVE_RETRIEVAL_ENABLED && !publicSourceAllowed\)/);
assert.doesNotMatch(SOURCE.appHtml, /async function fetchLiveSearchJson\(query, options = \{\}\)\s*\{\s*if \(!LIVE_RETRIEVAL_ENABLED\)/);
assert.match(SOURCE.appHtml, /const shouldDelayAssistantRender = false/);
assert.doesNotMatch(SOURCE.appHtml, /setManagedTimeout\(startAssistantRender, 500\)/);
assert.match(SOURCE.appHtml, /startAssistantRender\(\);/);
assert.match(SOURCE.appHtml, /return addChatMessage\(finalText, false, null, \{/);
assert.match(SOURCE.appHtml, /if \(shouldRequireVerifiedSources\(pipeline\.userText, pipeline\.intent, pipeline\.entityIntent\)\) \{[\s\S]*mode:\s*'rag'[\s\S]*Verified Web RAG[\s\S]*badge:\s*'Unverified'/);

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
assert.match(SOURCE.visionApi, /task === 'paper_answer_overlay'/);
assert.match(SOURCE.visionApi, /pipeline:\s*'paper-answer-overlay'/);
assert.match(SOURCE.visionApi, /overlayItems/);
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
assert.match(SOURCE.appHtml, /id="paper-answer-overlay"/);
assert.match(SOURCE.appHtml, /Clear overlay/);
assert.match(SOURCE.appHtml, /Refresh answers/);
assert.match(SOURCE.appHtml, /Copy answers/);
assert.match(SOURCE.appHtml, /function isPaperAnswerOverlayIntent/);
assert.match(SOURCE.appHtml, /write on the paper/);
assert.match(SOURCE.appHtml, /fill every field/);
assert.match(SOURCE.appHtml, /paper_answer_overlay/);
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
assert.match(SOURCE.appHtml, /compact verification note/);
assert.match(SOURCE.appHtml, /How checked:/);
assert.match(SOURCE.appHtml, /Sources used:/);
assert.match(SOURCE.appHtml, /Do not include Verdict, Claims checked/);
assert.match(SOURCE.appHtml, /function buildVerificationSearchQuery\(originalQuestion,\s*answerText = ''\)/);
assert.match(SOURCE.appHtml, /async function buildVerificationEvidenceBundle\(originalQuestion,\s*answerText = ''\)/);
assert.match(SOURCE.appHtml, /fetchLiveSearchJson\(query,\s*\{[\s\S]*maxResults:\s*5[\s\S]*answer:\s*true[\s\S]*mode:\s*'rag'/);
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
assert.match(SOURCE.chatGroqApi, /runEvidenceFirstWebRag\(fallbackQuery,\s*\{\s*limit:\s*6\s*\}\)/);
assert.match(SOURCE.chatGroqApi, /function buildVerificationRagQuery/);
assert.match(SOURCE.chatGroqApi, /function normalizeVerifyGrounding/);
assert.match(SOURCE.chatGroqApi, /function ensureVerificationSourcesSection/);
assert.match(SOURCE.chatGroqApi, /function normalizeCompactVerificationReport/);
assert.match(SOURCE.appHtml, /function isAlgebraEquationRequest/);
assert.match(SOURCE.appHtml, /async function handleAlgebraEquationRequest/);
assert.doesNotMatch(SOURCE.appHtml, /Follow-up understood:/);

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
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'sanitizeUserFacingRequestText'), visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'setLastVisibleUserMessage'), visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getLastVisibleUserMessage'), visiblePromptSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'addVisibleInputHistory'), visiblePromptSandbox);
assert.equal(visiblePromptSandbox.isInternalPromptText('Check whether this answer is accurate and internally consistent.'), true);
assert.equal(visiblePromptSandbox.setLastVisibleUserMessage('Answer to verify:\nHidden answer'), false);
const wrappedLearningPrompt = `User asked: "Difference between call by value and call by reference"

Teach this clearly for a beginner.

Rules:
- Cover any domain.`;
assert.equal(
    visiblePromptSandbox.sanitizeUserFacingRequestText(wrappedLearningPrompt),
    'Difference between call by value and call by reference'
);
assert.equal(visiblePromptSandbox.sanitizeUserFacingRequestText('Rules:\n- hidden system prompt'), '');
assert.equal(visiblePromptSandbox.setLastVisibleUserMessage('What is this phone?'), true);
assert.equal(visiblePromptSandbox.getLastVisibleUserMessage(), 'What is this phone?');
visiblePromptSandbox.addVisibleInputHistory('Original user request: secret');
visiblePromptSandbox.addVisibleInputHistory('What is this phone?');
assert.deepEqual(visiblePromptSandbox.inputHistory, ['What is this phone?']);
assert.match(extractFunctionSource(SOURCE.appHtml, 'showResponseRecoveryCard'), /sanitizeUserFacingRequestText\(userMessage\)/);
assert.doesNotMatch(extractFunctionSource(SOURCE.appHtml, 'showResponseRecoveryCard'), /String\(userMessage \|\| window\.__lastUserMessage/);
assert.doesNotMatch(SOURCE.appHtml, /Response paused|Last request|response-recovery-title|response-recovery-btn/);
assert.match(SOURCE.appHtml, /function isWeakAssistantAnswerForRetry/);
assert.match(SOURCE.appHtml, /chat_weak_answer_retry/);
assert.match(SOURCE.appHtml, /Understanding your request/);
assert.match(SOURCE.appHtml, /Writing the answer/);
assert.match(SOURCE.appHtml, /Checking sources/);
assert.match(SOURCE.appHtml, /Polishing the response/);
assert.match(SOURCE.appHtml, /function normalizePastedPromptText/);
assert.match(SOURCE.appHtml, /data-assistant-action="save_memory"/);
assert.match(SOURCE.appHtml, /function saveAssistantMessageToMemory/);
assert.match(SOURCE.appHtml, /function getChatSessionSearchSnippet/);
assert.match(SOURCE.appHtml, /chat-session-snippet/);
assert.match(SOURCE.appHtml, /function buildLearnedAnswerStyleHint/);
assert.match(SOURCE.appHtml, /function showDeploymentDiagnostics/);
assert.match(SOURCE.apiIndex, /diagnosticsHandler/);
assert.match(SOURCE.diagnosticsApi, /buildDiagnosticsStatus/);
assert.doesNotMatch(SOURCE.diagnosticsApi, /process\.env\[[^\]]+\][^;]*json/);
assert.match(SOURCE.appHtml, /help-modal-back-btn/);
assert.match(SOURCE.appHtml, /Back to previous screen/);
assert.match(SOURCE.styles, /\.help-modal-header\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px/);
assert.match(SOURCE.styles, /@media \(max-width:\s*640px\)[\s\S]*\.help-modal-enhanced/);
assert.match(SOURCE.styles, /\.custom-system-prompt-input\s*\{[\s\S]*min-height:\s*min\(34vh,\s*220px\)/);
assert.match(SOURCE.readme, /LIVE_RETRIEVAL_ENABLED=true/);
assert.match(SOURCE.readme, /live search is disabled by default/i);
assert.match(SOURCE.readme, /Feedback, Quality Review, and RLAIF/);
assert.match(SOURCE.readme, /do not train Groq, Gemini, Exa, NVIDIA, or any underlying model/i);
assert.match(SOURCE.readme, /in n words/);
assert.match(SOURCE.readme, /under n words/);
assert.match(SOURCE.chatGroqApi, /\\d\{1,4\}/);
assert.match(SOURCE.chatGroqApi, /function parseWordCountRequest/);
assert.match(SOURCE.chatGroqApi, /function applyResponseLengthFinalCheck/);
assert.match(SOURCE.chatGroqApi, /function rewriteToWordSpec/);
assert.doesNotMatch(SOURCE.chatGroqApi, /Additional details are available on request/);
assert.match(SOURCE.chatGroqApi, /source_like_claim_without_source/);
assert.match(SOURCE.chatGroqApi, /current_or_date_sensitive_claim/);
assert.doesNotMatch(SOURCE.styles, /response-recovery-panel|response-recovery-title|response-recovery-btn/);
assert.match(extractFunctionSource(SOURCE.appHtml, 'stopActiveGeneration'), /activeRequestController\s*=\s*null/);
assert.match(extractFunctionSource(SOURCE.appHtml, 'stopActiveGeneration'), /resetAssistantProcessingState\(\)/);

assert.equal(cleanQueryTarget('coorg around july'), 'coorg');
assert.equal(cleanQueryTarget('Coorg, Karnataka around July'), 'Coorg, Karnataka');
assert.equal(cleanQueryTarget('Paris, France tomorrow'), 'Paris, France');
assert.equal(cleanQueryTarget('Mysore during summer'), 'Mysore');
assert.equal(extractQueryTargetMetadata('OpenAI in 2023').dateContext, 'in 2023');
assert.equal(freeLiveProviderTest.extractLocation('weather in Testville around July'), 'Testville');
assert.equal(freeLiveProviderTest.extractLocation('forecast for Paris, France tomorrow'), 'Paris, France');
assert.equal(freeLiveProviderTest.extractPlaceTopic('best places to visit in Mysore during summer'), 'Mysore');
assert.equal(searchTest.buildSearchQueryRewrite('recent reviews of Nothing Phone 3').subject, 'Nothing Phone 3');
assert.equal(searchTest.buildSearchQueryRewrite('who was CEO of OpenAI in 2023').subject, 'OpenAI');
assert.equal(searchTest.buildSearchQueryRewrite('who was CEO of OpenAI in 2023').dateContext, 'in 2023');
assert.equal(searchTest.buildSearchQueryRewrite('Vijay latest movie in 2023').subject, 'Vijay');

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
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'compactChatTitleText'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'capitalizeChatTitle'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeChatTitleCandidate'), titleSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'stripChatTitlePromptFiller'), titleSandbox);
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
]), 'Learn JavaScript fast');
assert.equal(titleSandbox.deriveChatTitleFromMessages([
    { role: 'user', text: 'please tell me about black holes' },
    { role: 'assistant', text: 'Black holes are regions where gravity is extremely strong.' }
]), 'Black holes');
assert.equal(titleSandbox.deriveChatTitleFromMessages([
    { role: 'user', text: 'can you fix my speech input bug' },
    { role: 'assistant', text: 'I will inspect the speech input path.' }
]), 'Fix speech input bug');
titleSandbox.findPrimaryLinearEquation = () => ({ equation: 'x + 2 = 5' });
assert.equal(titleSandbox.deriveChatTitleFromMessages([
    { role: 'user', text: 'please solve x + 2 = 5' },
    { role: 'assistant', text: 'x = 3.' }
]), 'Solve x + 2 = 5');

const legacyDeleteSandbox = {
    CHAT_DELETED_SESSION_IDS_KEY: 'jarvis_deleted_chat_session_ids_v1',
    CHAT_DELETED_SESSION_TITLES_KEY: 'jarvis_deleted_chat_session_titles_v1',
    localStorage: {
        data: new Map(),
        get length() { return this.data.size; },
        key(index) { return Array.from(this.data.keys())[index] || null; },
        getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
        setItem(key, value) { this.data.set(key, String(value)); },
        removeItem(key) { this.data.delete(key); }
    },
    userName: 'tester',
    conversationHistory: []
};
vm.createContext(legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getHistoryStorageKey'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeHistoryUserMessage'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeHistoryAssistantMessage'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'sanitizeConversationHistoryRecords'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeDeletedChatTitle'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'compactChatTitleText'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'capitalizeChatTitle'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'normalizeChatTitleCandidate'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'stripChatTitlePromptFiller'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'deriveChatTitleFromText'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getLegacyHistoryStorageKeys'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getChatSessionDeleteFingerprint'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'legacyHistoryItemMatchesDeletedSession'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getDeletedChatSessionIds'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'getDeletedChatSessionTitles'), legacyDeleteSandbox);
vm.runInContext(extractFunctionSource(SOURCE.appHtml, 'isDeletedChatSession'), legacyDeleteSandbox);
legacyDeleteSandbox.localStorage.setItem('unify_history_tester', JSON.stringify([{ user: 'Old legacy question', ai: 'Old answer', turnId: 'turn-a' }]));
legacyDeleteSandbox.localStorage.setItem('unify_history_other', JSON.stringify([{ user: 'Old legacy question', ai: 'Old answer', turnId: 'turn-b' }]));
legacyDeleteSandbox.localStorage.setItem('jarvis_deleted_chat_session_titles_v1', JSON.stringify(['repeat title']));
assert.equal(legacyDeleteSandbox.isDeletedChatSession({ id: 'fresh-chat', title: 'Repeat title', deleted: false }), false);
legacyDeleteSandbox.localStorage.setItem('jarvis_deleted_chat_session_ids_v1', JSON.stringify(['deleted-chat']));
assert.equal(legacyDeleteSandbox.isDeletedChatSession({ id: 'deleted-chat', title: 'Different title', deleted: false }), true);
const legacyFingerprint = legacyDeleteSandbox.getChatSessionDeleteFingerprint({
    id: 'legacy_default_chat',
    title: 'Old legacy question',
    messages: [{ role: 'user', text: 'Old legacy question' }, { role: 'assistant', text: 'Old answer' }]
});
assert.equal(legacyDeleteSandbox.getLegacyHistoryStorageKeys().filter(key => key.startsWith('unify_history_')).length, 2);
assert.equal(legacyDeleteSandbox.legacyHistoryItemMatchesDeletedSession({ user: 'Old legacy question', ai: 'Old answer' }, legacyFingerprint), true);
assert.equal(legacyDeleteSandbox.legacyHistoryItemMatchesDeletedSession({ user: 'Different question', ai: 'Different answer' }, legacyFingerprint), false);

assert.match(SOURCE.appHtml, /trimmed === '\/'/);
assert.match(SOURCE.appHtml, /getSlashCommandPicker\(\) && trimmed !== ''/);
assert.match(SOURCE.appHtml, /CHAT_LEGACY_MIGRATION_DONE_KEY/);
assert.match(SOURCE.appHtml, /CHAT_DELETED_SESSION_IDS_KEY/);
assert.match(SOURCE.appHtml, /CHAT_DELETED_SESSION_TITLES_KEY/);
assert.match(SOURCE.appHtml, /function getDeletedChatSessionIds\(\)/);
assert.match(SOURCE.appHtml, /function getDeletedChatSessionTitles\(\)/);
assert.match(SOURCE.appHtml, /function rememberDeletedChatSession\(session\)/);
assert.match(SOURCE.appHtml, /function markLegacyChatMigrationDone\(\)/);
assert.match(SOURCE.appHtml, /function hasChatSessionsStorageRecord\(\)/);
assert.match(SOURCE.appHtml, /function getLegacyHistoryStorageKeys\(\)/);
assert.match(SOURCE.appHtml, /\^unify_history_/);
assert.match(SOURCE.appHtml, /function getChatSessionDeleteFingerprint\(session\)/);
assert.match(SOURCE.appHtml, /function legacyHistoryItemMatchesDeletedSession\(item, fingerprint\)/);
assert.match(SOURCE.appHtml, /function filterLegacyHistoryAgainstDeletedTombstones\(historyItems\)/);
assert.match(SOURCE.appHtml, /function clearLegacyHistoryForDeletedSession\(session\)/);
assert.match(SOURCE.appHtml, /if \(hasLegacyChatMigrationRun\(\)\) return;/);
assert.match(SOURCE.appHtml, /getDeletedChatSessionIds\(\)\.has\('legacy_default_chat'\)/);
assert.match(SOURCE.appHtml, /getDeletedChatSessionTitles\(\)\.has\(normalizeDeletedChatTitle\(legacyTitle\)\)/);
assert.match(SOURCE.appHtml, /for \(const historyKey of getLegacyHistoryStorageKeys\(\)\)/);
assert.match(SOURCE.appHtml, /conversationHistory = sanitizeConversationHistoryRecords\(conversationHistory\)[\s\S]*legacyHistoryItemMatchesDeletedSession\(item, fingerprint\)/);
assert.match(SOURCE.appHtml, /if \(hasChatSessionsStorageRecord\(\)\) \{[\s\S]*markLegacyChatMigrationDone\(\);[\s\S]*return;/);
assert.match(SOURCE.appHtml, /id="chat-delete-dialog"/);
assert.match(SOURCE.appHtml, /id="confirm-action-dialog"/);
assert.match(SOURCE.appHtml, /function openConfirmActionDialog/);
assert.doesNotMatch(SOURCE.appHtml, /window\.confirm/);
assert.match(SOURCE.appHtml, /Delete '\$\{session\.title \|\| 'this chat'\}'/);
assert.match(SOURCE.appHtml, /rememberDeletedChatSession\(session\);[\s\S]*clearLegacyHistoryForDeletedSession\(session\);[\s\S]*session\.messages = \[\];[\s\S]*forgetActiveEmptyChatDraft\(\);[\s\S]*saveChatSessions\(\);[\s\S]*if \(wasActiveSession\) \{[\s\S]*conversationHistory = \[\];[\s\S]*startNewChatSession\(\);/);
assert.match(SOURCE.appHtml, /askGeminiAI\(message,\s*\{[\s\S]*stream:\s*options\?\.stream === true[\s\S]*displayUserMessage:\s*options\?\.displayUserMessage/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(learningPrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /fastFinalizeStreamed === true[\s\S]*existingAssistantMessageId/);
assert.match(SOURCE.appHtml, /const streamedMessageId = String\(options\?\.existingAssistantMessageId/);
assert.match(SOURCE.appHtml, /if \(!safeText\) \{[\s\S]*discardStreamingAssistantMessage\(streamedMessageId\)/);
assert.match(SOURCE.appHtml, /finalizeStreamingAssistantMessage\(assistantMessageId, safeText/);
assert.match(SOURCE.appHtml, /logLatencyTrace\('assistant_final_render'/);
assert.match(SOURCE.appHtml, /logLatencyTrace\('chat_submit'/);
assert.match(SOURCE.appHtml, /logLatencyTrace\('chat_api_start'/);
assert.match(SOURCE.appHtml, /logLatencyTrace\('chat_first_delta'/);
assert.match(SOURCE.appHtml, /logLatencyTrace\('chat_stream_complete'/);
assert.match(SOURCE.appHtml, /allowEmpty:\s*true/);
assert.match(SOURCE.appHtml, /ensureStreamMessage\(\);\s*const handleEvent/);
assert.match(SOURCE.appHtml, /streaming:\s*true/);
assert.match(SOURCE.styles, /\.streaming-placeholder::after[\s\S]*\.assistant-message-text\.is-streaming::after/);
assert.match(SOURCE.styles, /@keyframes jarvis-stream-caret/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(recipePrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(introPrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(supportPrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(debatePrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(itineraryPrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /callAIWithTyping\(specialtyPrompt,[\s\S]*directModel:\s*true,[\s\S]*stream:\s*true,[\s\S]*displayUserMessage:\s*text/);
assert.match(SOURCE.appHtml, /recipeResponse\?\.assistantMessageId[\s\S]*discardStreamingAssistantMessage\(recipeResponse\.assistantMessageId\)/);
assert.match(SOURCE.appHtml, /aiResponse\?\.assistantMessageId[\s\S]*discardStreamingAssistantMessage\(aiResponse\.assistantMessageId\)/);
assert.match(SOURCE.appHtml, /medicalResponse = await callAIWithTyping\(medicalPrompt,[\s\S]*directModel:\s*true\s*\}\)/);
assert.match(SOURCE.chatGroqApi, /if \(shouldStreamChatRequest\(req\.body, intent, grounding, routeDecision, isInternalSummary\)\)[\s\S]*handleStreamingChatRequest/);
assert.match(SOURCE.chatGroqApi, /function needsPreStreamSafetyReview\(message\)/);
assert.match(SOURCE.styles, /\.chat-delete-dialog\s*\{/);
assert.match(SOURCE.styles, /\.chat-delete-dialog \.chat-delete-dialog-btn\.danger,[\s\S]*color:\s*#000000 !important/);
assert.match(SOURCE.styles, /\.chat-delete-dialog \.chat-delete-dialog-btn\.danger \*,[\s\S]*\.text-input-dialog \.text-input-dialog-btn\.primary \*[\s\S]*color:\s*#000000 !important/);
assert.match(SOURCE.styles, /\.text-input-dialog-btn\.primary,[\s\S]*color:\s*#000000 !important/);
assert.match(SOURCE.appHtml, /help-modal-back-btn/);
assert.match(SOURCE.appHtml, /Back to previous screen/);
assert.match(SOURCE.appHtml, /applyCustomSystemPromptAndClose\(\)" class="help-modal-ok-btn" aria-label="Save custom instructions"[\s\S]*OK/);
assert.doesNotMatch(SOURCE.appHtml, /class="help-modal-close-btn" aria-label="Close Help & Options"/);
assert.match(SOURCE.styles, /\.help-modal-header\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px/);
assert.match(SOURCE.styles, /button\[aria-label\^="Close"\],[\s\S]*button\[aria-label\^="Back"\],[\s\S]*border-radius:\s*12px !important/);
assert.match(SOURCE.styles, /\.help-modal-ok-btn,[\s\S]*\.help-modal-ok-btn:hover,[\s\S]*\.help-modal-ok-btn:focus-visible\s*\{[\s\S]*background:\s*#ffffff !important[\s\S]*color:\s*#000000 !important/);
assert.match(SOURCE.styles, /\.help-modal-enhanced\s*\{[\s\S]*width:\s*min\(92vw,\s*960px\) !important[\s\S]*max-height:\s*min\(82vh,\s*680px\) !important/);
assert.match(SOURCE.styles, /\.help-modal-enhanced \.help-modal-body\s*\{[\s\S]*padding:\s*clamp\(14px,\s*2\.4vw,\s*22px\) !important/);
assert.match(SOURCE.styles, /@media \(max-width:\s*640px\)[\s\S]*\.help-modal-enhanced[\s\S]*width:\s*calc\(100vw - 20px\) !important/);
assert.match(SOURCE.styles, /@media \(max-width:\s*640px\)[\s\S]*\.custom-system-prompt-input\s*\{[\s\S]*min-height:\s*min\(34vh,\s*220px\)/);

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
