import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './live-search.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            message,
            userName,
            context,
            forceSearch = false,
            maxResults = 6,
            systemPrompt
        } = req.body || {};

        const userMessage = String(message || '').trim();

        if (!userMessage) {
            return res.status(400).json({ error: 'message is required' });
        }

        const shouldSearch = Boolean(forceSearch) || needsLiveSearch(userMessage);

        let sources = [];
        let ragContext = '';
        let searchMeta = {
            used: false,
            provider: 'none',
            queryVariants: [],
            distinctDomainCount: 0,
            trustedCount: 0
        };

        if (shouldSearch) {
            const liveQueries = buildSearchQueries(userMessage);
            const verified = await runVerifiedWebSearch(liveQueries, {
                maxResultsPerQuery: Math.min(Number(maxResults) || 6, 6),
                limit: Math.min(Number(maxResults) || 6, 8)
            });

            const searchResults = verified?.results?.length
                ? verified.results
                : await searchWeb(userMessage, Math.min(Number(maxResults) || 6, 8));

            

            sources = normalizeSources(searchResults).slice(0, Math.min(Number(maxResults) || 6, 8));
            ragContext = buildRagContext(sources, userMessage);

            searchMeta = {
                used: true,
                provider: sources.length ? 'aggregated-search' : 'none',
                queryVariants: liveQueries,
                distinctDomainCount: verified?.distinctDomains?.length || countDistinctDomains(sources),
                trustedCount: verified?.trustedCount || 0
            };
        }

        const llmResult = await callChatModel({
            message: userMessage,
            userName,
            context,
            ragContext,
            systemPrompt: systemPrompt || buildAskSystemPrompt()
        });

        return res.status(200).json({
            success: true,
            intent: llmResult.intent || (shouldSearch ? 'web_answer' : 'casual_chat'),
            response: llmResult.response || '',
            action: llmResult.action || null,
            provider: llmResult.provider || 'none',
            modelUsed: llmResult.modelUsed || null,
            search: searchMeta,
            sources
        });
    } catch (error) {
        return res.status(200).json({
            success: false,
            intent: 'service_error',
            response: 'Something went wrong while preparing the answer.',
            action: null,
            details: String(error?.message || error),
            provider: 'none',
            sources: []
        });
    }
}

function needsLiveSearch(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;

    return /\b(latest|recent|current|today|tonight|this week|right now|news|headline|update|updates|best|top|compare|comparison|review|reviews|price|pricing|cost|rate|rates|score|scores|standings|ranking|rankings|result|results|winner|won|weather|forecast|traffic|train|flight|flights|where should i|what should i buy|recommend|recommendation|recommendations)\b/i.test(t);
}

function buildSearchQueries(query) {
    const raw = String(query || '').trim();
    if (!raw) return [];

    const topic = extractSearchTopic(raw) || raw;
    const cleanTopic = normalizeSearchTopic(topic);

    const out = [
        cleanTopic,
        `${cleanTopic} reliable source`
    ];

    if (isTimeSensitiveQuery(raw)) {
        out.push(`latest ${cleanTopic}`);
        out.push(`${cleanTopic} Reuters OR AP OR BBC OR official source`);
    }

    if (/\b(best|top|recommend|recommendations|places to visit|restaurants|hotels)\b/i.test(raw)) {
        out.push(`${cleanTopic} official tourism guide`);
        out.push(`${cleanTopic} trusted travel guide`);
    }

    return Array.from(new Set(out.filter(Boolean)));
}

function isTimeSensitiveQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|current|today|right now|as of now|breaking|news|headline|update|updates|score|scores|winner|won|result|results|standings|ranking|rankings|price|pricing|rate|rates|weather|forecast)\b/i.test(t);
}

function normalizeSearchTopic(text) {
    return String(text || '')
        .replace(/[^\w\s&.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripHtml(text = '') {
    return String(text)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeSources(results) {
    return (Array.isArray(results) ? results : [])
        .map((item) => ({
            title: stripHtml(item?.title || item?.name || 'Untitled'),
            url: String(item?.url || item?.link || '').trim(),
            description: stripHtml(item?.description || item?.snippet || '').slice(0, 300)
        }))
        .filter((item) => item.url);
}

function buildRagContext(sources, originalQuestion) {
    if (!Array.isArray(sources) || !sources.length) return '';

    const lines = [
        `Question: ${originalQuestion}`,
        '',
        'Use the following web results as evidence.',
        'Prefer higher quality sources when multiple results overlap.',
        'If the evidence is weak or mixed, say so clearly.',
        ''
    ];

    sources.slice(0, 6).forEach((source, index) => {
        lines.push(
            `[Source ${index + 1}]`,
            `Title: ${source.title || 'Untitled'}`,
            `URL: ${source.url || ''}`,
            `Snippet: ${source.description || ''}`,
            ''
        );
    });

    return lines.join('\n').trim();
}

function countDistinctDomains(sources) {
    const domains = new Set();

    for (const source of sources || []) {
        try {
            const hostname = new URL(source.url).hostname.replace(/^www\./, '');
            if (hostname) domains.add(hostname);
        } catch (_) {
            // ignore bad URLs
        }
    }

    return domains.size;
}

function buildAskSystemPrompt() {
    return `You are Unify, a helpful AI assistant.

When web context is provided:
- Answer using the retrieved context first.
- Do not invent facts beyond the provided evidence.
- If sources disagree or look weak, say that clearly.
- Keep the answer direct and useful.
- When relevant, mention the most credible sources naturally.
- Do not output markdown tables.
- Return JSON only in this format:
{
  "intent": "web_answer",
  "response": "final answer here",
  "action": null
}

When no web context is provided:
- Answer normally and helpfully.
- Return JSON only in this format:
{
  "intent": "casual_chat",
  "response": "final answer here",
  "action": null
}`;
}

async function callChatModel({ message, userName, context, ragContext, systemPrompt }) {
    const finalPrompt = buildFinalPrompt({
        systemPrompt,
        ragContext,
        context,
        message
    });

    const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (groqApiKey) {
        const groqConfiguredModel = String(process.env.GROQ_MODEL || '').trim();
        const groqCandidates = [
            groqConfiguredModel,
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant'
        ].filter(Boolean);

        let text = '';
        let modelUsed = null;
        let lastErrorDetail = '';

        for (const model of groqCandidates) {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${groqApiKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.4,
                    max_tokens: 2200,
                    messages: [
                        { role: 'user', content: finalPrompt }
                    ]
                })
            });

            if (response.ok) {
                const data = await response.json();
                text = String(data?.choices?.[0]?.message?.content || '').trim();
                modelUsed = model;
                break;
            }

            const bodyText = await response.text().catch(() => '');
            lastErrorDetail = `provider=groq, model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
        }

        if (!text) {
            throw new Error(lastErrorDetail || 'Groq did not return a successful response.');
        }

        return {
            ...safeParseAssistantJson(text),
            provider: 'groq',
            modelUsed
        };
    }

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!geminiApiKey) {
        return {
            intent: 'service_unconfigured',
            response: 'AI backend is not configured. Set GROQ_API_KEY or GEMINI_API_KEY in the server environment.',
            action: null,
            provider: 'none',
            modelUsed: null
        };
    }

    const geminiConfiguredModel = String(process.env.GEMINI_MODEL || '').trim();
    const geminiCandidates = [
        geminiConfiguredModel,
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash'
    ].filter(Boolean);

    let aiText = '';
    let modelUsed = null;
    let lastErrorDetail = '';

    for (const model of geminiCandidates) {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: finalPrompt }]
                    }],
                    generationConfig: {
                        temperature: 0.4,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 2200
                    }
                })
            }
        );

        if (response.ok) {
            const data = await response.json();
            aiText = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            modelUsed = model;
            break;
        }

        const bodyText = await response.text().catch(() => '');
        lastErrorDetail = `provider=gemini, model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
    }

    if (!aiText) {
        throw new Error(lastErrorDetail || 'No Gemini model responded successfully.');
    }

    return {
        ...safeParseAssistantJson(aiText),
        provider: 'gemini',
        modelUsed
    };
}

function buildFinalPrompt({ systemPrompt, ragContext, context, message }) {
    const contextBlock = Array.isArray(context)
        ? context
            .slice(-12)
            .map((m) => `${m?.role === 'user' ? 'User' : 'Assistant'}: ${String(m?.text || '')}`)
            .join('\n')
        : '';

    return [
        systemPrompt,
        ragContext ? `Retrieved context (RAG):\n${ragContext}` : '',
        contextBlock ? `Recent turns:\n${contextBlock}` : '',
        `User message: ${message}`
    ].filter(Boolean).join('\n\n');
}

function safeParseAssistantJson(text) {
    try {
        const parsed = JSON.parse(text);
        return {
            intent: parsed?.intent || 'casual_chat',
            response: String(parsed?.response || '').trim(),
            action: parsed?.action || null
        };
    } catch (_) {
        return {
            intent: 'casual_chat',
            response: String(text || '').trim(),
            action: null
        };
    }
}
