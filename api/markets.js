import { runVerifiedWebSearch } from './live-search.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const query = String(req.body?.query || '').trim();
        const hintedType = String(req.body?.assetType || '').trim().toLowerCase();
        const inferredType = hintedType || inferAssetType(query);

        if (inferredType === 'crypto') {
            const crypto = await lookupCrypto(query);
            return res.status(200).json(crypto);
        }
        if (inferredType === 'commodity') {
            const commodity = await lookupCommodity(query);
            return res.status(200).json(commodity);
        }

        const stock = await lookupStock(query);
        return res.status(200).json(stock);
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'market lookup failed',
            details: String(error?.message || error)
        });
    }
}

function inferAssetType(query) {
    const t = String(query || '').toLowerCase();
    if (/\b(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|crypto|coin|token)\b/.test(t)) {
        return 'crypto';
    }
    if (/\b(gold|silver|platinum|diamond|palladium|petrol|diesel|gasoline|crude|brent|wti|commodity|fuel)\b/.test(t)) {
        return 'commodity';
    }
    return 'stock';
}

async function lookupCrypto(query) {
    const searchResponse = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
    if (!searchResponse.ok) {
        return { success: false, error: 'crypto provider unavailable' };
    }
    const searchData = await searchResponse.json();
    const coin = Array.isArray(searchData?.coins) ? searchData.coins[0] : null;
    if (!coin?.id) {
        return { success: false, error: 'crypto asset not found' };
    }

    const priceResponse = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin.id)}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`);
    if (!priceResponse.ok) {
        return { success: false, error: 'crypto price unavailable' };
    }
    const priceData = await priceResponse.json();
    const coinData = priceData?.[coin.id] || {};

    const verified = await runVerifiedWebSearch([
        `${coin.name} price today`,
        `${coin.symbol} crypto price coindesk cointelegraph`,
        `${coin.name} market update latest`
    ], {
        maxResultsPerQuery: 4,
        limit: 8
    });

    return {
        success: true,
        verified: true,
        provider: 'coingecko',
        assetType: 'crypto',
        symbol: String(coin.symbol || '').toUpperCase(),
        name: coin.name,
        priceUsd: Number(coinData.usd),
        change24h: Number(coinData.usd_24h_change),
        lastUpdatedAt: coinData.last_updated_at || null,
        sourceCount: verified.results.length,
        distinctDomainCount: verified.distinctDomains.length,
        sources: verified.results.slice(0, 5).map(item => ({
            title: item.title,
            url: item.url,
            description: item.description
        }))
    };
}

async function lookupStock(query) {
    const symbol = inferTicker(query);
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;

    if (alphaKey && symbol) {
        const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${alphaKey}`);
        if (response.ok) {
            const data = await response.json();
            const quote = data?.['Global Quote'];
            const price = Number(quote?.['05. price']);
            if (Number.isFinite(price)) {
                const verified = await runVerifiedWebSearch([
                    `${symbol} stock price today`,
                    `${symbol} Reuters MarketWatch price`,
                    `${symbol} market update latest`
                ], {
                    maxResultsPerQuery: 4,
                    limit: 8
                });

                return {
                    success: true,
                    verified: true,
                    provider: 'alpha-vantage',
                    assetType: 'stock',
                    symbol,
                    price,
                    change: Number(quote?.['09. change']),
                    changePercent: quote?.['10. change percent'] || '',
                    tradingDay: quote?.['07. latest trading day'] || null,
                    sourceCount: verified.results.length,
                    distinctDomainCount: verified.distinctDomains.length,
                    sources: verified.results.slice(0, 5).map(item => ({
                        title: item.title,
                        url: item.url,
                        description: item.description
                    }))
                };
            }
        }
    }

    const verified = await runVerifiedWebSearch([
        `${query} stock price today`,
        `${query} market update Reuters Bloomberg CNBC`,
        `${query} latest stock news`
    ], {
        maxResultsPerQuery: 5,
        limit: 10
    });

    return {
        success: verified.results.length > 0,
        verified: verified.results.length > 0,
        provider: alphaKey ? 'web-fallback' : 'web-fallback-no-stock-api-key',
        assetType: 'stock',
        symbol: symbol || '',
        sourceCount: verified.results.length,
        distinctDomainCount: verified.distinctDomains.length,
        sources: verified.results.slice(0, 6).map(item => ({
            title: item.title,
            url: item.url,
            description: item.description
        }))
    };
}

function inferTicker(query) {
    const upper = String(query || '').toUpperCase().trim();
    const match = upper.match(/\b[A-Z]{1,5}\b/);
    return match ? match[0] : '';
}

async function lookupCommodity(query) {
    const profile = inferCommodityProfile(query);
    const verified = await runVerifiedWebSearch(buildCommodityQueries(query, profile), {
        maxResultsPerQuery: 5,
        limit: 10
    });
    const extracted = extractPriceFromResults(verified.results, profile);

    return {
        success: verified.results.length > 0,
        verified: verified.results.length > 0,
        provider: 'web-verified-commodity',
        assetType: 'commodity',
        commodityType: profile.kind,
        symbol: profile.token.toUpperCase(),
        name: profile.label,
        unit: profile.unit,
        price: extracted.price,
        currency: extracted.currency,
        sourceCount: verified.results.length,
        distinctDomainCount: verified.distinctDomains.length,
        sources: verified.results.slice(0, 6).map(item => ({
            title: item.title,
            url: item.url,
            description: item.description
        }))
    };
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
