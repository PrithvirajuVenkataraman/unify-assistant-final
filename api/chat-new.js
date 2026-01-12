// ========================================
// Unify Voice Assistant - Optimized API Endpoint
// File: api/chat.js
// ========================================

export default async function handler(req, res) {
    // CORS Configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Method not allowed',
            message: 'Only POST requests are accepted'
        });
    }
    
    try {
        // Request Validation
        const { message } = req.body;
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Valid message is required'
            });
        }
        
        if (message.length > 10000) {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Message too long (max 10000 characters)'
            });
        }
        
        // Get API Key
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        
        if (!GEMINI_API_KEY) {
            console.error('❌ GEMINI_API_KEY not set');
            return res.status(500).json({ 
                error: 'Configuration error',
                message: 'API key not configured'
            });
        }
        
        // ========== SMART SYSTEM PROMPT ==========
        // Concise for most things, detailed for travel planning
        const systemPrompt = `You are Unify, a helpful voice assistant. Be natural and friendly.

RESPONSE STYLE RULES:

For TRAVEL PLANNING (itineraries, trip plans, destinations):
- Be COMPREHENSIVE and DETAILED
- Include day-by-day breakdowns
- Suggest specific places, restaurants, activities
- Add timing and practical tips
- Make it complete and actionable

For EVERYTHING ELSE (jokes, facts, weather, calculations, questions):
- Be CONCISE - NO preambles like "Sure!", "Alright!", "Let me tell you", "Here's a joke"
- Get STRAIGHT to the answer
- Keep under 3 sentences unless specifically asked for more
- For jokes: just tell the joke immediately
- For facts: just state the fact

User: ${message}`;
        
        // Call Gemini API
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: systemPrompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048,  // Enough for detailed itineraries
                    stopSequences: []
                },
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ]
            })
        });
        
        // Handle API Errors
        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('❌ Gemini API error:', geminiResponse.status, errorText);
            
            if (geminiResponse.status === 429) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'Too many requests. Please try again in a moment.'
                });
            }
            
            if (geminiResponse.status === 401 || geminiResponse.status === 403) {
                return res.status(500).json({
                    error: 'API authentication error',
                    message: 'Invalid API key'
                });
            }
            
            return res.status(geminiResponse.status).json({ 
                error: 'AI service error',
                message: 'Failed to get response from AI service'
            });
        }
        
        // Parse Response
        const data = await geminiResponse.json();
        let responseText = '';
        
        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
            
            // Check for content filtering
            if (candidate.finishReason === 'SAFETY') {
                return res.status(400).json({
                    error: 'Content filtered',
                    message: 'Response filtered due to safety settings. Please rephrase.'
                });
            }
            
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                responseText = candidate.content.parts[0].text;
            }
        }
        
        // Validate response
        if (!responseText || responseText.trim().length === 0) {
            console.error('❌ Empty response from Gemini');
            return res.status(500).json({ 
                error: 'Empty response',
                message: 'AI returned empty response. Please try again.'
            });
        }
        
        // Success Response
        return res.status(200).json({
            response: responseText.trim(),
            model: 'gemini-1.5-flash',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Server error:', error.message);
        
        if (error.name === 'FetchError' || error.message.includes('fetch')) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Unable to reach AI service'
            });
        }
        
        return res.status(500).json({ 
            error: 'Internal server error',
            message: 'An unexpected error occurred'
        });
    }
}
