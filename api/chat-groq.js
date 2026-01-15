// RATE_LIMIT: simple in-memory per-IP throttle for api/chat-groq
// Note: In serverless, memory can reset between invocations. This still protects against tight loops.
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
    const perSec = checkRateLimit(req, { windowMs: 1000, max: 1 });
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
    console.log('🚀 JARVIS API called (Groq)');
    
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
        const { message, systemPrompt } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const API_KEY = process.env.GROQ_API_KEY;
        
        if (!API_KEY) {
            console.error('GROQ_API_KEY not found!');
            return res.status(200).json({ 
                response: 'Groq API key not configured. Get free key at: https://console.groq.com/keys'
            });
        }
        
        console.log('Groq API Key found');
        
        // Use Llama 3.3 70B (free, fast, smart!)
        const MODEL = 'llama-3.3-70b-versatile';
        
        console.log(`🚀 Calling Groq with ${MODEL}`);
        
        const requestBody = {
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: (systemPrompt || 'You are JARVIS, a helpful AI assistant.') + `

CRITICAL FORMAT RULES:
- When asked for hotel recommendations, you MUST respond in this EXACT format:
HOTEL: [Name]
DESC: [Description]
PRICE: [Budget/Mid-range/Luxury]
FOOD: [Pure Veg/Non-Veg/Both]
SPECIALTY: [Dish]
WHY: [Reason]
---

- Extract the EXACT city mentioned and only recommend hotels in THAT city
- Do NOT recommend hotels from nearby cities
- If user asks for "Chidambaram", only give Chidambaram hotels, NOT Puducherry
- Be precise about the city location`
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            temperature: 0.5,
            max_tokens: 4096,
            top_p: 0.9,
            stream: false  // Serverless functions don't support streaming well
        };
        
        const response = await fetch(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify(requestBody)
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Groq API Error:', errorData.error?.message);
            return res.status(200).json({ 
                response: `Groq API Error: ${errorData.error?.message || 'Unknown error'}`
            });
        }
        
        const data = await response.json();
        console.log('SUCCESS - Got response from Groq');
        
        const aiText = data.choices?.[0]?.message?.content;
        
        if (!aiText) {
            console.error('No text in response');
            return res.status(200).json({ 
                response: 'No response from AI. Please try again.'
            });
        }
        
        return res.status(200).json({
            response: aiText.trim(),
            model: MODEL
        });
        
    } catch (error) {
        console.error('Critical Error:', error.message);
        return res.status(200).json({ 
            response: `Error: ${error.message}`
        });
    }
}
