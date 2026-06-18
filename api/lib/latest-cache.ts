export type LatestItem = {
    id: string;
    title: string;
    url: string;
    summary: string;
    source: string;
    sourceId: string;
    publishedAt: string;
    fetchedAt: string;
};

export { saveItems, searchItems, getItems } from '../_lib/latest/latest-cache.js';
