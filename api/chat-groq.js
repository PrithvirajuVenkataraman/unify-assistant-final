// Vercel Serverless Function for Gemini AI
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { message, userName, systemPrompt: clientSystemPrompt, ragContext, context } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Get API key from environment variable
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return res.status(500).json({
                error: 'API key not configured',
                details: 'Set GEMINI_API_KEY in your server environment.'
            });
        }
        
        const systemPrompt = clientSystemPrompt || buildServerSystemPrompt(userName);
        const contextBlock = Array.isArray(context)
            ? context
                .slice(-20)
                .map(m => `${m?.role === 'user' ? 'User' : 'Assistant'}: ${String(m?.text || '')}`)
                .join('\n')
            : '';
        const ragBlock = typeof ragContext === 'string' ? ragContext.trim() : '';
        const finalPrompt = [
            systemPrompt,
            ragBlock ? `Retrieved context (RAG):\n${ragBlock}` : '',
            contextBlock ? `Recent turns:\n${contextBlock}` : '',
            `User message: ${message}`
        ].filter(Boolean).join('\n\n');

        const configuredModel = String(process.env.GEMINI_MODEL || '').trim();
        const modelCandidates = [
            configuredModel,
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash'
        ].filter(Boolean);

        let data = null;
        let modelUsed = null;
        let lastErrorDetail = '';
        const triedModels = [];

        for (const model of modelCandidates) {
            triedModels.push(model);
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: finalPrompt
                            }]
                        }],
                        generationConfig: {
                            temperature: 0.7,
                            topK: 40,
                            topP: 0.95,
                            maxOutputTokens: 2500,
                        }
                    })
                }
            );

            if (response.ok) {
                data = await response.json();
                modelUsed = model;
                break;
            }

            const bodyText = await response.text().catch(() => '');
            lastErrorDetail = `model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
        }

        if (!data) {
            return res.status(502).json({
                error: 'AI service temporarily unavailable',
                details: lastErrorDetail || 'No model responded successfully.',
                triedModels
            });
        }
        
        // Extract text from Gemini response
        let aiText = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            aiText = data.candidates[0].content.parts[0].text;
        }
        
        // Try to parse as JSON (for structured responses)
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            // If not JSON, treat as plain text response
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText,
                action: null
            };
        }
        
        return res.status(200).json({
            ...parsedResponse,
            modelUsed
        });
        
    } catch (error) {
        return res.status(500).json({
            error: 'Internal server error',
            details: String(error?.message || error)
        });
    }
}

function buildServerSystemPrompt(userName) {
    return `You are Unify, a helpful voice assistant.${userName ? ` The user's name is ${userName}.` : ''}

Your capabilities:
- Weather
- Reminders
- Memory (remembering where things are)

Style rules:
- Start directly with the answer. No greeting preambles.
- Avoid generic closing prompts (for example, "Would you like to know more...") unless user asked.
- For direct fact questions across any domain, answer with the fact immediately in 1-2 sentences. Do not pad with extra commentary, suggestions, or follow-up offers unless the user asked for detail.
- For person/celebrity queries ("Who is X?"), give a concise factual bio first, then notable works.
- If the user asks a "do/can/could/would" question, do not answer with only yes or no unless they explicitly asked for yes/no only; explain the answer.
- If the user asks to explain further, elaborate, or give more detail, expand the previous answer with more detail instead of repeating the short version.

Respond conversationally and naturally.`;
}
