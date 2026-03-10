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

        const verified = await runVerifiedWebSearch(queries, {
            maxResultsPerQuery: 6,
            limit: 10
        });

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
