import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import tls from 'node:tls';

const DEFAULT_USER_AGENT = 'UnifyAssistantWebSearch/1.0 (+https://vercel.app; respectful crawler)';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL_SECONDS = 15 * 60;
const ROBOTS_CACHE_TTL_SECONDS = 60 * 60;
const MAX_QUERY_LENGTH = 300;
const MAX_RESULTS = 5;
const DEFAULT_RESULTS = 4;
const MAX_TEXT_CHARS = 8000;
const RATE_LIMIT_WINDOW_MS = Number(process.env.WEB_SEARCH_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.WEB_SEARCH_RATE_LIMIT_MAX || 20);
const MEMORY_CACHE = new Map();
const RATE_LIMITS = new Map();

export async function webSearchHandler(req, res) {
    if (String(req?.method || 'GET').toUpperCase() !== 'POST') {
        return res.status(405).json({
            success: false,
            error: { code: 'method_not_allowed', message: 'Use POST /api/web-search.' }
        });
    }

    const rate = checkRateLimit(getClientKey(req));
    if (!rate.allowed) {
        return res.status(429).json({
            success: false,
            error: {
                code: 'rate_limited',
                message: 'Too many web search requests. Retry shortly.',
                retryAfterMs: rate.retryAfterMs
            }
        });
    }

    const body = parseRequestBody(req?.body);
    const normalized = normalizeSearchRequest(body);
    if (!normalized.ok) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_request', message: normalized.error }
        });
    }

    try {
        const data = await searchWeb(normalized.value.query, normalized.value);
        return res.status(200).json({
            success: true,
            ...data
        });
    } catch (error) {
        const code = error?.code || 'web_search_failed';
        const status = error?.status || (code === 'searxng_not_configured' ? 503 : 500);
        return res.status(status).json({
            success: false,
            error: {
                code,
                message: String(error?.publicMessage || error?.message || 'Web search failed.')
            },
            results: []
        });
    }
}

export async function searchWeb(query, options = {}) {
    const searxngUrl = getSearxngUrl(options.searxngUrl);
    if (!searxngUrl) {
        const error = new Error('SEARXNG_URL is not configured.');
        error.code = 'searxng_not_configured';
        error.status = 503;
        throw error;
    }

    const normalizedQuery = normalizeWhitespace(query).slice(0, MAX_QUERY_LENGTH);
    if (!normalizedQuery) {
        const error = new Error('Search query is required.');
        error.code = 'invalid_query';
        error.status = 400;
        throw error;
    }

    const maxResults = clampInteger(options.maxResults, 1, MAX_RESULTS, DEFAULT_RESULTS);
    const timeoutMs = clampInteger(options.timeoutMs, 1500, 15000, DEFAULT_TIMEOUT_MS);
    const textLimit = clampInteger(options.textLimit, 1200, 20000, MAX_TEXT_CHARS);
    const cacheTtlSeconds = clampInteger(options.cacheTtlSeconds, 30, 86400, DEFAULT_CACHE_TTL_SECONDS);
    const cacheKey = `web-search:${stableHash(JSON.stringify({ q: normalizedQuery, maxResults, textLimit }))}`;

    const cached = await cacheGet(cacheKey);
    if (cached) {
        return {
            ...cached,
            cached: true
        };
    }

    const searchResults = await querySearxng(searxngUrl, normalizedQuery, {
        timeoutMs,
        maxResults,
        userAgent: options.userAgent || DEFAULT_USER_AGENT
    });

    const ranked = rankSearxngResults(searchResults, normalizedQuery).slice(0, maxResults);
    const enriched = [];
    for (const result of ranked) {
        const page = await fetchReadablePage(result.url, {
            timeoutMs,
            textLimit,
            cacheTtlSeconds,
            userAgent: options.userAgent || DEFAULT_USER_AGENT,
            respectRobots: options.respectRobots !== false
        });
        if (!page.ok) continue;
        enriched.push({
            title: result.title || page.title || result.url,
            url: result.url,
            snippet: result.snippet || page.description || '',
            text: page.text,
            source: result.source || 'searxng',
            score: result.score,
            fetchedAt: new Date().toISOString()
        });
    }

    const payload = {
        query: normalizedQuery,
        results: enriched,
        sourceCount: enriched.length,
        searxngUrl: maskEndpoint(searxngUrl),
        cached: false
    };
    await cacheSet(cacheKey, payload, cacheTtlSeconds);
    return payload;
}

export function normalizeSearchRequest(body = {}) {
    const query = normalizeWhitespace(body.query || body.q || body.message || '');
    if (!query) return { ok: false, error: 'Missing query.' };
    if (query.length > MAX_QUERY_LENGTH) return { ok: false, error: `Query must be ${MAX_QUERY_LENGTH} characters or fewer.` };
    return {
        ok: true,
        value: {
            query,
            maxResults: body.maxResults ?? body.limit,
            timeoutMs: body.timeoutMs,
            textLimit: body.textLimit,
            cacheTtlSeconds: body.cacheTtlSeconds
        }
    };
}

function parseRequestBody(body) {
    if (body && typeof body === 'object') return body;
    if (typeof body !== 'string') return {};
    try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

async function querySearxng(baseUrl, query, options) {
    const url = new URL('/search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');
    url.searchParams.set('safesearch', '1');

    const cacheKey = `searxng:${stableHash(url.toString())}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const response = await fetchWithTimeout(url.toString(), {
        timeoutMs: options.timeoutMs,
        headers: {
            Accept: 'application/json',
            'User-Agent': options.userAgent
        }
    });
    if (!response.ok) {
        const error = new Error(`SearXNG returned HTTP ${response.status}.`);
        error.code = 'searxng_error';
        error.status = 502;
        throw error;
    }
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const normalized = results
        .map((item, index) => normalizeSearxngResult(item, index))
        .filter(item => item.url && isFetchableHttpUrl(item.url))
        .slice(0, Math.max(options.maxResults * 3, options.maxResults));
    await cacheSet(cacheKey, normalized, DEFAULT_CACHE_TTL_SECONDS);
    return normalized;
}

function normalizeSearxngResult(item, index) {
    return {
        title: normalizeWhitespace(item?.title || ''),
        url: normalizeUrl(item?.url || ''),
        snippet: normalizeWhitespace(item?.content || item?.snippet || ''),
        source: normalizeWhitespace(item?.engine || item?.engines?.[0] || 'searxng'),
        position: index + 1,
        score: Math.max(0, 100 - index)
    };
}

function rankSearxngResults(results, query) {
    const queryTerms = new Set(normalizeWhitespace(query).toLowerCase().split(' ').filter(term => term.length > 2));
    return [...results]
        .map(item => {
            const haystack = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
            const termHits = [...queryTerms].filter(term => haystack.includes(term)).length;
            const url = safeUrl(item.url);
            const extensionPenalty = /\.(pdf|zip|rar|7z|mp4|mp3|avi|mov)(?:$|\?)/i.test(item.url) ? 25 : 0;
            return {
                ...item,
                score: item.score + termHits * 8 - extensionPenalty + (url?.protocol === 'https:' ? 2 : 0)
            };
        })
        .sort((a, b) => b.score - a.score);
}

async function fetchReadablePage(url, options) {
    const normalizedUrl = normalizeUrl(url);
    if (!isFetchableHttpUrl(normalizedUrl)) {
        return { ok: false, reason: 'unsupported_url' };
    }

    const cacheKey = `page:${stableHash(normalizedUrl)}:${options.textLimit}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    if (options.respectRobots) {
        const allowed = await isAllowedByRobots(normalizedUrl, options.userAgent, options.timeoutMs);
        if (!allowed) return { ok: false, reason: 'robots_disallowed' };
    }

    try {
        const response = await fetchWithTimeout(normalizedUrl, {
            timeoutMs: options.timeoutMs,
            redirect: 'follow',
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': options.userAgent
            }
        });
        if (!response.ok || [401, 402, 403, 407, 429].includes(response.status)) {
            return { ok: false, reason: `http_${response.status}` };
        }
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            return { ok: false, reason: 'non_html' };
        }
        const html = await response.text();
        const cleaned = extractReadableText(html, options.textLimit);
        if (!cleaned.text || cleaned.text.length < 120) return { ok: false, reason: 'empty_text' };
        const payload = { ok: true, ...cleaned };
        await cacheSet(cacheKey, payload, options.cacheTtlSeconds);
        return payload;
    } catch (error) {
        return { ok: false, reason: 'fetch_failed', detail: String(error?.message || '') };
    }
}

function extractReadableText(html, textLimit = MAX_TEXT_CHARS) {
    const raw = String(html || '');
    const title = decodeHtmlEntities(extractFirst(raw, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const description = decodeHtmlEntities(
        extractFirst(raw, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
        extractFirst(raw, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)
    );
    const article = extractFirst(raw, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
    const main = extractFirst(raw, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
    const source = article || main || raw;
    const withoutNoise = source
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
        .replace(/<(nav|footer|header|aside|form|button)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+class=["'][^"']*(cookie|consent|banner|advert|ad-|ads|promo|subscribe|newsletter|modal|sidebar|menu|breadcrumb|social|share)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ');
    const text = decodeHtmlEntities(withoutNoise)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, textLimit);
    return { title: normalizeWhitespace(title), description: normalizeWhitespace(description), text };
}

async function isAllowedByRobots(targetUrl, userAgent, timeoutMs) {
    const parsed = safeUrl(targetUrl);
    if (!parsed) return false;
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const cacheKey = `robots:${stableHash(robotsUrl)}`;
    const cached = await cacheGet(cacheKey);
    const robotsText = cached?.text ?? await fetchRobotsText(robotsUrl, userAgent, timeoutMs);
    if (!cached) await cacheSet(cacheKey, { text: robotsText }, ROBOTS_CACHE_TTL_SECONDS);
    if (!robotsText) return true;
    return robotsAllows(robotsText, parsed.pathname || '/', userAgent);
}

async function fetchRobotsText(robotsUrl, userAgent, timeoutMs) {
    try {
        const response = await fetchWithTimeout(robotsUrl, {
            timeoutMs: Math.min(timeoutMs, 3000),
            headers: { 'User-Agent': userAgent, Accept: 'text/plain' }
        });
        if (!response.ok) return '';
        return (await response.text()).slice(0, 200_000);
    } catch (_) {
        return '';
    }
}

function robotsAllows(robotsText, pathname, userAgent) {
    const uaTokens = [String(userAgent || '').split('/')[0].toLowerCase(), '*'].filter(Boolean);
    const groups = [];
    let current = null;
    for (const rawLine of String(robotsText || '').split(/\r?\n/)) {
        const line = rawLine.replace(/#.*/, '').trim();
        if (!line) continue;
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (!match) continue;
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim();
        if (key === 'user-agent') {
            current = { agents: [value.toLowerCase()], rules: [] };
            groups.push(current);
        } else if ((key === 'disallow' || key === 'allow') && current) {
            current.rules.push({ type: key, path: value });
        }
    }
    const matching = groups.filter(group => group.agents.some(agent => uaTokens.includes(agent)));
    if (!matching.length) return true;
    const rules = matching.flatMap(group => group.rules).filter(rule => rule.path);
    let winner = null;
    for (const rule of rules) {
        const prefix = rule.path.replace(/\*.*$/, '');
        if (pathname.startsWith(prefix) && (!winner || rule.path.length > winner.path.length)) {
            winner = rule;
        }
    }
    return winner ? winner.type !== 'disallow' : true;
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function cacheGet(key) {
    const now = Date.now();
    const memory = MEMORY_CACHE.get(key);
    if (memory && memory.expiresAt > now) return memory.value;
    if (memory) MEMORY_CACHE.delete(key);

    const redis = await redisGet(key);
    if (redis != null) return redis;

    try {
        const file = await readFile(cacheFilePath(key), 'utf8');
        const parsed = JSON.parse(file);
        if (parsed.expiresAt > now) {
            MEMORY_CACHE.set(key, parsed);
            return parsed.value;
        }
    } catch (_) {}
    return null;
}

async function cacheSet(key, value, ttlSeconds) {
    const entry = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
    MEMORY_CACHE.set(key, entry);
    await Promise.allSettled([
        writeFileCache(key, entry),
        redisSet(key, value, ttlSeconds)
    ]);
}

async function writeFileCache(key, entry) {
    try {
        const dir = join(tmpdir(), 'unify-web-search-cache');
        await mkdir(dir, { recursive: true });
        await writeFile(cacheFilePath(key), JSON.stringify(entry), 'utf8');
    } catch (_) {}
}

function cacheFilePath(key) {
    return join(tmpdir(), 'unify-web-search-cache', `${stableHash(key)}.json`);
}

async function redisGet(key) {
    const url = getRedisUrl();
    if (!url) return null;
    try {
        const value = await redisCommand(url, ['GET', key]);
        return value ? JSON.parse(value) : null;
    } catch (_) {
        return null;
    }
}

async function redisSet(key, value, ttlSeconds) {
    const url = getRedisUrl();
    if (!url) return;
    try {
        await redisCommand(url, ['SETEX', key, String(ttlSeconds), JSON.stringify(value)]);
    } catch (_) {}
}

function getRedisUrl() {
    return String(process.env.REDIS_URL || '').trim();
}

async function redisCommand(redisUrl, args) {
    const parsed = new URL(redisUrl);
    const secure = parsed.protocol === 'rediss:';
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) return null;
    const port = Number(parsed.port || (secure ? 6380 : 6379));
    const host = parsed.hostname;
    const password = decodeURIComponent(parsed.password || '');
    const username = decodeURIComponent(parsed.username || '');
    const db = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : '';
    const commands = [];
    if (password) commands.push(username ? ['AUTH', username, password] : ['AUTH', password]);
    if (db) commands.push(['SELECT', db]);
    commands.push(args);
    return await new Promise((resolve, reject) => {
        const socket = secure ? tls.connect({ host, port }) : net.connect({ host, port });
        let buffer = Buffer.alloc(0);
        let responses = 0;
        let finalValue = null;
        const finish = () => {
            socket.end();
            resolve(finalValue);
        };
        socket.setTimeout(1500);
        socket.on('connect', () => {
            socket.write(commands.map(encodeRedisCommand).join(''));
        });
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            let parsedResponse;
            while ((parsedResponse = parseRedisResponse(buffer))) {
                buffer = parsedResponse.rest;
                responses += 1;
                finalValue = parsedResponse.value;
                if (responses >= commands.length) finish();
            }
        });
        socket.on('timeout', () => reject(new Error('redis_timeout')));
        socket.on('error', reject);
    });
}

function encodeRedisCommand(args) {
    return `*${args.length}\r\n${args.map(arg => {
        const value = String(arg);
        return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
    }).join('')}`;
}

function parseRedisResponse(buffer) {
    if (!buffer.length) return null;
    const type = String.fromCharCode(buffer[0]);
    const lineEnd = buffer.indexOf('\r\n');
    if (lineEnd < 0) return null;
    const line = buffer.subarray(1, lineEnd).toString('utf8');
    if (type === '+' || type === ':') return { value: line, rest: buffer.subarray(lineEnd + 2) };
    if (type === '-') throw new Error(line);
    if (type === '$') {
        const length = Number(line);
        if (length < 0) return { value: null, rest: buffer.subarray(lineEnd + 2) };
        const start = lineEnd + 2;
        const end = start + length;
        if (buffer.length < end + 2) return null;
        return { value: buffer.subarray(start, end).toString('utf8'), rest: buffer.subarray(end + 2) };
    }
    return null;
}

function checkRateLimit(clientKey) {
    const now = Date.now();
    const bucket = RATE_LIMITS.get(clientKey) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    if (bucket.resetAt <= now) {
        bucket.count = 0;
        bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }
    bucket.count += 1;
    RATE_LIMITS.set(clientKey, bucket);
    return {
        allowed: bucket.count <= RATE_LIMIT_MAX,
        retryAfterMs: Math.max(0, bucket.resetAt - now)
    };
}

function getClientKey(req) {
    return String(
        req?.headers?.['x-forwarded-for'] ||
        req?.headers?.['x-real-ip'] ||
        req?.socket?.remoteAddress ||
        'local'
    ).split(',')[0].trim();
}

function getSearxngUrl(override) {
    const value = String(override || process.env.SEARXNG_URL || '').trim();
    if (!value) return '';
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString().replace(/\/$/, '');
    } catch (_) {
        return '';
    }
}

function normalizeUrl(value) {
    const parsed = safeUrl(value);
    if (!parsed) return '';
    parsed.hash = '';
    return parsed.toString();
}

function isFetchableHttpUrl(value) {
    const parsed = safeUrl(value);
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return false;
    if (/^(10|127|169\.254|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(host)) return false;
    return true;
}

function safeUrl(value) {
    try {
        return new URL(String(value || '').trim());
    } catch (_) {
        return null;
    }
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function stableHash(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

function extractFirst(value, pattern) {
    const match = String(value || '').match(pattern);
    return match?.[1] || '';
}

function decodeHtmlEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16) || 32));
}

function maskEndpoint(value) {
    const parsed = safeUrl(value);
    return parsed ? parsed.origin : '';
}

export const __test = {
    extractReadableText,
    normalizeSearchRequest,
    robotsAllows,
    rankSearxngResults,
    isFetchableHttpUrl
};
