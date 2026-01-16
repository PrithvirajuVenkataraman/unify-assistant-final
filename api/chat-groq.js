// RATE_LIMIT: simple in-memory per-IP throttle for api/chat-groq
const __rateLimitStore = new Map();

function requireAppKey(req, res) {
    const expected = process.env.APP_API_KEY;
    if (!expected) return true;
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
    const perSec = checkRateLimit(req, { windowMs: 1000, max: 2 });
    if (!perSec.ok) {
        res.setHeader('Retry-After', String(perSec.retryAfterSec));
        res.setHeader('X-RateLimit-Policy', '2/second');
        res.status(429).json({ error: 'Rate limit exceeded. Try again in a moment.' });
        return false;
    }

    const perMin = checkRateLimit(req, { windowMs: 60_000, max: 60 });
    if (!perMin.ok) {
        res.setHeader('Retry-After', String(perMin.retryAfterSec));
        res.setHeader('X-RateLimit-Policy', '60/minute');
        res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
        return false;
    }

    return true;
}

// Default JARVIS system prompt
const DEFAULT_SYSTEM_PROMPT = `You are JARVIS, a helpful AI voice assistant inspired by Iron Man's AI.

PERSONALITY:
- Be helpful, witty, and slightly formal (like the movie JARVIS)
- Use the user's name naturally if provided
- Be concise but thorough

CRITICAL FORMAT RULES FOR HOTELS:
When asked for hotel recommendations, respond in this EXACT format:
HOTEL: [Name]
DESC: [One-line description]
PRICE: [Budget/Mid-range/Luxury]
FOOD: [Pure Veg/Non-Veg/Both]
SPECIALTY: [Must-try dish]
WHY: [Why recommended]
---

LOCATION RULES:
- Extract the EXACT city mentioned and only recommend hotels in THAT city
- Do NOT recommend hotels from nearby cities
- If user asks for "Chidambaram", only give Chidambaram hotels, NOT Puducherry
- Be precise about the city location

GENERAL RULES:
- Keep responses concise for voice reading
- Use natural conversational language
- Avoid excessive formatting (no ** bold markers)
- Use simple bullet points with dashes when needed`;

export default async function handler(req, res) {
    if (!requireAppKey(req, res)) return;
    
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Key');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (!enforceRateLimits(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { message, systemPrompt, userName } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const API_KEY = process.env.GROQ_API_KEY;
        
        if (!API_KEY) {
            return res.status(200).json({ 
                response: "I'm having trouble connecting to my brain right now. Please check that the Groq API key is configured.",
                error: 'GROQ_API_KEY not configured'
            });
        }
        
        // Build the system prompt
        let finalSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
        
        // Add user name context if provided
        if (userName) {
            finalSystemPrompt = `The user's name is ${userName}. Use their name naturally and occasionally.\n\n` + finalSystemPrompt;
        }
        
        const MODEL = 'llama-3.3-70b-versatile';
        
        const requestBody = {
            model: MODEL,
            messages: [
                { role: 'system', content: finalSystemPrompt },
                { role: 'user', content: message }
            ],
            temperature: 0.5,
            max_tokens: 4096,
            top_p: 0.9,
            stream: false
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
            return res.status(200).json({ 
                response: `I encountered an issue: ${errorData.error?.message || 'Unknown error'}. Please try again.`,
                error: errorData.error?.message
            });
        }
        
        const data = await response.json();
        const aiText = data.choices?.[0]?.message?.content;
        
        if (!aiText) {
            return res.status(200).json({ 
                response: "I didn't get a proper response. Please try again.",
                error: 'Empty response'
            });
        }
        
        return res.status(200).json({
            response: aiText.trim(),
            model: MODEL
        });
        
    } catch (error) {
        return res.status(200).json({ 
            response: `I encountered an error: ${error.message}. Please try again.`,
            error: error.message
        });
    }
}
