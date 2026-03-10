import { runVerifiedWebSearch } from './_lib/live-search.js';

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
        const query = String(req.body?.query || '').trim();
        const category = String(req.body?.category || '').trim();
        const city = String(req.body?.city || '').trim();
        const countryCode = String(req.body?.countryCode || '').trim();

        const topic = query || category || (city ? `${city} news` : 'latest news');
        const queries = [
            topic,
            `latest ${topic}`,
            `${topic} Reuters OR AP OR BBC OR Al Jazeera`
        ];
        if (!query && city) queries.push(`${city} breaking news`);
        if (!query && countryCode && countryCode !== 'DEFAULT') queries.push(`${countryCode} national news`);

        const [verified, rssArticles] = await Promise.all([
            runVerifiedWebSearch(queries, {
                maxResultsPerQuery: 6,
                limit: 10
            }),
            fetchGoogleNewsRss(topic)
        ]);

        if (rssArticles.length) {
            return res.status(200).json({
                success: true,
                verified: true,
                query: topic,
                sourceCount: rssArticles.length,
                distinctDomainCount: 1,
                trustedCount: rssArticles.length,
                articles: rssArticles
            });
        }

        if (!verified.results.length) {
            return res.status(200).json({
                success: true,
                verified: false,
                query: topic,
                sourceCount: 0,
                distinctDomainCount: 0,
                trustedCount: 0,
                articles: []
            });
        }

        return res.status(200).json({
            success: true,
            verified: true,
            query: topic,
            sourceCount: verified.results.length,
            distinctDomainCount: verified.distinctDomains.length,
            trustedCount: verified.trustedCount,
            articles: verified.results.map(item => ({
                title: item.title,
                url: item.url,
                description: item.description
            }))
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'news lookup failed',
            details: String(error?.message || error)
        });
    }
}

async function fetchGoogleNewsRss(topic) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml'
        }
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) && items.length < 8) {
        const block = match[1];
        const title = decodeXml(getTag(block, 'title'));
        const link = decodeXml(getTag(block, 'link'));
        const description = decodeXml(stripHtml(getTag(block, 'description')));
        if (!title || !link) continue;
        items.push({
            title: cleanGoogleNewsTitle(title),
            url: link,
            description: description || title
        });
    }
    return items;
}

function getTag(block, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    return regex.exec(block)?.[1] || '';
}

function stripHtml(input) {
    return String(input || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(input) {
    return String(input || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanGoogleNewsTitle(title) {
    return String(title || '').replace(/\s+-\s+[^-]+$/, '').trim();
}
