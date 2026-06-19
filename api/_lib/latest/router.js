export {
    classifyFreeLiveIntent,
    routeMessage,
    __test
} from '../free-live/classifier.js';

export function routeMessageJson(message) {
    return JSON.stringify(routeMessage(message));
}
