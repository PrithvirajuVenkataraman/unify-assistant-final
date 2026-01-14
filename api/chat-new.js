// ========================================
// JARVIS - Serverless Function (Node.js)
// File: api/chat-new.js
// ========================================

export default async function handler(req, res) {
    console.log('🚀 JARVIS API called');
    
    // Handle CORS
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
        const { message, systemPrompt: customSystemPrompt, userName } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GEMINI_API_KEY not found!');
            return res.status(200).json({ 
                response: 'API key not configured. Check Vercel environment variables.'
            });
        }
        
        console.log('✅ API Key found');
        
        // Use custom system prompt if provided, otherwise use JARVIS default
        const systemPrompt = customSystemPrompt || `You are JARVIS (Just A Rather Very Intelligent System), an AI assistant inspired by Iron Man's AI. Be sophisticated, helpful, and professional with a touch of British wit.

RESPONSE STYLE RULES:

For TRAVEL PLANNING (itineraries, trip plans, destinations):
- Be COMPREHENSIVE and DETAILED
- Include day-by-day breakdowns
- Suggest specific places, restaurants, activities
- Add timing and practical tips
- Make it complete and actionable

For EVERYTHING ELSE (jokes, facts, weather, calculations, questions):
- Be CONCISE - NO preambles like "Sure!", "Alright!", "Let me tell you"
- Get STRAIGHT to the answer
- Keep under 3 sentences unless specifically asked for more
- For jokes: just tell the joke immediately
- For facts: just state the fact
- Occasionally add subtle British sophistication`;
        
        // Use fastest and most reliable model
        const MODEL = 'gemini-2.0-flash-exp';
        const API_VERSION = 'v1alpha';
        
        const requestBody = {
            contents: [{
                parts: [{
                    text: systemPrompt + '\n\nUser message: ' + message
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4850,
                candidateCount: 1
            }
        };
        
        console.log(`🚀 Using: ${API_VERSION}/models/${MODEL}`);
        
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL}:generateContent?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                }
            );
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ API Error:', errorData);
                return res.status(200).json({ 
                    response: `I'm having trouble connecting to my AI. Please try again in a moment!`,
                    model: 'error'
                });
            }
            
            const data = await response.json();
            console.log(`✅ SUCCESS with ${MODEL}`);
            
            // Extract response text
            let responseText = '';
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                responseText = data.candidates[0].content.parts[0].text;
            } else {
                throw new Error('Invalid API response structure');
            }
            
            return res.status(200).json({
                response: responseText.trim(),
                model: MODEL
            });
            
        } catch (error) {
            console.error('Error:', error);
            return res.status(200).json({ 
                response: "I'm having trouble connecting to my AI. Please try again in a moment!",
                model: 'error'
            });
        }
    } catch (error) {
        console.error('CRITICAL Error:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        return res.status(200).json({ 
            response: `I'm having trouble connecting to my AI. Error: ${error.message}`,
            model: 'error',
            debug: error.stack
        });
    }
}
