const __rateLimitStore = new Map();
function requireAppKey(req, res) {
    const expected = process.env.APP_API_KEY;
    if (!expected) return true; // optional. If set in Vercel, it will be enforced.
    const provided = req.headers['x-app-key'];
    if (provided && String(provided) === String(expected)) return true;
    res.status(401).json({ error: 'Unauthorized' });
    return false;
}


function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
    if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
    return (req.socket && req.socket.remoteAddress) ? req.socket.remoteAddress : 'unknown';
}

function checkRateLimit(req, { windowMs, max }) {
    const ip = getClientIp(req);
    const now = Date.now();
    const key = `${ip}:${windowMs}`;

    const entry = __rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
        __rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true };
    }

    if (entry.count >= max) {
        const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        return { ok: false, retryAfterSec };
    }

    entry.count += 1;
    __rateLimitStore.set(key, entry);
    return { ok: true };
}

function enforceRateLimits(req, res) {
    // Burst control
    const perSec = checkRateLimit(req, { windowMs: 1000, max: 2 });
    if (!perSec.ok) {
        res.setHeader('Retry-After', String(perSec.retryAfterSec));
        res.setHeader('X-RateLimit-Policy', '2/second');
        res.status(429).json({ error: 'Rate limit exceeded. Try again in a moment.' });
        return false;
    }

    // Sustained control
    const perMin = checkRateLimit(req, { windowMs: 60_000, max: 60 });
    if (!perMin.ok) {
        res.setHeader('Retry-After', String(perMin.retryAfterSec));
        res.setHeader('X-RateLimit-Policy', '60/minute');
        res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
        return false;
    }

    return true;
}

export default async function handler(req, res) {
    if (!requireAppKey(req, res)) return;
    console.log('🔍 Brave Search API called');
    
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Throttle to protect free tier and prevent accidental loops
    if (!enforceRateLimits(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { query } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        
        const API_KEY = process.env.BRAVE_SEARCH_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ BRAVE_SEARCH_API_KEY not found!');
            return res.status(200).json({ 
                results: [],
                error: 'Search API key not configured'
            });
        }
        
        console.log(`🔍 Searching: ${query}`);
        
        // Call Brave Search API
        const response = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
            {
                method: 'GET',
                headers: { 
                    'Accept': 'application/json',
                    'X-Subscription-Token': API_KEY
                }
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Brave Search Error:', errorData);
            return res.status(200).json({ 
                results: [],
                error: 'Search failed'
            });
        }
        
        const data = await response.json();
        console.log('✅ Search results received');
        
        // Extract relevant info
        const results = data.web?.results?.slice(0, 5).map(r => ({
            title: r.title,
            description: r.description,
            url: r.url
        })) || [];
        
        return res.status(200).json({
            results: results,
            query: query
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return res.status(200).json({ 
            results: [],
            error: error.message
        });
    }
}
