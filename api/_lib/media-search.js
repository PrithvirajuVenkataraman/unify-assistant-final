import { applyApiSecurity } from './security.js';

const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 6;
const VISUAL_TOPIC_PATTERN = /\b(?:show|picture|pictures|image|images|photo|photos|diagram|visual|look like|what does|tell me about|explain|places to visit|tourist|travel|food|recipe|guitar|chord|map|monument|temple|museum|animal|plant|bird|car|bike|phone|product|planet|space|science|anatomy|history|person|city|country)\b/i;
const NON_VISUAL_PATTERN = /\b(?:code|debug|error|essay|poem|story|translate|calculate|math proof|grammar|rewrite)\b/i;

export default async function mediaSearchHandler(req, res) {
    const security = applyApiSecurity(req, res, {
        routeKey: 'media-search',
        rateLimit: { max: 45, windowMs: 60 * 1000 },
        maxBodyBytes: 32 * 1024
    });
    if (security.handled) return;

    const normalized = normalizeMediaRequest(req.body);
    if (!normalized.ok) {
        return res.status(400).json({
            success: false,
            error: {
                code: normalized.code,
                message: normalized.message
            }
        });
    }

    try {
        const result = await searchPublicMedia(normalized.value);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        const status = error?.code === 'media_timeout' ? 504 : 502;
        return res.status(status).json({
            success: false,
            error: {
                code: String(error?.code || 'media_search_failed'),
                message: String(error?.publicMessage || error?.message || 'Media search failed.')
            }
        });
    }
}

export async function searchPublicMedia(request) {
    const query = normalizeQuery(request?.query);
    const limit = clampInt(request?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const visual = classifyVisualMediaIntent(query);
    if (!visual.shouldSearch) {
        return {
            query,
            sourceType: 'public_media',
            provider: 'wikimedia',
            images: [],
            warnings: [visual.reason]
        };
    }

    const [wikipedia, commons] = await Promise.allSettled([
        searchWikipediaPageImages(query, { limit, timeoutMs: request.timeoutMs }),
        searchCommonsImages(query, { limit, timeoutMs: request.timeoutMs })
    ]);

    const images = dedupeImages([
        ...(wikipedia.status === 'fulfilled' ? wikipedia.value : []),
        ...(commons.status === 'fulfilled' ? commons.value : [])
    ]).slice(0, limit);

    const warnings = [
        'Images come from Wikimedia/Wikipedia public media where available.',
        'License and attribution are preserved when the source exposes them.'
    ];
    if (!images.length) warnings.push('No suitable public image was found for this topic.');

    return {
        query,
        sourceType: 'public_media',
        provider: 'wikimedia',
        images,
        warnings,
        fetchedAt: new Date().toISOString()
    };
}

export function normalizeMediaRequest(body = {}) {
    const query = normalizeQuery(body?.query || body?.topic);
    if (!query || query.length < 2) {
        return { ok: false, code: 'invalid_query', message: 'Provide a media search query.' };
    }
    return {
        ok: true,
        value: {
            query,
            limit: clampInt(body?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
            timeoutMs: clampInt(body?.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 12000)
        }
    };
}

export function classifyVisualMediaIntent(query) {
    const text = normalizeQuery(query);
    if (!text) return { shouldSearch: false, reason: 'empty_query' };
    if (NON_VISUAL_PATTERN.test(text) && !/\b(?:diagram|visual|image|picture|photo)\b/i.test(text)) {
        return { shouldSearch: false, reason: 'non_visual_request' };
    }
    if (VISUAL_TOPIC_PATTERN.test(text)) {
        return { shouldSearch: true, reason: 'visual_topic' };
    }
    const tokenCount = text.split(/\s+/).filter(Boolean).length;
    return {
        shouldSearch: tokenCount >= 2 && tokenCount <= 8,
        reason: tokenCount >= 2 && tokenCount <= 8 ? 'compact_topic' : 'low_visual_confidence'
    };
}

async function searchWikipediaPageImages(query, options = {}) {
    const url = new URL(WIKIPEDIA_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrlimit', String(Math.min(options.limit || DEFAULT_LIMIT, 5)));
    url.searchParams.set('prop', 'pageimages|info');
    url.searchParams.set('pithumbsize', '900');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const data = await fetchJson(url, options);
    const pages = Object.values(data?.query?.pages || {});
    return pages
        .map(page => {
            const thumbnail = String(page?.thumbnail?.source || '').trim();
            if (!thumbnail) return null;
            return normalizeImage({
                title: page.title,
                url: thumbnail,
                thumbnail,
                pageUrl: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title || '').replace(/\s+/g, '_'))}`,
                source: 'Wikipedia',
                license: 'See source page',
                attribution: 'Wikipedia contributors'
            });
        })
        .filter(Boolean);
}

async function searchCommonsImages(query, options = {}) {
    const searchUrl = new URL(COMMONS_API_URL);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('generator', 'search');
    searchUrl.searchParams.set('gsrnamespace', '6');
    searchUrl.searchParams.set('gsrsearch', `${query} filetype:bitmap`);
    searchUrl.searchParams.set('gsrlimit', String(Math.min(options.limit || DEFAULT_LIMIT, 6)));
    searchUrl.searchParams.set('prop', 'imageinfo|info');
    searchUrl.searchParams.set('iiprop', 'url|mime|extmetadata');
    searchUrl.searchParams.set('iiurlwidth', '900');
    searchUrl.searchParams.set('inprop', 'url');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');

    const data = await fetchJson(searchUrl, options);
    const pages = Object.values(data?.query?.pages || {});
    return pages
        .map(page => {
            const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
            const mime = String(info?.mime || '').toLowerCase();
            if (mime && !mime.startsWith('image/')) return null;
            const metadata = info?.extmetadata || {};
            const thumbnail = firstString(info?.thumburl, info?.url);
            const url = firstString(info?.url, thumbnail);
            if (!url) return null;
            return normalizeImage({
                title: String(page?.title || '').replace(/^File:/i, ''),
                url,
                thumbnail,
                pageUrl: page.fullurl || '',
                source: 'Wikimedia Commons',
                license: stripHtml(firstString(metadata?.LicenseShortName?.value, metadata?.License?.value, 'See source page')),
                attribution: stripHtml(firstString(metadata?.Artist?.value, metadata?.Credit?.value, 'Wikimedia Commons contributors'))
            });
        })
        .filter(Boolean);
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), clampInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 12000));
    try {
        const response = await fetch(url.toString(), {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'JARVISAssistant/1.0 public-media-search'
            },
            signal: controller.signal
        });
        if (!response.ok) {
            const error = new Error(`Media source returned ${response.status}.`);
            error.code = 'media_source_failed';
            error.publicMessage = 'The public media source failed.';
            throw error;
        }
        return await response.json();
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutError = new Error('Media search timed out.');
            timeoutError.code = 'media_timeout';
            timeoutError.publicMessage = 'Media search timed out.';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeImage(image) {
    const url = firstString(image.url, image.thumbnail);
    const thumbnail = firstString(image.thumbnail, image.url);
    if (!isSafePublicImageUrl(url) || !isSafePublicImageUrl(thumbnail)) return null;
    return {
        title: String(image.title || 'Public image').trim().slice(0, 140),
        url,
        thumbnail,
        pageUrl: firstString(image.pageUrl, url),
        source: String(image.source || 'Wikimedia').trim(),
        license: String(image.license || 'See source page').trim().slice(0, 120),
        attribution: String(image.attribution || image.source || 'Wikimedia contributors').trim().slice(0, 200),
        sourceType: 'public_media'
    };
}

function dedupeImages(images) {
    const seen = new Set();
    const out = [];
    for (const image of images) {
        if (!image?.url) continue;
        const key = image.url.replace(/\?.*$/, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(image);
    }
    return out;
}

function isSafePublicImageUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' &&
            /(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/i.test(url.hostname);
    } catch (_) {
        return false;
    }
}

function normalizeQuery(value) {
    return String(value || '')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\b(?:please|can you|could you|would you|tell me about|explain|show me|show|pictures?|images?|photos?|diagram|visuals?)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function firstString(...values) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function clampInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

export const __test = {
    classifyVisualMediaIntent,
    normalizeMediaRequest,
    normalizeQuery,
    isSafePublicImageUrl
};
