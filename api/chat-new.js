// Regular Vercel Serverless Function (Node.js)
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
        const { message, systemPrompt } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GEMINI_API_KEY not found!');
            return res.status(200).json({ 
                response: 'API key not configured. Please check Vercel environment variables.'
            });
        }
        
        console.log('✅ API Key found');
        
        // Use cheapest model (FREE tier: 15 RPM, 1500 RPD, 1.5M tokens/day)
        // gemini-2.0-flash-lite is cheapest at $0.075 input / $0.30 output
        const MODEL = 'gemini-2.0-flash-lite';
        const API_VERSION = 'v1beta';
        
        console.log(`🚀 Calling: ${API_VERSION}/models/${MODEL}`);
        
        const requestBody = {
            contents: [{
                parts: [{
                    text: (systemPrompt || '') + '\n\nUser: ' + message
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4850
            }
        };
        
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
            console.error('❌ Gemini API Error:', errorData.error?.message);
            return res.status(200).json({ 
                response: `Gemini API Error: ${errorData.error?.message || 'Unknown error'}`
            });
        }
        
        const data = await response.json();
        console.log('✅ SUCCESS - Got response from Gemini');
        
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!aiText) {
            console.error('❌ No text in response');
            return res.status(200).json({ 
                response: 'No response from AI. Please try again.'
            });
        }
        
        return res.status(200).json({
            response: aiText.trim()
        });
        
    } catch (error) {
        console.error('❌ Critical Error:', error.message);
        return res.status(200).json({ 
            response: `Error: ${error.message}`
        });
    }
}
