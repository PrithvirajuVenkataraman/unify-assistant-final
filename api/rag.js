import crypto from 'crypto';
import { applyApiSecurity } from './security.js';

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

async function queryPineconeRag(payload = {}) {
    const query = normalizeWhitespace(payload.query);
    if (!query) throw new Error('query_required');

    const namespace = toSafeNamespace(payload.namespace);
    const topK = clamp(toPositiveInt(payload.topK, DEFAULT_TOP_K), 1, 20);
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

    const normalized = matches.map((m) => ({
        id: String(m?.id || ''),
        score: Number(m?.score || 0),
        metadata: m?.metadata && typeof m.metadata === 'object' ? m.metadata : {},
        text: String(m?.metadata?.text || '').trim()
    })).filter(m => m.id && m.text);

    const ragContext = normalized.length
        ? normalized.map((m, idx) => `[${idx + 1}] ${m.text}`).join('\n\n')
        : '';

    return {
        namespace,
        query,
        topK,
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
            const { query, topK, namespace, filter } = body;
            if (!String(query || '').trim()) {
                return res.status(400).json({ success: false, error: 'query is required' });
            }
            const result = await queryPineconeRag({ query, topK, namespace, filter });
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
                ragOnly = false
            } = body;

            const cleanMessage = String(message || '').trim();
            if (!cleanMessage) {
                return res.status(400).json({ success: false, error: 'message is required' });
            }

            const retrieval = await queryPineconeRag({
                query: cleanMessage,
                namespace,
                topK,
                filter
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
                    sourceCount: retrieval.matches.length,
                    matches: retrieval.matches.map(m => ({
                        id: m.id,
                        score: m.score,
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
