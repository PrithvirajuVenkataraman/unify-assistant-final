import { getLatestSources } from './latest-sources.js';
import { saveItems } from './latest-cache.js';

const DEFAULT_TIMEOUT_MS = 5000;

export async function ingestLatestSources(options = {}) {
    const sources = Array.isArray(options.sources) ? options.sources : getLatestSources();
    const settled = await Promise.allSettled(sources.map(source => fetchFeed(source, options)));
    const items = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const saved = saveItems(items);
    return {
        success: true,
        fetchedSourceCount: settled.filter(result => result.status === 'fulfilled').length,
        failedSourceCount: settled.filter(result => result.status === 'rejected').length,
        itemCount: items.length,
        saved
    };
}

export async function fetchFeed(source, options = {}) {
    const response = await fetchWithTimeout(source.url, {
        headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            'User-Agent': 'UnifyAssistantLatestCache/1.0'
        }
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    if (!response.ok) return [];
    const xml = await response.text();
    return parseFeed(xml, source);
}

export function parseFeed(xml, source = {}) {
    const text = String(xml || '');
    const rssItems = extractBlocks(text, 'item');
    const atomItems = rssItems.length ? [] : extractBlocks(text, 'entry');
    return (rssItems.length ? rssItems : atomItems)
        .map(block => normalizeArticle(block, source, atomItems.length > 0))
        .filter(item => item.title && item.url);
}

function normalizeArticle(block, source, isAtom) {
    const title = decodeXml(firstTag(block, 'title'));
    const url = isAtom
        ? firstAtomLink(block) || decodeXml(firstTag(block, 'id'))
        : decodeXml(firstTag(block, 'link'));
    const summary = decodeXml(firstTag(block, isAtom ? 'summary' : 'description') || firstTag(block, 'content'));
    const publishedAt = decodeXml(firstTag(block, 'pubDate') || firstTag(block, 'published') || firstTag(block, 'updated'));
    return {
        id: url,
        title,
        url,
        summary: stripTags(summary).slice(0, 500),
        source: source.name || source.id || '',
        sourceId: source.id || '',
        publishedAt,
        fetchedAt: new Date().toISOString()
    };
}

function extractBlocks(xml, tag) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const blocks = [];
    let match;
    while ((match = pattern.exec(xml))) {
        blocks.push(match[1]);
    }
    return blocks;
}

function firstTag(block, tag) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(block || '').match(new RegExp(`<(?:[a-z]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${escaped}>`, 'i'));
    return match?.[1] || '';
}

function firstAtomLink(block) {
    const match = String(block || '').match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    return decodeXml(match?.[1] || '');
}

function stripTags(value) {
    return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
    return String(value || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
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

export const __test = {
    normalizeArticle,
    extractBlocks,
    firstTag
};
