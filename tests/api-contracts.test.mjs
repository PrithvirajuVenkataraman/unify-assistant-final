import assert from 'node:assert/strict';
import apiHandler, { resolveRequestPath } from '../api/index.js';
import chatHandler, { __test as chatTest } from '../api/chat-groq.js';
import currentFactsHandler from '../api/current-facts.js';
import marketsHandler from '../api/markets.js';
import searchHandler, { __test as searchTest } from '../api/search.js'; 
import visionHandler from '../api/vision.js'; 
import { webSearchHandler, __test as webSearchTest } from '../api/_lib/web-search-core.js';
import { clearItems, saveItems } from '../api/_lib/latest/latest-cache.js';

const SAMPLE = Object.freeze({
    chatMessage: 'q',
    selectionText: 'const v = 1;',
    customInstruction: 'q q',
    customPrompt: 'a b c',
    challengedAnswer: 'verify q',
    challengedResponse: '2020.',
    currentQuery: 'q q',
    marketQuery: 'q q',
    budgetQuery: 'Plan 3 days under INR 12000',
    imageBase64: 'eA=='
});

const ORIGINAL_SERPER_API_KEY = process.env.SERPER_API_KEY;
const ORIGINAL_SERPER_KEY = process.env.SERPER_KEY;
const ORIGINAL_LIVE_RETRIEVAL_ENABLED = process.env.LIVE_RETRIEVAL_ENABLED;
const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const ORIGINAL_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const ORIGINAL_GEMINI_SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL; 
const ORIGINAL_SEARXNG_URL = process.env.SEARXNG_URL;
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
const ORIGINAL_WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED;
const ORIGINAL_FETCH = globalThis.fetch; 
delete process.env.SERPER_API_KEY;
delete process.env.SERPER_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY; 
delete process.env.GEMINI_SEARCH_MODEL; 
delete process.env.SEARXNG_URL;
delete process.env.REDIS_URL;
delete process.env.WEB_SEARCH_ENABLED;

assert.equal(resolveRequestPath({ url: '/api/chat-groq?x=1' }), '/api/chat-groq');
assert.equal(resolveRequestPath({ url: '/api/chat-groq-extra' }), '/api/chat-groq-extra');

const notFound = await callHandler(apiHandler, request('/api/chat-groq-extra', {})); 
assert.equal(notFound.statusCode, 404); 
assert.equal(notFound.body.error.code, 'route_not_found'); 

const pausedWebSearch = await callHandler(webSearchHandler, request('/api/web-search', { query: 'latest open source search' }));
assert.equal(pausedWebSearch.statusCode, 503);
assert.equal(pausedWebSearch.body.disabled, true);
assert.equal(pausedWebSearch.body.error.code, 'web_search_disabled');
process.env.WEB_SEARCH_ENABLED = 'true';
const missingSearxng = await callHandler(webSearchHandler, request('/api/web-search', { query: 'latest open source search' }));
assert.equal(missingSearxng.statusCode, 503);
assert.equal(missingSearxng.body.error.code, 'searxng_not_configured');
assert.equal(webSearchTest.normalizeSearchRequest({ query: '  chief minister Tamil Nadu  ' }).value.query, 'chief minister Tamil Nadu');
assert.equal(webSearchTest.robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public', '/private/page', 'UnifyAssistantWebSearch'), false);
assert.equal(webSearchTest.robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public', '/private/public/page', 'UnifyAssistantWebSearch'), true);

process.env.SEARXNG_URL = 'https://searxng.test';
globalThis.fetch = async url => {
    const value = String(url);
    if (value.startsWith('https://searxng.test/search')) {
        return okJson({
            results: [
                { title: 'Example Article', url: 'https://example.com/article', content: 'Example snippet', engine: 'mock' },
                { title: 'Blocked Article', url: 'https://blocked.example/private', content: 'Blocked snippet', engine: 'mock' }
            ]
        });
    }
    if (value === 'https://example.com/robots.txt') {
        return textResponse('User-agent: *\nAllow: /', 200, 'text/plain');
    }
    if (value === 'https://blocked.example/robots.txt') {
        return textResponse('User-agent: *\nDisallow: /', 200, 'text/plain');
    }
    if (value === 'https://example.com/article') {
        return textResponse('<html><head><title>Example Article</title><meta name="description" content="Clean description"></head><body><nav>menu</nav><article><h1>Example Article</h1><p>This is a readable article body with enough useful words to be included in the cleaned search result for prompt grounding and citation.</p><script>bad()</script><footer>footer</footer></article></body></html>');
    }
    throw new Error(`Unexpected fetch ${value}`);
};
const webSearchOk = await callHandler(webSearchHandler, request('/api/web-search', {
    query: 'example article',
    maxResults: 2,
    textLimit: 2000
}));
assert.equal(webSearchOk.statusCode, 200);
assert.equal(webSearchOk.body.success, true);
assert.equal(webSearchOk.body.results.length, 1);
assert.equal(webSearchOk.body.results[0].url, 'https://example.com/article');
assert.doesNotMatch(webSearchOk.body.results[0].text, /menu|footer|bad/);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.SEARXNG_URL;
delete process.env.WEB_SEARCH_ENABLED;

const invalidChat = await callHandler(chatHandler, request('/api/chat-groq', { message: '' }));
assert.equal(invalidChat.statusCode, 400);
assert.equal(invalidChat.body.success, false);
assert.equal(invalidChat.body.error.code, 'invalid_request');

const invalidSelection = chatTest.normalizeChatRequest({
    message: SAMPLE.customInstruction,
    intent: 'selection_explain'
});
assert.equal(invalidSelection.ok, false);

const validSelection = chatTest.normalizeChatRequest({
    message: SAMPLE.customInstruction,
    intent: 'selection_explain',
    grounding: {
        selectedText: SAMPLE.selectionText,
        sourceAnswer: SAMPLE.selectionText,
        originalRequest: SAMPLE.chatMessage
    },
    preferences: { responseStyle: 'witty' }
});
assert.equal(validSelection.ok, true);
assert.equal(validSelection.value.preferences.responseStyle, 'witty');
const customPromptRequest = chatTest.normalizeChatRequest({
    message: SAMPLE.chatMessage,
    preferences: {
        customSystemPrompt: SAMPLE.customPrompt
    }
});
assert.equal(customPromptRequest.ok, true);
assert.equal(customPromptRequest.value.preferences.customSystemPrompt, SAMPLE.customPrompt);
assert.match(
    chatTest.buildServerSystemPrompt(customPromptRequest.value.preferences),
    /custom reply instructions as tone and formatting preferences only/i
);
const grounded = chatTest.buildGroundedUserMessage(
    validSelection.value.message,
    validSelection.value.intent,
    validSelection.value.grounding
);
assert.match(grounded, /Do not treat source code.*generic code review/i);
assert.doesNotMatch(grounded, /What this code does/);
assert.deepEqual(
    ['balanced', 'witty', 'chatty', 'supportive', 'debate'].map(chatTest.normalizeResponseStyle),
    ['balanced', 'witty', 'chatty', 'supportive', 'debate']
);
assert.equal(chatTest.normalizeResponseStyle('unknown'), 'balanced');
assert.ok(chatTest.getQualityRiskReasons(SAMPLE.challengedAnswer, SAMPLE.challengedResponse, 'chat').length > 0);
assert.equal(chatTest.getStableFactAnswer('What is the capital of France?'), 'The capital of France is Paris.');
const capitalReply = await callHandler(chatHandler, request('/api/chat-groq', { message: 'What is the capital of France?' }));
assert.equal(capitalReply.statusCode, 200);
assert.equal(capitalReply.body.provider, 'deterministic');
assert.equal(capitalReply.body.response, 'The capital of France is Paris.');
assert.equal(capitalReply.body.webEscalation.escalated, false);
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).strategy, 'direct');
process.env.SERPER_API_KEY = 'test-serper-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
assert.equal(chatTest.classifyRoutingDecision('What is the current president of France?', '', {}).strategy, 'live_first');
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).strategy, 'direct');
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
assert.equal(chatTest.classifyRoutingDecision('What is the current president of France?', '', {}).strategy, 'live_first');
assert.equal(
    chatTest.resolveContextualLiveQuery('Who is Ada Lovelace?', [
        { role: 'user', text: 'Tell me about ISRO' },
        { role: 'assistant', text: 'ISRO summary' }
    ]),
    'Who is Ada Lovelace?'
);
assert.match(
    chatTest.resolveContextualLiveQuery('latest on it', [
        { role: 'user', text: 'Tell me about ISRO' },
        { role: 'assistant', text: 'ISRO summary' }
    ]),
    /\bisro\b/i
);
for (const scenario of [
    {
        prior: 'Tell me about UNICEF',
        assistant: 'UNICEF summary',
        standalone: 'Who is Marie Curie?',
        expectedStandalone: 'Who is Marie Curie?',
        followup: 'latest on it',
        expectedAnchor: /\bunicef\b/i
    },
    {
        prior: 'Explain quantum computing',
        assistant: 'Quantum computing summary',
        standalone: 'What is photosynthesis?',
        expectedStandalone: 'What is photosynthesis?',
        followup: 'show sources for it',
        expectedAnchor: /\bquantum\b/i
    }
]) {
    assert.equal(
        chatTest.resolveContextualLiveQuery(scenario.standalone, [
            { role: 'user', text: scenario.prior },
            { role: 'assistant', text: scenario.assistant }
        ]),
        scenario.expectedStandalone
    );
    assert.match(
        chatTest.resolveContextualLiveQuery(scenario.followup, [
            { role: 'user', text: scenario.prior },
            { role: 'assistant', text: scenario.assistant }
        ]),
        scenario.expectedAnchor
    );
}

const wrongMethod = await callHandler(currentFactsHandler, {
    ...request('/api/current-facts', {}),
    method: 'GET',
    headers: {}
});
assert.equal(wrongMethod.statusCode, 405);
assert.equal(wrongMethod.body.error.code, 'method_not_allowed');

clearItems();
const cacheMissFacts = await callHandler(currentFactsHandler, request('/api/current-facts', { query: SAMPLE.currentQuery }));
assert.equal(cacheMissFacts.statusCode, 200);
assert.equal(cacheMissFacts.body.resolved, false);
assert.equal(cacheMissFacts.body.error.code, 'cache_miss');
saveItems([{
    title: 'OpenAI ships a cached update',
    url: 'https://openai.com/news/cached-update',
    summary: 'Cached article for current facts.',
    source: 'OpenAI News',
    publishedAt: new Date().toISOString()
}]);
const cachedFacts = await callHandler(currentFactsHandler, request('/api/current-facts', { query: 'latest OpenAI news' }));
assert.equal(cachedFacts.statusCode, 200);
assert.equal(cachedFacts.body.resolved, true);
assert.equal(cachedFacts.body.sources[0].source, 'OpenAI News');
clearItems();

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return { query: { search: [{ title: 'France', snippet: 'France country profile.' }] } };
            },
            async text() { return ''; }
        };
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    title: 'France',
                    extract: 'France is a country in Western Europe.',
                    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/France' } }
                };
            },
            async text() { return ''; }
        };
    }
    if (href.includes('api.gdeltproject.org')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    articles: [{
                        title: 'France current background',
                        url: 'https://www.bbc.com/news/world-europe-17298730',
                        domain: 'bbc.com',
                        seendate: '20260617120000'
                    }]
                };
            },
            async text() { return ''; }
        };
    }
    throw new Error(`unexpected URL ${href}`);
};
const publicSearch = await callHandler(searchHandler, request('/api/search', { query: 'France facts', limit: 5 }));
assert.equal(publicSearch.statusCode, 200);
assert.equal(publicSearch.body.success, true);
assert.equal(publicSearch.body.provider, 'public_sources');
assert.equal(publicSearch.body.results.length, 2);
assert.deepEqual(publicSearch.body.distinctDomains, ['bbc.com', 'en.wikipedia.org']);
assert.equal(publicSearch.body.trustedCount, 2);
assert.equal(publicSearch.body.geminiEnhanced, false);
assert.equal(publicSearch.body.results[0].sourceLabel, 'bbc.com via GDELT');
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({ articles: [] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const officialShortcutSearch = await callHandler(searchHandler, request('/api/search', { query: 'ISRO official update', limit: 5 }));
assert.equal(officialShortcutSearch.statusCode, 200);
assert.equal(officialShortcutSearch.body.success, true);
assert.equal(officialShortcutSearch.body.provider, 'public_sources');
assert.ok(officialShortcutSearch.body.results.some(item => item.domain === 'isro.gov.in'));
assert.ok(officialShortcutSearch.body.results.some(item => item.sourceType === 'official_source'));
globalThis.fetch = ORIGINAL_FETCH;

clearItems();
saveItems([{
    title: 'React 19.2 release notes',
    url: 'https://react.dev/blog/2026/06/01/react-19-2',
    summary: 'A cached React release article.',
    source: 'React Blog',
    publishedAt: new Date().toISOString()
}]);
const cachedLatestSearch = await callHandler(searchHandler, request('/api/search', { query: 'latest React release', limit: 5 }));
assert.equal(cachedLatestSearch.statusCode, 200);
assert.equal(cachedLatestSearch.body.success, true);
assert.equal(cachedLatestSearch.body.provider, 'latest_cache');
assert.equal(cachedLatestSearch.body.results[0].sourceLabel, 'React Blog');
clearItems();

const liveRequiredSearch = await callHandler(searchHandler, request('/api/search', { query: 'bitcoin price now', limit: 5 }));
assert.equal(liveRequiredSearch.statusCode, 503);
assert.equal(liveRequiredSearch.body.error.code, 'real_time_source_not_connected');

process.env.GEMINI_API_KEY = 'test-gemini-key';
let geminiCallCount = 0;
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
            return okJson({
                candidates: [{ content: { parts: [{ text: '{"queries":["ISRO official latest update","ISRO launch news"]}' }] } }]
            });
        }
        return okJson({
            candidates: [{
                content: {
                    parts: [{
                        text: '{"ranked":[{"index":0,"description":"Official ISRO source for current updates.","reason":"official source"}]}'
                    }]
                }
            }]
        });
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [{
                title: 'ISRO update reported',
                url: 'https://www.bbc.com/news/science-environment-isro',
                domain: 'bbc.com',
                seendate: '20260617121000'
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const geminiSearch = await callHandler(searchHandler, request('/api/search', { query: 'ISRO background', limit: 5 }));
assert.equal(geminiSearch.statusCode, 200);
assert.equal(geminiSearch.body.success, true);
assert.equal(geminiSearch.body.geminiEnhanced, true);
assert.equal(geminiSearch.body.results[0].domain, 'isro.gov.in');
assert.match(geminiSearch.body.results[0].description, /Official ISRO source/);
assert.ok(geminiCallCount >= 2);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.GEMINI_API_KEY = 'test-gemini-key';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        return {
            ok: false,
            status: 500,
            async json() { return {}; },
            async text() { return 'gemini unavailable'; }
        };
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: 'NASA', snippet: 'NASA profile.' }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: 'NASA',
            extract: 'NASA is the United States space agency.',
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/NASA' } }
        });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({ articles: [] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const geminiFailureSearch = await callHandler(searchHandler, request('/api/search', { query: 'NASA facts', limit: 5 }));
assert.equal(geminiFailureSearch.statusCode, 200);
assert.equal(geminiFailureSearch.body.success, true);
assert.equal(geminiFailureSearch.body.geminiEnhanced, false);
assert.ok(geminiFailureSearch.body.warnings.some(item => item.includes('gemini_')));
assert.ok(geminiFailureSearch.body.results.length >= 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.SERPER_API_KEY = 'test-serper-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
const keyFingerprint = searchTest.getSerperKeyFingerprint();
assert.equal(keyFingerprint.length, 10);
assert.notEqual(keyFingerprint, 'test-serper-key');
globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://google.serper.dev/search');
    assert.equal(init?.headers?.['X-API-KEY'], 'test-serper-key');
    return {
        ok: true,
        status: 200,
        async json() {
            return {
                organic: [
                    {
                        title: 'France facts',
                        link: 'https://www.bbc.com/news/world-europe-17298730?x=1',
                        snippet: 'France country profile and current background.',
                        position: 1
                    },
                    {
                        title: 'France facts duplicate',
                        link: 'https://www.bbc.com/news/world-europe-17298730?x=2',
                        snippet: 'Duplicate URL after query stripping.',
                        position: 2
                    },
                    {
                        title: 'Official France',
                        link: 'https://www.diplomatie.gouv.fr/en/',
                        snippet: 'Official French foreign ministry.',
                        position: 3
                    }
                ]
            };
        },
        async text() {
            return '';
        }
    };
};
const enabledSearch = await callHandler(searchHandler, request('/api/search', { query: 'France facts', limit: 5 }));
assert.equal(enabledSearch.statusCode, 200);
assert.equal(enabledSearch.body.success, true);
assert.equal(enabledSearch.body.results.length, 2);
assert.deepEqual(enabledSearch.body.distinctDomains, ['bbc.com', 'diplomatie.gouv.fr']);
assert.equal(enabledSearch.body.trustedCount, 1);
assert.equal(searchTest.isTrustedLiveSource('https://www.bbc.com/news'), true);
const authError = searchTest.createSerperStatusError(401, '{"message":"Invalid API key abcdefghijklmnopqrstuvwxyz"}');
assert.equal(authError.code, 'serper_auth_failed');
assert.equal(authError.httpStatus, 502);
assert.equal(authError.upstreamStatus, 401);
assert.equal(authError.retryable, false);
assert.match(authError.publicMessage, /Serper rejected the API key/);
assert.doesNotMatch(authError.publicMessage, /abcdefghijklmnopqrstuvwxyz/);
const quotaError = searchTest.createSerperStatusError(429, 'quota exceeded');
assert.equal(quotaError.code, 'serper_quota_or_rate_limit');
assert.equal(quotaError.retryable, false);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;

const disabledMarkets = await callHandler(marketsHandler, request('/api/markets', {
    mode: 'markets',
    query: SAMPLE.marketQuery
}));
assert.equal(disabledMarkets.statusCode, 503);
assert.equal(disabledMarkets.body.error.code, 'feature_disabled');

const budgetPlan = await callHandler(marketsHandler, request('/api/markets', {
    mode: 'budget_plan',
    query: SAMPLE.budgetQuery
}));
assert.equal(budgetPlan.statusCode, 200);
assert.equal(budgetPlan.body.success, true);
assert.equal(budgetPlan.body.plan.currency, 'INR');

const invalidVisionMime = await callHandler(visionHandler, request('/api/vision', {
    task: 'general_vision',
    mimeType: 'text/plain',
    imageBase64: SAMPLE.imageBase64
}));
assert.equal(invalidVisionMime.statusCode, 415);
assert.equal(invalidVisionMime.body.error.code, 'unsupported_media_type');

restoreEnv('SERPER_API_KEY', ORIGINAL_SERPER_API_KEY);
restoreEnv('SERPER_KEY', ORIGINAL_SERPER_KEY);
restoreEnv('LIVE_RETRIEVAL_ENABLED', ORIGINAL_LIVE_RETRIEVAL_ENABLED);
restoreEnv('GEMINI_API_KEY', ORIGINAL_GEMINI_API_KEY); 
restoreEnv('GOOGLE_API_KEY', ORIGINAL_GOOGLE_API_KEY); 
restoreEnv('GEMINI_SEARCH_MODEL', ORIGINAL_GEMINI_SEARCH_MODEL); 
restoreEnv('SEARXNG_URL', ORIGINAL_SEARXNG_URL);
restoreEnv('REDIS_URL', ORIGINAL_REDIS_URL);
restoreEnv('WEB_SEARCH_ENABLED', ORIGINAL_WEB_SEARCH_ENABLED);
globalThis.fetch = ORIGINAL_FETCH; 

console.log('api-contract-tests-ok');

function restoreEnv(name, value) {
    if (typeof value === 'undefined') {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

function okJson(payload) { 
    return {
        ok: true,
        status: 200,
        async json() {
            return payload;
        },
        async text() {
            return '';
        }
    };
} 

function textResponse(payload, status = 200, contentType = 'text/html; charset=utf-8') {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return String(name || '').toLowerCase() === 'content-type' ? contentType : '';
            }
        },
        async json() {
            return JSON.parse(payload);
        },
        async text() {
            return payload;
        }
    };
}
 
function request(url, body) { 
    return {
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body
    };
}

async function callHandler(handler, req) {
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
        },
        end() {
            return this;
        }
    };
    await handler(req, res);
    return res;
}
