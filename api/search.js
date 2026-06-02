export const config = { maxDuration: 60 };
import { applyApiSecurity } from './security.js';

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const SERPER_NEWS_ENDPOINT = 'https://google.serper.dev/news';
const DEFAULT_SEARCH_TIMEOUT_MS = 6500;
const TRUSTED_DOMAINS = [
    'reuters.com', 'apnews.com', 'bbc.com', 'aljazeera.com', 'thehindu.com',
    'indianexpress.com', 'espncricinfo.com', 'cricbuzz.com', 'fifa.com',
    'nasa.gov', 'isro.gov.in', 'who.int', 'gov', 'edu'
];

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'search',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const query = String(req.body?.query || '').trim();
    const maxResults = clampInt(req.body?.maxResults, 8, 1, 12);
    const wantsAnswer = Boolean(req.body?.answer);
    const domain = String(req.body?.domain || '').trim().toLowerCase();
    const factType = String(req.body?.factType || '').trim().toLowerCase();
    const mustContain = Array.isArray(req.body?.mustContain)
        ? req.body.mustContain.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [];
    if (!query) {
        return res.status(400).json({ success: false, error: 'query is required', results: [] });
    }
    if (query.length > 500) {
        return res.status(413).json({ success: false, error: 'query is too long', results: [] });
    }

    const serperConfigured = hasSerperKey();
    if (!serperConfigured) {
        return res.status(503).json({
            success: false,
            error: 'Live search is not configured. Set SERPER_API_KEY in the server environment.',
            serperConfigured: false,
            results: []
        });
    }

    try {
        const effectiveQuery = biasSearchQuery(query, { domain, factType });
        const webSearch = await searchSerperDetailed(effectiveQuery, { maxResults, type: 'search' });
        const newsSearch = wantsAnswer ? await searchSerperDetailed(effectiveQuery, { maxResults: Math.min(maxResults, 6), type: 'news' }) : { results: [] };
        const rawResults = dedupeResults([...(webSearch.results || []), ...(newsSearch.results || [])]);
        const filteredResults = filterResultsByMustContain(rawResults, mustContain);
        const results = filteredResults.slice(0, maxResults);
        const providerErrors = [webSearch, newsSearch]
            .filter(item => item?.error)
            .map(item => ({
                provider: item.provider,
                status: item.status || 0,
                error: item.error
            }));

        if (!results.length && providerErrors.length) {
            const rssRaw = await searchGoogleNewsRss(effectiveQuery, { maxResults }).catch(() => []);
            const rssResults = filterResultsByMustContain(rssRaw, mustContain);
            if (rssResults.length) {
                const answer = wantsAnswer ? await buildGroundedSearchAnswer(query, rssResults) : { text: '', provider: '', model: '', error: '' };
                return res.status(200).json({
                    success: true,
                    serperConfigured: true,
                    query,
                    results: rssResults,
                    providerBreakdown: {
                        serperSearch: 0,
                        serperNews: 0,
                        googleNewsRss: rssResults.length,
                        serper: 0
                    },
                    providerErrors,
                    answer: answer.text,
                    answerProvider: answer.provider || 'google_news_rss_fallback',
                    answerModel: answer.model || '',
                    answerError: answer.error || ''
                });
            }
            const creditError = providerErrors.find(item => /not enough credits|quota|billing|payment/i.test(String(item?.error || '')));
            return res.status(creditError ? 402 : 502).json({
                success: false,
                error: creditError
                    ? 'Live search provider has no remaining Serper credits. Add Serper credits or configure another provider.'
                    : (providerErrors[0].error || 'live search provider failed'),
                serperConfigured: true,
                providerErrors,
                results: []
            });
        }

        const response = {
            success: true,
            serperConfigured: true,
            query,
            effectiveQuery,
            domain,
            factType,
            mustContain,
            results,
            sourceCategories: results.map(item => ({
                title: item.title,
                url: item.url,
                category: classifySearchSourceCategory(item, { domain, factType })
            })),
            discardedWeakSources: rawResults
                .filter(item => classifySearchSourceCategory(item, { domain, factType }) === 'weak_context')
                .slice(0, 5)
                .map(item => ({ title: item.title, url: item.url })),
            providerBreakdown: {
                serperSearch: webSearch.results?.length || 0,
                serperNews: newsSearch.results?.length || 0,
                serper: results.length
            },
            providerErrors
        };

        if (wantsAnswer && results.length) {
            const answer = await buildGroundedSearchAnswer(query, results);
            response.answer = answer.text;
            response.answerProvider = answer.provider;
            response.answerModel = answer.model;
            response.answerError = answer.error;
        }

        return res.status(200).json(response);
    } catch (error) {
        return res.status(200).json({
            success: false,
            error: 'live search failed',
            errorDetail: req?.body?.debug ? String(error?.message || error || '').slice(0, 300) : undefined,
            serperConfigured,
            results: []
        });
    }
}

function biasSearchQuery(query, options = {}) {
    const raw = String(query || '').trim();
    const domain = String(options.domain || '').toLowerCase();
    const factType = String(options.factType || '').toLowerCase();
    if (domain === 'sports' && (factType === 'result' || factType === 'score' || /\b(ipl|cricket|match|score|result|won|winner)\b/i.test(raw))) {
        if (/\b(ipl|indian premier league)\b/i.test(raw)) {
            return `${raw} result scorecard Cricbuzz ESPNcricinfo IPLT20`;
        }
        return `${raw} result scorecard official`;
    }
    if (factType === 'role') return `${raw} official current`;
    if (domain === 'space_science') return `${raw} official latest update`;
    return raw;
}

function filterResultsByMustContain(results, mustContain) {
    const list = Array.isArray(results) ? results : [];
    const required = Array.isArray(mustContain)
        ? mustContain.map(item => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [];
    if (!required.length) return list;
    const filtered = list.filter(item => {
        const combined = `${item?.title || ''} ${item?.description || ''} ${item?.url || ''}`.toLowerCase();
        return required.some(token => combined.includes(token));
    });
    return filtered.length ? filtered : list;
}

export function hasSerperKey() {
    return Boolean(process.env.SERPER_API_KEY || process.env.SERPER_KEY);
}

export async function searchSerper(query, options = {}) {
    const detailed = await searchSerperDetailed(query, options);
    return detailed.results || [];
}

async function searchSerperDetailed(query, options = {}) {
    const apiKey = process.env.SERPER_API_KEY || process.env.SERPER_KEY;
    const provider = options.type === 'news' ? 'serper_news' : 'serper_search';
    if (!apiKey) {
        return { provider, ok: false, status: 503, error: 'SERPER_API_KEY is not configured', results: [] };
    }
    const maxResults = clampInt(options.maxResults, 8, 1, 20);
    const timeoutMs = clampInt(options.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, 1000, 15000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const endpoint = options.type === 'news' ? SERPER_NEWS_ENDPOINT : SERPER_ENDPOINT;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey
            },
            signal: options.signal || controller.signal,
            body: JSON.stringify({
                q: query,
                num: maxResults,
                gl: options.gl || 'us',
                hl: options.hl || 'en'
            })
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            return {
                provider,
                ok: false,
                status: response.status,
                error: `Serper ${options.type === 'news' ? 'news' : 'search'} failed: ${String(detail || response.statusText).slice(0, 300)}`,
                results: []
            };
        }
        const data = await response.json();
        return {
            provider,
            ok: true,
            status: 200,
            error: '',
            results: normalizeSerperResults(data, maxResults)
        };
    } catch (error) {
        return {
            provider,
            ok: false,
            status: 0,
            error: error?.name === 'AbortError' ? 'Serper request timed out' : String(error?.message || error || 'Serper request failed'),
            results: []
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function runVerifiedWebSearch(queries, options = {}) {
    const list = Array.isArray(queries) ? queries : [queries];
    const maxResultsPerQuery = clampInt(options.maxResultsPerQuery, 6, 1, 10);
    const limit = clampInt(options.limit, 10, 1, 20);
    const settled = await Promise.allSettled(
        list
            .map(q => String(q || '').trim())
            .filter(Boolean)
            .slice(0, 5)
            .map(q => searchSerper(q, {
                maxResults: maxResultsPerQuery,
                signal: options.signal,
                timeoutMs: options.timeoutMs
            }))
    );
    const seen = new Set();
    const results = [];
    for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        for (const row of item.value || []) {
            const url = String(row?.url || '').trim();
            if (!url || seen.has(url)) continue;
            seen.add(url);
            results.push(row);
            if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
    }
    const distinctDomains = Array.from(new Set(results.map(item => getDomainFromUrl(item.url)).filter(Boolean)));
    const trustedCount = results.filter(item => isTrustedLiveSource(item.url)).length;
    return { results, distinctDomains, trustedCount };
}

function normalizeSerperResults(data, maxResults) {
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const news = Array.isArray(data?.news) ? data.news : [];
    return [...organic, ...news]
        .map(item => ({
            title: cleanText(item?.title),
            url: normalizeUrl(item?.link || item?.url),
            description: cleanText(item?.snippet || item?.description || item?.title),
            date: cleanText(item?.date || ''),
            provider: 'serper'
        }))
        .filter(item => item.title && item.url)
        .slice(0, maxResults);
}

function dedupeResults(results) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(results) ? results : []) {
        const url = String(item?.url || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(item);
    }
    return out;
}

export async function searchGoogleNewsRss(query, options = {}) {
    const maxResults = clampInt(options.maxResults, 8, 1, 12);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), clampInt(options.timeoutMs, 6500, 1000, 15000));
    try {
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const response = await fetch(rssUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 UnifyAssistant/1.0'
            },
            signal: options.signal || controller.signal
        });
        if (!response.ok) return [];
        const xml = await response.text();
        const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        return itemBlocks
            .map(block => ({
                title: decodeXml(stripTags(extractXmlTag(block, 'title'))),
                url: normalizeGoogleNewsUrl(decodeXml(extractXmlTag(block, 'link'))),
                description: decodeXml(stripTags(extractXmlTag(block, 'description'))),
                date: decodeXml(extractXmlTag(block, 'pubDate')),
                provider: 'google_news_rss'
            }))
            .filter(item => item.title && item.url)
            .slice(0, maxResults);
    } finally {
        clearTimeout(timeoutId);
    }
}

function extractXmlTag(xml, tagName) {
    const match = String(xml || '').match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
    return match?.[1] || '';
}

function stripTags(value) {
    return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
    return String(value || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeGoogleNewsUrl(url) {
    const value = normalizeUrl(url);
    if (!value) return '';
    try {
        const parsed = new URL(value);
        const direct = parsed.searchParams.get('url');
        return direct && /^https?:\/\//i.test(direct) ? direct : value;
    } catch (_) {
        return value;
    }
}

async function buildGroundedSearchAnswer(query, results) {
    const snippets = results
        .slice(0, 6)
        .map((r, i) => `${i + 1}. ${r.title}\nSnippet: ${r.description}\nURL: ${r.url}`)
        .join('\n\n');
    const prompt = `Answer the user using only these current web snippets.

User question: "${query}"

Rules:
- Start with the direct answer in 1-3 sentences.
- Add up to 3 short key points only if useful.
- Do not invent facts not present in the snippets.
- Do not infer a winner, score, role holder, price, or event outcome unless it is explicitly present in the snippets.
- If snippets are only fixtures, schedules, previews, predictions, or landing pages, say no confirmed result was found.
- If snippets disagree or are weak, say that clearly.

Snippets:
${snippets}`;

    const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (groqKey) {
        try {
            const model = String(process.env.GROQ_MODEL || 'openai/gpt-oss-120b').trim();
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.2,
                    max_tokens: 420,
                    messages: [
                        { role: 'system', content: 'You are a grounded live-search answerer. Use only supplied snippets.' },
                        { role: 'user', content: prompt }
                    ]
                })
            });
            if (response.ok) {
                const data = await response.json();
                const text = cleanText(data?.choices?.[0]?.message?.content || '');
                if (text) return { text, provider: 'groq', model, error: '' };
            }
        } catch (error) {
            return { text: fallbackSnippetAnswer(results), provider: 'fallback', model: '', error: String(error?.message || error || '') };
        }
    }

    return { text: fallbackSnippetAnswer(results), provider: 'fallback', model: '', error: groqKey ? 'empty_model_answer' : 'GROQ_API_KEY is not configured' };
}

function classifySearchSourceCategory(item, options = {}) {
    const combined = `${item?.title || ''} ${item?.description || ''}`.toLowerCase();
    const domain = String(options.domain || '').toLowerCase();
    const factType = String(options.factType || '').toLowerCase();
    if (domain === 'sports' && (factType === 'result' || factType === 'score')) {
        if (/\b(preview|prediction|pitch report|weather|rain|washed out|schedule|fixtures?|live scores?|points table|standings|probable xi|fantasy|dream11)\b/.test(combined)) {
            return 'weak_context';
        }
        if (/\b(result|scorecard|who won|beat|defeated|won by|lost to|match report|highlights?)\b/.test(combined)) {
            return 'post_event_result';
        }
    }
    if (/\bofficial\b/.test(combined)) return 'official';
    return 'general';
}

function fallbackSnippetAnswer(results) {
    const top = Array.isArray(results) ? results[0] : null;
    if (!top) return '';
    const lead = cleanText(top.description || top.title || '');
    const title = cleanText(top.title || '');
    if (lead && title && lead !== title) return `${title}: ${lead}`;
    return lead || title;
}

export function extractSearchTopic(text) {
    const raw = String(text || '').trim();
    return raw
        .replace(/^\s*(latest|current|today'?s|recent|breaking)\s+/i, '')
        .replace(/\b(news|headlines|updates?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

export function isTrustedLiveSource(url) {
    const domain = getDomainFromUrl(url);
    if (!domain) return false;
    return TRUSTED_DOMAINS.some(trusted => domain === trusted || domain.endsWith(`.${trusted}`) || domain.endsWith(trusted));
}

function normalizeUrl(url) {
    const value = String(url || '').trim();
    return /^https?:\/\//i.test(value) ? value : '';
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}
