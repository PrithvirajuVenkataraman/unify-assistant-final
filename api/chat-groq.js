export default async function handler(req, res) {
    // Enable CORS
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
        const { message, userName, systemPrompt: clientSystemPrompt, ragContext, context } = req.body || {};

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const systemPrompt = clientSystemPrompt || buildServerSystemPrompt(userName);
        const contextBlock = Array.isArray(context)
            ? context
                .slice(-20)
                .map(m => `${m?.role === 'user' ? 'User' : 'Assistant'}: ${String(m?.text || '')}`)
                .join('\n')
            : '';
        const clientRagBlock = typeof ragContext === 'string' ? ragContext.trim() : '';
        const liveRag = await buildLiveRagContext(message, req);
        const ragBlock = [clientRagBlock, liveRag.ragText].filter(Boolean).join('\n\n');
        const finalPrompt = [
            systemPrompt,
            ragBlock ? `Retrieved context (RAG):\n${ragBlock}` : '',
            contextBlock ? `Recent turns:\n${contextBlock}` : '',
            `User message: ${message}`
        ].filter(Boolean).join('\n\n');

        // Prefer Groq for this endpoint; keep Gemini fallback for compatibility.
        let groqFailureDetail = '';
        let groqTriedModels = [];
        const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
        if (groqApiKey) {
            const groqConfiguredModel = String(process.env.GROQ_MODEL || '').trim();
            const groqCandidates = [
                groqConfiguredModel,
                'llama-3.3-70b-versatile',
                'llama-3.1-8b-instant'
            ].filter(Boolean);

            let groqText = '';
            let modelUsed = null;
            let lastErrorDetail = '';
            const triedModels = [];

            for (const model of groqCandidates) {
                triedModels.push(model);
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${groqApiKey}`
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.7,
                        max_tokens: 2500,
                        messages: [
                            { role: 'user', content: finalPrompt }
                        ]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    groqText = String(data?.choices?.[0]?.message?.content || '').trim();
                    modelUsed = model;
                    break;
                }

                const bodyText = await response.text().catch(() => '');
                lastErrorDetail = `provider=groq, model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
            }

            if (groqText) {
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(groqText);
                } catch (e) {
                    parsedResponse = {
                        intent: 'casual_chat',
                        response: groqText,
                        action: null
                    };
                }
                parsedResponse = enforceLiveAnswerStyle(parsedResponse, message, liveRag.sources);

                return res.status(200).json({
                    ...parsedResponse,
                    modelUsed,
                    provider: 'groq'
                });
            }
            // Do not fail hard here; continue to Gemini fallback if available.
            groqFailureDetail = lastErrorDetail || 'Groq did not return a successful response.';
            groqTriedModels = triedModels;
        }

        // Fallback path: Gemini if GROQ key is not configured.
        const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!geminiApiKey) {
            return res.status(200).json({
                intent: 'service_unconfigured',
                response: 'AI backend is not configured. Set GROQ_API_KEY or GEMINI_API_KEY in the server environment.',
                action: null,
                provider: 'none',
                details: groqFailureDetail || undefined,
                triedModels: groqTriedModels.length ? groqTriedModels : undefined
            });
        }

        const geminiConfiguredModel = String(process.env.GEMINI_MODEL || '').trim();
        const geminiCandidates = [
            geminiConfiguredModel,
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash'
        ].filter(Boolean);

        let geminiData = null;
        let modelUsed = null;
        let lastErrorDetail = '';
        const triedModels = [];

        for (const model of geminiCandidates) {
            triedModels.push(model);
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: finalPrompt }]
                        }],
                        generationConfig: {
                            temperature: 0.7,
                            topK: 40,
                            topP: 0.95,
                            maxOutputTokens: 2500,
                        }
                    })
                }
            );

            if (response.ok) {
                geminiData = await response.json();
                modelUsed = model;
                break;
            }

            const bodyText = await response.text().catch(() => '');
            lastErrorDetail = `provider=gemini, model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
        }

        if (!geminiData) {
            return res.status(200).json({
                intent: 'service_unavailable',
                response: 'The AI service is temporarily unavailable right now. Please try again shortly.',
                action: null,
                triedModels,
                provider: 'gemini',
                details: [
                    groqFailureDetail ? `groq: ${groqFailureDetail}` : '',
                    lastErrorDetail ? `gemini: ${lastErrorDetail}` : 'No Gemini model responded successfully.'
                ].filter(Boolean).join(' | ')
            });
        }

        let aiText = '';
        if (geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
            aiText = geminiData.candidates[0].content.parts[0].text;
        }

        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText,
                action: null
            };
        }
        parsedResponse = enforceLiveAnswerStyle(parsedResponse, message, liveRag.sources);

        return res.status(200).json({
            ...parsedResponse,
            modelUsed,
            provider: 'gemini'
        });
    } catch (error) {
        return res.status(200).json({
            intent: 'service_error',
            response: 'The AI service hit an internal error. Please try again.',
            action: null,
            details: String(error?.message || error)
        });
    }
}

async function buildLiveRagContext(message, req) {
    const query = String(message || '').trim();
    if (!query || !isTimeSensitiveInfoRequest(query)) return { ragText: '', sources: [] };

    try {
        const liveQueries = buildLiveQueries(query);
        const runVerifiedWebSearch = await resolveRunVerifiedWebSearch();
        let results = [];

        if (runVerifiedWebSearch) {
            const verified = await runVerifiedWebSearch(liveQueries, {
                maxResultsPerQuery: 6,
                limit: 12
            });
            results = Array.isArray(verified?.results) ? verified.results : [];
        } else {
            results = await fetchFromOwnSearchApi(liveQueries, req);
        }

        const ranked = rankLiveSources(query, results).slice(0, 6);
        if (!ranked.length) return { ragText: '', sources: [] };

        const lines = [`Live web verification for: "${query}"`];
        for (let i = 0; i < ranked.length; i++) {
            const item = ranked[i] || {};
            lines.push(`${i + 1}. ${String(item.title || 'Untitled').trim()}`);
            lines.push(`URL: ${String(item.url || '').trim()}`);
            if (item.description) {
                lines.push(`Summary: ${String(item.description).trim()}`);
            }
        }
        return { ragText: lines.join('\n'), sources: ranked };
    } catch (error) {
        return { ragText: '', sources: [] };
    }
}

async function resolveRunVerifiedWebSearch() {
    try {
        const mod = await import('./live-search.js');
        if (typeof mod?.runVerifiedWebSearch === 'function') {
            return mod.runVerifiedWebSearch;
        }
    } catch (_) {}
    return null;
}

async function fetchFromOwnSearchApi(queries, req) {
    try {
        const host = String(req?.headers?.host || '').trim();
        if (!host) return [];
        const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').trim();
        const baseUrl = `${proto}://${host}`;
        const list = Array.isArray(queries) ? queries : [String(queries || '')];
        const all = [];

        for (const q of list.slice(0, 4)) {
            const response = await fetch(`${baseUrl}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: String(q || ''), maxResults: 6 })
            });
            if (!response.ok) continue;
            const data = await response.json();
            const results = Array.isArray(data?.results) ? data.results : [];
            all.push(...results);
        }

        const seen = new Set();
        const deduped = [];
        for (const item of all) {
            const key = String(item?.url || '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
        }
        return deduped;
    } catch (_) {
        return [];
    }
}

function isTimeSensitiveInfoRequest(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|current|today|now|update|updates|news|headlines|status|mission|launch|price|rate|score|result|election|breaking|as of)\b/.test(t);
}

function enforceLiveAnswerStyle(parsedResponse, message, liveSources) {
    const responseText = String(parsedResponse?.response || '').trim();
    if (!isTimeSensitiveInfoRequest(message)) return parsedResponse;
    if (!Array.isArray(liveSources) || !liveSources.length) return parsedResponse;

    const hasLinks = /https?:\/\//i.test(responseText);
    const genericAdvice = /\b(check|visit|see|refer)\b[\s\S]{0,80}\b(official website|website|site)\b/i.test(responseText) ||
        /\bi recommend checking\b/i.test(responseText);

    if (hasLinks && !genericAdvice) return parsedResponse;

    return {
        ...parsedResponse,
        intent: parsedResponse?.intent || 'live_update',
        response: buildLiveUpdateResponse(message, liveSources),
        action: parsedResponse?.action ?? null
    };
}

function buildLiveUpdateResponse(message, liveSources) {
    const now = new Date();
    const asOf = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const top = liveSources.slice(0, 3);
    const lead = top[0] || {};
    const title = String(lead.title || 'Latest update');

    const lines = [`As of ${asOf}, the latest update is: ${title}.`, '', 'Sources:'];
    for (const item of top) {
        lines.push(`- ${String(item.title || 'Source')}: ${String(item.url || '').trim()}`);
    }
    return lines.join('\n');
}

function buildLiveQueries(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    if (/\bisro\b/.test(lower)) {
        return [
            'ISRO latest mission update site:isro.gov.in',
            'ISRO latest launch update site:isro.gov.in',
            'ISRO mission update press release site:isro.gov.in',
            `${q} Reuters OR The Hindu OR Indian Express`
        ];
    }
    return [q];
}

function rankLiveSources(query, results) {
    const list = Array.isArray(results) ? results : [];
    const q = String(query || '').toLowerCase();
    const wantsIsro = /\bisro\b/.test(q);
    const currentYear = new Date().getUTCFullYear();
    const seen = new Set();
    const scored = [];

    for (const item of list) {
        const url = String(item?.url || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const title = String(item?.title || '');
        const desc = String(item?.description || '');
        const hay = `${title} ${desc}`.toLowerCase();
        const host = getHost(url);

        let score = 0;
        if (wantsIsro) {
            if (host.endsWith('isro.gov.in')) score += 8;
            if (/\b(isro|launch|mission|satellite|pslv|gslv|nvs|aditya|chandrayaan|gaganyaan)\b/.test(hay)) score += 4;
            if (/\.pdf($|\?)/i.test(url) && !host.endsWith('isro.gov.in')) score -= 6;
            if (/\b(aps|unoosa|respond basket)\b/.test(hay)) score -= 7;
        }

        if (/\b(latest|today|update|updates|current|now|recent)\b/.test(hay)) score += 2;
        if (/\b(reuters|the hindu|indian express|bbc|ap news)\b/.test(hay)) score += 2;

        const yearMatch = hay.match(/\b(20\d{2})\b/);
        if (yearMatch?.[1]) {
            const y = Number(yearMatch[1]);
            if (Number.isFinite(y)) {
                if (y >= currentYear - 1) score += 2;
                if (y <= currentYear - 3) score -= 3;
            }
        }

        scored.push({ ...item, __score: score });
    }

    scored.sort((a, b) => (b.__score || 0) - (a.__score || 0));
    return scored.filter(item => (item.__score || 0) >= 0);
}

function getHost(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

function buildServerSystemPrompt(userName) {
    return `You are Unify, a helpful voice assistant.${userName ? ` The user's name is ${userName}.` : ''}

Your capabilities:
- Weather
- Reminders
- Memory (remembering where things are)

Style rules:
- Start directly with the answer. No greeting preambles.
- Avoid generic closing prompts (for example, "Would you like to know more...") unless user asked.
- For direct fact questions across any domain, answer with the fact immediately in 1-2 sentences. Do not pad with extra commentary, suggestions, or follow-up offers unless the user asked for detail.
- For person/celebrity queries ("Who is X?"), give a concise factual bio first, then notable works.
- For "Who is X?" or "Tell me about X" requests, never reply with research steps like "search online/check databases". Give the direct factual answer.
- If the user asks a "do/can/could/would" question, do not answer with only yes or no unless they explicitly asked for yes/no only; explain the answer.
- If the user asks to explain further, elaborate, or give more detail, expand the previous answer with more detail instead of repeating the short version.
- For latest/news/update/current queries, provide concrete, date-aware answers:
  1) Start with "As of <Month Day, Year>" when timing matters.
  2) Give the latest verified update first.
  3) Include 1-3 source links.
  4) Prefer official/primary sources from Retrieved context (RAG) when available.
- Never answer a latest/update query with only generic advice like "check the official website" unless the user explicitly asked where to check.
- If retrieved sources are insufficient or conflicting, say that clearly and provide the best verified status with sources.

Respond conversationally and naturally.`;
}
