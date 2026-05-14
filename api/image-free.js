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
        const requireReferenceApplied = Boolean(req.body?.requireReferenceApplied);

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
            if (requireReferenceApplied) {
                return res.status(422).json({
                    success: false,
                    error: 'reference image could not be applied'
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
    const isDataImage = /^data:image\//i.test(referenceImage);

    if (isDataImage) {
        const multipartResult = await generateWithReferenceMultipart({
            prompt,
            model,
            width,
            height,
            seed,
            referenceImage,
            apiKey
        });
        if (multipartResult?.imageUrl) return multipartResult;
    }

    const jsonResult = await generateWithReferenceJson({
        prompt,
        model,
        width,
        height,
        seed,
        referenceImage,
        apiKey
    });
    if (jsonResult?.imageUrl) return jsonResult;

    if (!isDataImage && /^https?:\/\//i.test(referenceImage)) {
        const urlAsData = await fetchUrlAsDataUrl(referenceImage);
        if (urlAsData) {
            const multipartResult = await generateWithReferenceMultipart({
                prompt,
                model,
                width,
                height,
                seed,
                referenceImage: urlAsData,
                apiKey
            });
            if (multipartResult?.imageUrl) return multipartResult;
        }
    }

    return null;
}

async function generateWithReferenceJson({ prompt, model, width, height, seed, referenceImage, apiKey }) {
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
    const imageUrl = extractImageUrlFromProviderPayload(data);
    if (!imageUrl) return null;
    return { imageUrl, provider: 'pollinations-gen-json' };
}

async function generateWithReferenceMultipart({ prompt, model, width, height, seed, referenceImage, apiKey }) {
    const fileData = dataUrlToFile(referenceImage, 'reference-image');
    if (!fileData) return null;

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('model', model);
    form.append('size', `${width}x${height}`);
    form.append('response_format', 'url');
    form.append('safe', 'true');
    form.append('n', '1');
    form.append('seed', String(seed));
    form.append('image', fileData.blob, fileData.fileName || 'reference-image.png');

    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
        method: 'POST',
        headers,
        body: form
    });
    if (!response.ok) return null;

    const data = await response.json().catch(() => ({}));
    const imageUrl = extractImageUrlFromProviderPayload(data);
    if (!imageUrl) return null;
    return { imageUrl, provider: 'pollinations-gen-multipart' };
}

function extractImageUrlFromProviderPayload(data) {
    const urlFromData = String(data?.data?.[0]?.url || '').trim();
    if (urlFromData) return urlFromData;

    const directUrl = String(data?.url || '').trim();
    if (directUrl) return directUrl;

    const b64 = String(data?.data?.[0]?.b64_json || data?.b64_json || '').trim();
    if (b64) return `data:image/png;base64,${b64}`;
    return '';
}

function dataUrlToFile(dataUrl, baseName = 'reference-image') {
    const value = String(dataUrl || '').trim();
    const match = value.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;

    const mimeType = match[1].toLowerCase();
    const base64 = match[2].replace(/\s+/g, '');
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.replace('image/', '');
    try {
        const buffer = Buffer.from(base64, 'base64');
        const blob = new Blob([buffer], { type: mimeType });
        return {
            blob,
            fileName: `${baseName}.${ext}`,
            mimeType
        };
    } catch (_) {
        return null;
    }
}

async function fetchUrlAsDataUrl(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return '';
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!/^image\/(png|jpe?g|webp)/.test(contentType)) return '';
        const bytes = Buffer.from(await response.arrayBuffer());
        const base64 = bytes.toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (_) {
        return '';
    }
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
