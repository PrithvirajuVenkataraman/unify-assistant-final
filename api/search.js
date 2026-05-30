export const config = { maxDuration: 60 };
import { applyApiSecurity } from './security.js';

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
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
        const results = await searchSerper(query, { maxResults });
        const response = {
            success: true,
            serperConfigured: true,
            query,
            results,
            providerBreakdown: { serper: results.length }
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

export function hasSerperKey() {
    return Boolean(process.env.SERPER_API_KEY || process.env.SERPER_KEY);
}

export async function searchSerper(query, options = {}) {
    const apiKey = process.env.SERPER_API_KEY || process.env.SERPER_KEY;
    if (!apiKey) return [];
    const maxResults = clampInt(options.maxResults, 8, 1, 20);
    const timeoutMs = clampInt(options.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, 1000, 15000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(SERPER_ENDPOINT, {
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
        if (!response.ok) return [];
        const data = await response.json();
        return normalizeSerperResults(data, maxResults);
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
