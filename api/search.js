export default async function handler(req, res) {
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
        const query = String(req.body?.query || '').trim();
        const maxResults = Math.min(Math.max(Number(req.body?.maxResults || 8), 1), 10);
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }

        const serperKey = process.env.SERPER_API_KEY;
        const braveKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
        const attempts = [];

        if (serperKey) {
            attempts.push({
                provider: 'serper-google',
                run: () => searchWithSerper(query, maxResults, serperKey)
            });
        }
        if (braveKey) {
            attempts.push({
                provider: 'brave',
                run: () => searchWithBrave(query, maxResults, braveKey)
            });
        }
        attempts.push({
            provider: 'duckduckgo-instant',
            run: () => searchWithDuckDuckGo(query, maxResults)
        });
        attempts.push({
            provider: 'duckduckgo-html',
            run: () => searchWithDuckDuckGoHtml(query, maxResults)
        });

        let results = [];
        let provider = 'none';
        for (const attempt of attempts) {
            try {
                const current = await attempt.run();
                if (Array.isArray(current) && current.length > 0) {
                    provider = attempt.provider;
                    results = current;
                    break;
                }
            } catch (e) {
                // Try next provider.
            }
        }

        return res.status(200).json({
            success: true,
            provider,
            results
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'search failed'
        });
    }
}

async function searchWithSerper(query, maxResults, apiKey) {
    const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': apiKey
        },
        body: JSON.stringify({
            q: query,
            num: maxResults
        })
    });

    if (!response.ok) return [];
    const data = await response.json();
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    return organic.slice(0, maxResults).map(item => ({
        title: item?.title || 'Untitled',
        url: item?.link || '',
        description: item?.snippet || ''
    })).filter(item => item.url);
}

async function searchWithBrave(query, maxResults, apiKey) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': apiKey
        }
    });

    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data?.web?.results) ? data.web.results : [];
    return list.slice(0, maxResults).map(item => ({
        title: item?.title || 'Untitled',
        url: item?.url || '',
        description: item?.description || ''
    })).filter(item => item.url);
}

async function searchWithDuckDuckGo(query, maxResults) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    const out = [];

    const pushTopic = (topic) => {
        if (!topic || out.length >= maxResults) return;
        if (topic.FirstURL && topic.Text) {
            out.push({
                title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 80),
                url: topic.FirstURL,
                description: topic.Text
            });
        }
    };

    const related = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
    for (const item of related) {
        if (item?.Topics && Array.isArray(item.Topics)) {
            for (const sub of item.Topics) pushTopic(sub);
        } else {
            pushTopic(item);
        }
        if (out.length >= maxResults) break;
    }

    return out.slice(0, maxResults);
}

async function searchWithDuckDuckGoHtml(query, maxResults) {
    const response = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `q=${encodeURIComponent(query)}`
    });
    if (!response.ok) return [];

    const html = await response.text();
    const out = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(html)) && out.length < maxResults) {
        const url = decodeHtmlEntities(String(match[1] || '').trim());
        const title = decodeHtmlEntities(stripTags(String(match[2] || '').trim()));
        if (!/^https?:\/\//i.test(url) || !title) continue;
        out.push({
            title,
            url,
            description: title
        });
    }
    return out;
}

function stripTags(input) {
    return String(input || '').replace(/<[^>]*>/g, ' ');
}

function decodeHtmlEntities(input) {
    return String(input || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}
