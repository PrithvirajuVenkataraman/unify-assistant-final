import { runVerifiedWebSearch } from './live-search.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const query = String(req.body?.query || '').trim();
        if (!query) {
            return res.status(400).json({ success: false, error: 'query is required' });
        }

        const profile = inferCommodityProfile(query);
        const queries = buildCommodityQueries(query, profile);
        const verified = await runVerifiedWebSearch(queries, {
            maxResultsPerQuery: 5,
            limit: 10
        });

        const priceInfo = extractPriceFromResults(verified.results, profile);

        return res.status(200).json({
            success: verified.results.length > 0,
            verified: verified.results.length > 0,
            provider: 'web-verified-commodity',
            assetType: 'commodity',
            commodityType: profile.kind,
            commodity: profile.label,
            unit: profile.unit,
            price: priceInfo.price,
            currency: priceInfo.currency,
            sourceCount: verified.results.length,
            distinctDomainCount: verified.distinctDomains.length,
            sources: verified.results.slice(0, 6).map(item => ({
                title: item.title,
                url: item.url,
                description: item.description
            }))
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'commodity lookup failed',
            details: String(error?.message || error)
        });
    }
}

function inferCommodityProfile(query) {
    const t = String(query || '').toLowerCase();
    if (/\bpetrol|gasoline\b/.test(t)) {
        return { kind: 'fuel', label: 'Petrol', token: 'petrol', unit: 'per litre' };
    }
    if (/\bdiesel\b/.test(t)) {
        return { kind: 'fuel', label: 'Diesel', token: 'diesel', unit: 'per litre' };
    }
    if (/\bgold\b/.test(t)) {
        return { kind: 'metal', label: 'Gold', token: 'gold', unit: 'per ounce' };
    }
    if (/\bsilver\b/.test(t)) {
        return { kind: 'metal', label: 'Silver', token: 'silver', unit: 'per ounce' };
    }
    if (/\bplatinum\b/.test(t)) {
        return { kind: 'metal', label: 'Platinum', token: 'platinum', unit: 'per ounce' };
    }
    if (/\bdiamond\b/.test(t)) {
        return { kind: 'gem', label: 'Diamond', token: 'diamond', unit: 'market quote' };
    }
    return { kind: 'commodity', label: 'Commodity', token: 'commodity', unit: 'market quote' };
}

function buildCommodityQueries(rawQuery, profile) {
    const q = String(rawQuery || '').trim();
    if (profile.kind === 'fuel') {
        return [
            `${profile.token} price today India`,
            `${profile.token} price today IOCL HPCL BPCL`,
            `${profile.token} price per litre Bloomberg Reuters`,
            q
        ];
    }

    if (profile.kind === 'metal' || profile.kind === 'gem') {
        return [
            `${profile.token} price today`,
            `${profile.token} spot price Bloomberg Reuters`,
            `${profile.token} price today kitco investing.com`,
            q
        ];
    }

    return [
        `${q} latest price today`,
        `${q} price Bloomberg Reuters`,
        q
    ];
}

function extractPriceFromResults(results, profile) {
    const pool = Array.isArray(results) ? results : [];
    for (const item of pool.slice(0, 8)) {
        const haystack = `${item?.title || ''} ${item?.description || ''}`;
        const parsed = extractPriceCandidate(haystack, profile);
        if (parsed) return parsed;
    }
    return { price: null, currency: '' };
}

function extractPriceCandidate(text, profile) {
    const body = String(text || '').replace(/\s+/g, ' ').trim();
    if (!body) return null;

    const inrMatch = body.match(/(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]+)?)/i);
    if (inrMatch?.[1]) {
        const value = parseNumber(inrMatch[1]);
        if (isPlausiblePrice(value, profile)) return { price: value, currency: 'INR' };
    }

    const usdMatch = body.match(/(?:usd|us\$|\$)\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]+)?)/i);
    if (usdMatch?.[1]) {
        const value = parseNumber(usdMatch[1]);
        if (isPlausiblePrice(value, profile)) return { price: value, currency: 'USD' };
    }

    return null;
}

function parseNumber(raw) {
    const value = Number(String(raw || '').replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
}

function isPlausiblePrice(value, profile) {
    if (!Number.isFinite(value) || value <= 0) return false;
    if (profile.kind === 'fuel') return value >= 10 && value <= 1000;
    if (profile.kind === 'metal') return value >= 1 && value <= 100000;
    if (profile.kind === 'gem') return value >= 1 && value <= 1000000;
    return value >= 1 && value <= 1000000;
}
