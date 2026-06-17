import assert from 'node:assert/strict';
import apiHandler, { resolveRequestPath } from '../api/index.js';
import chatHandler, { __test as chatTest } from '../api/chat-groq.js';
import currentFactsHandler from '../api/current-facts.js';
import marketsHandler from '../api/markets.js';
import searchHandler, { __test as searchTest } from '../api/search.js';
import visionHandler from '../api/vision.js';

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
const ORIGINAL_MEILI_HOST = process.env.MEILI_HOST;
const ORIGINAL_MEILI_SEARCH_KEY = process.env.MEILI_SEARCH_KEY;
const ORIGINAL_MEILI_INDEX = process.env.MEILI_INDEX;
const ORIGINAL_FETCH = globalThis.fetch;
delete process.env.SERPER_API_KEY;
delete process.env.SERPER_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.MEILI_HOST;
delete process.env.MEILI_SEARCH_KEY;
delete process.env.MEILI_INDEX;

assert.equal(resolveRequestPath({ url: '/api/chat-groq?x=1' }), '/api/chat-groq');
assert.equal(resolveRequestPath({ url: '/api/chat-groq-extra' }), '/api/chat-groq-extra');

const notFound = await callHandler(apiHandler, request('/api/chat-groq-extra', {}));
assert.equal(notFound.statusCode, 404);
assert.equal(notFound.body.error.code, 'route_not_found');

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
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).reason, 'live_retrieval_disabled');
process.env.SERPER_API_KEY = 'test-serper-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
assert.equal(chatTest.classifyRoutingDecision('What is the current president of France?', '', {}).strategy, 'live_first');
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).strategy, 'direct');
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
process.env.MEILI_HOST = 'https://meili.example.test';
process.env.MEILI_SEARCH_KEY = 'test-meili-search-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
assert.equal(chatTest.classifyRoutingDecision('What is the current president of France?', '', {}).strategy, 'live_first');
delete process.env.MEILI_HOST;
delete process.env.MEILI_SEARCH_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;

const wrongMethod = await callHandler(currentFactsHandler, {
    ...request('/api/current-facts', {}),
    method: 'GET',
    headers: {}
});
assert.equal(wrongMethod.statusCode, 405);
assert.equal(wrongMethod.body.error.code, 'method_not_allowed');

const disabledFacts = await callHandler(currentFactsHandler, request('/api/current-facts', { query: SAMPLE.currentQuery }));
assert.equal(disabledFacts.statusCode, 503);
assert.equal(disabledFacts.body.error.code, 'feature_disabled');

const disabledSearch = await callHandler(searchHandler, request('/api/search', { query: SAMPLE.currentQuery }));
assert.equal(disabledSearch.statusCode, 503);
assert.equal(disabledSearch.body.error.code, 'feature_disabled');

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
assert.equal(quotaError.retryable, true);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;

process.env.MEILI_HOST = 'https://meili.example.test/';
process.env.MEILI_SEARCH_KEY = 'test-meili-search-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://meili.example.test/indexes/jarvis_web_pages/search');
    assert.equal(init?.headers?.Authorization, 'Bearer test-meili-search-key');
    return {
        ok: true,
        status: 200,
        async json() {
            return {
                hits: [
                    {
                        title: 'ISRO latest update',
                        canonicalUrl: 'https://www.isro.gov.in/latest-update',
                        description: 'Official ISRO mission update.',
                        domain: 'isro.gov.in',
                        fetchedAt: '2026-06-17T00:00:00.000Z',
                        trusted: true
                    }
                ]
            };
        },
        async text() {
            return '';
        }
    };
};
const crawlerSearch = await callHandler(searchHandler, request('/api/search', { query: 'latest ISRO news', limit: 5 }));
assert.equal(crawlerSearch.statusCode, 200);
assert.equal(crawlerSearch.body.success, true);
assert.equal(crawlerSearch.body.provider, 'crawler_index');
assert.equal(crawlerSearch.body.indexResultCount, 1);
assert.equal(crawlerSearch.body.results[0].domain, 'isro.gov.in');
assert.equal(crawlerSearch.body.trustedCount, 1);

process.env.SERPER_API_KEY = 'test-serper-key';
let searchCalls = 0;
globalThis.fetch = async (url, init) => {
    searchCalls += 1;
    if (String(url).includes('meili.example.test')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    hits: [
                        {
                            title: 'Thin local result',
                            canonicalUrl: 'https://www.isro.gov.in/thin',
                            description: 'One local source.',
                            domain: 'isro.gov.in'
                        }
                    ]
                };
            },
            async text() {
                return '';
            }
        };
    }
    assert.equal(String(url), 'https://google.serper.dev/search');
    assert.equal(init?.headers?.['X-API-KEY'], 'test-serper-key');
    return {
        ok: true,
        status: 200,
        async json() {
            return {
                organic: [
                    {
                        title: 'Reuters ISRO update',
                        link: 'https://www.reuters.com/world/india/isro-update',
                        snippet: 'Reuters report on ISRO.',
                        position: 1
                    }
                ]
            };
        },
        async text() {
            return '';
        }
    };
};
const fallbackSearch = await callHandler(searchHandler, request('/api/search', { query: 'latest ISRO news', limit: 5 }));
assert.equal(fallbackSearch.statusCode, 200);
assert.equal(fallbackSearch.body.provider, 'crawler_index+serper');
assert.equal(fallbackSearch.body.results.length, 2);
assert.equal(searchCalls, 2);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.MEILI_HOST;
delete process.env.MEILI_SEARCH_KEY;
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
restoreEnv('MEILI_HOST', ORIGINAL_MEILI_HOST);
restoreEnv('MEILI_SEARCH_KEY', ORIGINAL_MEILI_SEARCH_KEY);
restoreEnv('MEILI_INDEX', ORIGINAL_MEILI_INDEX);
globalThis.fetch = ORIGINAL_FETCH;

console.log('api-contract-tests-ok');

function restoreEnv(name, value) {
    if (typeof value === 'undefined') {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
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
