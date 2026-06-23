import assert from 'node:assert/strict';
import fs from 'node:fs';
import apiHandler, { resolveRequestPath } from '../api/index.js';
import chatHandler, { __test as chatTest } from '../api/chat-groq.js';
import currentFactsHandler from '../api/current-facts.js';
import marketsHandler from '../api/markets.js';
import searchHandler, { __test as searchTest } from '../api/search.js'; 
import visionHandler from '../api/vision.js'; 
import ocrHandler from '../api/ocr.js';
import { OCR_LIMITS } from '../api/_lib/ocr.js';
import { webSearchHandler, __test as webSearchTest } from '../api/_lib/web-search-core.js';
import extractUrlHandler, { __test as extractUrlTest } from '../api/extract-url.js';
import mediaSearchHandler, { __test as mediaSearchTest } from '../api/media-search.js';
import { clearItems, saveItems } from '../api/_lib/latest/latest-cache.js';

const APP_HTML_SOURCE = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

const ROLE_FIXTURES = Object.freeze({
    president: Object.freeze({
        role: 'president',
        jurisdiction: 'Test Republic',
        jurisdictionId: 'Q100001',
        jurisdictionDescription: 'test sovereign state',
        holderId: 'Q100002',
        holder: 'Fixture President',
        alternateHolder: 'Alternate President',
        officeLabel: 'president',
        start: '2020-01-02T00:00:00Z',
        startDate: '2020-01-02',
        article: 'https://en.wikipedia.org/wiki/Fixture_President'
    }),
    primeMinister: Object.freeze({
        role: 'prime minister',
        jurisdiction: 'Test Union',
        jurisdictionId: 'Q100003',
        jurisdictionDescription: 'test country',
        holderId: 'Q100004',
        holder: 'Fixture Premier',
        officeLabel: 'prime minister',
        start: '2021-03-04T00:00:00Z',
        startDate: '2021-03-04',
        article: 'https://en.wikipedia.org/wiki/Fixture_Premier'
    }),
    chiefMinister: Object.freeze({
        role: 'chief minister',
        jurisdiction: 'Test Territory',
        jurisdictionId: 'Q100005',
        jurisdictionDescription: 'test state',
        holderId: 'Q100006',
        holder: 'Fixture Minister',
        alternateHolder: 'Alternate Minister',
        officeLabel: 'Chief Minister of Test Territory',
        start: '2022-05-06T00:00:00Z',
        startDate: '2022-05-06',
        article: 'https://en.wikipedia.org/wiki/Fixture_Minister'
    }),
    governor: Object.freeze({
        role: 'governor',
        jurisdiction: 'Test Region',
        jurisdictionId: 'Q100007',
        jurisdictionDescription: 'test province',
        holderId: 'Q100008',
        holder: 'Fixture Governor',
        officeLabel: 'Governor of Test Region',
        start: '2023-07-08T00:00:00Z',
        startDate: '2023-07-08',
        article: 'https://en.wikipedia.org/wiki/Fixture_Governor'
    }),
    ceo: Object.freeze({
        role: 'CEO',
        jurisdiction: 'Test Organization',
        jurisdictionId: 'Q100009',
        jurisdictionDescription: 'test organization',
        holderId: 'Q100010',
        holder: 'Fixture Executive',
        officeLabel: 'CEO',
        start: '2024-09-10T00:00:00Z',
        startDate: '2024-09-10',
        article: 'https://en.wikipedia.org/wiki/Fixture_Executive'
    })
});

const LIVE_FIXTURES = Object.freeze({
    weather: Object.freeze({
        place: 'Testville',
        region: 'Fixture Region',
        country: 'Fixture Country',
        query: 'weather in Testville',
        temperature: 31,
        apparent: 35,
        humidity: 70,
        wind: 12
    }),
    crypto: Object.freeze({
        asset: 'bitcoin',
        query: 'bitcoin price now',
        usd: 65000,
        inr: 5400000,
        change: 1.25
    }),
    disaster: Object.freeze({
        kind: 'earthquake',
        query: 'earthquake updates today',
        title: 'Fixture earthquake event',
        date: '2026-06-18T00:00:00Z'
    }),
    sports: Object.freeze({
        query: 'cricket score now',
        team: 'Fixture City Club',
        league: 'Cricket Fixture League'
    }),
    places: Object.freeze({
        query: 'places to visit in Sample Harbor',
        topic: 'Sample Harbor',
        summary: 'Sample Harbor is a port destination with public attractions.'
    }),
    government: Object.freeze({
        query: 'latest government news in Sample Republic',
        title: 'Fixture government update',
        url: 'https://www.bbc.com/news/fixture-government-update'
    }),
    unsupported: Object.freeze({
        query: 'restaurants near me open now'
    })
});

const ORIGINAL_SERPER_API_KEY = process.env.SERPER_API_KEY;
const ORIGINAL_SERPER_KEY = process.env.SERPER_KEY;
const ORIGINAL_LIVE_RETRIEVAL_ENABLED = process.env.LIVE_RETRIEVAL_ENABLED;
const ORIGINAL_GROQ_API_KEY = process.env.GROQ_API_KEY;
const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const ORIGINAL_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const ORIGINAL_GEMINI_SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL; 
const ORIGINAL_SEARXNG_URL = process.env.SEARXNG_URL;
const ORIGINAL_CRAWL4AI_URL = process.env.CRAWL4AI_URL;
const ORIGINAL_CRAWL4AI_TOKEN = process.env.CRAWL4AI_TOKEN;
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
const ORIGINAL_WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED;
const ORIGINAL_FETCH = globalThis.fetch; 
delete process.env.SERPER_API_KEY;
delete process.env.SERPER_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY; 
delete process.env.GEMINI_SEARCH_MODEL; 
delete process.env.SEARXNG_URL;
delete process.env.CRAWL4AI_URL;
delete process.env.CRAWL4AI_TOKEN;
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
assert.equal(webSearchTest.normalizeSearchRequest({ query: `  ${ROLE_FIXTURES.chiefMinister.role} ${ROLE_FIXTURES.chiefMinister.jurisdiction}  ` }).value.query, `${ROLE_FIXTURES.chiefMinister.role} ${ROLE_FIXTURES.chiefMinister.jurisdiction}`);
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

const disabledExtract = await callHandler(extractUrlHandler, request('/api/extract-url', { url: 'https://example.com/article' }));
assert.equal(disabledExtract.statusCode, 503);
assert.equal(disabledExtract.body.error.code, 'crawl4ai_not_configured');
const invalidExtract = await callHandler(extractUrlHandler, request('/api/extract-url', { url: 'not a url' }));
assert.equal(invalidExtract.statusCode, 400);
assert.equal(invalidExtract.body.error.code, 'invalid_url');
const privateExtract = await callHandler(extractUrlHandler, request('/api/extract-url', { url: 'http://127.0.0.1:8080/private' }));
assert.equal(privateExtract.statusCode, 400);
assert.equal(privateExtract.body.error.code, 'private_url_blocked');
assert.equal(extractUrlTest.normalizeExtractRequest({ url: 'https://example.com/a#frag' }).value.url, 'https://example.com/a');
assert.equal(extractUrlTest.buildCrawl4AiEndpoint('https://crawl4ai.example').endsWith('/crawl'), true);
process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
process.env.CRAWL4AI_TOKEN = 'test-crawl-token';
let crawlAuthHeader = '';
globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://crawl4ai.example/crawl');
    crawlAuthHeader = String(init?.headers?.Authorization || '');
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.url, 'https://example.com/article');
    return okJson({
        result: {
            url: 'https://example.com/article',
            title: 'Example Article',
            description: 'Clean extracted page.',
            markdown: '# Example Article\n\nUseful extracted text.'
        }
    });
};
const extractedUrl = await callHandler(extractUrlHandler, request('/api/extract-url', {
    url: 'https://example.com/article',
    query: 'summarize this',
    textLimit: 2000
}));
assert.equal(extractedUrl.statusCode, 200);
assert.equal(extractedUrl.body.success, true);
assert.equal(extractedUrl.body.result.sourceType, 'crawl4ai_extract');
assert.match(extractedUrl.body.result.markdown, /Example Article/);
assert.equal(crawlAuthHeader, 'Bearer test-crawl-token');
globalThis.fetch = async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
};
const timeoutExtract = await callHandler(extractUrlHandler, request('/api/extract-url', {
    url: 'https://example.org/slow',
    timeoutMs: 3000
}));
assert.equal(timeoutExtract.statusCode, 504);
assert.equal(timeoutExtract.body.error.code, 'crawl4ai_timeout');
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.CRAWL4AI_URL;
delete process.env.CRAWL4AI_TOKEN;

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
const verifyGrounded = chatTest.buildGroundedUserMessage(
    'Check whether this selection is accurate.',
    'selection_verify',
    validSelection.value.grounding
);
assert.match(verifyGrounded, /Verdict: likely accurate, partly accurate, unsupported, or incorrect/i);
assert.match(verifyGrounded, /Evidence used:/i);
assert.match(verifyGrounded, /How checked:/i);
assert.match(verifyGrounded, /Claims needing live\/source verification:/i);
assert.match(verifyGrounded, /Corrected answer:/i);
assert.match(APP_HTML_SOURCE, /function buildVerificationResponseInstructions/);
assert.match(APP_HTML_SOURCE, /Evidence used:/);
assert.match(APP_HTML_SOURCE, /How checked:/);
assert.match(APP_HTML_SOURCE, /Claims needing live\/source verification:/);
assert.match(APP_HTML_SOURCE, /Corrected answer:/);
assert.match(APP_HTML_SOURCE, /await maybeShowReferenceImageForQuery\(`\$\{visibleText\} \$\{selected\}`,\s*answer,\s*messageId\)/);
assert.match(APP_HTML_SOURCE, /const factualAsk = /);
assert.match(APP_HTML_SOURCE, /pictures would be great/);
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
assert.equal(chatTest.classifyRoutingDecision(roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction), '', {}).strategy, 'live_first');
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).strategy, 'direct');
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
assert.equal(chatTest.classifyRoutingDecision(roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction), '', {}).strategy, 'live_first');
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

assert.equal(
    chatTest.resolveRouteEscalation(
        { strategy: 'direct', reason: 'stable_factual_query' },
        'Who discovered penicillin?',
        'Alexander Fleming discovered penicillin.',
        { strictMode: true }
    ).escalate,
    false
);
assert.equal(
    chatTest.resolveRouteEscalation(
        { strategy: 'direct', reason: 'stable_factual_query' },
        'Who discovered penicillin?',
        'I am not sure. You can check Google or a website.',
        { strictMode: true }
    ).reason,
    'unknown_general_knowledge_answer'
);
assert.equal(chatTest.isCrawl4AiFallbackCandidate({ url: 'https://en.wikipedia.org/wiki/Penicillin' }), true);
assert.equal(chatTest.isCrawl4AiFallbackCandidate({ url: 'https://example.com/file.pdf' }), false);

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CHAT_ROUTER_MODE = 'strict_single_pass';
let confidentSearchCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('Classify the user message')) {
            return okJson({ choices: [{ message: { content: '{"blocked":false,"reason":"safe","safe_response":""}' } }] });
        }
        if (prompt.includes('Review this candidate answer')) {
            return okJson({ choices: [{ message: { content: '{"verdict":"pass","issues":[],"correctedResponse":""}' } }] });
        }
        return okJson({ choices: [{ message: { content: 'Alexander Fleming discovered penicillin.' } }] });
    }
    confidentSearchCalls += 1;
    throw new Error(`unexpected URL ${href}`);
};
const confidentStableChat = await callHandler(chatHandler, request('/api/chat-groq', { message: 'Who discovered penicillin?' }));
assert.equal(confidentStableChat.statusCode, 200);
assert.equal(confidentStableChat.body.webEscalation.escalated, false);
assert.equal(confidentStableChat.body.webEscalation.reason, 'stable_fact_answered_directly');
assert.match(confidentStableChat.body.response, /Alexander Fleming discovered penicillin/);
assert.equal(confidentSearchCalls, 0);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.CHAT_ROUTER_MODE;

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CHAT_ROUTER_MODE = 'strict_single_pass';
process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
let uncertainModelCalls = 0;
let fallbackCrawlCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('Classify the user message')) {
            return okJson({ choices: [{ message: { content: '{"blocked":false,"reason":"safe","safe_response":""}' } }] });
        }
        if (prompt.includes('Review this candidate answer')) {
            return okJson({ choices: [{ message: { content: '{"verdict":"pass","issues":[],"correctedResponse":""}' } }] });
        }
        uncertainModelCalls += 1;
        if (prompt.includes('Retrieved context (RAG):')) {
            return okJson({ choices: [{ message: { content: 'Aspirin history is commonly linked to Felix Hoffmann and Bayer chemists, based on the extracted public source.' } }] });
        }
        return okJson({ choices: [{ message: { content: 'I am not sure. You can check Google or a reliable website.' } }] });
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: 'Aspirin', snippet: 'Aspirin discovery and history.' }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: 'Aspirin',
            extract: 'Aspirin history includes the work of Felix Hoffmann and Bayer chemists.',
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Aspirin' } }
        });
    }
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href === 'https://crawl4ai.example/crawl') {
        fallbackCrawlCalls += 1;
        return okJson({
            result: {
                url: 'https://en.wikipedia.org/wiki/Aspirin',
                title: 'Aspirin',
                description: 'Aspirin discovery history.',
                text: 'Aspirin history includes the work of Felix Hoffmann and Bayer chemists in the late nineteenth century.'
            }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const uncertainStableChat = await callHandler(chatHandler, request('/api/chat-groq', { message: 'Who discovered aspirin?' }));
assert.equal(uncertainStableChat.statusCode, 200);
assert.equal(uncertainStableChat.body.webEscalation.escalated, true);
assert.equal(uncertainStableChat.body.webEscalation.reason, 'crawl4ai_grounding_used');
assert.equal(uncertainStableChat.body.webEscalation.extractor, 'crawl4ai');
assert.equal(uncertainStableChat.body.webEscalation.sourceCount, 1);
assert.ok(fallbackCrawlCalls > 0 && fallbackCrawlCalls <= 3);
assert.equal(uncertainModelCalls, 2);
assert.match(uncertainStableChat.body.response, /Felix Hoffmann|extracted public source/);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.CHAT_ROUTER_MODE;
delete process.env.CRAWL4AI_URL;

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CHAT_ROUTER_MODE = 'strict_single_pass';
let unavailableModelCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('Classify the user message')) {
            return okJson({ choices: [{ message: { content: '{"blocked":false,"reason":"safe","safe_response":""}' } }] });
        }
        if (prompt.includes('Review this candidate answer')) {
            return okJson({ choices: [{ message: { content: '{"verdict":"pass","issues":[],"correctedResponse":""}' } }] });
        }
        unavailableModelCalls += 1;
        return okJson({ choices: [{ message: { content: 'I am not sure. You can check Google or a reliable website.' } }] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const unavailableFallbackChat = await callHandler(chatHandler, request('/api/chat-groq', { message: 'Who discovered aspirin?' }));
assert.equal(unavailableFallbackChat.statusCode, 200);
assert.equal(unavailableFallbackChat.body.webEscalation.escalated, false);
assert.equal(unavailableFallbackChat.body.webEscalation.reason, 'crawl4ai_unavailable');
assert.equal(unavailableFallbackChat.body.webEscalation.extractor, 'crawl4ai');
assert.equal(unavailableFallbackChat.body.response, 'I am not sure. You can check Google or a reliable website.');
assert.equal(unavailableModelCalls, 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.CHAT_ROUTER_MODE;

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
assert.equal(publicSearch.body.answerEvidenceCount, 2);
assert.equal(publicSearch.body.geminiEnhanced, false);
assert.equal(publicSearch.body.results[0].sourceLabel, 'bbc.com via GDELT');
assert.ok(!publicSearch.body.results.some(item => item.sourceType === 'reference_lookup'));
assert.ok(!publicSearch.body.results.some(item => item.sourceType === 'archive_lookup'));
globalThis.fetch = ORIGINAL_FETCH;

const presidentQuery = roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction);
const chiefMinisterQuery = roleQuery(ROLE_FIXTURES.chiefMinister.role, ROLE_FIXTURES.chiefMinister.jurisdiction, '');
const ceoQuery = roleQuery(ROLE_FIXTURES.ceo.role, ROLE_FIXTURES.ceo.jurisdiction);
assert.deepEqual(searchTest.parseGovernmentRoleQuery(presidentQuery), {
    role: 'president',
    roleText: 'president',
    jurisdiction: ROLE_FIXTURES.president.jurisdiction,
    property: 'P35'
});
assert.deepEqual(searchTest.parseGovernmentRoleQuery(chiefMinisterQuery), {
    role: 'chief minister',
    roleText: 'chief minister',
    jurisdiction: ROLE_FIXTURES.chiefMinister.jurisdiction,
    property: 'P39'
});
assert.deepEqual(searchTest.parseGovernmentRoleQuery(ceoQuery), {
    role: 'ceo',
    roleText: 'CEO',
    jurisdiction: ROLE_FIXTURES.ceo.jurisdiction,
    property: 'P169'
});
assert.equal(searchTest.isValidCitationSource({
    title: `Britannica search: ${chiefMinisterQuery}`,
    url: `https://www.britannica.com/search?query=${encodeURIComponent(chiefMinisterQuery)}`,
    description: 'Reference lookup on Britannica.',
    domain: 'britannica.com',
    sourceType: 'reference_lookup'
}, chiefMinisterQuery), false);
assert.equal(searchTest.isValidCitationSource({
    title: `archive.today search: ${chiefMinisterQuery}`,
    url: `https://archive.today/search/?q=${encodeURIComponent(chiefMinisterQuery)}`,
    description: 'Archive lookup.',
    domain: 'archive.today',
    sourceType: 'archive_lookup'
}, chiefMinisterQuery), false);
assert.equal(searchTest.isValidCitationSource({
    title: 'Official profile',
    url: 'https://example.gov/profile',
    description: 'Official profile page with current office holder information.',
    domain: 'example.gov',
    sourceType: 'official_source',
    pageFetched: false
}, 'current office holder'), false);
assert.equal(searchTest.isValidCitationSource({
    title: 'WHO official',
    url: 'https://www.who.int/',
    description: 'Official World Health Organization updates and public health information.',
    domain: 'who.int',
    sourceType: 'official_source',
    pageFetched: true,
    exactShortcutMatch: false
}, chiefMinisterQuery), false);
assert.deepEqual(searchTest.parseDiscoveryFactQuery('Founder of penicillin'), {
    subject: 'penicillin',
    relation: 'discovery'
});
assert.equal(searchTest.isDiscoveryAnswerSource(searchTest.parseDiscoveryFactQuery('Founder of penicillin'), {
    title: 'Al Capone',
    description: 'Al Capone was treated with penicillin late in his life.',
    sourceType: 'encyclopedia'
}), false);
const penicillinAnswer = searchTest.buildSourceDerivedAnswer([], { query: 'Founder of penicillin' });
assert.match(penicillinAnswer.answer, /Alexander Fleming discovered penicillin/i);
assert.doesNotMatch(penicillinAnswer.answer, /^Ernst Chain/i);

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.president.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.president.jurisdictionId, label: ROLE_FIXTURES.president.jurisdiction, description: ROLE_FIXTURES.president.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.president.holderId,
            holderLabel: ROLE_FIXTURES.president.holder,
            officeLabel: ROLE_FIXTURES.president.officeLabel,
            start: ROLE_FIXTURES.president.start,
            article: ROLE_FIXTURES.president.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const presidentSearch = await callHandler(searchHandler, request('/api/search', { query: presidentQuery, limit: 5 }));
assert.equal(presidentSearch.statusCode, 200);
assert.equal(presidentSearch.body.success, true);
assert.ok(presidentSearch.body.answerEvidenceCount >= 1);
assert.equal(presidentSearch.body.answerProvider, 'wikidata_structured_claim');
assert.match(presidentSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.president.holder)));
assert.equal(presidentSearch.body.results[0].holderName, ROLE_FIXTURES.president.holder);
assert.equal(presidentSearch.body.results[0].role, ROLE_FIXTURES.president.role);
assert.equal(presidentSearch.body.results[0].jurisdiction, ROLE_FIXTURES.president.jurisdiction);
assert.equal(presidentSearch.body.results[0].wikidataId, ROLE_FIXTURES.president.holderId);
assert.equal(presidentSearch.body.results[0].evidenceLevel, 'structured_claim');
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.primeMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.primeMinister.jurisdictionId, label: ROLE_FIXTURES.primeMinister.jurisdiction, description: ROLE_FIXTURES.primeMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.primeMinister.holderId,
            holderLabel: ROLE_FIXTURES.primeMinister.holder,
            officeLabel: ROLE_FIXTURES.primeMinister.officeLabel,
            start: ROLE_FIXTURES.primeMinister.start,
            article: ROLE_FIXTURES.primeMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const primeMinisterSearch = await callHandler(searchHandler, request('/api/search', { query: roleQuery(ROLE_FIXTURES.primeMinister.role, ROLE_FIXTURES.primeMinister.jurisdiction), limit: 5 }));
assert.equal(primeMinisterSearch.statusCode, 200);
assert.equal(primeMinisterSearch.body.results[0].holderName, ROLE_FIXTURES.primeMinister.holder);
assert.equal(primeMinisterSearch.body.results[0].role, ROLE_FIXTURES.primeMinister.role);
assert.equal(primeMinisterSearch.body.results[0].jurisdiction, ROLE_FIXTURES.primeMinister.jurisdiction);
assert.equal(primeMinisterSearch.body.results[0].startDate, ROLE_FIXTURES.primeMinister.startDate);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.chiefMinister.holderId,
            holderLabel: ROLE_FIXTURES.chiefMinister.holder,
            officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
            start: ROLE_FIXTURES.chiefMinister.start,
            article: ROLE_FIXTURES.chiefMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const structuredRoleSearch = await callHandler(searchHandler, request('/api/search', { query: chiefMinisterQuery, limit: 5 }));
assert.equal(structuredRoleSearch.statusCode, 200);
assert.equal(structuredRoleSearch.body.results[0].holderName, ROLE_FIXTURES.chiefMinister.holder);
assert.equal(structuredRoleSearch.body.results[0].role, ROLE_FIXTURES.chiefMinister.role);
assert.equal(structuredRoleSearch.body.results[0].jurisdiction, ROLE_FIXTURES.chiefMinister.jurisdiction);
assert.equal(structuredRoleSearch.body.results[0].evidenceLevel, 'structured_claim');
assert.match(structuredRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.holder)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.chiefMinister.holderId,
            holderLabel: ROLE_FIXTURES.chiefMinister.alternateHolder,
            officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
            start: ROLE_FIXTURES.chiefMinister.start,
            article: ROLE_FIXTURES.chiefMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const changedRoleSearch = await callHandler(searchHandler, request('/api/search', { query: chiefMinisterQuery, limit: 5 }));
assert.equal(changedRoleSearch.statusCode, 200);
assert.match(changedRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.alternateHolder)));
assert.doesNotMatch(changedRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.holder)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: `${ROLE_FIXTURES.chiefMinister.officeLabel}`, snippet: 'Office overview.' }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: ROLE_FIXTURES.chiefMinister.officeLabel,
            extract: `${ROLE_FIXTURES.chiefMinister.officeLabel} is the head of government for ${ROLE_FIXTURES.chiefMinister.jurisdiction}.`,
            content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${encodeURIComponent(ROLE_FIXTURES.chiefMinister.officeLabel).replaceAll('%20', '_')}` } }
        });
    }
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const genericRoleDefinitionSearch = await callHandler(searchHandler, request('/api/search', { query: chiefMinisterQuery, limit: 5 }));
assert.equal(genericRoleDefinitionSearch.statusCode, 200);
assert.ok(genericRoleDefinitionSearch.body.results.some(item => item.sourceType === 'encyclopedia'));
assert.equal(genericRoleDefinitionSearch.body.answer, undefined);
assert.equal(genericRoleDefinitionSearch.body.answerProvider, undefined);
globalThis.fetch = ORIGINAL_FETCH;

let whoShortcutTouched = false;
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('who.int')) {
        whoShortcutTouched = true;
        throw new Error(`WHO shortcut should not be used for pronoun query ${href}`);
    }
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.chiefMinister.holderId,
            holderLabel: ROLE_FIXTURES.chiefMinister.holder,
            officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
            start: ROLE_FIXTURES.chiefMinister.start,
            article: ROLE_FIXTURES.chiefMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const whoPronounRoleSearch = await callHandler(searchHandler, request('/api/search', { query: pronounRoleQuery(ROLE_FIXTURES.chiefMinister.role, ROLE_FIXTURES.chiefMinister.jurisdiction), limit: 5 }));
assert.equal(whoPronounRoleSearch.statusCode, 200);
assert.equal(whoShortcutTouched, false);
assert.ok(!whoPronounRoleSearch.body.results.some(item => item.domain === 'who.int'));
assert.equal(whoPronounRoleSearch.body.results[0].holderName, ROLE_FIXTURES.chiefMinister.holder);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.governor.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.governor.jurisdictionId, label: ROLE_FIXTURES.governor.jurisdiction, description: ROLE_FIXTURES.governor.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.governor.holderId,
            holderLabel: ROLE_FIXTURES.governor.holder,
            officeLabel: ROLE_FIXTURES.governor.officeLabel,
            start: ROLE_FIXTURES.governor.start,
            article: ROLE_FIXTURES.governor.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const governorSearch = await callHandler(searchHandler, request('/api/search', { query: roleQuery(ROLE_FIXTURES.governor.role, ROLE_FIXTURES.governor.jurisdiction, ''), limit: 5 }));
assert.equal(governorSearch.statusCode, 200);
assert.equal(governorSearch.body.results[0].holderName, ROLE_FIXTURES.governor.holder);
assert.equal(governorSearch.body.results[0].role, ROLE_FIXTURES.governor.role);
assert.equal(governorSearch.body.results[0].jurisdiction, ROLE_FIXTURES.governor.jurisdiction);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.ceo.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.ceo.jurisdictionId, label: ROLE_FIXTURES.ceo.jurisdiction, description: ROLE_FIXTURES.ceo.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.ceo.holderId,
            holderLabel: ROLE_FIXTURES.ceo.holder,
            officeLabel: ROLE_FIXTURES.ceo.officeLabel,
            start: ROLE_FIXTURES.ceo.start,
            article: ROLE_FIXTURES.ceo.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const ceoSearch = await callHandler(searchHandler, request('/api/search', { query: ceoQuery, limit: 5 }));
assert.equal(ceoSearch.statusCode, 200);
assert.equal(ceoSearch.body.results[0].holderName, ROLE_FIXTURES.ceo.holder);
assert.equal(ceoSearch.body.results[0].role, 'ceo');
assert.equal(ceoSearch.body.results[0].jurisdiction, ROLE_FIXTURES.ceo.jurisdiction);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const unknownRoleSearch = await callHandler(searchHandler, request('/api/search', { query: 'current president of Atlantis', limit: 5 }));
assert.equal(unknownRoleSearch.statusCode, 200);
assert.equal(unknownRoleSearch.body.answerEvidenceCount, 0);
assert.equal(unknownRoleSearch.body.results.length, 0);
assert.ok(unknownRoleSearch.body.warnings.some(item => /No public-source results/.test(item)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href === 'https://www.isro.gov.in/') {
        return textResponse('<html><head><title>ISRO official</title><meta name="description" content="Official Indian Space Research Organisation source for current updates and primary information."></head><body>Official Indian Space Research Organisation updates.</body></html>');
    }
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

process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
let crawlOfficialShortcutUsed = false;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href === 'https://crawl4ai.example/crawl') {
        crawlOfficialShortcutUsed = true;
        const body = JSON.parse(String(init?.body || '{}'));
        assert.equal(body.url, 'https://www.isro.gov.in/');
        return okJson({
            result: {
                url: 'https://www.isro.gov.in/',
                title: 'ISRO official via Crawl4AI',
                description: 'Official ISRO source extracted by Crawl4AI for current mission updates and primary information.',
                markdown: '# ISRO official via Crawl4AI\n\nOfficial ISRO source extracted by Crawl4AI.'
            }
        });
    }
    assert.notEqual(href, 'https://www.isro.gov.in/');
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const crawlOfficialShortcutSearch = await callHandler(searchHandler, request('/api/search', { query: 'ISRO official source', limit: 5 }));
assert.equal(crawlOfficialShortcutSearch.statusCode, 200);
assert.equal(crawlOfficialShortcutUsed, true);
assert.ok(crawlOfficialShortcutSearch.body.results.some(item => item.domain === 'isro.gov.in' && item.pageFetched === true));
assert.ok(crawlOfficialShortcutSearch.body.results.some(item => item.qualitySignals.includes('crawl4ai_extracted')));
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.CRAWL4AI_URL;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href === 'https://www.who.int/') {
        return textResponse('<html><head><title>WHO official</title><meta name="description" content="Official World Health Organization source for public health updates and primary information."></head><body>Official World Health Organization updates.</body></html>');
    }
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const whoOfficialShortcutSearch = await callHandler(searchHandler, request('/api/search', { query: 'WHO official source', limit: 5 }));
assert.equal(whoOfficialShortcutSearch.statusCode, 200);
assert.ok(whoOfficialShortcutSearch.body.results.some(item => item.domain === 'who.int'));
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
assert.equal(cachedLatestSearch.body.answerProvider, 'latest_cache_source');
assert.match(cachedLatestSearch.body.answer, /React 19\.2 release notes/);
clearItems();

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.coingecko.com/api/v3/simple/price')) {
        return okJson({
            [LIVE_FIXTURES.crypto.asset]: {
                usd: LIVE_FIXTURES.crypto.usd,
                inr: LIVE_FIXTURES.crypto.inr,
                usd_24h_change: LIVE_FIXTURES.crypto.change
            }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const liveRequiredSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.crypto.query, limit: 5 }));
assert.equal(liveRequiredSearch.statusCode, 200);
assert.equal(liveRequiredSearch.body.success, true);
assert.equal(liveRequiredSearch.body.provider, 'coingecko');
assert.equal(liveRequiredSearch.body.category, 'crypto');
assert.equal(liveRequiredSearch.body.results[0].sourceType, 'free_crypto_price');
assert.equal(liveRequiredSearch.body.answerProvider, 'coingecko_source');
assert.match(liveRequiredSearch.body.answer, new RegExp(String(LIVE_FIXTURES.crypto.usd)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('geocoding-api.open-meteo.com')) {
        return okJson({ results: [{ name: LIVE_FIXTURES.weather.place, admin1: LIVE_FIXTURES.weather.region, country: LIVE_FIXTURES.weather.country, latitude: 13.08, longitude: 80.27 }] });
    }
    if (href.includes('api.open-meteo.com/v1/forecast')) {
        return okJson({
            current: {
                temperature_2m: LIVE_FIXTURES.weather.temperature,
                apparent_temperature: LIVE_FIXTURES.weather.apparent,
                relative_humidity_2m: LIVE_FIXTURES.weather.humidity,
                wind_speed_10m: LIVE_FIXTURES.weather.wind
            },
            current_units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const weatherSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.weather.query, limit: 5 }));
assert.equal(weatherSearch.statusCode, 200);
assert.equal(weatherSearch.body.provider, 'open-meteo');
assert.equal(weatherSearch.body.category, 'weather');
assert.equal(weatherSearch.body.results[0].sourceType, 'free_weather');
assert.equal(weatherSearch.body.answerProvider, 'open_meteo_source');
assert.match(weatherSearch.body.answer, new RegExp(LIVE_FIXTURES.weather.place));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('geocoding-api.open-meteo.com')) {
        return okJson({ results: [{ name: LIVE_FIXTURES.weather.place, admin1: LIVE_FIXTURES.weather.region, country: LIVE_FIXTURES.weather.country, latitude: 13.08, longitude: 80.27 }] });
    }
    if (href.includes('api.open-meteo.com/v1/forecast')) {
        return okJson({
            current: {
                temperature_2m: LIVE_FIXTURES.weather.temperature + 4,
                apparent_temperature: LIVE_FIXTURES.weather.apparent + 4,
                relative_humidity_2m: LIVE_FIXTURES.weather.humidity,
                wind_speed_10m: LIVE_FIXTURES.weather.wind
            },
            current_units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const changedWeatherSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.weather.query, limit: 5 }));
assert.equal(changedWeatherSearch.statusCode, 200);
assert.notEqual(changedWeatherSearch.body.answer, weatherSearch.body.answer);
assert.match(changedWeatherSearch.body.answer, new RegExp(String(LIVE_FIXTURES.weather.temperature + 4)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('eonet.gsfc.nasa.gov')) {
        return okJson({
            events: [{
                title: LIVE_FIXTURES.disaster.title,
                categories: [{ title: 'Earthquakes' }],
                geometry: [{ date: LIVE_FIXTURES.disaster.date }],
                sources: [{ url: 'https://eonet.gsfc.nasa.gov/events/example' }]
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const disasterSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.disaster.query, limit: 5 }));
assert.equal(disasterSearch.statusCode, 200);
assert.equal(disasterSearch.body.provider, 'nasa-eonet');
assert.equal(disasterSearch.body.category, 'disasters');
assert.equal(disasterSearch.body.results[0].sourceType, 'free_disaster_event');
assert.equal(disasterSearch.body.answerProvider, 'nasa_eonet_source');
assert.match(disasterSearch.body.answer, new RegExp(LIVE_FIXTURES.disaster.title));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('thesportsdb.com')) {
        return okJson({ teams: [{ strTeam: LIVE_FIXTURES.sports.team, strLeague: LIVE_FIXTURES.sports.league, strWebsite: 'www.fixtureclub.example' }] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const sportsSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.sports.query, limit: 5 }));
assert.equal(sportsSearch.statusCode, 200);
assert.equal(sportsSearch.body.provider, 'thesportsdb');
assert.equal(sportsSearch.body.category, 'sports');
assert.equal(sportsSearch.body.results[0].sourceType, 'free_sports_reference');
assert.equal(sportsSearch.body.answerProvider, 'sports_reference_source');
assert.match(sportsSearch.body.answer, new RegExp(LIVE_FIXTURES.sports.team));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: LIVE_FIXTURES.places.topic, snippet: `${LIVE_FIXTURES.places.topic} place.` }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: LIVE_FIXTURES.places.topic,
            extract: LIVE_FIXTURES.places.summary,
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fixture_Harbor' } }
        });
    }
    if (href.includes('nominatim.openstreetmap.org/search')) {
        return okJson([{ name: LIVE_FIXTURES.places.topic, display_name: `${LIVE_FIXTURES.places.topic}, Fixture Country`, osm_type: 'relation', osm_id: 123 }]);
    }
    throw new Error(`unexpected URL ${href}`);
};
const tourismSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.places.query, limit: 5 }));
assert.equal(tourismSearch.statusCode, 200);
assert.equal(tourismSearch.body.provider, 'wikimedia+openstreetmap');
assert.equal(tourismSearch.body.category, 'tourism_food_places');
assert.ok(tourismSearch.body.results.some(item => item.sourceType === 'free_reference'));
assert.ok(tourismSearch.body.results.some(item => item.sourceType === 'free_place_data'));
assert.equal(tourismSearch.body.answerProvider, 'public_place_source');
assert.match(tourismSearch.body.answer, new RegExp(LIVE_FIXTURES.places.topic));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [{
                title: LIVE_FIXTURES.government.title,
                url: LIVE_FIXTURES.government.url,
                domain: 'bbc.com',
                seendate: '20260618120000'
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const governmentSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.government.query, limit: 5 }));
assert.equal(governmentSearch.statusCode, 200);
assert.equal(governmentSearch.body.category, 'government');
assert.equal(governmentSearch.body.provider, 'public_sources');
assert.equal(governmentSearch.body.results[0].sourceLabel, 'bbc.com via GDELT');
assert.equal(governmentSearch.body.answerProvider, 'public_source_result');
assert.match(governmentSearch.body.answer, new RegExp(LIVE_FIXTURES.government.title));
globalThis.fetch = ORIGINAL_FETCH;

const unsupportedLiveSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.unsupported.query, limit: 5 }));
assert.equal(unsupportedLiveSearch.statusCode, 200);
assert.equal(unsupportedLiveSearch.body.success, false);
assert.equal(unsupportedLiveSearch.body.error.code, 'unsupported_free_live');
assert.equal(unsupportedLiveSearch.body.answer, undefined);

process.env.GEMINI_API_KEY = 'test-gemini-key';
let geminiCallCount = 0;
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href === 'https://www.isro.gov.in/') {
        return textResponse('<html><head><title>ISRO official</title><meta name="description" content="Official ISRO source for current updates and mission information."></head><body>Official ISRO current updates.</body></html>');
    }
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
    const href = String(url);
    assert.doesNotMatch(href, /google\.serper\.dev/);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({ articles: [] });
    }
    return {
        ok: true,
        status: 200,
        async json() {
            return {};
        },
        async text() {
            return '';
        }
    };
};
const enabledSearch = await callHandler(searchHandler, request('/api/search', { query: 'France facts', limit: 5 }));
assert.equal(enabledSearch.statusCode, 200);
assert.equal(enabledSearch.body.success, true);
assert.equal(enabledSearch.body.provider, 'public_sources');
assert.equal(enabledSearch.body.results.length, 0);
assert.equal(enabledSearch.body.answerEvidenceCount, 0);
assert.ok(!enabledSearch.body.results.some(item => item.sourceType === 'reference_lookup'));
assert.ok(!enabledSearch.body.results.some(item => item.sourceType === 'archive_lookup'));
assert.ok(enabledSearch.body.warnings.some(item => /No public-source results/.test(item)));
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

const invalidMediaSearch = await callHandler(mediaSearchHandler, request('/api/media-search', { query: '' }));
assert.equal(invalidMediaSearch.statusCode, 400);
assert.equal(invalidMediaSearch.body.error.code, 'invalid_query');
assert.equal(mediaSearchTest.classifyVisualMediaIntent('tell me about guitar chords').shouldSearch, true);
assert.equal(mediaSearchTest.classifyVisualMediaIntent('who discovered penicillin').shouldSearch, true);
assert.equal(mediaSearchTest.classifyVisualMediaIntent('explain photosynthesis').shouldSearch, true);
assert.equal(mediaSearchTest.classifyVisualMediaIntent('debug this javascript error').shouldSearch, false);
assert.equal(mediaSearchTest.isSafePublicImageUrl('https://upload.wikimedia.org/example.jpg'), true);
assert.equal(mediaSearchTest.isSafePublicImageUrl('https://example.com/example.jpg'), false);

globalThis.fetch = async url => {
    const value = String(url);
    if (value.startsWith('https://en.wikipedia.org/w/api.php')) {
        return okJson({
            query: {
                pages: {
                    1: {
                        title: 'Guitar chord',
                        fullurl: 'https://en.wikipedia.org/wiki/Guitar_chord',
                        thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Guitar_chord.jpg/900px-Guitar_chord.jpg' }
                    }
                }
            }
        });
    }
    if (value.startsWith('https://commons.wikimedia.org/w/api.php')) {
        return okJson({
            query: {
                pages: {
                    2: {
                        title: 'File:Guitar chord diagram.jpg',
                        fullurl: 'https://commons.wikimedia.org/wiki/File:Guitar_chord_diagram.jpg',
                        imageinfo: [{
                            url: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Guitar_chord_diagram.jpg',
                            thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Guitar_chord_diagram.jpg/900px-Guitar_chord_diagram.jpg',
                            mime: 'image/jpeg',
                            extmetadata: {
                                LicenseShortName: { value: 'CC BY-SA 4.0' },
                                Artist: { value: '<span>Example Artist</span>' }
                            }
                        }]
                    }
                }
            }
        });
    }
    throw new Error(`Unexpected media fetch ${value}`);
};
const mediaSearch = await callHandler(mediaSearchHandler, request('/api/media-search', {
    query: 'tell me about guitar chords',
    limit: 3
}));
assert.equal(mediaSearch.statusCode, 200);
assert.equal(mediaSearch.body.success, true);
assert.equal(mediaSearch.body.sourceType, 'public_media');
assert.equal(mediaSearch.body.images.length, 2);
assert.equal(mediaSearch.body.images[1].license, 'CC BY-SA 4.0');
assert.equal(mediaSearch.body.images[1].attribution, 'Example Artist');
globalThis.fetch = ORIGINAL_FETCH;

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

process.env.GROQ_API_KEY = 'test-groq-key';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        return okJson({
            choices: [{
                message: {
                    content: JSON.stringify({
                        text: 'Invoice\nTotal: INR 123.45',
                        pages: [{ pageNumber: 1, text: 'Invoice\nTotal: INR 123.45' }],
                        blocks: [
                            { type: 'heading', text: 'Invoice', pageNumber: 1, confidence: 0.95 },
                            { type: 'key_value', fields: { Total: 'INR 123.45' }, pageNumber: 1, confidence: 0.9 }
                        ],
                        confidence: 'high',
                        warnings: [],
                        metadata: { documentType: 'invoice' }
                    })
                }
            }]
        });
    }
    throw new Error(`unexpected OCR image URL ${href}`);
};
const imageOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'invoice.png',
    mimeType: 'image/png',
    fileBase64: SAMPLE.imageBase64
}));
assert.equal(imageOcr.statusCode, 200);
assert.equal(imageOcr.body.success, true);
assert.match(imageOcr.body.result.text, /Invoice/);
assert.equal(imageOcr.body.result.confidence, 'high');
assert.equal(imageOcr.body.result.metadata.extractionMode, 'image_ocr');
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;

const textPdfOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'sample.pdf',
    mimeType: 'application/pdf',
    fileBase64: buildTextPdfBase64('Hello OCR PDF with enough readable embedded text for extraction')
}));
assert.equal(textPdfOcr.statusCode, 200);
assert.equal(textPdfOcr.body.success, true);
assert.match(textPdfOcr.body.result.text, /Hello OCR PDF/);
assert.equal(textPdfOcr.body.result.metadata.extractionMode, 'pdf_text');

const nearLimitTextOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'near-limit.txt',
    mimeType: 'text/plain',
    fileBase64: Buffer.alloc(OCR_LIMITS.maxFileBytes, 65).toString('base64')
}));
assert.equal(nearLimitTextOcr.statusCode, 200);
assert.equal(nearLimitTextOcr.body.success, true);
assert.equal(nearLimitTextOcr.body.result.metadata.extractionMode, 'plain_text');

delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
const scannedPdfNoProvider = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
    fileBase64: buildTextPdfBase64('')
}));
assert.equal(scannedPdfNoProvider.statusCode, 503);
assert.equal(scannedPdfNoProvider.body.error.code, 'provider_unavailable');
assert.match(scannedPdfNoProvider.body.error.message, /Scanned PDF OCR needs GEMINI_API_KEY or GOOGLE_API_KEY/);

process.env.GEMINI_API_KEY = 'test-gemini-key';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        return okJson({
            candidates: [{
                content: {
                    parts: [{
                        text: JSON.stringify({
                            text: 'Scanned PDF OCR text',
                            pages: [{ pageNumber: 1, text: 'Scanned PDF OCR text' }],
                            blocks: [{ type: 'paragraph', text: 'Scanned PDF OCR text', pageNumber: 1, confidence: 0.72 }],
                            confidence: 'medium',
                            warnings: [],
                            metadata: { documentType: 'scanned_pdf' }
                        })
                    }]
                }
            }]
        });
    }
    throw new Error(`unexpected OCR Gemini URL ${href}`);
};
const scannedPdfOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
    fileBase64: buildTextPdfBase64('')
}));
assert.equal(scannedPdfOcr.statusCode, 200);
assert.equal(scannedPdfOcr.body.result.metadata.extractionMode, 'pdf_scanned_ocr');
assert.match(scannedPdfOcr.body.result.text, /Scanned PDF OCR text/);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.GROQ_API_KEY = 'test-groq-key';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        return okJson({
            choices: [{
                message: {
                    content: JSON.stringify({
                        text: '',
                        pages: [],
                        blocks: [],
                        confidence: 'low',
                        warnings: ['No readable text found.'],
                        metadata: {}
                    })
                }
            }]
        });
    }
    throw new Error(`unexpected unreadable OCR URL ${href}`);
};
const unreadableOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'blank.jpg',
    mimeType: 'image/jpeg',
    fileBase64: SAMPLE.imageBase64
}));
assert.equal(unreadableOcr.statusCode, 200);
assert.equal(unreadableOcr.body.result.confidence, 'low');
assert.ok(unreadableOcr.body.result.warnings.length >= 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;

const unsupportedOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'slides.ppt',
    mimeType: 'application/vnd.ms-powerpoint',
    fileBase64: SAMPLE.imageBase64
}));
assert.equal(unsupportedOcr.statusCode, 415);
assert.equal(unsupportedOcr.body.error.code, 'unsupported_file_type');

const largeOcr = await callHandler(ocrHandler, request('/api/ocr', {
    fileName: 'large.txt',
    mimeType: 'text/plain',
    fileBase64: Buffer.alloc(OCR_LIMITS.maxFileBytes + 1).toString('base64')
}));
assert.equal(largeOcr.statusCode, 413);
assert.equal(largeOcr.body.error.code, 'file_too_large');

restoreEnv('GROQ_API_KEY', ORIGINAL_GROQ_API_KEY);
restoreEnv('SERPER_API_KEY', ORIGINAL_SERPER_API_KEY);
restoreEnv('SERPER_KEY', ORIGINAL_SERPER_KEY);
restoreEnv('LIVE_RETRIEVAL_ENABLED', ORIGINAL_LIVE_RETRIEVAL_ENABLED);
restoreEnv('GEMINI_API_KEY', ORIGINAL_GEMINI_API_KEY); 
restoreEnv('GOOGLE_API_KEY', ORIGINAL_GOOGLE_API_KEY); 
restoreEnv('GEMINI_SEARCH_MODEL', ORIGINAL_GEMINI_SEARCH_MODEL); 
restoreEnv('SEARXNG_URL', ORIGINAL_SEARXNG_URL);
restoreEnv('CRAWL4AI_URL', ORIGINAL_CRAWL4AI_URL);
restoreEnv('CRAWL4AI_TOKEN', ORIGINAL_CRAWL4AI_TOKEN);
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

function wikidataRolePayload({ holder, holderLabel, officeLabel, start = '', article = '' }) {
    return {
        results: {
            bindings: [{
                holder: { type: 'uri', value: `http://www.wikidata.org/entity/${holder}` },
                holderLabel: { type: 'literal', value: holderLabel },
                officeLabel: { type: 'literal', value: officeLabel },
                ...(start ? { start: { type: 'literal', value: start } } : {}),
                ...(article ? { article: { type: 'uri', value: article } } : {})
            }]
        }
    };
}

function roleQuery(role, jurisdiction, prefix = 'current') {
    return [prefix, role, 'of', jurisdiction]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function pronounRoleQuery(role, jurisdiction) {
    return `who is the ${role} of ${jurisdiction}`.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTextPdfBase64(text) {
    const safeText = String(text || '').replace(/[()\\]/g, '');
    const stream = safeText
        ? `BT /F1 24 Tf 72 720 Td (${safeText}) Tj ET`
        : 'BT ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let pdf = '%PDF-1.1\n';
    const offsets = [0];
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(pdf, 'latin1'));
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefAt = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (const offset of offsets.slice(1)) {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefAt}\n%%EOF`;
    return Buffer.from(pdf, 'latin1').toString('base64');
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
