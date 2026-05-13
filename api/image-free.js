export const config = { maxDuration: 30 };
import { applyApiSecurity } from './security.js';

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const MAX_PROMPT_CHARS = 500;
const MAX_REFERENCE_IMAGE_CHARS = 2_000_000;
const FREE_MODELS = new Set(['flux', 'turbo', 'sdxl']);

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'image-free',
        maxBodyBytes: 3 * 1024 * 1024,
        rateLimit: { max: 10, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const prompt = String(req.body?.prompt || '').trim();
        const referenceImage = String(req.body?.referenceImage || '').trim();
        const modelRaw = String(req.body?.model || 'flux').trim().toLowerCase();
        const model = FREE_MODELS.has(modelRaw) ? modelRaw : 'flux';
        const width = clampInt(req.body?.width, DEFAULT_WIDTH, 256, 1536);
        const height = clampInt(req.body?.height, DEFAULT_HEIGHT, 256, 1536);
        const seed = clampInt(req.body?.seed, Date.now() % 1000000, 0, 9999999);
        const precisionMode = String(req.body?.precisionMode || '').trim().toLowerCase();

        if (!prompt) {
            return res.status(400).json({ success: false, error: 'prompt is required' });
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
            return res.status(413).json({ success: false, error: 'prompt is too long' });
        }
        if (referenceImage && referenceImage.length > MAX_REFERENCE_IMAGE_CHARS) {
            return res.status(413).json({ success: false, error: 'reference image is too large' });
        }
        if (referenceImage && !isSafeReferenceImage(referenceImage)) {
            return res.status(400).json({ success: false, error: 'unsupported reference image format' });
        }

        const cleanPrompt = buildPrecisionPrompt(prompt, precisionMode);

        if (referenceImage) {
            const referencedResult = await generateWithReferenceImage({
                prompt: cleanPrompt,
                model,
                width,
                height,
                seed,
                referenceImage
            });
            if (referencedResult?.imageUrl) {
                return res.status(200).json({
                    success: true,
                    provider: referencedResult.provider || 'pollinations',
                    model,
                    prompt: cleanPrompt,
                    width,
                    height,
                    seed,
                    imageUrl: referencedResult.imageUrl,
                    referenceApplied: true
                });
            }
        }

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
            imageUrl,
            referenceApplied: false
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'free image generation unavailable right now'
        });
    }
}

async function generateWithReferenceImage({ prompt, model, width, height, seed, referenceImage }) {
    const apiKey = String(process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_KEY || '').trim();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const payload = {
        prompt,
        model,
        size: `${width}x${height}`,
        response_format: 'url',
        safe: true,
        n: 1,
        seed,
        image: referenceImage
    };

    const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) return null;

    const data = await response.json().catch(() => ({}));
    const imageUrl = String(data?.data?.[0]?.url || '').trim();
    if (!imageUrl) return null;

    return { imageUrl, provider: 'pollinations-gen' };
}

function isSafeReferenceImage(value) {
    const v = String(value || '').trim();
    if (!v) return false;
    if (/^https?:\/\/[^\s]+$/i.test(v)) return true;
    return /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(v);
}

function buildPrecisionPrompt(prompt, precisionMode = '') {
    const base = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!base) return '';
    if (precisionMode === 'temple' || /\b(nataraja|nataraj|chidambaram|temple|gopuram|dravidian)\b/i.test(base)) {
        return `${base}. Authentic South Indian Dravidian temple architecture, culturally accurate Nataraja iconography, realistic stone and bronze textures, accurate proportions, no fantasy distortions, no western architecture elements.`;
    }
    return base;
}

function clampInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.round(n);
    if (i < min) return min;
    if (i > max) return max;
    return i;
}
