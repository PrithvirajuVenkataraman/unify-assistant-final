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
        const isInternalSummary = isInternalSummarizerPrompt(message, clientSystemPrompt);

        // Pass 1: model-only (no live search) for speed and cost.
        const firstPrompt = composeFinalPrompt(systemPrompt, clientRagBlock, contextBlock, message);
        const firstPass = await runModelWithFallback(firstPrompt);
        if (!firstPass.ok) {
            return res.status(200).json(firstPass.payload);
        }

        let selectedPass = firstPass;
        let liveRag = { ragText: '', sources: [] };
        const escalation = isInternalSummary
            ? { escalate: false, reason: 'internal_summarizer_prompt' }
            : getWebEscalationDecision(message, firstPass.parsedResponse?.response || '');

        // Pass 2: only do live search when the first answer is weak/stale for time-sensitive queries.
        if (escalation.escalate) {
            liveRag = await buildLiveRagContext(message, req, context);
            if (liveRag.ragText) {
                const secondPrompt = composeFinalPrompt(
                    systemPrompt,
                    [clientRagBlock, liveRag.ragText].filter(Boolean).join('\n\n'),
                    contextBlock,
                    message
                );
                const secondPass = await runModelWithFallback(secondPrompt);
                if (secondPass.ok) {
                    selectedPass = secondPass;
                }
            }
        }

        const finalParsed = enforceLiveAnswerStyle(selectedPass.parsedResponse, message, liveRag.sources);
        return res.status(200).json({
            ...finalParsed,
            modelUsed: selectedPass.modelUsed,
            provider: selectedPass.provider,
            webEscalation: {
                considered: isWebCheckCandidateQuery(message),
                escalated: escalation.escalate,
                reason: escalation.reason,
                sourceCount: Array.isArray(liveRag.sources) ? liveRag.sources.length : 0,
                requestType: isInternalSummary ? 'internal_summary' : 'user_query'
            }
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

function composeFinalPrompt(systemPrompt, ragBlock, contextBlock, message) {
    return [
        systemPrompt,
        ragBlock ? `Retrieved context (RAG):\n${ragBlock}` : '',
        contextBlock ? `Recent turns:\n${contextBlock}` : '',
        `User message: ${message}`
    ].filter(Boolean).join('\n\n');
}

async function runModelWithFallback(finalPrompt) {
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
            return {
                ok: true,
                parsedResponse: parseModelText(groqText),
                modelUsed,
                provider: 'groq'
            };
        }

        groqFailureDetail = lastErrorDetail || 'Groq did not return a successful response.';
        groqTriedModels = triedModels;
    }

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!geminiApiKey) {
        return {
            ok: false,
            payload: {
                intent: 'service_unconfigured',
                response: 'AI backend is not configured. Set GROQ_API_KEY or GEMINI_API_KEY in the server environment.',
                action: null,
                provider: 'none',
                details: groqFailureDetail || undefined,
                triedModels: groqTriedModels.length ? groqTriedModels : undefined
            }
        };
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
        return {
            ok: false,
            payload: {
                intent: 'service_unavailable',
                response: 'The AI service is temporarily unavailable right now. Please try again shortly.',
                action: null,
                triedModels,
                provider: 'gemini',
                details: [
                    groqFailureDetail ? `groq: ${groqFailureDetail}` : '',
                    lastErrorDetail ? `gemini: ${lastErrorDetail}` : 'No Gemini model responded successfully.'
                ].filter(Boolean).join(' | ')
            }
        };
    }

    const aiText = String(geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return {
        ok: true,
        parsedResponse: parseModelText(aiText),
        modelUsed,
        provider: 'gemini'
    };
}

function parseModelText(modelText) {
    const text = String(modelText || '').trim();
    if (!text) {
        return {
            intent: 'casual_chat',
            response: '',
            action: null
        };
    }
    try {
        return JSON.parse(text);
    } catch (_) {
        return {
            intent: 'casual_chat',
            response: text,
            action: null
        };
    }
}

function shouldEscalateToWeb(message, firstAnswer) {
    return getWebEscalationDecision(message, firstAnswer).escalate;
}

function isInternalSummarizerPrompt(message, clientSystemPrompt) {
    const msg = String(message || '').toLowerCase();
    const sp = String(clientSystemPrompt || '').toLowerCase();
    return (
        (msg.includes('snippets:') && msg.includes('user question:')) ||
        sp.includes('summarize only from supplied snippets') ||
        sp.includes('do not invent facts')
    );
}

function getWebEscalationDecision(message, firstAnswer) {
    const query = String(message || '').trim();
    const answer = String(firstAnswer || '').trim();
    if (!isWebCheckCandidateQuery(query)) return { escalate: false, reason: 'not_factual_or_time_sensitive' };
    if (!answer) return { escalate: true, reason: 'empty_answer' };
    if (/\b(with sources?|source links?)\b/i.test(query)) return { escalate: true, reason: 'user_requested_sources' };

    const genericAdvice = /\b(check|visit|see|refer)\b[\s\S]{0,120}\b(official website|website|site|news websites?)\b/i.test(answer) ||
        /\b(steps you can follow|you can check)\b/i.test(answer);
    if (genericAdvice) return { escalate: true, reason: 'generic_advice_answer' };

    const uncertain = /\b(i (?:don'?t|do not) have (?:live|real[- ]?time)|not sure|cannot verify|might be outdated)\b/i.test(answer);
    if (uncertain) return { escalate: true, reason: 'uncertain_or_stale_answer' };

    const asksWhenOrDate = /\b(when|date|first match|opening match|schedule|fixture)\b/i.test(query);
    if (asksWhenOrDate && !extractDateCandidate(answer)) return { escalate: true, reason: 'date_missing_in_answer' };

    const factualQuery = isFactualQuery(query);
    const evasiveFactualAnswer =
        /\b(i think|maybe|perhaps|not sure|cannot confirm|can't confirm|hard to say)\b/i.test(answer) ||
        /\b(check|visit|refer)\b[\s\S]{0,120}\b(official website|website|site|search|google)\b/i.test(answer);
    if (factualQuery && evasiveFactualAnswer) {
        return { escalate: true, reason: 'weak_factual_answer' };
    }

    return { escalate: false, reason: 'model_answer_accepted' };
}

async function buildLiveRagContext(message, req, contextTurns = []) {
    const query = String(message || '').trim();
    if (!query || !isWebCheckCandidateQuery(query)) return { ragText: '', sources: [] };

    try {
        const resolvedQuery = resolveContextualLiveQuery(query, contextTurns);
        const liveQueries = buildLiveQueries(resolvedQuery);
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

        const ranked = rankLiveSources(resolvedQuery, results).slice(0, 6);
        if (!ranked.length) return { ragText: '', sources: [] };

        const lines = [`Live web verification for: "${query}"`];
        if (resolvedQuery.toLowerCase() !== query.toLowerCase()) {
            lines.push(`Resolved query: "${resolvedQuery}"`);
        }
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
    return /\b(latest|recent|current|today|now|update|updates|news|headlines|status|mission|launch|price|rate|score|result|election|breaking|as of|ipl|match|matches|fixture|fixtures|schedule|opening match|first match)\b/.test(t);
}

function isFactualQuery(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;
    if (/\b(joke|poem|story|write|compose|roleplay|imagine)\b/.test(t)) return false;

    return /\b(who|what|when|where|which|how many|how much|date of|founded|ceo|president|prime minister|captain|winner|population|capital|currency|height|age|released|launch date)\b/.test(t) ||
        /\b(is|are|was|were)\b.+\b\?\s*$/.test(t);
}

function isWebCheckCandidateQuery(text) {
    return isTimeSensitiveInfoRequest(text) || isFactualQuery(text);
}

function enforceLiveAnswerStyle(parsedResponse, message, liveSources) {
    if (!isTimeSensitiveInfoRequest(message)) return parsedResponse;
    if (!Array.isArray(liveSources) || !liveSources.length) return parsedResponse;

    return {
        ...parsedResponse,
        intent: 'live_update',
        response: buildLiveUpdateResponse(message, liveSources),
        action: parsedResponse?.action ?? null
    };
}

function buildLiveUpdateResponse(message, liveSources) {
    const now = new Date();
    const asOf = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const rankedForLead = rankLeadSources(message, liveSources).filter(item => shouldUseAsFinalSource(message, item));
    const top = rankedForLead.slice(0, 3);
    const lead = top[0] || {};
    const title = normalizeLeadTitle(message, lead);
    const description = String(lead?.description || '').trim();
    const updateLine = normalizeUpdateLine(message, title, description, liveSources);

    const lines = [`As of ${asOf}, ${updateLine}`, '', 'Sources:'];
    for (const item of top) {
        lines.push(`- ${String(item.url || '').trim()}`);
    }
    return lines.join('\n');
}

function buildLiveQueries(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    if (/\bisro\b/.test(lower)) {
        return [
            'ISRO latest mission update press release site:isro.gov.in',
            'ISRO launch mission statement site:isro.gov.in',
            'ISRO mission update PSLV GSLV NVS site:isro.gov.in',
            `${q} Reuters OR The Hindu OR Indian Express`
        ];
    }
    if (/\bipl\b/.test(lower) || (/\b(match|schedule|fixture|opening|first)\b/.test(lower) && /\bcricket\b/.test(lower))) {
        return [
            'IPL first match date official schedule iplt20.com',
            'IPL first match teams official schedule iplt20.com',
            'IPL opening match date ESPNcricinfo Cricbuzz',
            'IPL opening match teams ESPNcricinfo Cricbuzz',
            'IPL fixtures first game date',
            q
        ];
    }
    return [q];
}

function rankLiveSources(query, results) {
    const list = Array.isArray(results) ? results : [];
    const q = String(query || '').toLowerCase();
    const queryTerms = tokenizeRelevanceTerms(q);
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
        const overlap = queryTerms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);

        let score = 0;
        if (overlap > 0) {
            score += overlap * 2;
        } else if (queryTerms.length > 0) {
            score -= 8;
        }
        if (wantsIsro) {
            if (host.endsWith('isro.gov.in')) score += 8;
            if (/\b(isro|launch|mission|satellite|pslv|gslv|nvs|aditya|chandrayaan|gaganyaan)\b/.test(hay)) score += 4;
            if (/\.pdf($|\?)/i.test(url) && !host.endsWith('isro.gov.in')) score -= 6;
            if (/\b(aps|unoosa|respond basket)\b/.test(hay)) score -= 7;
            if (/^isro$/i.test(title.trim())) score -= 6;
            if (/\/?$/.test(safePathname(url)) && host.endsWith('isro.gov.in')) score -= 5;
            if (host === 'x.com' || host === 'twitter.com') score -= 4;
            if (/latest_updates\.html/i.test(url)) score -= 1;
            if (/\b(update|updates|mission|launch|press release|statement)\b/.test(hay)) score += 3;
            if (isGenericIsroTitle(title)) score -= 6;
            if (isGoogleNewsRedirect(url)) score -= 7;
            if (!/\b(mission|launch|satellite|pslv|gslv|nvs|aditya|chandrayaan|gaganyaan)\b/.test(hay)) score -= 2;
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

        scored.push({ ...item, __score: score, __termOverlap: overlap });
    }

    scored.sort((a, b) => (b.__score || 0) - (a.__score || 0));
    const relevant = scored.filter(item => (item.__termOverlap || 0) > 0 && (item.__score || 0) >= 0);
    if (relevant.length >= 2) return relevant;
    return scored.filter(item => (item.__score || 0) >= 0);
}

function rankLeadSources(query, sources) {
    const wantsIsro = /\bisro\b/i.test(String(query || ''));
    const queryTerms = tokenizeRelevanceTerms(query);
    const list = Array.isArray(sources) ? sources.slice() : [];
    const withScore = list.map(item => {
        const title = String(item?.title || '');
        const desc = String(item?.description || '');
        const url = String(item?.url || '');
        const host = getHost(url);
        const hay = `${title} ${desc}`.toLowerCase();
        const overlap = queryTerms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
        let score = 0;
        if (overlap > 0) {
            score += overlap * 2;
        } else if (queryTerms.length > 0) {
            score -= 6;
        }
        if (wantsIsro) {
            if (host.endsWith('isro.gov.in')) score += 4;
            if (/\b(update|updates|mission|launch|statement|press|satellite|pslv|gslv|nvs|aditya|chandrayaan|gaganyaan)\b/.test(hay)) score += 5;
            if (/^isro$/i.test(title.trim())) score -= 6;
            if ((host === 'x.com' || host === 'twitter.com')) score -= 5;
            if (/latest_updates\.html/i.test(url)) score -= 1;
            if (/\/?$/.test(safePathname(url)) && host.endsWith('isro.gov.in')) score -= 4;
            if (isGenericIsroTitle(title)) score -= 7;
            if (isGoogleNewsRedirect(url)) score -= 7;
            if (!/\b(mission|launch|satellite|pslv|gslv|nvs|aditya|chandrayaan|gaganyaan)\b/.test(hay)) score -= 2;
        }
        return { ...item, __leadScore: score };
    });
    withScore.sort((a, b) => (b.__leadScore || 0) - (a.__leadScore || 0));
    return withScore;
}

function resolveContextualLiveQuery(query, contextTurns) {
    const current = String(query || '').trim();
    if (!current) return '';
    const context = Array.isArray(contextTurns) ? contextTurns : [];
    const anchor = buildTopicAnchor(context);
    if (!anchor) return current;

    const currentTerms = tokenizeTopicTerms(current);
    const anchorTerms = tokenizeTopicTerms(anchor);
    const overlap = countTokenOverlap(currentTerms, anchorTerms);
    const underspecified = isUnderspecifiedFollowup(current, currentTerms);

    if (overlap > 0) return current;
    if (isTopicDiversion(current, currentTerms, anchorTerms)) return current;
    if (!underspecified) return current;

    return `${current} ${anchor}`.replace(/\s+/g, ' ').trim();
}

function tokenizeRelevanceTerms(text) {
    const stop = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than',
        'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'who', 'what', 'when', 'where', 'why', 'how',
        'in', 'on', 'for', 'to', 'of', 'with', 'by', 'from',
        'me', 'you', 'your', 'my', 'our', 'their',
        'latest', 'current', 'today', 'update', 'updates'
    ]);

    return Array.from(new Set(
        String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(token => token && token.length > 1 && !stop.has(token))
            .slice(0, 16)
    ));
}

function buildTopicAnchor(contextTurns) {
    const userTurns = (Array.isArray(contextTurns) ? contextTurns : [])
        .filter(turn => String(turn?.role || '').toLowerCase() === 'user')
        .slice(-8)
        .map(turn => String(turn?.text || '').trim())
        .filter(Boolean);

    for (let i = userTurns.length - 1; i >= 0; i--) {
        const candidate = userTurns[i];
        const terms = tokenizeTopicTerms(candidate);
        if (terms.length < 2) continue;
        if (isUnderspecifiedFollowup(candidate, terms)) continue;
        return terms.slice(0, 8).join(' ');
    }
    return '';
}

function tokenizeTopicTerms(text) {
    const stop = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than',
        'do', 'does', 'did', 'can', 'could', 'would', 'will', 'should',
        'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
        'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours',
        'we', 'our', 'ours', 'they', 'their', 'theirs', 'he', 'she', 'it',
        'this', 'that', 'these', 'those', 'there', 'here',
        'please', 'kindly', 'just', 'about', 'on', 'for', 'to', 'of', 'in',
        'at', 'by', 'with', 'from', 'into', 'as', 'per',
        'tell', 'show', 'give', 'find', 'search', 'look', 'lookup', 'check',
        'explain', 'describe', 'summarize', 'summary',
        'latest', 'recent', 'current', 'today', 'right', 'now', 'update', 'updates',
        'sources', 'source', 'link', 'links', 'news', 'headline', 'headlines'
    ]);

    return Array.from(new Set(
        String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(token => token && token.length > 1 && !stop.has(token))
            .slice(0, 16)
    ));
}

function countTokenOverlap(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
    const bSet = new Set(b);
    let count = 0;
    for (const token of a) {
        if (bSet.has(token)) count++;
    }
    return count;
}

function isUnderspecifiedFollowup(query, pretokenizedTerms) {
    const q = String(query || '').trim().toLowerCase();
    const terms = Array.isArray(pretokenizedTerms) ? pretokenizedTerms : tokenizeTopicTerms(q);
    if (!q) return false;

    const referential = /\b(it|its|they|them|that|this|these|those|there|same|above|earlier|previous|first match|opening match|that match|that game|who are playing|who is playing)\b/.test(q);
    const questionLead = /^(who|what|when|where|which|how)\b/.test(q);
    const veryShort = terms.length > 0 && terms.length <= 3;
    const asksFactWithoutEntity = questionLead && terms.length <= 4;

    return referential || veryShort || asksFactWithoutEntity;
}

function isTopicDiversion(query, currentTerms, anchorTerms) {
    const q = String(query || '').toLowerCase();
    const overlap = countTokenOverlap(currentTerms, anchorTerms);
    if (overlap > 0) return false;

    const hasNamedLikeSignal = (Array.isArray(currentTerms) ? currentTerms : []).length >= 4;
    const explicitSwitch = /\b(now|instead|different topic|another topic|new topic|change topic|switch topic)\b/.test(q);
    const containsDistinctEntityHint = /\b(who is|what is|tell me about)\s+[a-z0-9][a-z0-9\s-]{2,}/.test(q);

    return explicitSwitch || (hasNamedLikeSignal && containsDistinctEntityHint);
}

function safePathname(url) {
    try {
        return new URL(String(url || '')).pathname || '/';
    } catch (_) {
        return '/';
    }
}

function getHost(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

function isGoogleNewsRedirect(url) {
    const host = getHost(url);
    return host === 'news.google.com' && /\/rss\/articles\//i.test(String(url || ''));
}

function isGenericIsroTitle(title) {
    const t = String(title || '').trim().toLowerCase();
    return t === 'isro' || t === 'updates - isro' || t === 'latest updates - isro';
}

function shouldUseAsFinalSource(message, item) {
    const isroMissionQuery = /\bisro\b/i.test(String(message || '')) && /\b(mission|launch|update|latest)\b/i.test(String(message || ''));
    const title = String(item?.title || '');
    const desc = String(item?.description || '');
    const hay = `${title} ${desc}`.toLowerCase();
    const url = String(item?.url || '');
    if (isGoogleNewsRedirect(url)) return false;
    if (!isroMissionQuery) return true;
    if (isGenericIsroTitle(title)) return false;
    return /\b(mission|launch|satellite|pslv|gslv|nvs|aditya|chandrayaan|gaganyaan|statement|press)\b/.test(hay);
}

function normalizeLeadTitle(message, lead) {
    const raw = String(lead?.title || '').trim();
    if (!raw) return 'Latest mission update is currently being tracked from official sources';
    if (/\bisro\b/i.test(String(message || '')) && isGenericIsroTitle(raw)) {
        return 'ISRO published fresh mission-related updates on its official channels';
    }
    return raw;
}

function normalizeUpdateLine(message, title, description, sources) {
    const msg = String(message || '').toLowerCase();
    const cleanTitle = String(title || '').replace(/[.\s]+$/g, '').trim();
    const descFirst = String(description || '').split(/[.!?]\s/)[0].trim();
    const combined = `${cleanTitle} ${descFirst}`.trim();
    const date = extractDateCandidate(combined) || findDateAcrossSources(sources);

    if (/^\s*when\b/.test(msg) && date) {
        return `the reported date is ${date} (${cleanTitle}).`;
    }
    if (/^\s*when\b/.test(msg) && !date) {
        return `I could not confirm an exact date from the top live snippets.`;
    }
    if (descFirst && descFirst.length >= 25 && !/^https?:\/\//i.test(descFirst)) {
        return `${cleanTitle}. ${descFirst}.`;
    }
    return `the latest update is: ${cleanTitle}.`;
}

function extractDateCandidate(text) {
    const t = String(text || '');
    if (!t) return '';

    const patterns = [
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
        /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,
        /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{4}\b/i,
        /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i
    ];

    for (const p of patterns) {
        const m = t.match(p);
        if (m?.[0]) return m[0];
    }
    return '';
}

function findDateAcrossSources(sources) {
    const list = Array.isArray(sources) ? sources : [];
    for (const item of list.slice(0, 6)) {
        const t = `${String(item?.title || '')} ${String(item?.description || '')}`;
        const date = extractDateCandidate(t);
        if (date) return date;
    }
    return '';
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
