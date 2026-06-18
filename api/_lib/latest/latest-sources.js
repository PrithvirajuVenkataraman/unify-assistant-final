export const LATEST_SOURCES = Object.freeze([
    {
        id: 'openai-news',
        name: 'OpenAI News',
        url: 'https://openai.com/news/rss.xml',
        category: 'ai'
    },
    {
        id: 'anthropic-news',
        name: 'Anthropic News',
        url: 'https://www.anthropic.com/news/rss.xml',
        category: 'ai'
    },
    {
        id: 'vercel-blog',
        name: 'Vercel Blog',
        url: 'https://vercel.com/blog/rss.xml',
        category: 'web'
    },
    {
        id: 'nextjs-blog',
        name: 'Next.js Blog',
        url: 'https://nextjs.org/feed.xml',
        category: 'web'
    },
    {
        id: 'react-blog',
        name: 'React Blog',
        url: 'https://react.dev/rss.xml',
        category: 'web'
    },
    {
        id: 'hacker-news',
        name: 'Hacker News',
        url: 'https://hnrss.org/frontpage',
        category: 'technology'
    },
    {
        id: 'arxiv-cs',
        name: 'arXiv Computer Science',
        url: 'https://export.arxiv.org/rss/cs',
        category: 'research'
    }
]);

export function getLatestSources() {
    return LATEST_SOURCES;
}
