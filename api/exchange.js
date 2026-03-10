import { runVerifiedWebSearch } from './_lib/live-search.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const from = String(req.body?.from || '').trim().toUpperCase();
        const to = String(req.body?.to || '').trim().toUpperCase();
        const amount = Number(req.body?.amount || 1);
        const date = String(req.body?.date || '').trim();

        if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
            return res.status(400).json({ error: 'Valid 3-letter currency codes are required.' });
        }

        const endpoint = date
            ? `https://api.frankfurter.dev/v1/${encodeURIComponent(date)}?base=${from}&symbols=${to}`
            : `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`;
        const response = await fetch(endpoint);
        if (!response.ok) {
            return res.status(502).json({ error: 'Exchange provider unavailable.' });
        }
        const data = await response.json();
        const rate = Number(data?.rates?.[to]);
        if (!Number.isFinite(rate)) {
            return res.status(502).json({ error: 'Exchange rate unavailable.' });
        }

        const verified = await runVerifiedWebSearch([
            `${from} ${to} exchange rate today`,
            `${from} to ${to} rate xe oanda x-rates`,
            `${from} ${to} exchange rate Reuters OR ECB`
        ], {
            maxResultsPerQuery: 4,
            limit: 8
        });

        return res.status(200).json({
            success: true,
            verified: true,
            provider: 'frankfurter',
            date: data?.date || date || null,
            from,
            to,
            amount,
            rate,
            convertedAmount: amount * rate,
            sourceCount: verified.results.length,
            distinctDomainCount: verified.distinctDomains.length,
            sources: verified.results.slice(0, 5).map(item => ({
                title: item.title,
                url: item.url,
                description: item.description
            }))
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'exchange lookup failed',
            details: String(error?.message || error)
        });
    }
}
