export const config = { maxDuration: 30 };
import { applyApiSecurity } from './security.js';

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const MAX_PROMPT_CHARS = 500;
const MAX_REFERENCE_IMAGE_CHARS = 2_000_000;
const WIKIPEDIA_REF_TIMEOUT_MS = 4500;
const FREE_MODELS = new Set(['flux', 'turbo', 'sdxl']);
const HTTP_TIMEOUT_MS = 9000;
const HTTP_RETRIES = 1;
const MAX_REMOTE_REFERENCE_IMAGE_BYTES = 2_500_000;

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
        const requireReferenceApplied = Boolean(req.body?.requireReferenceApplied);
        const strictReferenceRequired = requireReferenceApplied && Boolean(referenceImage);

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

        const cleanPrompt = buildPrompt(prompt);

        const autoReferenceImage = (!referenceImage && shouldAutoReferencePrompt(cleanPrompt))
            ? await fetchWikipediaReferenceImageUrl(cleanPrompt)
            : '';
        const effectiveReferenceImage = referenceImage || autoReferenceImage;
        const referenceSource = referenceImage ? 'user' : (autoReferenceImage ? 'wikipedia' : null);

        if (effectiveReferenceImage) {
            const referencedResult = await generateWithReferenceImage({
                prompt: cleanPrompt,
                model,
                width,
                height,
                seed,
                referenceImage: effectiveReferenceImage
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
                    referenceApplied: true,
                    referenceSource
                });
            }
            if (strictReferenceRequired) {
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
            referenceApplied: false,
            referenceSource
        });
    } catch (error) {
        const reason = String(error?.message || 'unknown_error');
        console.error('[image-free] generation failed:', { reason });
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

    const response = await fetchWithTimeoutRetry('https://gen.pollinations.ai/v1/images/generations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    }, { timeoutMs: HTTP_TIMEOUT_MS, retries: HTTP_RETRIES });
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

    const response = await fetchWithTimeoutRetry('https://gen.pollinations.ai/v1/images/generations', {
        method: 'POST',
        headers,
        body: form
    }, { timeoutMs: HTTP_TIMEOUT_MS, retries: HTTP_RETRIES });
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
        if (!isAllowedReferenceRemoteUrl(url)) return '';
        const response = await fetchWithTimeoutRetry(url, undefined, {
            timeoutMs: 7000,
            retries: 0
        });
        if (!response.ok) return '';
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!/^image\/(png|jpe?g|webp)/.test(contentType)) return '';
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_REFERENCE_IMAGE_BYTES) return '';
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > MAX_REMOTE_REFERENCE_IMAGE_BYTES) return '';
        const base64 = bytes.toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (_) {
        return '';
    }
}

function isSafeReferenceImage(value) {
    const v = String(value || '').trim();
    if (!v) return false;
    if (/^https?:\/\/[^\s]+$/i.test(v)) return isAllowedReferenceRemoteUrl(v);
    return /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(v);
}

function shouldAutoReferencePrompt(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return false;
    const lower = text.toLowerCase();

    // Do not auto-attach wiki references for generic creative/custom artwork prompts.
    if (/\b(logo|poster|banner|wallpaper|abstract|concept art|mascot|character design|sticker|custom|cyberpunk|fantasy|anime|cartoon)\b/.test(lower)) {
        return false;
    }
    if (/\b(in the style of|style of|photorealistic|cinematic|ultra detailed|vfx|digital art)\b/.test(lower)) {
        return false;
    }

    // Auto-reference only when query looks like a concrete real-world entity/place.
    const entitySignals = /\b(city|country|state|district|town|village|temple|church|mosque|palace|fort|museum|monument|landmark|tower|bridge|mountain|lake|river|beach|island|airport|station)\b/;
    const subjectTokens = extractWikipediaReferenceSubject(text).split(/\s+/).filter(Boolean);
    return entitySignals.test(lower) || (subjectTokens.length >= 2 && subjectTokens.length <= 6 && /^[A-Z]/.test(text));
}

async function fetchWikipediaReferenceImageUrl(prompt) {
    const subject = extractWikipediaReferenceSubject(prompt);
    if (!subject) return '';

    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(subject)}&gsrlimit=1&prop=pageimages|info&inprop=url&pithumbsize=1024&format=json`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), WIKIPEDIA_REF_TIMEOUT_MS) : null;
    try {
        const response = await fetchWithTimeoutRetry(endpoint, controller ? { signal: controller.signal } : undefined, {
            timeoutMs: WIKIPEDIA_REF_TIMEOUT_MS,
            retries: 0
        });
        if (!response.ok) return '';
        const data = await response.json().catch(() => ({}));
        const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
        const page = pages.find(item => item && item.thumbnail && !item.missing);
        const imageUrl = String(page?.thumbnail?.source || '').trim();
        if (!/^https?:\/\/[^\s]+$/i.test(imageUrl)) return '';
        return imageUrl;
    } catch (_) {
        return '';
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function extractWikipediaReferenceSubject(prompt) {
    const raw = String(prompt || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!raw) return '';

    const simplified = raw
        .replace(/\b(photo(?:realistic)?|cinematic|ultra(?:-|\s)?detailed|highly detailed|8k|4k|hdr|render|digital art|illustration|concept art|octane|unreal|vfx)\b/gi, ' ')
        .replace(/\b(with|featuring|showing|at|during)\b.*$/i, ' ')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokens = simplified.split(' ').filter(Boolean);
    if (!tokens.length) return '';
    return tokens.slice(0, 8).join(' ');
}

function buildPrompt(prompt) {
    const base = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!base) return '';
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

function isAllowedReferenceRemoteUrl(input) {
    try {
        const parsed = new URL(String(input || '').trim());
        const protocol = String(parsed.protocol || '').toLowerCase();
        if (protocol !== 'https:' && protocol !== 'http:') return false;
        const host = String(parsed.hostname || '').toLowerCase();
        if (!host) return false;
        if (host === 'localhost' || host === '0.0.0.0') return false;
        if (host.endsWith('.local') || host.endsWith('.localhost')) return false;
        if (isPrivateIpLiteral(host)) return false;
        return true;
    } catch (_) {
        return false;
    }
}

function isPrivateIpLiteral(host) {
    const ipv4 = host.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
    if (ipv4) {
        const parts = host.split('.').map(v => Number(v));
        if (parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return true;
        if (parts[0] === 10) return true;
        if (parts[0] === 127) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
        return false;
    }

    const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    return false;
}

async function fetchWithTimeoutRetry(url, init = undefined, options = {}) {
    const timeoutMs = clampInt(options.timeoutMs, HTTP_TIMEOUT_MS, 1000, 30000);
    const retries = clampInt(options.retries, HTTP_RETRIES, 0, 3);
    let lastErr = null;

    for (let i = 0; i <= retries; i++) {
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
        try {
            const upstreamSignal = init?.signal;
            const signal = (upstreamSignal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function')
                ? AbortSignal.any([upstreamSignal, timeoutController.signal])
                : (upstreamSignal || timeoutController.signal);
            const merged = {
                ...(init || {}),
                signal
            };
            const response = await fetch(url, merged);
            clearTimeout(timeout);
            return response;
        } catch (error) {
            clearTimeout(timeout);
            lastErr = error;
            if (i >= retries) throw error;
        }
    }
    throw lastErr || new Error('fetch_failed');
}
