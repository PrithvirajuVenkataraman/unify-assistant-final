import net from 'node:net';
import { applyApiSecurity } from '../security.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_TEXT_LIMIT = 12000;
const MAX_TEXT_LIMIT = 40000;
const MAX_URL_LENGTH = 2048;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MEMORY_CACHE = new Map();

export default async function extractUrlHandler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'extract-url',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 20, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const normalized = normalizeExtractRequest(req.body || {});
    if (!normalized.ok) {
        return res.status(400).json({
            success: false,
            error: { code: normalized.code || 'invalid_request', message: normalized.error },
            result: null
        });
    }

    try {
        const result = await extractWithCrawl4Ai(normalized.value);
        return res.status(200).json({
            success: true,
            result
        });
    } catch (error) {
        const status = Number(error?.status) || 502;
        return res.status(status).json({
            success: false,
            error: {
                code: String(error?.code || 'crawl4ai_failed'),
                message: String(error?.publicMessage || error?.message || 'Crawl4AI extraction failed.'),
                retryable: error?.retryable !== false
            },
            result: null
        });
    }
}

export async function extractWithCrawl4Ai(options = {}) {
    const normalized = normalizeExtractRequest(options);
    if (!normalized.ok) {
        throw createExtractError({
            code: normalized.code || 'invalid_request',
            status: 400,
            publicMessage: normalized.error,
            retryable: false
        });
    }

    const baseUrl = getCrawl4AiUrl(options.crawl4aiUrl);
    if (!baseUrl) {
        throw createExtractError({
            code: 'crawl4ai_not_configured',
            status: 503,
            publicMessage: 'Crawl4AI extraction is not configured. Set CRAWL4AI_URL to enable shared Docker extraction.',
            retryable: false
        });
    }

    const request = normalized.value;
    const cacheKey = buildCacheKey(baseUrl, request);
    const cached = cacheGet(cacheKey);
    if (cached) return { ...cached, cached: true };

    const endpoint = buildCrawl4AiEndpoint(baseUrl);
    let response;
    try {
        response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: buildHeaders(options.token),
            body: JSON.stringify(buildCrawl4AiPayload(request))
        }, request.timeoutMs);
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        throw createExtractError({
            code: aborted ? 'crawl4ai_timeout' : 'crawl4ai_network_error',
            status: aborted ? 504 : 502,
            publicMessage: aborted
                ? 'Crawl4AI extraction timed out.'
                : 'Crawl4AI extraction service could not be reached.',
            retryable: true
        });
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw createExtractError({
            code: response.status === 401 || response.status === 403
                ? 'crawl4ai_auth_failed'
                : response.status === 429
                    ? 'crawl4ai_rate_limited'
                    : 'crawl4ai_upstream_error',
            status: response.status === 429 ? 429 : 502,
            upstreamStatus: response.status,
            publicMessage: buildUpstreamMessage(response.status, detail),
            retryable: response.status >= 500 || response.status === 429
        });
    }

    const data = await response.json().catch(() => ({}));
    const result = normalizeCrawl4AiResult(data, request.url, request);
    if (!result.markdown && !result.text) {
        throw createExtractError({
            code: 'crawl4ai_empty_result',
            status: 502,
            publicMessage: 'Crawl4AI returned no readable content.',
            retryable: true
        });
    }
    cacheSet(cacheKey, result);
    return result;
}

export function normalizeExtractRequest(body = {}) {
    const url = normalizeUrl(body.url || body.href || body.sourceUrl || '');
    if (!url) return { ok: false, code: 'invalid_url', error: 'A valid http or https URL is required.' };
    const safety = validatePublicHttpUrl(url);
    if (!safety.ok) return { ok: false, code: safety.code, error: safety.message };
    const textLimit = clampInt(body.textLimit || body.maxChars, DEFAULT_TEXT_LIMIT, 1000, MAX_TEXT_LIMIT);
    return {
        ok: true,
        value: {
            url,
            query: String(body.query || '').replace(/\s+/g, ' ').trim().slice(0, 500),
            textLimit,
            timeoutMs: clampInt(body.timeoutMs, DEFAULT_TIMEOUT_MS, 3000, 30000),
            respectRobots: body.respectRobots !== false
        }
    };
}

export function normalizeCrawl4AiResult(data, originalUrl, request = {}) {
    const payload = data?.result && typeof data.result === 'object' ? data.result : data;
    const markdown = firstString(
        payload?.markdown,
        payload?.markdown_v2?.raw_markdown,
        payload?.markdownV2?.rawMarkdown,
        payload?.fit_markdown,
        payload?.content?.markdown
    );
    const text = firstString(
        payload?.text,
        payload?.cleaned_text,
        payload?.cleanedText,
        payload?.extracted_content,
        payload?.content?.text,
        markdown ? stripMarkdown(markdown) : ''
    ).slice(0, request.textLimit || DEFAULT_TEXT_LIMIT);
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const title = firstString(payload?.title, metadata.title, payload?.page_title, getHost(originalUrl) || originalUrl);
    const description = firstString(payload?.description, metadata.description, payload?.excerpt, text.slice(0, 220));
    return {
        title: title.slice(0, 220),
        url: normalizeUrl(payload?.url || payload?.source_url || originalUrl),
        description: description.replace(/\s+/g, ' ').trim().slice(0, 320),
        markdown: markdown.slice(0, request.textLimit || DEFAULT_TEXT_LIMIT),
        text,
        sourceType: 'crawl4ai_extract',
        fetchedAt: new Date().toISOString(),
        warnings: Array.from(new Set([
            ...(Array.isArray(payload?.warnings) ? payload.warnings.map(String) : []),
            'Crawl4AI is optional shared Docker extraction, not broad web search.'
        ])),
        cached: false
    };
}

function buildCrawl4AiEndpoint(baseUrl) {
    try {
        const parsed = new URL(baseUrl);
        if (/\/(?:crawl|extract|arun|api\/crawl)\/?$/i.test(parsed.pathname)) return parsed.toString();
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/crawl`;
        return parsed.toString();
    } catch (_) {
        return baseUrl;
    }
}

function buildCrawl4AiPayload(request) {
    return {
        url: request.url,
        urls: [request.url],
        query: request.query || undefined,
        crawler_config: {
            cache_mode: 'enabled',
            word_count_threshold: 10,
            excluded_tags: ['script', 'style', 'noscript', 'iframe']
        },
        browser_config: {
            headless: true
        },
        extraction_strategy: 'markdown',
        markdown: true,
        only_text: false,
        respect_robots_txt: request.respectRobots
    };
}

function buildHeaders(tokenOverride) {
    const token = String(tokenOverride || process.env.CRAWL4AI_TOKEN || '').trim();
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function getCrawl4AiUrl(override) {
    const value = String(override || process.env.CRAWL4AI_URL || '').trim();
    if (!value) return '';
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString().replace(/\/$/, '');
    } catch (_) {
        return '';
    }
}

function validatePublicHttpUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        return { ok: false, code: 'invalid_url', message: 'A valid http or https URL is required.' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, code: 'unsupported_url_protocol', message: 'Only http and https URLs can be extracted.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local')) {
        return { ok: false, code: 'private_url_blocked', message: 'Local and private URLs cannot be extracted.' };
    }
    if (net.isIP(host) && isPrivateIp(host)) {
        return { ok: false, code: 'private_url_blocked', message: 'Local and private URLs cannot be extracted.' };
    }
    if (/^(10|127|169\.254|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(host)) {
        return { ok: false, code: 'private_url_blocked', message: 'Local and private URLs cannot be extracted.' };
    }
    return { ok: true };
}

function isPrivateIp(host) {
    if (host === '::1') return true;
    if (/^fc|^fd/i.test(host)) return true;
    return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
}

function normalizeUrl(value) {
    const raw = String(value || '').trim().slice(0, MAX_URL_LENGTH);
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        parsed.hash = '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function createExtractError({ code, status, upstreamStatus, publicMessage, retryable }) {
    const error = new Error(publicMessage);
    error.code = code;
    error.status = status;
    error.upstreamStatus = upstreamStatus;
    error.publicMessage = publicMessage;
    error.retryable = retryable;
    return error;
}

function buildUpstreamMessage(status, detail = '') {
    const clean = String(detail || '').replace(/\s+/g, ' ').replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').trim().slice(0, 180);
    if (status === 401 || status === 403) return `Crawl4AI rejected the request or token${clean ? `: ${clean}` : '.'}`;
    if (status === 429) return `Crawl4AI is rate limited${clean ? `: ${clean}` : '.'}`;
    return `Crawl4AI returned an upstream error${status ? ` (${status})` : ''}${clean ? `: ${clean}` : '.'}`;
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function cacheGet(key) {
    const item = MEMORY_CACHE.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
        MEMORY_CACHE.delete(key);
        return null;
    }
    return item.value;
}

function cacheSet(key, value) {
    MEMORY_CACHE.set(key, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

function buildCacheKey(baseUrl, request) {
    return `${baseUrl}|${request.url}|${request.textLimit}|${request.respectRobots}`;
}

function firstString(...values) {
    for (const value of values) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text) return text;
    }
    return '';
}

function stripMarkdown(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[#>*_`~\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getHost(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export const __test = {
    buildCrawl4AiEndpoint,
    buildCrawl4AiPayload,
    normalizeCrawl4AiResult,
    normalizeExtractRequest,
    validatePublicHttpUrl
};
