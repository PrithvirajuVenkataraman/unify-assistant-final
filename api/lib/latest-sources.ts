export type LatestSource = {
    id: string;
    name: string;
    url: string;
    category: string;
};

export { LATEST_SOURCES, getLatestSources } from '../_lib/latest/latest-sources.js';
