import { webSearchHandler } from './_lib/web-search-core.js';

type VercelRequestLike = {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
    socket?: { remoteAddress?: string };
};

type VercelResponseLike = {
    status(code: number): VercelResponseLike;
    json(payload: unknown): unknown;
};

export type WebSearchSource = {
    title: string;
    url: string;
    snippet: string;
    text: string;
    source: string;
    score: number;
    fetchedAt: string;
};

export type WebSearchResponse = {
    success: boolean;
    query?: string; 
    results?: WebSearchSource[];
    sourceCount?: number;
    cached?: boolean;
    error?: {
        code: string;
        message: string;
        retryAfterMs?: number;
    };
};

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
    return webSearchHandler(req, res);
}
