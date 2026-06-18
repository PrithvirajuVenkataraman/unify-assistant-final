export type SearchWebSource = {
    title: string;
    url: string;
    snippet: string;
    text: string;
};

export type SearchWebOptions = {
    endpoint?: string; 
    maxResults?: number;
    timeoutMs?: number;
    textLimit?: number;
};

export async function searchWeb(query: string, options: SearchWebOptions = {}): Promise<SearchWebSource[]> {
    const endpoint = options.endpoint || '/api/web-search';
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query,
            maxResults: options.maxResults ?? 4,
            timeoutMs: options.timeoutMs ?? 8000,
            textLimit: options.textLimit ?? 8000
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
        throw new Error(String(data?.error?.message || 'Web search failed.'));
    }

    return (Array.isArray(data?.results) ? data.results : []).map((item: any) => ({
        title: String(item?.title || '').trim(),
        url: String(item?.url || '').trim(),
        snippet: String(item?.snippet || '').trim(),
        text: String(item?.text || '').trim()
    })).filter((item: SearchWebSource) => item.url && item.text);
}

export function buildWebSearchPromptSources(sources: SearchWebSource[]): string {
    return sources.map((source, index) => [
        `[${index + 1}] ${source.title || source.url}`,
        `URL: ${source.url}`,
        source.snippet ? `Snippet: ${source.snippet}` : '',
        `Content: ${source.text.slice(0, 4000)}`
    ].filter(Boolean).join('\n')).join('\n\n');
}
