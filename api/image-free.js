export const config = { maxDuration: 30 };
import { applyApiSecurity } from './security.js';

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const MAX_PROMPT_CHARS = 500;
const FREE_MODELS = new Set(['flux', 'turbo', 'sdxl']);

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'image-free',
        maxBodyBytes: 48 * 1024,
        rateLimit: { max: 10, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const prompt = String(req.body?.prompt || '').trim();
        const modelRaw = String(req.body?.model || 'flux').trim().toLowerCase();
        const model = FREE_MODELS.has(modelRaw) ? modelRaw : 'flux';
        const width = clampInt(req.body?.width, DEFAULT_WIDTH, 256, 1536);
        const height = clampInt(req.body?.height, DEFAULT_HEIGHT, 256, 1536);
        const seed = clampInt(req.body?.seed, Date.now() % 1000000, 0, 9999999);

        if (!prompt) {
            return res.status(400).json({ success: false, error: 'prompt is required' });
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
            return res.status(413).json({ success: false, error: 'prompt is too long' });
        }

        const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
        const encodedPrompt = encodeURIComponent(cleanPrompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=${encodeURIComponent(model)}&width=${width}&height=${height}&seed=${seed}&nologo=true&safe=true`;

        return res.status(200).json({
            success: true,
            provider: 'pollinations',
            model,
            prompt: cleanPrompt,
            width,
            height,
            seed,
            imageUrl
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'free image generation unavailable right now'
        });
    }
}

function clampInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.round(n);
    if (i < min) return min;
    if (i > max) return max;
    return i;
}
