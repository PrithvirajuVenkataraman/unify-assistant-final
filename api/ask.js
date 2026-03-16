import { searchWeb } from './live-search.js';
import {
    buildSearchQueries,
    isCurrentRoleLookup,
    isTimeSensitiveQuery
} from './search.js';

const DEFAULT_MAX_RESULTS = 6;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 8;
const MAX_CONTEXT_TURNS = 12;
const MAX_SOURCE_SNIPPET_LENGTH = 300;
const MAX_RAG_SOURCES = 6;
const SEARCH_TRIGGER_PATTERN = /\b(latest|recent|current|today|tonight|this week|right now|news|headline|update|updates|best|top|compare|comparison|review|reviews|price|pricing|cost|rate|rates|score|scores|standings|ranking|rankings|result|results|winner|won|weather|forecast|traffic|train|flight|flights|where should i|what should i buy|recommend|recommendation|recommendations|ceo|cfo|cto|coo|chairman|chairperson|founder|owner|president|managing director|executive team|leadership)\b/i;
const MEDICAL_TRIGGER_PATTERN = /\b(fever|cough|cold|flu|pain|ache|headache|migraine|nausea|vomiting|diarrhea|constipation|rash|itching|fatigue|weakness|dizziness|vertigo|shortness of breath|breathlessness|wheezing|sore throat|chest pain|abdominal pain|stomach pain|back pain|joint pain|swelling|inflammation|bleeding|infection|burning|chills|sweating|palpitations|tachycardia|hypertension|hypotension|blood pressure|oxygen|spo2|congestion|runny nose|sneezing|ear pain|sinus|loss of smell|loss of taste|dehydration|seizure|fainting|syncope|numbness|tingling|blurred vision|anxiety|insomnia|depression)\b/gi;
const MEDICAL_CONTEXT_PATTERN = /\b(patient|pt\.?|doctor|diagnosis|diagnose|differential|symptom|symptoms|complains of|complaining of|presents with|presenting with|history of|hx of|reports|reporting|suffers from|clinical|condition|disease)\b/i;

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
            maxResults = DEFAULT_MAX_RESULTS,
            systemPrompt,
            mode,
            medical = false
        } = req.body || {};

        const userMessage = normalizeText(message);
        const normalizedMaxResults = clampInteger(maxResults, DEFAULT_MAX_RESULTS, MIN_MAX_RESULTS, MAX_MAX_RESULTS);

        if (!userMessage) {
            return res.status(400).json({ error: 'message is required' });
        }

        const medicalMode = shouldUseMedicalMode({
            body: req.body,
            userMessage,
            explicitMode: mode,
            medical
        });

        if (medicalMode) {
            console.log('MEDICAL MODE ACTIVATED');

            const medicalResult = await callChatModel({
                message: userMessage,
                userName,
                context,
                ragContext: '',
                systemPrompt: systemPrompt || buildMedicalSystemPrompt()
            });

            return res.status(200).json({
                success: true,
                intent: medicalResult.intent || 'medical_analysis',
                response: medicalResult.response || medicalResult.advice || '',
                action: medicalResult.action || null,
                symptoms: Array.isArray(medicalResult.symptoms) ? medicalResult.symptoms : [],
                conditions: Array.isArray(medicalResult.conditions) ? medicalResult.conditions : [],
                red_flags: Array.isArray(medicalResult.red_flags) ? medicalResult.red_flags : [],
                advice: normalizeText(medicalResult.advice),
                disclaimer: normalizeText(medicalResult.disclaimer) || defaultMedicalDisclaimer(),
                provider: medicalResult.provider || 'none',
                modelUsed: medicalResult.modelUsed || null,
                search: buildDefaultSearchMeta(false),
                sources: []
            });
        }

        const strictCurrentRoleLookup = isCurrentRoleLookup(userMessage);
        const shouldSearch = Boolean(forceSearch) || strictCurrentRoleLookup || needsLiveSearch(userMessage);

        let sources = [];
        let ragContext = '';
        let searchMeta = buildDefaultSearchMeta(strictCurrentRoleLookup);

        console.log('ASK QUESTION:', userMessage);
        console.log('ASK FORCE CURRENT ROLE LOOKUP:', strictCurrentRoleLookup);
        console.log('ASK SHOULD SEARCH:', shouldSearch);

        if (shouldSearch) {
            const liveQueries = buildSearchQueries(userMessage);
            console.log('ASK LIVE QUERY VARIANTS:', liveQueries);

            const earlySearch = await runSmartSearch({
                liveQueries,
                userMessage,
                normalizedMaxResults,
                strictCurrentRoleLookup
            });

            sources = normalizeSources(earlySearch.results).slice(0, normalizedMaxResults);
            ragContext = buildRagContext(sources, userMessage, { strictCurrentRoleLookup });

            console.log('ASK FINAL SOURCES COUNT:', sources.length);
            console.log('ASK DISTINCT DOMAINS:', countDistinctDomains(sources));
            console.log('ASK RAG CONTEXT LENGTH:', ragContext.length);

            searchMeta = {
                used: true,
                provider: sources.length ? 'aggregated-search' : 'none',
                queryVariants: Array.isArray(liveQueries) ? liveQueries : [],
                distinctDomainCount: countDistinctDomains(sources),
                trustedCount: countTrustedSources(sources),
                forcedCurrentRoleLookup: strictCurrentRoleLookup,
                earlyStopped: earlySearch.earlyStopped,
                winningQuery: earlySearch.winningQuery || null
            };
        }

        console.log('CALLING CHAT MODEL NOW');

        const llmResult = await callChatModel({
            message: userMessage,
            userName,
            context,
            ragContext,
            systemPrompt: systemPrompt || buildAskSystemPrompt()
        });

        console.log('MODEL PROVIDER:', llmResult.provider || 'none');
        console.log('MODEL USED:', llmResult.modelUsed || 'none');
        console.log('MODEL RESPONSE LENGTH:', String(llmResult.response || '').length);

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
        console.error('ASK ROUTE ERROR:', error);

        return res.status(200).json({
            success: false,
            intent: 'service_error',
            response: 'Something went wrong while preparing the answer.',
            action: null,
            details: String(error?.message || error),
            provider: 'none',
            sources: [],
            search: buildDefaultSearchMeta(false)
        });
    }
}

function isMedicalMode(body) {
    return body?.mode === 'medical' || body?.medical === true;
}

function shouldUseMedicalMode({ body, userMessage, explicitMode, medical }) {
    if (isMedicalMode(body) || explicitMode === 'medical' || medical === true) {
        return true;
    }

    return looksLikeMedicalSymptomInput(userMessage);
}

function looksLikeMedicalSymptomInput(text) {
    const value = normalizeText(text);
    if (!value) return false;

    const lowered = value.toLowerCase();
    const matches = lowered.match(MEDICAL_TRIGGER_PATTERN) || [];
    const hasMedicalContext = MEDICAL_CONTEXT_PATTERN.test(lowered);
    const startsLikeCase = /^(patient|pt\.?|doctor|male|female|child|adult|elderly|reports|complains of|presents with)/i.test(value);
    const hasDuration = /\b\d+\s*(day|days|week|weeks|month|months|hour|hours)\b/i.test(value);

    if (matches.length >= 2 && (hasMedicalContext || hasDuration || startsLikeCase)) {
        return true;
    }

    if (hasMedicalContext && matches.length >= 1) {
        return true;
    }

    return false;
}

function needsLiveSearch(text) {
    const value = normalizeText(text).toLowerCase();
    if (!value) return false;
    if (isCurrentRoleLookup(value)) return true;
    if (isTimeSensitiveQuery(value)) return true;
    return SEARCH_TRIGGER_PATTERN.test(value);
}

function buildDefaultSearchMeta(strictCurrentRoleLookup) {
    return {
        used: false,
        provider: 'none',
        queryVariants: [],
        distinctDomainCount: 0,
        trustedCount: 0,
        forcedCurrentRoleLookup: Boolean(strictCurrentRoleLookup),
        earlyStopped: false,
        winningQuery: null
    };
}

async function runSmartSearch({ liveQueries, userMessage, normalizedMaxResults, strictCurrentRoleLookup }) {
    const queries = Array.isArray(liveQueries) ? liveQueries.filter(Boolean).slice(0, 3) : [];
    const fallbackQuery = normalizeText(userMessage);

    const collected = [];
    const seen = new Set();

    let earlyStopped = false;
    let winningQuery = null;

    for (const query of queries) {
        console.log('API PATH USED: /api/search query:', query);

        let results = [];
        try {
            results = await searchWeb(query, Math.min(normalizedMaxResults, 4));
        } catch (error) {
            console.error('SEARCH ERROR FOR QUERY:', query, error?.message || error);
            results = [];
        }

        console.log('SEARCH RESULTS COUNT FOR QUERY:', query, Array.isArray(results) ? results.length : 0);

        const normalized = normalizeSources(results);
        mergeUniqueSources(collected, normalized, seen);

        const strong = findStrongSource(normalized, { strictCurrentRoleLookup });
        if (strong) {
            earlyStopped = true;
            winningQuery = query;
            console.log('EARLY STOP TRIGGERED BY:', query);
            console.log('STRONG SOURCE URL:', strong.url);
            break;
        }
    }

    if (!collected.length && fallbackQuery) {
        console.log('RUNNING FALLBACK SEARCH FOR USER MESSAGE');
        const fallbackResults = await searchWeb(fallbackQuery, normalizedMaxResults).catch((error) => {
            console.error('FALLBACK SEARCH ERROR:', error?.message || error);
            return [];
        });

        const normalizedFallback = normalizeSources(fallbackResults);
        mergeUniqueSources(collected, normalizedFallback, seen);
        console.log('FALLBACK SEARCH RESULTS COUNT:', normalizedFallback.length);
    }

    return {
        results: collected.slice(0, normalizedMaxResults),
        earlyStopped,
        winningQuery
    };
}

function findStrongSource(sources, options = {}) {
    const strictCurrentRoleLookup = Boolean(options.strictCurrentRoleLookup);

    return (Array.isArray(sources) ? sources : []).find((source) => {
        const url = String(source?.url || '').toLowerCase();
        const title = String(source?.title || '').toLowerCase();

        if (!url) return false;

        if (strictCurrentRoleLookup) {
            return /reuters\.com|bloomberg\.com|sec\.gov/.test(url) ||
                /investor|leadership|management|executive|board|about/.test(url) ||
                /leadership|management|executive team|board of directors|investor relations/.test(title);
        }

        return /reuters\.com|apnews\.com|bbc\.com|bloomberg\.com/.test(url);
    }) || null;
}

function mergeUniqueSources(target, items, seen) {
    for (const item of Array.isArray(items) ? items : []) {
        const key = canonicalizeUrl(item?.url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        target.push(item);
    }
}

function normalizeText(value) {
    return String(value || '').trim();
}

function clampInteger(value, fallback, min, max) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(numeric, min), max);
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
            url: normalizeText(item?.url || item?.link),
            description: stripHtml(item?.description || item?.snippet || '').slice(0, MAX_SOURCE_SNIPPET_LENGTH)
        }))
        .filter((item) => item.url)
        .filter(dedupeSourceByUrl());
}

function dedupeSourceByUrl() {
    const seen = new Set();

    return (item) => {
        const key = canonicalizeUrl(item?.url);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    };
}

function canonicalizeUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        parsed.hash = '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function buildRagContext(sources, originalQuestion, options = {}) {
    if (!Array.isArray(sources) || !sources.length) return '';

    const lines = [
        `Question: ${originalQuestion}`,
        '',
        'Use the following web results as evidence.',
        'Prefer higher quality sources when multiple results overlap.',
        'If the evidence is weak or mixed, say so clearly.'
    ];

    if (options.strictCurrentRoleLookup) {
        lines.push('This is a strict current leadership lookup. Prefer official leadership, investor relations, annual report, or regulatory filing evidence before general summaries.');
        lines.push('If the sources clearly identify the role holder, answer directly and do not add generic uncertainty.');
    }

    lines.push('');

    sources.slice(0, MAX_RAG_SOURCES).forEach((source, index) => {
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

    for (const source of Array.isArray(sources) ? sources : []) {
        try {
            const hostname = new URL(source.url).hostname.replace(/^www\./, '');
            if (hostname) domains.add(hostname);
        } catch (_) {
            // ignore malformed urls
        }
    }

    return domains.size;
}

function countTrustedSources(sources) {
    return (Array.isArray(sources) ? sources : []).filter((source) => {
        const url = String(source?.url || '').toLowerCase();
        return /reuters\.com|bloomberg\.com|apnews\.com|bbc\.com|sec\.gov/.test(url) ||
            /investor|leadership|management|about/.test(url);
    }).length;
}

function buildAskSystemPrompt() {
    return `You are Unify, a helpful AI assistant.

When web context is provided:
- Answer using the retrieved context first.
- Do not invent facts beyond the provided evidence.
- If sources disagree or look weak, say that clearly.
- For current company leadership questions, prefer official company leadership, investor relations, annual report, or regulatory filing evidence first, then major business outlets.
- Do not add fallback uncertainty like "I couldn't find recent information" when the sources clearly identify the role holder.
- Keep the answer direct and useful.
- When referring to sources, use the titles or domains from the provided sources list.
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

function buildMedicalSystemPrompt() {
    return `You are Unify, a careful clinical symptom analysis assistant.

The input may be a doctor's short note, a plain sentence of symptoms, or a symptom description.

Your job:
- Extract concise symptom chunks from the input.
- Identify 1 to 4 possible conditions, not a final diagnosis.
- Provide a confidence score from 0 to 1 for each possible condition.
- Identify urgent red flags if present.
- Provide short, careful care advice.
- Always include a disclaimer.
- Never claim certainty.
- Never say this is a confirmed diagnosis.

Return JSON only in this exact format:
{
  "intent": "medical_analysis",
  "response": "A short summary of the likely possibilities.",
  "action": null,
  "symptoms": ["symptom 1", "symptom 2"],
  "conditions": [
    { "name": "Possible condition name", "confidence": 0.74 }
  ],
  "red_flags": ["red flag 1"],
  "advice": "Short practical advice.",
  "disclaimer": "${defaultMedicalDisclaimer()}"
}`;
}

function defaultMedicalDisclaimer() {
    return 'This AI output is for reference only and may be incorrect or incomplete. It is not a medical diagnosis and should not replace professional medical judgment. Please consult a qualified healthcare professional.';
}

async function callChatModel({ message, userName, context, ragContext, systemPrompt }) {
    const finalPrompt = buildFinalPrompt({
        systemPrompt,
        ragContext,
        context,
        message,
        userName
    });

    const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (groqApiKey) {
        const groqConfiguredModel = normalizeText(process.env.GROQ_MODEL);
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
                text = normalizeText(data?.choices?.[0]?.message?.content);
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

    const geminiConfiguredModel = normalizeText(process.env.GEMINI_MODEL);
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
            aiText = normalizeText(
                data?.candidates?.[0]?.content?.parts?.[0]?.text ||
                data?.candidates?.[0]?.content?.text ||
                ''
            );
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

function buildFinalPrompt({ systemPrompt, ragContext, context, message, userName }) {
    const contextBlock = Array.isArray(context)
        ? context
            .slice(-MAX_CONTEXT_TURNS)
            .map((item) => `${item?.role === 'user' ? 'User' : 'Assistant'}: ${normalizeText(item?.text)}`)
            .filter(Boolean)
            .join('\n')
        : '';

    const userLabel = normalizeText(userName) ? `User name: ${normalizeText(userName)}` : '';

    return [
        systemPrompt,
        userLabel,
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
            response: normalizeText(parsed?.response),
            action: parsed?.action || null,
            symptoms: normalizeStringArray(parsed?.symptoms),
            conditions: normalizeConditions(parsed?.conditions),
            red_flags: normalizeStringArray(parsed?.red_flags),
            advice: normalizeText(parsed?.advice),
            disclaimer: normalizeText(parsed?.disclaimer)
        };
    } catch (_) {
        return {
            intent: 'casual_chat',
            response: normalizeText(text),
            action: null,
            symptoms: [],
            conditions: [],
            red_flags: [],
            advice: '',
            disclaimer: ''
        };
    }
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];

    return value
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .slice(0, 10);
}

function normalizeConditions(value) {
    if (!Array.isArray(value)) return [];

    return value
        .map((item) => ({
            name: normalizeText(item?.name),
            confidence: normalizeConfidence(item?.confidence)
        }))
        .filter((item) => item.name)
        .slice(0, 6);
}

function normalizeConfidence(value) {
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric < 0) return 0;
    if (numeric > 1) return 1;
    return Number(numeric.toFixed(2));
}
