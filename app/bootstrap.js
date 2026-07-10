import { createConversationEngine } from './context-engine.js';
import { ApiError, postJson } from './api-client.js';
import { createApplicationState } from './state.js';
import { createSafeStorage } from './storage.js';
import { installSpeechInputUI } from './speech-input.js';
import * as JarvisFrontendRouting from './frontend-routing.js';
import * as JarvisFailurePolicy from './failure-policy.js';
import * as JarvisPlaceGrounding from './place-grounding.js';
import * as JarvisConverseState from './converse-state.js';

const engine = createConversationEngine({
    maxTurns: 12,
    maxContextChars: 9000,
    maxThreads: 8
});

globalThis.JarvisConversation = engine;
globalThis.JarvisApi = Object.freeze({ ApiError, postJson });
globalThis.JarvisState = createApplicationState();
globalThis.JarvisStorage = createSafeStorage();
globalThis.JarvisFrontendRouting = Object.freeze({ ...JarvisFrontendRouting });
globalThis.JarvisFailurePolicy = Object.freeze({ ...JarvisFailurePolicy });
globalThis.JarvisPlaceGrounding = Object.freeze({ ...JarvisPlaceGrounding });
globalThis.JarvisConverseState = Object.freeze({ ...JarvisConverseState });

function initializeSpeechInput() {
    if (globalThis.JarvisSpeechInput) return;
    installSpeechInputUI({
        onComposerChanged() {
            globalThis.handleComposerInput?.();
        },
        onStateChanged() {
            globalThis.toggleSendButton?.();
        },
        onSubmit(submission) {
            return globalThis.sendTextInput?.(submission);
        },
        onError(message) {
            globalThis.showTemporaryMessage?.(message);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSpeechInput, { once: true });
} else {
    initializeSpeechInput();
}

globalThis.dispatchEvent(new CustomEvent('jarvis:modules-ready'));
