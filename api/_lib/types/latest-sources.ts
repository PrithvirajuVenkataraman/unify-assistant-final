export type LatestSource = {
    id: string;
    name: string;
    url: string;
    category: string;
};

export { LATEST_SOURCES, getLatestSources } from '../latest/latest-sources.js';
