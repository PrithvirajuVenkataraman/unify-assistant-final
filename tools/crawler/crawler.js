import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CRAWLER_USER_AGENT = 'JarvisCrawler/1.0 (+https://jarvisjr.vercel.app)';
export const DEFAULT_INDEX_FILE = 'crawler-index.jsonl';
export const DEFAULT_SEED_URLS = Object.freeze([
    'https://www.isro.gov.in/',
    'https://www.nasa.gov/',
    'https://www.reuters.com/',
    'https://www.bbc.com/news',
    'https://apnews.com/',
    'https://www.cdc.gov/',
    'https://www.nih.gov/',
    'https://www.noaa.gov/'
]);

const BINARY_EXTENSIONS = /\.(?:7z|avi|bmp|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|m4a|m4v|mov|mp3|mp4|mpeg|ods|odt|ogg|pdf|png|pptx?|rar|rss|svg|tar|ttf|webm|webp|woff2?|xlsx?|xml|zip)(?:[?#].*)?$/i;
const MAX_TEXT_LENGTH = 24_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_200_000;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_DEPTH = 1;
const DEFAULT_MAX_LINKS_PER_PAGE = 12;
const DEFAULT_DOMAIN_DELAY_MS = 1_000;

export function parseSeedUrls(value = '') {
    const configured = String(value || '')
        .split(/[\n,]/)
        .map(item => normalizeCrawlUrl(item))
        .filter(Boolean);
    return configured.length ? configured : [...DEFAULT_SEED_URLS];
}

export function normalizeCrawlUrl(input = '', baseUrl = '') {
    try {
        const parsed = new URL(String(input || '').trim(), baseUrl || undefined);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        parsed.hash = '';
        parsed.username = '';
        parsed.password = '';
        if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
            parsed.port = '';
        }
        parsed.hostname = parsed.hostname.toLowerCase();
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

export function getDomainFromUrl(url = '') {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

export function isLikelyBinaryUrl(url = '') {
    return BINARY_EXTENSIONS.test(String(url || '').split('?')[0]);
}

export function isSameDomainLink(sourceUrl = '', candidateUrl = '') {
    const sourceDomain = getDomainFromUrl(sourceUrl);
    const candidateDomain = getDomainFromUrl(candidateUrl);
    return Boolean(sourceDomain && candidateDomain && sourceDomain === candidateDomain);
}

export function extractLinks(html = '', baseUrl = '', options = {}) {
    const maxLinks = clampInt(options.maxLinks, DEFAULT_MAX_LINKS_PER_PAGE, 1, 100);
    const links = [];
    const seen = new Set();
    const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) && links.length < maxLinks) {
        const normalized = normalizeCrawlUrl(decodeHtml(match[2]), baseUrl);
        if (!normalized || seen.has(normalized) || isLikelyBinaryUrl(normalized)) continue;
        if (options.sameDomainOnly !== false && !isSameDomainLink(baseUrl, normalized)) continue;
        seen.add(normalized);
        links.push(normalized);
    }
    return links;
}

export function extractHtmlMetadata(html = '', url = '') {
    const source = String(html || '');
    const title = cleanText(firstMatch(source, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const description = cleanText(
        firstMatch(source, /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*(["'])(.*?)\1/i, 2) ||
        firstMatch(source, /<meta\b[^>]*\bcontent\s*=\s*(["'])(.*?)\1[^>]*\bname\s*=\s*["']description["']/i, 2) ||
        firstMatch(source, /<meta\b[^>]*\bproperty\s*=\s*["']og:description["'][^>]*\bcontent\s*=\s*(["'])(.*?)\1/i, 2)
    );
    const canonicalUrl = normalizeCrawlUrl(
        firstMatch(source, /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*(["'])(.*?)\1/i, 2) ||
        firstMatch(source, /<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*\bcontent\s*=\s*(["'])(.*?)\1/i, 2) ||
        url,
        url
    );
    const publishedAt = cleanText(
        firstMatch(source, /<meta\b[^>]*\bproperty\s*=\s*["']article:published_time["'][^>]*\bcontent\s*=\s*(["'])(.*?)\1/i, 2) ||
        firstMatch(source, /<meta\b[^>]*\bname\s*=\s*["'](?:date|pubdate|publishdate)["'][^>]*\bcontent\s*=\s*(["'])(.*?)\1/i, 2) ||
        firstMatch(source, /<time\b[^>]*\bdatetime\s*=\s*(["'])(.*?)\1/i, 2)
    );
    return { title, description, canonicalUrl, publishedAt };
}

export function stripHtmlToText(html = '') {
    return cleanText(String(html || '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
    ).slice(0, MAX_TEXT_LENGTH);
}

export function parseRobotsTxt(text = '') {
    const groups = [];
    let current = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.replace(/#.*/, '').trim();
        if (!line) continue;
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (key === 'user-agent') {
            current = { agents: [value.toLowerCase()], rules: [] };
            groups.push(current);
        } else if (current && (key === 'allow' || key === 'disallow')) {
            current.rules.push({ type: key, path: value });
        }
    }
    return groups;
}

export function isAllowedByRobots(url = '', robotsGroups = [], userAgent = CRAWLER_USER_AGENT) {
    let path = '/';
    try {
        const parsed = new URL(url);
        path = `${parsed.pathname || '/'}${parsed.search || ''}`;
    } catch (_) {
        return false;
    }

    const agent = String(userAgent || '').toLowerCase();
    const matching = robotsGroups
        .filter(group => group.agents.some(item => item === '*' || agent.includes(item)))
        .flatMap(group => group.rules)
        .filter(rule => rule.path !== '');
    if (!matching.length) return true;

    let winner = null;
    for (const rule of matching) {
        if (!robotPathMatches(path, rule.path)) continue;
        if (!winner || rule.path.length > winner.path.length) winner = rule;
    }
    return !winner || winner.type !== 'disallow';
}

export function createCrawlerDocumentId(url = '') {
    return createHash('sha256').update(String(url || '')).digest('hex');
}

export function contentHash(text = '') {
    return createHash('sha256').update(String(text || '').replace(/\s+/g, ' ').trim()).digest('hex');
}

export function buildCrawlerDocument({ url, html, fetchedAt = new Date().toISOString(), trusted = false } = {}) {
    const normalizedUrl = normalizeCrawlUrl(url);
    const metadata = extractHtmlMetadata(html, normalizedUrl);
    const canonicalUrl = metadata.canonicalUrl || normalizedUrl;
    const text = stripHtmlToText(html);
    const description = metadata.description || text.slice(0, 220);
    return {
        id: createCrawlerDocumentId(canonicalUrl || normalizedUrl),
        url: normalizedUrl,
        canonicalUrl,
        domain: getDomainFromUrl(canonicalUrl || normalizedUrl),
        title: metadata.title || getDomainFromUrl(normalizedUrl) || normalizedUrl,
        description,
        text,
        publishedAt: metadata.publishedAt,
        fetchedAt,
        trusted: Boolean(trusted),
        contentHash: contentHash(text)
    };
}

export async function crawlSeeds(options = {}) {
    const seeds = (options.seeds || parseSeedUrls(process.env.CRAWLER_SEED_URLS)).map(url => normalizeCrawlUrl(url)).filter(Boolean);
    const maxPages = clampInt(options.maxPages, DEFAULT_MAX_PAGES, 1, 1000);
    const maxDepth = clampInt(options.maxDepth, DEFAULT_MAX_DEPTH, 0, 5);
    const maxLinksPerPage = clampInt(options.maxLinksPerPage, DEFAULT_MAX_LINKS_PER_PAGE, 1, 100);
    const domainDelayMs = clampInt(options.domainDelayMs, DEFAULT_DOMAIN_DELAY_MS, 0, 60_000);
    const minTextLength = clampInt(options.minTextLength, 280, 1, 5000);
    const queue = seeds.map(url => ({ url, depth: 0 }));
    const visited = new Set();
    const robotsCache = new Map();
    const lastDomainFetch = new Map();
    const documents = [];

    while (queue.length && visited.size < maxPages) {
        const item = queue.shift();
        const url = normalizeCrawlUrl(item?.url || '');
        if (!url || visited.has(url) || isLikelyBinaryUrl(url)) continue;
        visited.add(url);

        const domain = getDomainFromUrl(url);
        const robots = await getRobotsForUrl(url, robotsCache, options);
        if (!isAllowedByRobots(url, robots, options.userAgent || CRAWLER_USER_AGENT)) continue;
        await waitForDomainDelay(domain, lastDomainFetch, domainDelayMs);

        const page = await fetchCrawlerPage(url, options).catch(() => null);
        if (!page?.html) continue;
        const document = buildCrawlerDocument({
            url: page.url || url,
            html: page.html,
            fetchedAt: new Date().toISOString(),
            trusted: Boolean(options.trustedDomains?.includes(domain))
        });
        if (document.text.length >= minTextLength) documents.push(document);

        if (item.depth >= maxDepth) continue;
        for (const link of extractLinks(page.html, page.url || url, { maxLinks: maxLinksPerPage })) {
            if (!visited.has(link)) queue.push({ url: link, depth: item.depth + 1 });
        }
    }

    if (options.index !== false && documents.length) {
        await upsertLocalIndex(documents, options);
    }
    return { documents, crawledCount: visited.size };
}

export function getIndexFilePath(options = {}) {
    return path.resolve(String(options.indexFile || process.env.CRAWLER_INDEX_FILE || DEFAULT_INDEX_FILE));
}

export async function readLocalIndex(options = {}) {
    const filePath = getIndexFilePath(options);
    const text = await fs.readFile(filePath, 'utf8').catch(error => {
        if (error?.code === 'ENOENT') return '';
        throw error;
    });
    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

export async function upsertLocalIndex(documents = [], options = {}) {
    const filePath = getIndexFilePath(options);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const existing = new Map();
    for (const item of await readLocalIndex(options)) {
        if (item?.id) existing.set(item.id, item);
    }
    for (const item of documents) {
        if (item?.id) existing.set(item.id, item);
    }
    const output = Array.from(existing.values())
        .map(item => JSON.stringify(item))
        .join('\n');
    await fs.writeFile(filePath, output ? `${output}\n` : '', 'utf8');
    return { indexedDocuments: documents.length, totalDocuments: existing.size, indexFile: filePath };
}

export function searchLocalIndex(documents = [], query = '', options = {}) {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const limit = clampInt(options.limit, 8, 1, 50);
    return documents
        .map(item => ({ item, score: scoreDocument(item, terms) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || String(b.item.fetchedAt || '').localeCompare(String(a.item.fetchedAt || '')))
        .slice(0, limit)
        .map((entry, index) => ({
            title: String(entry.item.title || '').trim(),
            description: String(entry.item.description || entry.item.text || '').replace(/\s+/g, ' ').trim().slice(0, 320),
            url: String(entry.item.canonicalUrl || entry.item.url || '').trim(),
            domain: String(entry.item.domain || getDomainFromUrl(entry.item.url)).trim(),
            source: String(entry.item.domain || 'crawler_index').trim(),
            date: String(entry.item.publishedAt || entry.item.fetchedAt || '').trim(),
            position: index + 1,
            trusted: Boolean(entry.item.trusted),
            score: entry.score,
            query
        }));
}

async function getRobotsForUrl(url, cache, options) {
    let origin = '';
    try {
        const parsed = new URL(url);
        origin = parsed.origin;
    } catch (_) {
        return [];
    }
    if (cache.has(origin)) return cache.get(origin);
    const robotsUrl = `${origin}/robots.txt`;
    const text = await fetchTextWithLimit(robotsUrl, {
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxBytes: 160_000,
        userAgent: options.userAgent || CRAWLER_USER_AGENT
    }).catch(() => '');
    const parsed = parseRobotsTxt(text);
    cache.set(origin, parsed);
    return parsed;
}

async function fetchCrawlerPage(url, options = {}) {
    const response = await fetchWithTimeout(url, {
        headers: {
            'User-Agent': options.userAgent || CRAWLER_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml'
        },
        redirect: 'follow'
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || !contentType.includes('text/html')) return null;
    const html = await readResponseTextWithLimit(response, options.maxBytes || DEFAULT_MAX_BYTES);
    return { url: response.url || url, html };
}

async function fetchTextWithLimit(url, options = {}) {
    const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': options.userAgent || CRAWLER_USER_AGENT },
        redirect: 'follow'
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    if (!response.ok) return '';
    return readResponseTextWithLimit(response, options.maxBytes || DEFAULT_MAX_BYTES);
}

async function readResponseTextWithLimit(response, maxBytes) {
    const reader = response.body?.getReader?.();
    if (!reader) {
        const text = await response.text();
        return text.slice(0, maxBytes);
    }
    const chunks = [];
    let total = 0;
    while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        chunks.push(chunk);
    }
    const combined = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
        const slice = chunk.slice(0, Math.max(0, maxBytes - offset));
        combined.set(slice, offset);
        offset += slice.byteLength;
        if (offset >= maxBytes) break;
    }
    return new TextDecoder().decode(combined);
}

async function waitForDomainDelay(domain, lastDomainFetch, delayMs) {
    if (!delayMs || !domain) return;
    const last = lastDomainFetch.get(domain) || 0;
    const waitMs = Math.max(0, delayMs - (Date.now() - last));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastDomainFetch.set(domain, Date.now());
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

function firstMatch(text, pattern, group = 1) {
    const match = pattern.exec(text);
    return match?.[group] ? decodeHtml(match[group]) : '';
}

function cleanText(text = '') {
    return decodeHtml(String(text || ''))
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeHtml(text = '') {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []));
}

function scoreDocument(item, terms) {
    const title = String(item?.title || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    const domain = String(item?.domain || '').toLowerCase();
    const text = String(item?.text || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (title.includes(term)) score += 8;
        if (description.includes(term)) score += 4;
        if (domain.includes(term)) score += 3;
        if (text.includes(term)) score += 1;
    }
    if (item?.trusted) score += 2;
    return score;
}

function robotPathMatches(path, rulePath) {
    const cleanRule = String(rulePath || '').replace(/\*/g, '.*');
    if (!cleanRule) return false;
    try {
        return new RegExp(`^${cleanRule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.\*/g, '.*')}`).test(path);
    } catch (_) {
        return path.startsWith(String(rulePath || ''));
    }
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}
