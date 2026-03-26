import crypto from 'crypto';
import { applyApiSecurity } from './security.js';
import { extractSearchTopic, runVerifiedWebSearch } from './live-search.js';

export const config = {
    maxDuration: 60,
    api: { bodyParser: { sizeLimit: '2mb' } }
};

const DEFAULT_EMBED_MODEL = String(
    process.env.GEMINI_EMBED_MODEL ||
    process.env.GOOGLE_EMBED_MODEL ||
    'text-embedding-004'
).trim();
const DEFAULT_TOP_K = 6;

function assertEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getGoogleApiKey() {
    const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!key) {
        throw new Error('Missing required environment variable: GEMINI_API_KEY or GOOGLE_API_KEY');
    }
    return key;
}

function toSafeNamespace(input) {
    const ns = String(input || process.env.PINECONE_NAMESPACE || 'default')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64);
    return ns || 'default';
}

function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeWhitespace(text) {
    return String(text || '')
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function chunkTextForRag(text, options = {}) {
    const clean = normalizeWhitespace(text);
    if (!clean) return [];

    const chunkSize = clamp(toPositiveInt(options.chunkSize, 1400), 300, 4000);
    const chunkOverlap = clamp(toPositiveInt(options.chunkOverlap, 220), 0, Math.floor(chunkSize * 0.6));

    const chunks = [];
    let start = 0;

    while (start < clean.length) {
        let end = Math.min(clean.length, start + chunkSize);

        if (end < clean.length) {
            const windowStart = Math.max(start + Math.floor(chunkSize * 0.55), start);
            const slice = clean.slice(windowStart, end);
            const breakMatch = slice.match(/(?:\n\n|\n|\.\s|\?\s|!\s)(?![\s\S]*(?:\n\n|\n|\.\s|\?\s|!\s))/);
            if (breakMatch?.index != null) {
                end = windowStart + breakMatch.index + breakMatch[0].length;
            }
        }

        const chunk = clean.slice(start, end).trim();
        if (chunk) chunks.push(chunk);

        if (end >= clean.length) break;
        start = Math.max(0, end - chunkOverlap);
    }

    return chunks;
}

function sanitizeMetadataValue(value) {
    if (value == null) return undefined;
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    return String(value).slice(0, 400);
}

function sanitizeMetadata(metadata = {}) {
    const out = {};
    for (const [k, v] of Object.entries(metadata || {})) {
        if (!k) continue;
        const key = String(k).replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 64);
        const val = sanitizeMetadataValue(v);
        if (val === undefined) continue;
        out[key] = val;
    }
    return out;
}

function buildDocumentId(seed = '') {
    if (seed && /^[a-zA-Z0-9:_-]{1,120}$/.test(seed)) return seed;
    return `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function getEmbedModelCandidates() {
    return Array.from(new Set([
        DEFAULT_EMBED_MODEL,
        'text-embedding-004',
        'gemini-embedding-001'
    ].filter(Boolean)));
}

function toGoogleTaskType(input) {
    const raw = String(input || '').toUpperCase().trim();
    if (raw === 'RETRIEVAL_QUERY') return 'RETRIEVAL_QUERY';
    return 'RETRIEVAL_DOCUMENT';
}

async function googleEmbeddings(inputs, options = {}) {
    const apiKey = getGoogleApiKey();
    const taskType = toGoogleTaskType(options.taskType);
    const candidates = getEmbedModelCandidates();
    let lastError = 'google_embeddings_failed';

    for (const model of candidates) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents?key=${apiKey}`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: inputs.map((text) => ({
                    model: `models/${model}`,
                    taskType,
                    content: { parts: [{ text: String(text || '') }] }
                }))
            })
        });

        const raw = await response.text();
        if (!response.ok) {
            lastError = `google_embeddings_failed model=${model} status=${response.status} body=${raw.slice(0, 220)}`;
            continue;
        }

        const data = raw ? JSON.parse(raw) : {};
        const vectors = Array.isArray(data?.embeddings)
            ? data.embeddings.map((item) => Array.isArray(item?.values) ? item.values : null).filter(Boolean)
            : [];

        if (vectors.length === inputs.length) {
            return vectors;
        }
        lastError = `google_embeddings_empty_or_mismatch model=${model}`;
    }

    throw new Error(lastError);
}

async function pineconeRequest(path, body) {
    const apiKey = assertEnv('PINECONE_API_KEY');
    const host = assertEnv('PINECONE_INDEX_HOST').replace(/^https?:\/\//i, '');

    const response = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: {
            'Api-Key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body || {})
    });

    const raw = await response.text();
    if (!response.ok) {
        throw new Error(`pinecone_request_failed path=${path} status=${response.status} body=${raw.slice(0, 220)}`);
    }

    return raw ? JSON.parse(raw) : {};
}

async function upsertDocumentToPinecone(payload = {}) {
    const text = normalizeWhitespace(payload.text);
    if (!text) throw new Error('text_required_for_upsert');

    const namespace = toSafeNamespace(payload.namespace);
    const documentId = buildDocumentId(payload.documentId);
    const chunks = chunkTextForRag(text, {
        chunkSize: payload.chunkSize,
        chunkOverlap: payload.chunkOverlap
    });

    if (!chunks.length) throw new Error('no_chunks_generated');

    const batchSize = clamp(toPositiveInt(payload.embedBatchSize, 20), 1, 100);
    const sharedMetadata = sanitizeMetadata(payload.metadata);
    const records = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
        const part = chunks.slice(i, i + batchSize);
        const vectors = await googleEmbeddings(part, { taskType: 'RETRIEVAL_DOCUMENT' });

        for (let j = 0; j < part.length; j++) {
            const chunkIndex = i + j;
            records.push({
                id: `${documentId}#${chunkIndex}`,
                values: vectors[j],
                metadata: {
                    ...sharedMetadata,
                    documentId,
                    chunkIndex,
                    text: part[j]
                }
            });
        }
    }

    const upsertRes = await pineconeRequest('/vectors/upsert', {
        namespace,
        vectors: records
    });

    return {
        namespace,
        documentId,
        chunkCount: chunks.length,
        upsertedCount: Number(upsertRes?.upsertedCount || records.length)
    };
}

async function queryPineconeMatches(payload = {}) {
    const query = normalizeWhitespace(payload.query);
    if (!query) return [];

    const namespace = toSafeNamespace(payload.namespace);
    const topK = clamp(toPositiveInt(payload.topK, DEFAULT_TOP_K), 1, 40);
    const [queryVector] = await googleEmbeddings([query], { taskType: 'RETRIEVAL_QUERY' });

    const body = {
        namespace,
        vector: queryVector,
        topK,
        includeMetadata: true,
        includeValues: false
    };

    if (payload.filter && typeof payload.filter === 'object') {
        body.filter = payload.filter;
    }

    const data = await pineconeRequest('/query', body);
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    return matches.map((m) => ({
        id: String(m?.id || ''),
        score: Number(m?.score || 0),
        metadata: m?.metadata && typeof m.metadata === 'object' ? m.metadata : {},
        text: String(m?.metadata?.text || '').trim(),
        sourceType: 'vector'
    })).filter(m => m.id && m.text);
}

function getRagQueryTerms(query) {
    const stop = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than',
        'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'what', 'which', 'who', 'when', 'where', 'why', 'how',
        'to', 'of', 'in', 'on', 'for', 'with', 'from', 'by', 'as',
        'tell', 'show', 'give', 'find', 'search', 'lookup', 'about',
        'please', 'latest', 'recent', 'current', 'today'
    ]);

    return Array.from(new Set(
        String(query || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t && t.length > 1 && !stop.has(t))
            .slice(0, 16)
    ));
}

function buildSearchQueriesForRag(query) {
    const clean = normalizeWhitespace(query);
    if (!clean) return [];
    const topic = extractSearchTopic(clean) || clean;
    const out = [topic];
    if (/\b(latest|recent|current|today|now|update|news|score|price)\b/i.test(clean)) {
        out.push(`latest ${topic}`);
        out.push(`${topic} Reuters OR AP OR BBC`);
    }
    return Array.from(new Set(out.filter(Boolean)));
}

function sanitizeWebUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function decodeBasicHtml(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function stripHtmlToText(html) {
    return decodeBasicHtml(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim());
}

function extractTitleFromHtml(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return decodeBasicHtml(match?.[1] || '').replace(/\s+/g, ' ').trim();
}

function parseDateCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts) || ts <= 0) return 0;
    return ts;
}

function extractPublishedAtFromHtml(html, text = '') {
    const doc = String(html || '');
    const candidates = [];
    const metaPatterns = [
        /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
        /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']pubdate["'][^>]*>/i,
        /<meta[^>]+name=["']publishdate["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']publishdate["'][^>]*>/i,
        /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']date["'][^>]*>/i
    ];

    for (const p of metaPatterns) {
        const m = doc.match(p);
        if (m?.[1]) candidates.push(m[1]);
    }

    const timeTag = doc.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
    if (timeTag?.[1]) candidates.push(timeTag[1]);

    const textDate = String(text || '').match(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i
    );
    if (textDate?.[0]) candidates.push(textDate[0]);

    for (const c of candidates) {
        const ts = parseDateCandidate(c);
        if (ts > 0) return ts;
    }
    return 0;
}

function isTimeSensitiveRagQuery(query) {
    return /\b(latest|recent|current|today|now|right now|update|news|headline|breaking|score|result|price|rate|status|as of)\b/i
        .test(String(query || ''));
}

function freshnessScore(publishedAtMs, query) {
    const ts = Number(publishedAtMs) || 0;
    const timeSensitive = isTimeSensitiveRagQuery(query);
    if (!ts) return timeSensitive ? -0.2 : 0;

    const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(ageDays)) return 0;
    if (ageDays <= 2) return timeSensitive ? 1.0 : 0.2;
    if (ageDays <= 7) return timeSensitive ? 0.8 : 0.18;
    if (ageDays <= 30) return timeSensitive ? 0.45 : 0.12;
    if (ageDays <= 180) return timeSensitive ? 0.2 : 0.08;
    if (ageDays <= 365) return timeSensitive ? -0.05 : 0.02;
    if (ageDays <= 3 * 365) return timeSensitive ? -0.25 : -0.03;
    return timeSensitive ? -0.45 : -0.06;
}

async function fetchAndExtractWebDocument(url, timeoutMs = 6000) {
    const safeUrl = sanitizeWebUrl(url);
    if (!safeUrl) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(safeUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'UnifyAssistantRAG/1.0',
                'Accept': 'text/html,application/xhtml+xml'
            },
            signal: controller.signal
        });
        if (!response.ok) return null;
        const ctype = String(response.headers.get('content-type') || '').toLowerCase();
        if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml')) return null;

        const html = await response.text();
        const text = normalizeWhitespace(stripHtmlToText(html)).slice(0, 14000);
        if (!text || text.length < 200) return null;
        const publishedAtMs = extractPublishedAtFromHtml(html, text);

        return {
            url: safeUrl,
            title: extractTitleFromHtml(html),
            text,
            publishedAt: publishedAtMs > 0 ? new Date(publishedAtMs).toISOString() : '',
            publishedAtMs
        };
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchSearchResultsForRag(query, options = {}) {
    const maxResults = clamp(toPositiveInt(options.maxResults, 6), 1, 10);
    const baseUrl = String(options.baseUrl || '').trim();

    if (baseUrl) {
        try {
            const response = await fetch(`${baseUrl}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, maxResults })
            });
            if (response.ok) {
                const data = await response.json();
                const items = Array.isArray(data?.results) ? data.results : [];
                return items.map(item => ({
                    title: String(item?.title || '').trim(),
                    url: sanitizeWebUrl(item?.url || ''),
                    description: String(item?.description || '').trim()
                })).filter(item => item.url);
            }
        } catch (_) {
            // Fall through to direct live search.
        }
    }

    try {
        const queries = buildSearchQueriesForRag(query);
        const verified = await runVerifiedWebSearch(queries, {
            maxResultsPerQuery: Math.min(maxResults, 6),
            limit: maxResults
        });
        const items = Array.isArray(verified?.results) ? verified.results : [];
        return items.map(item => ({
            title: String(item?.title || '').trim(),
            url: sanitizeWebUrl(item?.url || ''),
            description: String(item?.description || '').trim()
        })).filter(item => item.url);
    } catch (_) {
        return [];
    }
}

function dot(a, b) {
    let sum = 0;
    const len = Math.min(Array.isArray(a) ? a.length : 0, Array.isArray(b) ? b.length : 0);
    for (let i = 0; i < len; i++) {
        sum += (Number(a[i]) || 0) * (Number(b[i]) || 0);
    }
    return sum;
}

function magnitude(v) {
    let sum = 0;
    const arr = Array.isArray(v) ? v : [];
    for (let i = 0; i < arr.length; i++) {
        const n = Number(arr[i]) || 0;
        sum += n * n;
    }
    return Math.sqrt(sum);
}

function cosineSimilarity(a, b) {
    const denom = magnitude(a) * magnitude(b);
    if (!denom) return 0;
    return dot(a, b) / denom;
}

function lexicalScore(text, terms) {
    const hay = String(text || '').toLowerCase();
    if (!hay || !Array.isArray(terms) || !terms.length) return 0;
    const overlap = terms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
    return overlap / terms.length;
}

async function buildLiveWebMatches(query, options = {}) {
    const webEnabled = options.webSearch !== false;
    if (!webEnabled) return [];

    const topK = clamp(toPositiveInt(options.topK, DEFAULT_TOP_K), 1, 20);
    const maxUrls = clamp(toPositiveInt(options.webMaxUrls, 4), 1, 6);
    const searchResults = await fetchSearchResultsForRag(query, {
        maxResults: Math.max(maxUrls, topK),
        baseUrl: options.baseUrl
    });
    const topUrls = searchResults.slice(0, maxUrls).map(item => item.url).filter(Boolean);
    if (!topUrls.length) return [];

    const docs = (await Promise.all(topUrls.map(url => fetchAndExtractWebDocument(url, 6000)))).filter(Boolean);
    if (!docs.length) return [];

    const allChunks = [];
    for (const doc of docs) {
        const chunks = chunkTextForRag(doc.text, {
            chunkSize: clamp(toPositiveInt(options.webChunkSize, 900), 300, 1500),
            chunkOverlap: clamp(toPositiveInt(options.webChunkOverlap, 140), 0, 400)
        }).slice(0, 8);
        for (let i = 0; i < chunks.length; i++) {
            allChunks.push({
                id: `web:${doc.url}#${i}`,
                text: chunks[i],
                metadata: {
                    sourceType: 'web',
                    url: doc.url,
                    title: doc.title || '',
                    publishedAt: doc.publishedAt || '',
                    chunkIndex: i,
                    documentId: `web_${crypto.createHash('sha1').update(doc.url).digest('hex').slice(0, 16)}`
                }
            });
        }
    }
    if (!allChunks.length) return [];

    const [queryVector] = await googleEmbeddings([query], { taskType: 'RETRIEVAL_QUERY' });
    const batchSize = 20;
    const vectors = [];
    for (let i = 0; i < allChunks.length; i += batchSize) {
        const part = allChunks.slice(i, i + batchSize).map(item => item.text);
        const partVectors = await googleEmbeddings(part, { taskType: 'RETRIEVAL_DOCUMENT' });
        vectors.push(...partVectors);
    }

    const terms = getRagQueryTerms(query);
    const scored = allChunks.map((chunk, idx) => {
        const semantic = clamp((cosineSimilarity(queryVector, vectors[idx]) + 1) / 2, 0, 1);
        const lexical = lexicalScore(chunk.text, terms);
        const fresh = freshnessScore(chunk?.metadata?.publishedAt, query);
        const score = (semantic * 0.66) + (lexical * 0.22) + (fresh * 0.12);
        return {
            id: chunk.id,
            score,
            metadata: chunk.metadata,
            text: chunk.text,
            sourceType: 'web'
        };
    }).sort((a, b) => b.score - a.score);

    return scored.slice(0, clamp(topK * 2, topK, 20));
}

function fuseMatches(primary, secondary, topK) {
    const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]
        .filter(item => item && item.id && item.text)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const out = [];
    const perDoc = new Map();
    for (const item of merged) {
        const docId = String(item?.metadata?.documentId || '').trim() || String(item.id).split('#')[0];
        const count = perDoc.get(docId) || 0;
        if (count >= 2) continue;
        perDoc.set(docId, count + 1);
        out.push(item);
        if (out.length >= topK) break;
    }
    return out;
}

async function queryPineconeRag(payload = {}) {
    const query = normalizeWhitespace(payload.query);
    if (!query) throw new Error('query_required');

    const namespace = toSafeNamespace(payload.namespace);
    const topK = clamp(toPositiveInt(payload.topK, DEFAULT_TOP_K), 1, 20);
    const vectorMatches = await queryPineconeMatches({
        query,
        namespace,
        topK: clamp(topK * 2, topK, 30),
        filter: payload.filter
    });
    const webMatches = await buildLiveWebMatches(query, {
        webSearch: payload.webSearch,
        topK,
        baseUrl: payload.baseUrl,
        webMaxUrls: payload.webMaxUrls,
        webChunkSize: payload.webChunkSize,
        webChunkOverlap: payload.webChunkOverlap
    });
    const normalized = fuseMatches(vectorMatches, webMatches, topK);

    const ragContext = normalized.length
        ? normalized.map((m, idx) => {
            const sourceType = m.sourceType || m?.metadata?.sourceType || 'vector';
            const sourceUrl = String(m?.metadata?.url || '').trim();
            const publishedAt = String(m?.metadata?.publishedAt || '').trim();
            const datePart = publishedAt ? ` [published: ${publishedAt.slice(0, 10)}]` : '';
            const prefix = sourceUrl
                ? `[${idx + 1}] (${sourceType}) ${sourceUrl}${datePart}`
                : `[${idx + 1}] (${sourceType})${datePart}`;
            return `${prefix}\n${m.text}`;
        }).join('\n\n')
        : '';

    return {
        namespace,
        query,
        topK,
        webSearchEnabled: payload.webSearch !== false,
        webSourceCount: webMatches.length,
        matches: normalized,
        ragContext
    };
}

function ragEnvSummary() {
    return {
        hasPineconeApiKey: Boolean(String(process.env.PINECONE_API_KEY || '').trim()),
        hasPineconeIndexHost: Boolean(String(process.env.PINECONE_INDEX_HOST || '').trim()),
        hasGoogleApiKey: Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()),
        embedModel: DEFAULT_EMBED_MODEL,
        defaultNamespace: toSafeNamespace(process.env.PINECONE_NAMESPACE || 'default')
    };
}

function getBaseUrl(req) {
    const host = String(req?.headers?.host || '').trim();
    if (!host) return '';
    const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').trim();
    return `${proto}://${host}`;
}

function inferAction(body = {}) {
    const explicit = String(body.action || '').trim().toLowerCase();
    if (explicit === 'upsert' || explicit === 'query' || explicit === 'chat') return explicit;

    if (String(body.message || '').trim()) return 'chat';
    if (String(body.query || '').trim() && !String(body.text || '').trim()) return 'query';
    if (String(body.text || '').trim()) return 'upsert';
    return '';
}

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'rag',
        maxBodyBytes: 2 * 1024 * 1024,
        rateLimit: { max: 20, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const body = req.body || {};
        const action = inferAction(body);

        if (action === 'upsert') {
            const { text, documentId, namespace, metadata, chunkSize, chunkOverlap, embedBatchSize } = body;
            if (!String(text || '').trim()) {
                return res.status(400).json({ success: false, error: 'text is required' });
            }

            const result = await upsertDocumentToPinecone({
                text,
                documentId,
                namespace,
                metadata,
                chunkSize,
                chunkOverlap,
                embedBatchSize
            });
            return res.status(200).json({ success: true, action, ...result });
        }

        if (action === 'query') {
            const { query, topK, namespace, filter, webSearch = true, webMaxUrls, webChunkSize, webChunkOverlap } = body;
            if (!String(query || '').trim()) {
                return res.status(400).json({ success: false, error: 'query is required' });
            }
            const result = await queryPineconeRag({
                query,
                topK,
                namespace,
                filter,
                webSearch,
                webMaxUrls,
                webChunkSize,
                webChunkOverlap,
                baseUrl: getBaseUrl(req)
            });
            return res.status(200).json({ success: true, action, ...result });
        }

        if (action === 'chat') {
            const {
                message,
                namespace,
                topK,
                filter,
                userName,
                context,
                systemPrompt,
                ragOnly = false,
                webSearch = true,
                webMaxUrls,
                webChunkSize,
                webChunkOverlap
            } = body;

            const cleanMessage = String(message || '').trim();
            if (!cleanMessage) {
                return res.status(400).json({ success: false, error: 'message is required' });
            }

            const retrieval = await queryPineconeRag({
                query: cleanMessage,
                namespace,
                topK,
                filter,
                webSearch,
                webMaxUrls,
                webChunkSize,
                webChunkOverlap,
                baseUrl: getBaseUrl(req)
            });

            if (ragOnly) {
                return res.status(200).json({
                    success: true,
                    action,
                    intent: 'rag_retrieval',
                    response: retrieval.ragContext || 'No relevant context found in vector store.',
                    rag: retrieval
                });
            }

            const baseUrl = getBaseUrl(req);
            if (!baseUrl) {
                return res.status(500).json({
                    success: false,
                    error: 'rag_chat_failed',
                    details: 'Could not resolve internal base URL for /api/chat-groq.'
                });
            }

            const chatResponse = await fetch(`${baseUrl}/api/chat-groq`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: cleanMessage,
                    userName,
                    systemPrompt,
                    context,
                    ragContext: retrieval.ragContext
                })
            });

            const raw = await chatResponse.text();
            const parsed = raw ? JSON.parse(raw) : {};

            return res.status(200).json({
                ...parsed,
                rag: {
                    namespace: retrieval.namespace,
                    topK: retrieval.topK,
                    webSearchEnabled: retrieval.webSearchEnabled,
                    webSourceCount: retrieval.webSourceCount,
                    sourceCount: retrieval.matches.length,
                    matches: retrieval.matches.map(m => ({
                        id: m.id,
                        score: m.score,
                        sourceType: m.sourceType || m?.metadata?.sourceType || 'vector',
                        metadata: m.metadata
                    }))
                }
            });
        }

        return res.status(400).json({
            success: false,
            error: 'invalid_action',
            details: 'Use action: upsert | query | chat'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'rag_failed',
            details: String(error?.message || 'unknown').slice(0, 220),
            env: ragEnvSummary()
        });
    }
}
