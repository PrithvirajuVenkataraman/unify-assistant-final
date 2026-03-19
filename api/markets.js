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
