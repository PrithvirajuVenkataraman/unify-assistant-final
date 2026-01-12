// ========================================
// Unify Voice Assistant - Secure API Endpoint
// File: api/chat.js (Place this in api/ folder)
// Vercel Serverless Function
// ========================================

export default async function handler(req, res) {
    // ========== CORS Configuration ==========
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // ========== Method Validation ==========
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Method not allowed',
            message: 'Only POST requests are accepted'
        });
    }
    
    try {
        // ========== Request Validation ==========
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Message parameter is required'
            });
        }
        
        if (typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Message must be a string'
            });
        }
        
        if (message.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Message cannot be empty'
            });
        }
        
        if (message.length > 10000) {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Message too long (max 10000 characters)'
            });
        }
        
        // ========== Environment Variable ==========
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        
        if (!GEMINI_API_KEY) {
            console.error('❌ GEMINI_API_KEY environment variable not set');
            return res.status(500).json({ 
                error: 'Configuration error',
                message: 'API key not configured. Please add GEMINI_API_KEY to Vercel environment variables.'
            });
        }
        
        // ========== Call Gemini API ==========
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: message
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048,
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
        
        // ========== Handle Gemini Errors ==========
        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('❌ Gemini API error:', {
                status: geminiResponse.status,
                statusText: geminiResponse.statusText,
                error: errorText
            });
            
            // Check for specific errors
            if (geminiResponse.status === 429) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'Too many requests. Please try again in a moment.'
                });
            }
            
            if (geminiResponse.status === 401 || geminiResponse.status === 403) {
                return res.status(500).json({
                    error: 'API authentication error',
                    message: 'Invalid API key. Please check your configuration.'
                });
            }
            
            return res.status(geminiResponse.status).json({ 
                error: 'AI service error',
                message: 'Failed to get response from AI service',
                details: geminiResponse.statusText
            });
        }
        
        // ========== Parse Response ==========
        const data = await geminiResponse.json();
        
        // Extract response text
        let responseText = '';
        
        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
            
            // Check for content filtering
            if (candidate.finishReason === 'SAFETY') {
                return res.status(400).json({
                    error: 'Content filtered',
                    message: 'Response was filtered due to safety settings. Please try rephrasing your question.'
                });
            }
            
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                responseText = candidate.content.parts[0].text;
            }
        }
        
        // Validate response
        if (!responseText || responseText.trim().length === 0) {
            console.error('❌ Empty response from Gemini:', JSON.stringify(data, null, 2));
            return res.status(500).json({ 
                error: 'Empty response',
                message: 'AI returned an empty response. Please try again.'
            });
        }
        
        // ========== Success Response ==========
        return res.status(200).json({
            response: responseText.trim(),
            model: 'gemini-1.5-flash',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        // ========== Error Handling ==========
        console.error('❌ Server error:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Check for network errors
        if (error.name === 'FetchError' || error.message.includes('fetch')) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Unable to reach AI service. Please try again later.'
            });
        }
        
        // Generic error response
        return res.status(500).json({ 
            error: 'Internal server error',
            message: 'An unexpected error occurred. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// ========================================
