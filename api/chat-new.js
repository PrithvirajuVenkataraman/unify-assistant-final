// Vercel Edge Function - v2.0 - NEW MODELS
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
    console.log('🚀 Edge function v2.0 called - NEW MODELS');
    
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        });
    }
    
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const { message, systemPrompt } = await req.json();
        
        if (!message) {
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GEMINI_API_KEY not found!');
            return new Response(JSON.stringify({ 
                response: 'API key not configured. Check Vercel environment variables.',
                intent: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        console.log('✅ API Key found');
        
        // NEW MODELS - Will try each until one works
        const MODELS_TO_TRY = [
            'gemini-2.0-flash-exp',
            'gemini-exp-1206',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b',
            'gemini-1.5-pro'
        ];
        
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
        
        let response;
        let lastError;
        let workingModel = null;
        
        // Try v1 API first (supports experimental models), then v1beta
        const API_VERSIONS = ['v1', 'v1beta'];
        
        for (const apiVersion of API_VERSIONS) {
            for (const MODEL of MODELS_TO_TRY) {
                console.log(`🧪 Trying: ${apiVersion}/models/${MODEL}`);
                
                try {
                    response = await fetch(
                        `https://generativelanguage.googleapis.com/${apiVersion}/models/${MODEL}:generateContent?key=${API_KEY}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody)
                        }
                    );
                    
                    if (response.ok) {
                        workingModel = MODEL;
                        console.log(`✅ SUCCESS with ${apiVersion}/models/${MODEL}`);
                        break;
                    } else {
                        const errorData = await response.json();
                        lastError = errorData;
                        console.log(`❌ ${MODEL} failed:`, errorData.error?.message);
                    }
                } catch (err) {
                    console.log(`❌ ${MODEL} error:`, err.message);
                    lastError = err;
                }
            }
            
            if (workingModel) break; // Found working model, stop trying
        }
        
        if (!workingModel) {
            console.error('❌ ALL MODELS FAILED');
            return new Response(JSON.stringify({ 
                response: `All models failed. Last error: ${lastError?.error?.message || 'Unknown'}`,
                intent: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const data = await response.json();
        
        let aiText = '';
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            aiText = data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Invalid API response structure');
        }
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText
            };
        }
        
        return new Response(JSON.stringify(parsedResponse), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        
        return new Response(JSON.stringify({ 
            response: "Error: " + error.message,
            intent: 'error'
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
