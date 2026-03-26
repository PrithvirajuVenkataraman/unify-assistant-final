import crypto from 'crypto';
import { applyApiSecurity } from './security.js';
import { extractSearchTopic, runVerifiedWebSearch } from './live-search.js';

export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: '2mb' } } };

const DEFAULT_EMBED_MODEL = String(process.env.GEMINI_EMBED_MODEL || process.env.GOOGLE_EMBED_MODEL || 'text-embedding-004').trim();
const DEFAULT_TOP_K = 6;
const ENABLE_LLM_RERANK = String(process.env.RAG_ENABLE_LLM_RERANK || '').trim().toLowerCase() === 'true';

const C = {
  MAX: 400,
  EMB_TTL: 10 * 60 * 1000,
  WEB_TTL: 4 * 60 * 1000,
  SEARCH_TTL: 2 * 60 * 1000
};
const cache = { emb: new Map(), web: new Map(), search: new Map() };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toPosInt = (v, f) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : f; };
const now = () => Date.now();
const hash = (s, n = 20) => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, n);
const clean = (t) => String(t || '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const toNs = (i) => (String(i || process.env.PINECONE_NAMESPACE || 'default').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default');
const embKey = (t, type) => `${type}:${hash(clean(t), 40)}`;

function cacheGet(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (v.exp <= now()) { map.delete(key); return null; }
  v.last = now();
  return v.val;
}
function cacheSet(map, key, val, ttl) {
  map.set(key, { val, exp: now() + ttl, last: now() });
  if (map.size <= C.MAX) return;
  const old = Array.from(map.entries()).sort((a, b) => (a[1]?.last || 0) - (b[1]?.last || 0));
  for (let i = 0; i < Math.max(1, map.size - C.MAX); i++) map.delete(old[i][0]);
}

function assertEnv(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
function getGoogleApiKey() {
  const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!key) throw new Error('Missing required environment variable: GEMINI_API_KEY or GOOGLE_API_KEY');
  return key;
}

function getTerms(q) {
  const stop = new Set(['a','an','the','and','or','but','if','then','than','is','are','was','were','be','been','being','what','which','who','when','where','why','how','to','of','in','on','for','with','from','by','as','tell','show','give','find','search','lookup','about','please','latest','recent','current','today','now']);
  return Array.from(new Set(String(q || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(x => x && x.length > 1 && !stop.has(x)).slice(0, 20)));
}

function splitSentences(text) {
  const s = clean(text);
  if (!s) return [];
  const parts = s.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/g).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}
function chunkTextForRag(text, o = {}) {
  const src = clean(text); if (!src) return [];
  const chunkChars = clamp(toPosInt(o.chunkSize, 1400), 300, 4000);
  const overlapChars = clamp(toPosInt(o.chunkOverlap, 220), 0, Math.floor(chunkChars * 0.6));
  const target = clamp(Math.ceil(chunkChars / 4), 100, 1200);
  const overlap = clamp(Math.ceil(overlapChars / 4), 0, Math.floor(target * 0.5));
  const sents = splitSentences(src); const out = [];
  let cur = 0;
  while (cur < sents.length) {
    let i = cur; let toks = 0; const buf = [];
    while (i < sents.length) {
      const nt = Math.max(1, Math.ceil(sents[i].length / 4));
      if (buf.length && toks + nt > target) break;
      buf.push(sents[i]); toks += nt; i++;
      if (toks >= target) break;
    }
    const ch = clean(buf.join(' ')); if (ch) out.push(ch);
    if (i >= sents.length) break;
    let back = 0; let j = i - 1;
    while (j >= 0 && back < overlap) { back += Math.max(1, Math.ceil(sents[j].length / 4)); j--; }
    cur = Math.max(cur + 1, j + 1);
  }
  return Array.from(new Map(out.map(x => [hash(x, 28), x])).values());
}

function sanitizeMetadata(m = {}) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    const key = String(k || '').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 64);
    if (!key) continue;
    if (v == null) continue;
    out[key] = ['string', 'number', 'boolean'].includes(typeof v) ? v : String(v).slice(0, 400);
  }
  return out;
}

function toTask(x) { return String(x || '').toUpperCase().trim() === 'RETRIEVAL_QUERY' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'; }
function modelCandidates() { return Array.from(new Set([DEFAULT_EMBED_MODEL, 'text-embedding-004', 'gemini-embedding-001'].filter(Boolean))); }

async function googleEmbeddings(inputs, opt = {}) {
  const taskType = toTask(opt.taskType);
  const list = (Array.isArray(inputs) ? inputs : []).map(x => clean(String(x || '')));
  if (!list.length) return [];

  const out = new Array(list.length); const miss = [];
  for (let i = 0; i < list.length; i++) {
    const c = cacheGet(cache.emb, embKey(list[i], taskType));
    if (c) out[i] = c; else miss.push({ i, text: list[i] });
  }
  if (!miss.length) return out;

  const apiKey = getGoogleApiKey();
  let err = 'google_embeddings_failed';
  for (const model of modelCandidates()) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents?key=${apiKey}`;
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: miss.map(m => ({ model: `models/${model}`, taskType, content: { parts: [{ text: m.text }] } })) })
    });
    const raw = await r.text();
    if (!r.ok) { err = `google_embeddings_failed model=${model} status=${r.status} body=${raw.slice(0, 220)}`; continue; }
    const data = raw ? JSON.parse(raw) : {};
    const vecs = Array.isArray(data?.embeddings) ? data.embeddings.map(e => Array.isArray(e?.values) ? e.values : null).filter(Boolean) : [];
    if (vecs.length !== miss.length) { err = `google_embeddings_empty_or_mismatch model=${model}`; continue; }
    for (let j = 0; j < miss.length; j++) { out[miss[j].i] = vecs[j]; cacheSet(cache.emb, embKey(miss[j].text, taskType), vecs[j], C.EMB_TTL); }
    return out;
  }
  throw new Error(err);
}

async function pineconeRequest(path, body) {
  const apiKey = assertEnv('PINECONE_API_KEY');
  const host = assertEnv('PINECONE_INDEX_HOST').replace(/^https?:\/\//i, '');
  const r = await fetch(`https://${host}${path}`, { method: 'POST', headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const raw = await r.text();
  if (!r.ok) throw new Error(`pinecone_request_failed path=${path} status=${r.status} body=${raw.slice(0, 220)}`);
  return raw ? JSON.parse(raw) : {};
}
async function upsertDocumentToPinecone(payload = {}) {
  const text = clean(payload.text);
  if (!text) throw new Error('text_required_for_upsert');
  const namespace = toNs(payload.namespace);
  const documentId = payload.documentId && /^[a-zA-Z0-9:_-]{1,120}$/.test(payload.documentId) ? payload.documentId : `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const chunks = chunkTextForRag(text, { chunkSize: payload.chunkSize, chunkOverlap: payload.chunkOverlap });
  if (!chunks.length) throw new Error('no_chunks_generated');

  const batch = clamp(toPosInt(payload.embedBatchSize, 20), 1, 100);
  const meta = sanitizeMetadata(payload.metadata);
  const vectors = [];
  for (let i = 0; i < chunks.length; i += batch) {
    const part = chunks.slice(i, i + batch);
    const embeds = await googleEmbeddings(part, { taskType: 'RETRIEVAL_DOCUMENT' });
    for (let j = 0; j < part.length; j++) vectors.push({ id: `${documentId}#${i + j}`, values: embeds[j], metadata: { ...meta, documentId, chunkIndex: i + j, text: part[j] } });
  }

  const up = await pineconeRequest('/vectors/upsert', { namespace, vectors });
  return { namespace, documentId, chunkCount: chunks.length, upsertedCount: Number(up?.upsertedCount || vectors.length) };
}

async function queryPineconeMatches(payload = {}) {
  const query = clean(payload.query);
  if (!query) return [];
  const namespace = toNs(payload.namespace);
  const topK = clamp(toPosInt(payload.topK, DEFAULT_TOP_K), 1, 40);
  const [queryVector] = await googleEmbeddings([query], { taskType: 'RETRIEVAL_QUERY' });
  const body = { namespace, vector: queryVector, topK, includeMetadata: true, includeValues: false };
  if (payload.filter && typeof payload.filter === 'object') body.filter = payload.filter;
  const data = await pineconeRequest('/query', body);
  return (Array.isArray(data?.matches) ? data.matches : []).map(m => ({ id: String(m?.id || ''), score: Number(m?.score || 0), metadata: m?.metadata && typeof m.metadata === 'object' ? m.metadata : {}, text: String(m?.metadata?.text || '').trim(), sourceType: 'vector' })).filter(m => m.id && m.text);
}

function resolveQueryContext(query, context = []) {
  const q = clean(query);
  if (!q) return '';
  const terms = getTerms(q);
  const referential = /\b(it|they|that|this|those|these|same|earlier|previous|compare)\b/i.test(q);
  if (!referential && terms.length >= 4) return q;
  const turns = (Array.isArray(context) ? context : []).filter(t => String(t?.role || '').toLowerCase() === 'user').slice(-6).map(t => clean(t?.text || '')).filter(Boolean);
  for (let i = turns.length - 1; i >= 0; i--) {
    const anchorTerms = getTerms(turns[i]);
    if (anchorTerms.length < 3) continue;
    if (terms.some(t => anchorTerms.includes(t))) return q;
    return clean(`${q} ${anchorTerms.slice(0, 8).join(' ')}`);
  }
  return q;
}

function isBlockedHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    const o = h.split('.').map(Number);
    if (o[0] === 10 || o[0] === 127 || o[0] === 0 || (o[0] === 169 && o[1] === 254) || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31)) return true;
  }
  return ['metadata', 'metadata.google.internal', 'kubernetes.default.svc'].includes(h);
}

function sanitizeWebUrl(url) {
  try {
    const p = new URL(String(url || '').trim());
    if (!['http:', 'https:'].includes(p.protocol)) return '';
    if (isBlockedHost(p.hostname)) return '';
    if (p.port && !['80', '443'].includes(p.port)) return '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref', 'ref_src'].forEach(k => p.searchParams.delete(k));
    p.hash = ''; p.hostname = p.hostname.toLowerCase(); p.pathname = p.pathname.replace(/\/{2,}/g, '/'); if (p.pathname.length > 1) p.pathname = p.pathname.replace(/\/$/, '');
    return p.toString();
  } catch (_) { return ''; }
}

const decodeBasicHtml = (t) => String(t || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const stripHtmlToText = (h) => decodeBasicHtml(String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim());
const extractTitleFromHtml = (h) => decodeBasicHtml((String(h || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')).replace(/\s+/g, ' ').trim();

function extractPublishedMs(html, text = '') {
  const doc = String(html || '');
  const vals = [];
  for (const p of [/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i, /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["'][^>]*>/i, /<meta[^>]+name=["']publishdate["'][^>]+content=["']([^"']+)["'][^>]*>/i, /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i]) { const m = doc.match(p); if (m?.[1]) vals.push(m[1]); }
  const tm = doc.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i); if (tm?.[1]) vals.push(tm[1]);
  const tx = String(text || '').match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i); if (tx?.[0]) vals.push(tx[0]);
  for (const v of vals) { const ts = Date.parse(String(v || '')); if (Number.isFinite(ts) && ts > 0) return ts; }
  return 0;
}

async function fetchAndExtractWebDocument(url, timeoutMs = 6000) {
  const safeUrl = sanitizeWebUrl(url); if (!safeUrl) return null;
  const ck = `web:${safeUrl}`; const hit = cacheGet(cache.web, ck); if (hit) return hit;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(safeUrl, { method: 'GET', headers: { 'User-Agent': 'UnifyAssistantRAG/2.0', 'Accept': 'text/html,application/xhtml+xml' }, signal: ctrl.signal });
    if (!r.ok) return null;
    const ctype = String(r.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml')) return null;
    const html = await r.text();
    const text = clean(stripHtmlToText(html)).slice(0, 16000);
    if (!text || text.length < 200) return null;
    const publishedAtMs = extractPublishedMs(html, text);
    const doc = { url: sanitizeWebUrl(r.url || safeUrl) || safeUrl, title: extractTitleFromHtml(html), text, publishedAt: publishedAtMs > 0 ? new Date(publishedAtMs).toISOString() : '', publishedAtMs };
    cacheSet(cache.web, ck, doc, C.WEB_TTL);
    return doc;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}
function loadTrustedHostWeights() {
  const raw = String(process.env.RAG_TRUSTED_HOST_WEIGHTS || '').trim();
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
    const out = {};
    for (const [h, v] of Object.entries(p)) { const k = String(h || '').trim().toLowerCase(); const n = Number(v); if (k && Number.isFinite(n)) out[k] = clamp(n, -0.4, 0.4); }
    return out;
  } catch (_) { return {}; }
}
function trustScore(url, weights = {}) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    let best = 0;
    for (const [d, w] of Object.entries(weights || {})) if (host === d || host.endsWith(`.${d}`)) if (Math.abs(w) > Math.abs(best)) best = w;
    return best;
  } catch (_) { return 0; }
}

async function generateSemanticSearchQueries(query, options = {}) {
  const q = clean(query); if (!q) return [];
  const contextual = resolveQueryContext(q, options.context || []);
  const base = extractSearchTopic(contextual) || contextual;
  const out = [base];
  const baseUrl = String(options.baseUrl || '').trim();
  if (!baseUrl) return out;
  try {
    const r = await fetch(`${baseUrl}/api/chat-groq`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt: 'Generate semantic web-search rewrites. Return ONLY a JSON array of short query strings. No prose.', message: `Rewrite this user query into 4 alternative web search queries that preserve intent and maximize factual retrieval quality.\\n\\nQuery: "${contextual}"\\n\\nOutput strictly as JSON array of strings.` }) });
    if (!r.ok) return out;
    const d = await r.json();
    let rewrites = []; try { rewrites = JSON.parse(String(d?.response || d?.text || '')); } catch { rewrites = []; }
    out.push(...(Array.isArray(rewrites) ? rewrites : []).map(x => clean(String(x || ''))).filter(Boolean).slice(0, 4));
  } catch (_) {}
  return Array.from(new Set(out.filter(Boolean))).slice(0, 5);
}

function parseJsonObjectFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchSearchResultsForRag(query, options = {}) {
  const cleanQuery = clean(query);
  const maxResults = clamp(toPosInt(options.maxResults, 6), 1, 10);
  const baseUrl = String(options.baseUrl || '').trim();
  const ck = `search:${hash(`${cleanQuery}|${maxResults}`, 32)}`;
  const hit = cacheGet(cache.search, ck); if (hit) return hit;

  if (baseUrl) {
    try {
      const r = await fetch(`${baseUrl}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: cleanQuery, maxResults }) });
      if (r.ok) {
        const d = await r.json();
        const items = (Array.isArray(d?.results) ? d.results : []).map(i => ({ title: String(i?.title || '').trim(), url: sanitizeWebUrl(i?.url || ''), description: String(i?.description || '').trim() })).filter(i => i.url);
        const out = Array.from(new Map(items.map(i => [i.url, i])).values());
        cacheSet(cache.search, ck, out, C.SEARCH_TTL);
        return out;
      }
    } catch (_) {}
  }

  try {
    const queries = await generateSemanticSearchQueries(cleanQuery, { baseUrl, context: options.context });
    const verified = await runVerifiedWebSearch(queries, { maxResultsPerQuery: Math.min(maxResults, 6), limit: maxResults });
    const items = (Array.isArray(verified?.results) ? verified.results : []).map(i => ({ title: String(i?.title || '').trim(), url: sanitizeWebUrl(i?.url || ''), description: String(i?.description || '').trim() })).filter(i => i.url);
    const out = Array.from(new Map(items.map(i => [i.url, i])).values());
    cacheSet(cache.search, ck, out, C.SEARCH_TTL);
    return out;
  } catch (_) { return []; }
}

const isTimeSensitive = (q) => /\b(latest|recent|current|today|now|update|updates|news|headlines|status|price|rates?|score|result|breaking|earnings|quarter|schedule|fixture|as of)\b/i.test(String(q || ''));
const adaptiveWeights = (q) => isTimeSensitive(q) ? { s: 0.56, l: 0.13, b: 0.1, f: 0.13, t: 0.08 } : { s: 0.7, l: 0.15, b: 0.09, f: 0.01, t: 0.05 };
const freshScore = (ts) => { const n = Number(ts) || 0; if (!n) return 0; const d = (Date.now() - n) / 86400000; if (d <= 2) return 0.24; if (d <= 7) return 0.2; if (d <= 30) return 0.14; if (d <= 180) return 0.07; if (d <= 365) return 0.02; if (d <= 1095) return -0.04; return -0.09; };
const norm = (a) => { const v = a.map(x => Number(x) || 0); if (!v.length) return []; const min = Math.min(...v), max = Math.max(...v); return max - min < 1e-9 ? v.map(() => 0.5) : v.map(x => (x - min) / (max - min)); };
const cos = (a, b) => { const d = a.reduce((s, x, i) => s + (Number(x) || 0) * (Number(b?.[i]) || 0), 0); const ma = Math.sqrt(a.reduce((s, x) => s + (Number(x) || 0) ** 2, 0)); const mb = Math.sqrt((Array.isArray(b) ? b : []).reduce((s, x) => s + (Number(x) || 0) ** 2, 0)); return ma && mb ? d / (ma * mb) : 0; };
const scoreCut = (arr, floor = 0.12) => { const a = arr.filter(Number.isFinite).sort((x, y) => y - x); if (!a.length) return floor; if (a.length === 1) return Math.max(floor, a[0] - 0.01); const m = a.reduce((s, n) => s + n, 0) / a.length; const v = a.reduce((s, n) => s + (n - m) ** 2, 0) / a.length; return Math.max(floor, m + 0.1 * Math.sqrt(Math.max(v, 0))); };

async function buildLiveWebMatches(query, options = {}) {
  if (options.webSearch === false) return [];
  const topK = clamp(toPosInt(options.topK, DEFAULT_TOP_K), 1, 20);
  const maxUrls = clamp(toPosInt(options.webMaxUrls, 4), 1, 6);
  const hits = await fetchSearchResultsForRag(query, { maxResults: Math.max(maxUrls, topK), baseUrl: options.baseUrl, context: options.context });
  if (!hits.length) return [];

  const terms = getTerms(query);
  const trusted = loadTrustedHostWeights();
  const [qVec] = await googleEmbeddings([query], { taskType: 'RETRIEVAL_QUERY' });
  const hVec = await googleEmbeddings(hits.map(h => [h.title, h.description, h.url].filter(Boolean).join('\n').slice(0, 1200)), { taskType: 'RETRIEVAL_DOCUMENT' });
  let ranked = hits.map((h, i) => ({ ...h, __score: (((cos(qVec, hVec[i]) + 1) / 2) * 0.8) + (lexicalScore(`${h.title}\n${h.description}`, terms) * 0.14) + (trustScore(h.url, trusted) * 0.06) })).sort((a, b) => b.__score - a.__score);
  ranked = ranked.filter(x => x.__score >= scoreCut(ranked.map(r => r.__score), 0.14));
  if (!ranked.length) ranked = hits.slice(0, Math.min(maxUrls, 3));

  const urls = Array.from(new Set(ranked.map(x => x.url).filter(Boolean))).slice(0, maxUrls);
  const docs = Array.from(new Map((await Promise.all(urls.map(u => fetchAndExtractWebDocument(u, 6000)))).filter(Boolean).map(d => [`${d.url}|${hash(d.text.slice(0, 700), 18)}`, d])).values());
  if (!docs.length) return [];

  const chunks = [];
  for (const doc of docs) {
    const c = chunkTextForRag(doc.text, { chunkSize: clamp(toPosInt(options.webChunkSize, 900), 300, 1800), chunkOverlap: clamp(toPosInt(options.webChunkOverlap, 140), 0, 500) }).slice(0, 10);
    for (let i = 0; i < c.length; i++) chunks.push({ id: `web:${doc.url}#${i}`, text: c[i], metadata: { sourceType: 'web', url: doc.url, title: doc.title || '', publishedAt: doc.publishedAt || '', chunkIndex: i, documentId: `web_${hash(doc.url, 16)}` }, sourceType: 'web' });
  }
  if (!chunks.length) return [];

  const cVec = []; for (let i = 0; i < chunks.length; i += 20) cVec.push(...(await googleEmbeddings(chunks.slice(i, i + 20).map(c => c.text), { taskType: 'RETRIEVAL_DOCUMENT' })));
  const sem = chunks.map((c, i) => clamp((cos(qVec, cVec[i]) + 1) / 2, 0, 1));
  const lex = chunks.map(c => lexicalScore(c.text, terms));
  const fre = norm(chunks.map(c => freshScore(c?.metadata?.publishedAt)));
  const tr = norm(chunks.map(c => trustScore(c?.metadata?.url, trusted)));
  const w = adaptiveWeights(query);
  const scored = chunks.map((c, i) => ({ ...c, score: (sem[i] * w.s) + (lex[i] * w.l) + (fre[i] * w.f) + (tr[i] * w.t), rankSignals: { semantic: sem[i], lexical: lex[i], fresh: fre[i], trust: tr[i] } })).sort((a, b) => b.score - a.score);
  const cutoff = scoreCut(scored.map(s => s.score), 0.2);
  const list = (scored.filter(s => s.score >= cutoff).length ? scored.filter(s => s.score >= cutoff) : scored.slice(0, clamp(topK, 1, 8))).slice(0, clamp(topK * 2, topK, 24));
  return Array.from(new Map(list.map(i => [`${i?.metadata?.documentId}|${hash(i.text.slice(0, 260), 18)}`, i])).values());
}
function fuseMatches(primary, secondary, topK) {
  const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].filter(i => i && i.id && i.text).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const out = []; const perDoc = new Map();
  for (const item of merged) {
    const docId = String(item?.metadata?.documentId || '').trim() || String(item.id).split('#')[0];
    const count = perDoc.get(docId) || 0;
    if (count >= 2) continue;
    perDoc.set(docId, count + 1); out.push(item);
    if (out.length >= topK * 3) break;
  }
  return out;
}

function rerankMatches(query, matches) {
  const terms = getTerms(query); const trusted = loadTrustedHostWeights();
  return (Array.isArray(matches) ? matches : []).map(m => {
    const semantic = clamp(Number(m?.score || 0), 0, 1);
    const lexical = lexicalScore(m?.text || '', terms);
    const fresh = freshScore(m?.metadata?.publishedAt || '');
    const trust = trustScore(m?.metadata?.url || '', trusted);
    return { ...m, score: (semantic * 0.72) + (lexical * 0.18) + (fresh * 0.04) + (trust * 0.06), rerank: { semantic, lexical, fresh, trust } };
  }).sort((a, b) => b.score - a.score);
}

async function maybeLlmRerank(query, matches, baseUrl) {
  if (!ENABLE_LLM_RERANK || !baseUrl || !Array.isArray(matches) || matches.length < 3) return matches;
  const candidates = matches.slice(0, 18).map((m, i) => ({ id: String(m.id || `c${i}`), sourceType: String(m.sourceType || 'vector'), url: String(m?.metadata?.url || ''), title: String(m?.metadata?.title || ''), text: String(m?.text || '').slice(0, 360) }));
  try {
    const r = await fetch(`${baseUrl}/api/chat-groq`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt: 'You are a retrieval reranker. Return JSON only: {"orderedIds":["id1","id2"]}', message: `Query: "${query}"\nCandidates: ${JSON.stringify(candidates)}\nReturn orderedIds by relevance.` }) });
    if (!r.ok) return matches;
    const d = await r.json();
    const obj = parseJsonObjectFromText(String(d?.response || d?.text || ''));
    const ids = Array.isArray(obj?.orderedIds) ? obj.orderedIds.map(x => String(x || '')).filter(Boolean) : [];
    if (!ids.length) return matches;
    const byId = new Map(matches.map(m => [String(m.id), m]));
    const out = [];
    for (const id of ids) if (byId.has(id)) out.push(byId.get(id));
    for (const m of matches) if (!out.includes(m)) out.push(m);
    return out;
  } catch (_) { return matches; }
}

function buildCitationArtifacts(matches) {
  const arr = Array.isArray(matches) ? matches : [];
  const citationMap = arr.map((m, idx) => ({ index: idx + 1, id: String(m.id || ''), score: Number(m.score || 0), sourceType: String(m.sourceType || m?.metadata?.sourceType || 'vector'), url: String(m?.metadata?.url || ''), title: String(m?.metadata?.title || ''), publishedAt: String(m?.metadata?.publishedAt || '') }));
  const ragContext = arr.length ? arr.map((m, idx) => {
    const sourceType = m.sourceType || m?.metadata?.sourceType || 'vector';
    const sourceUrl = String(m?.metadata?.url || '').trim();
    const publishedAt = String(m?.metadata?.publishedAt || '').trim();
    const datePart = publishedAt ? ` [published: ${publishedAt.slice(0, 10)}]` : '';
    const prefix = sourceUrl ? `[${idx + 1}] (${sourceType}) ${sourceUrl}${datePart}` : `[${idx + 1}] (${sourceType})${datePart}`;
    return `${prefix}\n${m.text}`;
  }).join('\n\n') : '';
  return { citationMap, ragContext };
}

function extractCitationIndexes(text, max = 14) {
  const out = []; const seen = new Set(); const re = /\[(\d{1,3})\]/g; let m;
  while ((m = re.exec(String(text || ''))) && out.length < max) { const n = Number(m[1]); if (Number.isFinite(n) && n > 0 && !seen.has(n)) { seen.add(n); out.push(n); } }
  return out;
}

async function queryPineconeRag(payload = {}) {
  const t0 = now();
  const originalQuery = clean(payload.query);
  if (!originalQuery) throw new Error('query_required');
  const query = resolveQueryContext(originalQuery, payload.context || []);
  const namespace = toNs(payload.namespace);
  const topK = clamp(toPosInt(payload.topK, DEFAULT_TOP_K), 1, 20);

  const t1 = now();
  const vectorMatches = await queryPineconeMatches({ query, namespace, topK: clamp(topK * 2, topK, 30), filter: payload.filter });
  const vectorMs = now() - t1;

  const t2 = now();
  const webMatches = await buildLiveWebMatches(query, { webSearch: payload.webSearch, topK, baseUrl: payload.baseUrl, webMaxUrls: payload.webMaxUrls, webChunkSize: payload.webChunkSize, webChunkOverlap: payload.webChunkOverlap, context: payload.context });
  const webMs = now() - t2;

  const fused = fuseMatches(vectorMatches, webMatches, topK);
  const t3 = now();
  const reranked = await maybeLlmRerank(query, rerankMatches(query, fused), payload.baseUrl);
  const rerankMs = now() - t3;

  const matches = reranked.slice(0, topK);
  const { citationMap, ragContext } = buildCitationArtifacts(matches);
  return {
    namespace,
    query: originalQuery,
    rewrittenQuery: query,
    topK,
    webSearchEnabled: payload.webSearch !== false,
    webSourceCount: webMatches.length,
    matches,
    citationMap,
    ragContext,
    timings: { totalMs: now() - t0, vectorMs, webMs, rerankMs },
    retrievalDebug: {
      vectorCandidateCount: vectorMatches.length,
      webCandidateCount: webMatches.length,
      fusedCount: fused.length,
      finalCount: matches.length,
      scoreMean: matches.length ? Number((matches.reduce((s, m) => s + (Number(m.score) || 0), 0) / matches.length).toFixed(4)) : 0
    }
  };
}

function ragEnvSummary() {
  return {
    hasPineconeApiKey: Boolean(String(process.env.PINECONE_API_KEY || '').trim()),
    hasPineconeIndexHost: Boolean(String(process.env.PINECONE_INDEX_HOST || '').trim()),
    hasGoogleApiKey: Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()),
    embedModel: DEFAULT_EMBED_MODEL,
    defaultNamespace: toNs(process.env.PINECONE_NAMESPACE || 'default'),
    llmRerankEnabled: ENABLE_LLM_RERANK
  };
}

const getBaseUrl = (req) => { const host = String(req?.headers?.host || '').trim(); if (!host) return ''; const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').trim(); return `${proto}://${host}`; };
function inferAction(body = {}) { const e = String(body.action || '').trim().toLowerCase(); if (e === 'upsert' || e === 'query' || e === 'chat') return e; if (String(body.message || '').trim()) return 'chat'; if (String(body.query || '').trim() && !String(body.text || '').trim()) return 'query'; if (String(body.text || '').trim()) return 'upsert'; return ''; }
function buildCitationPrompt(base = '') { const strict = ['Citation rules for this answer:', '- Use only Retrieved context for factual claims.', '- Include citations like [1], [2] for each factual sentence.', '- If evidence is missing, say you could not verify it from retrieved sources.', '- Do not invent facts or citations.'].join('\n'); return [String(base || '').trim(), strict].filter(Boolean).join('\n\n'); }

export default async function handler(req, res) {
  const guard = applyApiSecurity(req, res, { methods: ['POST'], routeKey: 'rag', maxBodyBytes: 2 * 1024 * 1024, rateLimit: { max: 20, windowMs: 60 * 1000 } });
  if (guard.handled) return;

  try {
    const body = req.body || {}; const action = inferAction(body);

    if (action === 'upsert') {
      const { text, documentId, namespace, metadata, chunkSize, chunkOverlap, embedBatchSize } = body;
      if (!String(text || '').trim()) return res.status(400).json({ success: false, error: 'text is required' });
      const result = await upsertDocumentToPinecone({ text, documentId, namespace, metadata, chunkSize, chunkOverlap, embedBatchSize });
      return res.status(200).json({ success: true, action, ...result });
    }

    if (action === 'query') {
      const { query, topK, namespace, filter, webSearch = true, webMaxUrls, webChunkSize, webChunkOverlap, context } = body;
      if (!String(query || '').trim()) return res.status(400).json({ success: false, error: 'query is required' });
      const result = await queryPineconeRag({ query, topK, namespace, filter, webSearch, webMaxUrls, webChunkSize, webChunkOverlap, context, baseUrl: getBaseUrl(req) });
      return res.status(200).json({ success: true, action, ...result });
    }

    if (action === 'chat') {
      const { message, namespace, topK, filter, userName, context, systemPrompt, ragOnly = false, webSearch = true, webMaxUrls, webChunkSize, webChunkOverlap } = body;
      const cleanMessage = String(message || '').trim();
      if (!cleanMessage) return res.status(400).json({ success: false, error: 'message is required' });
      const retrieval = await queryPineconeRag({ query: cleanMessage, namespace, topK, filter, webSearch, webMaxUrls, webChunkSize, webChunkOverlap, context, baseUrl: getBaseUrl(req) });
      if (ragOnly) return res.status(200).json({ success: true, action, intent: 'rag_retrieval', response: retrieval.ragContext || 'No relevant context found in vector store.', citations: retrieval.citationMap, rag: retrieval });

      const baseUrl = getBaseUrl(req);
      if (!baseUrl) return res.status(500).json({ success: false, error: 'rag_chat_failed', details: 'Could not resolve internal base URL for /api/chat-groq.' });

      const chatResponse = await fetch(`${baseUrl}/api/chat-groq`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: cleanMessage, userName, systemPrompt: buildCitationPrompt(systemPrompt), context, ragContext: retrieval.ragContext }) });
      const raw = await chatResponse.text();
      const parsed = raw ? JSON.parse(raw) : {};
      const idx = extractCitationIndexes(parsed?.response || '', 16);
      const citations = retrieval.citationMap.filter(c => idx.includes(c.index));
      return res.status(200).json({ ...parsed, citations, rag: { namespace: retrieval.namespace, topK: retrieval.topK, rewrittenQuery: retrieval.rewrittenQuery, webSearchEnabled: retrieval.webSearchEnabled, webSourceCount: retrieval.webSourceCount, sourceCount: retrieval.matches.length, timings: retrieval.timings, retrievalDebug: retrieval.retrievalDebug, citationMap: retrieval.citationMap, matches: retrieval.matches.map(m => ({ id: m.id, score: m.score, sourceType: m.sourceType || m?.metadata?.sourceType || 'vector', rerank: m.rerank, rankSignals: m.rankSignals, metadata: m.metadata })) } });
    }

    return res.status(400).json({ success: false, error: 'invalid_action', details: 'Use action: upsert | query | chat' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'rag_failed', details: String(error?.message || 'unknown').slice(0, 220), env: ragEnvSummary() });
  }
}
