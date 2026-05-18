export const config = { maxDuration: 60 };
import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './live-search.js';
import { applyApiSecurity } from './security.js';

export default async function handler(req, res) {
    try {
        const guard = applyApiSecurity(req, res, {
            methods: ['POST'],
            routeKey: 'search',
            maxBodyBytes: 48 * 1024,
            rateLimit: { max: 40, windowMs: 60 * 1000 }
        });
        if (guard.handled) return;

        const query = String(req.body?.query || '').trim();
        const maxResults = Math.min(Math.max(Number(req.body?.maxResults || 8), 1), 10);
        const includeAnswer = Boolean(req.body?.answer || req.body?.includeAnswer || req.body?.mode === 'answer');
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }
        if (query.length > 500) {
            return res.status(413).json({ error: 'query is too long' });
        }

        const liveQueries = buildSearchQueries(query);
        const verified = await runVerifiedWebSearch(liveQueries, {
            maxResultsPerQuery: Math.min(maxResults, 6),
            limit: maxResults,
            includePageExtract: true
        });
        const rawResults = verified.results.length ? verified.results : await searchWeb(query, maxResults);
        const asOf = new Date().toISOString();
        const results = rawResults.map(item => ({
            ...item,
            canonicalUrl: buildCanonicalUrl(item?.url || ''),
            publishedAt: extractPublishedAtIso(item)
        }));
        const answerPayload = includeAnswer
            ? await buildGroqSearchAnswer(query, results)
            : { answer: '', answerProvider: 'none', answerModel: '', answerSources: [], answerError: '' };

        return res.status(200).json({
            success: true,
            provider: results.length ? 'aggregated-search' : 'none',
            answer: answerPayload.answer,
            answerProvider: answerPayload.answerProvider,
            answerModel: answerPayload.answerModel,
            answerSources: answerPayload.answerSources,
            answerError: answerPayload.answerError,
            queryVariants: liveQueries,
            queryVariantsUsed: liveQueries,
            asOf,
            distinctDomainCount: verified.distinctDomains?.length || 0,
            trustedCount: verified.trustedCount || 0,
            providerBreakdown: verified.providerBreakdown || {},
            serperConfigured: Boolean(verified.serperConfigured),
            results
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            provider: 'none',
            answer: '',
            answerProvider: 'none',
            answerModel: '',
            answerSources: [],
            answerError: 'search_unavailable',
            queryVariants: [],
            queryVariantsUsed: [],
            asOf: new Date().toISOString(),
            distinctDomainCount: 0,
            trustedCount: 0,
            results: [],
            error: 'search_unavailable',
            errorDetail: req?.body?.debug ? String(error?.message || error || '').slice(0, 300) : undefined
        });
    }
}

async function buildGroqSearchAnswer(query, results) {
    const sourcePool = (Array.isArray(results) ? results : [])
        .filter(item => item?.url && (item?.title || item?.description || item?.pageExtract))
        .slice(0, 6);
    if (!sourcePool.length) {
        return {
            answer: '',
            answerProvider: 'none',
            answerModel: '',
            answerSources: [],
            answerError: 'no_sources'
        };
    }

    const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (!groqApiKey) {
        return {
            answer: '',
            answerProvider: 'none',
            answerModel: '',
            answerSources: sourcePool.map(toAnswerSource),
            answerError: 'groq_unconfigured'
        };
    }

    const snippets = sourcePool
        .map((item, index) => {
            const title = truncateForPrompt(item?.title || item?.pageTitle || 'Untitled', 180);
            const description = truncateForPrompt(item?.description || '', 450);
            const pageExtract = truncateForPrompt(item?.pageExtract || '', 900);
            const evidence = pageExtract || description || title;
            return `${index + 1}. ${title}\nEvidence: ${evidence}\nURL: ${item.url}`;
        })
        .join('\n\n');

    const prompt = `Answer the user's question using ONLY the web evidence below.

User question: "${query}"

Rules:
- Start with the direct answer in 1-3 short sentences.
- If evidence is conflicting or weak, say that clearly.
- Do not give search instructions.
- Do not invent facts that are not present in the evidence.
- Keep it concise.
- End with a short "Confidence: High/Medium/Low" line.

Web evidence:
${snippets}`;

    const groqConfiguredModel = String(process.env.GROQ_SEARCH_MODEL || process.env.GROQ_MODEL || '').trim();
    const candidates = [
        groqConfiguredModel,
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant'
    ].filter(Boolean);

    let lastError = '';
    for (const model of candidates) {
        try {
            const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${groqApiKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.2,
                    max_tokens: 700,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a web-grounded answer engine. Use only supplied search evidence.'
                        },
                        { role: 'user', content: prompt }
                    ]
                })
            }, 8500);
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                lastError = `groq_${response.status}_${body.slice(0, 120)}`;
                continue;
            }
            const data = await response.json();
            const answer = cleanSearchAnswer(String(data?.choices?.[0]?.message?.content || ''));
            if (!answer) {
                lastError = 'empty_groq_answer';
                continue;
            }
            return {
                answer,
                answerProvider: 'groq',
                answerModel: model,
                answerSources: sourcePool.map(toAnswerSource),
                answerError: ''
            };
        } catch (error) {
            lastError = String(error?.message || 'groq_request_failed').slice(0, 160);
        }
    }

    return {
        answer: '',
        answerProvider: 'none',
        answerModel: '',
        answerSources: sourcePool.map(toAnswerSource),
        answerError: lastError || 'groq_answer_failed'
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

function toAnswerSource(item) {
    return {
        title: item?.title || item?.pageTitle || '',
        url: item?.url || '',
        canonicalUrl: item?.canonicalUrl || buildCanonicalUrl(item?.url || ''),
        provider: item?.provider || '',
        publishedAt: item?.publishedAt || extractPublishedAtIso(item)
    };
}

function truncateForPrompt(value, maxLength) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function cleanSearchAnswer(value) {
    return String(value || '')
        .replace(/^\s*(?:\*\*)?Direct answer:(?:\*\*)?\s*/i, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildCanonicalUrl(input) {
    try {
        const parsed = new URL(String(input || '').trim());
        const protocol = parsed.protocol.toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') return '';
        const dropKeys = new Set([
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'utm_id', 'gclid', 'fbclid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'ref_src'
        ]);
        const kept = [];
        for (const [k, v] of parsed.searchParams.entries()) {
            if (dropKeys.has(String(k || '').toLowerCase())) continue;
            kept.push([k, v]);
        }
        kept.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
        const query = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        return `${protocol}//${host}${normalizedPath}${query ? `?${query}` : ''}`;
    } catch (_) {
        return '';
    }
}

function extractPublishedAtIso(result) {
    const title = String(result?.title || '');
    const description = String(result?.description || '');
    const combined = `${title} ${description}`;

    const monthDayYear = combined.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i);
    if (monthDayYear) {
        const parsed = Date.parse(monthDayYear[0]);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    const ymd = combined.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
    if (ymd) {
        const parsed = Date.parse(`${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    const mdy = combined.match(/\b(0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])[-\/.](20\d{2})\b/);
    if (mdy) {
        const parsed = Date.parse(`${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    return null;
}


function buildSearchQueries(query) {
    const raw = String(query || '').trim();
    if (!raw) return [];
    const topic = extractSearchTopic(raw) || raw;
    const out = [topic];
    const aliasedTopic = normalizeSearchTopic(topic);
    if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
        out.push(aliasedTopic);
    }

    if (isRoleOrOfficeHolderQuery(raw)) {
        const currentYear = new Date().getUTCFullYear();
        out.push(`current ${topic}`);
        out.push(`${topic} as of ${currentYear}`);
        if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
            out.push(`current ${aliasedTopic}`);
            out.push(`${aliasedTopic} as of ${currentYear}`);
        }
    }

    if (isTimeSensitiveQuery(raw)) {
        const timeAwareTopic = raw
            .replace(/\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|update(?:s)? on|status of|winner|won|champion|score|scores|stats|standings|points table|ranking|rankings|record|qualified|eliminated)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const cleanedTimeAwareTopic = extractSearchTopic(timeAwareTopic) || topic;
        if (cleanedTimeAwareTopic && cleanedTimeAwareTopic.toLowerCase() !== topic.toLowerCase()) {
            out.push(cleanedTimeAwareTopic);
        }
        out.push(`latest ${cleanedTimeAwareTopic || topic}`);
        if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
            out.push(`latest ${aliasedTopic}`);
        }
    }

    return Array.from(new Set(out.filter(Boolean)));
}

function isTimeSensitiveQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|updates?|status|price now|rate today|winner|won|champion|scores?|live score|stats?|standings|points table|rankings?|record|qualified|eliminated)\b/.test(t);
}

function isRoleOrOfficeHolderQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(who is|who's|current|latest)\b/.test(t) &&
        /\b(pm|prime minister|cm|chief minister|president|governor|mayor|minister|ceo|chairman|chairperson|captain|coach|head of|leader of|administrator|director general)\b/.test(t);
}

function normalizeSearchTopic(text) {
    return String(text || '')
        .replace(/[^\w\s&.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

