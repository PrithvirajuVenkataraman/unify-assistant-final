const ERROR_MESSAGES = {
    'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings.',
    'service-not-allowed': 'Speech recognition is blocked by the browser or device policy.',
    'audio-capture': 'No working microphone was found.',
    network: 'Speech recognition could not reach the recognition service.',
    'no-speech': 'No speech was detected. Please try again.'
};
const enqueueMicrotask = globalThis.queueMicrotask || (callback => Promise.resolve().then(callback));

export function createSpeechInputController(options = {}) {
    const Recognition = options.Recognition;
    const callbacks = {
        onInterim: options.onInterim || (() => {}),
        onFinal: options.onFinal || (() => {}),
        onState: options.onState || (() => {}),
        onError: options.onError || (() => {})
    };
    let recognition = null;
    let activeSession = null;
    let recognitionSessionId = 0;
    let mode = 'idle';
    let converseEnabled = false;
    let processing = false;
    let submissionsInFlight = 0;
    let intentionalStop = false;
    let restartRequested = false;
    let restartQueued = false;
    let currentInterim = '';
    let language = options.language || 'en-US';
    const submittedResultIds = new Set();
    const recentConverseSubmissions = new Map();

    function getState() {
        return {
            supported: typeof Recognition === 'function',
            mode,
            converseEnabled,
            listening: Boolean(recognition),
            processing,
            interruptible: converseEnabled && processing,
            recognitionSessionId,
            submittedResultIds: [...submittedResultIds],
            restartRequested
        };
    }

    function emitState() {
        callbacks.onState(getState());
    }

    function clearInterim() {
        currentInterim = '';
        callbacks.onInterim('', getState());
    }

    function rememberSubmittedResult(resultId) {
        submittedResultIds.add(resultId);
        if (submittedResultIds.size <= 100) return;
        const oldest = submittedResultIds.values().next().value;
        submittedResultIds.delete(oldest);
    }

    function shouldSubmitConverseTranscript(text, transcriptId) {
        const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!normalized) return false;
        const now = Date.now();
        for (const [key, createdAt] of recentConverseSubmissions) {
            if (now - createdAt > 1800) recentConverseSubmissions.delete(key);
        }
        const key = `${normalized}:${String(transcriptId || '')}`;
        if (recentConverseSubmissions.has(key) || recentConverseSubmissions.has(normalized)) return false;
        recentConverseSubmissions.set(key, now);
        recentConverseSubmissions.set(normalized, now);
        return true;
    }

    function stopRecognition(reason = 'manual') {
        restartRequested = converseEnabled && reason !== 'disabled';
        if (!recognition) return;
        intentionalStop = true;
        if (activeSession) activeSession.closed = true;
        clearInterim();
        try {
            recognition.stop();
        } catch {
            try {
                recognition.abort();
            } catch {}
        }
    }

    function requestConverseRestart() {
        if (recognition) {
            restartRequested = false;
            return;
        }
        restartRequested = Boolean(converseEnabled);
        if (!restartRequested || submissionsInFlight || recognition || restartQueued) return;
        restartQueued = true;
        enqueueMicrotask(() => {
            restartQueued = false;
            if (converseEnabled && !recognition) {
                restartRequested = false;
                startRecognition('converse');
            }
        });
    }

    function startRecognition(nextMode) {
        if (typeof Recognition !== 'function') {
            callbacks.onError('Speech recognition is not supported in this browser.');
            emitState();
            return false;
        }
        if (recognition || (processing && nextMode !== 'converse')) return false;

        const instance = new Recognition();
        const session = {
            id: ++recognitionSessionId,
            instance,
            closed: false
        };
        recognition = instance;
        activeSession = session;
        mode = nextMode;
        intentionalStop = false;
        restartRequested = false;
        instance.lang = language;
        instance.interimResults = true;
        instance.continuous = nextMode === 'converse';
        instance.maxAlternatives = 1;

        instance.onstart = emitState;
        instance.onresult = async event => {
            if (activeSession !== session || session.closed) return;
            let interim = '';
            const finalParts = [];
            const finalResultIds = [];
            for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
                const result = event.results[index];
                const transcript = String(result?.[0]?.transcript || '').trim();
                if (!transcript) continue;
                if (result.isFinal) {
                    const resultId = `${session.id}:${index}:${transcript.toLowerCase().replace(/\s+/g, ' ')}`;
                    if (submittedResultIds.has(resultId)) continue;
                    rememberSubmittedResult(resultId);
                    finalResultIds.push(resultId);
                    finalParts.push(transcript);
                } else {
                    interim += `${transcript} `;
                }
            }
            currentInterim = interim.trim();
            callbacks.onInterim(currentInterim, getState());
            const finalText = finalParts.join(' ').trim();
            if (!finalText) return;
            const transcriptId = finalResultIds.join('|');

            if (nextMode === 'converse') {
                if (activeSession !== session || session.closed || !shouldSubmitConverseTranscript(finalText, transcriptId)) {
                    return;
                }
                submissionsInFlight += 1;
                try {
                    await callbacks.onFinal(finalText, {
                        autoSubmit: true,
                        interrupt: processing,
                        mode: nextMode,
                        sessionId: session.id,
                        transcriptId
                    });
                } finally {
                    submissionsInFlight = Math.max(0, submissionsInFlight - 1);
                    if (!recognition) requestConverseRestart();
                }
                return;
            }

            callbacks.onFinal(finalText, {
                autoSubmit: false,
                mode: nextMode,
                sessionId: session.id,
                transcriptId
            });
            stopRecognition('dictation_complete');
        };
        instance.onerror = event => {
            if (activeSession !== session) return;
            const code = String(event?.error || 'unknown');
            if (code !== 'aborted' || !intentionalStop) {
                clearInterim();
                if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(code)) {
                    converseEnabled = false;
                    mode = 'idle';
                    restartRequested = false;
                    session.closed = true;
                    stopRecognition('disabled');
                }
                callbacks.onError(ERROR_MESSAGES[code] || `Speech recognition failed (${code}).`);
            }
        };
        instance.onend = () => {
            if (activeSession !== session) return;
            recognition = null;
            activeSession = null;
            session.closed = true;
            intentionalStop = false;
            clearInterim();
            if (mode === 'dictation') mode = 'idle';
            emitState();
            requestConverseRestart();
        };

        try {
            instance.start();
            emitState();
            return true;
        } catch (error) {
            recognition = null;
            activeSession = null;
            session.closed = true;
            mode = 'idle';
            clearInterim();
            callbacks.onError(String(error?.message || 'Could not start speech recognition.'));
            emitState();
            return false;
        }
    }

    function toggleDictation() {
        if (mode === 'dictation' && recognition) {
            stopRecognition();
            return false;
        }
        if (converseEnabled) stop({ disableConverse: true });
        return startRecognition('dictation');
    }

    function toggleConverse() {
        if (converseEnabled) {
            stop({ disableConverse: true });
            return false;
        }
        converseEnabled = true;
        mode = 'converse';
        emitState();
        if (!processing) startRecognition('converse');
        return true;
    }

    function setProcessing(active) {
        processing = Boolean(active);
        if (processing && !converseEnabled) {
            if (recognition) stopRecognition('processing');
        } else if (!processing) {
            requestConverseRestart();
        }
        emitState();
    }

    function stop({ disableConverse = false } = {}) {
        if (disableConverse) converseEnabled = false;
        restartRequested = false;
        stopRecognition(disableConverse ? 'disabled' : 'manual');
        if (!converseEnabled) mode = 'idle';
        clearInterim();
        emitState();
    }

    function setLanguage(nextLanguage) {
        const normalized = String(nextLanguage || '').trim();
        if (!normalized) return language;
        language = normalized;
        clearInterim();
        if (recognition) {
            stopRecognition('language_change');
        } else {
            requestConverseRestart();
        }
        return language;
    }

    return {
        getState,
        setLanguage,
        toggleDictation,
        toggleConverse,
        setProcessing,
        stop
    };
}

export function installSpeechInputUI(options = {}) {
    const input = document.getElementById('text-input');
    const vttButton = document.getElementById('voice-to-text-btn');
    const status = document.getElementById('speech-input-status');
    if (!input || !vttButton) return null;

    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    let committedText = '';

    const savedLanguage = globalThis.localStorage?.getItem?.('jarvis_voice_input_language');
    const controller = createSpeechInputController({
        Recognition,
        language: savedLanguage || navigator.language || 'en-US',
        onInterim(text) {
            input.value = [committedText, text].filter(Boolean).join(' ').trim();
            options.onComposerChanged?.();
        },
        async onFinal(text, event) {
            if (event.autoSubmit) {
                const outgoing = text;
                committedText = '';
                input.value = outgoing;
                input.dataset.inputSource = 'converse';
                options.onComposerChanged?.();
                await options.onSubmit?.({
                    source: 'converse',
                    preserveTranscript: true,
                    interrupt: event.interrupt === true,
                    transcriptId: event.transcriptId,
                    recognitionSessionId: event.sessionId
                });
            } else {
                committedText = [committedText, text].filter(Boolean).join(' ').trim();
                input.value = committedText;
                input.dataset.inputSource = 'vtt';
                options.onComposerChanged?.();
                input.focus();
            }
        },
        onState(state) {
            vttButton.classList.toggle('is-listening', state.mode === 'dictation' && state.listening);
            vttButton.setAttribute('aria-pressed', state.mode === 'dictation' && state.listening ? 'true' : 'false');
            vttButton.disabled = !state.supported || state.processing || state.converseEnabled;
            input.placeholder = state.converseEnabled
                ? (state.processing ? 'Listening for an interruption...' : 'Converse mode is listening...')
                : (state.mode === 'dictation' && state.listening ? 'Listening...' : 'Ask anything...');
            if (status) {
                status.textContent = !state.supported
                    ? 'Voice input is unavailable in this browser.'
                    : state.converseEnabled
                        ? (state.processing ? 'JARVIS is responding. Speak to interrupt.' : 'Converse mode on. Speak naturally; replies remain text-only.')
                        : state.listening
                            ? 'Listening for one message...'
                            : '';
            }
            options.onStateChanged?.(state);
        },
        onError(message) {
            if (status) status.textContent = message;
            options.onError?.(message);
        }
    });

    globalThis.toggleVoiceToText = () => {
        committedText = input.value.trim();
        return controller.toggleDictation();
    };
    globalThis.toggleConverseMode = () => {
        committedText = '';
        input.value = '';
        delete input.dataset.inputSource;
        options.onComposerChanged?.();
        return controller.toggleConverse();
    };
    globalThis.JarvisSpeechInput = controller;
    globalThis.JarvisSpeechInput.toggleConverse = globalThis.toggleConverseMode;
    globalThis.syncVttUiState = () => controller.getState();
    globalThis.setVoiceInputLanguage = language => {
        const selected = controller.setLanguage(language);
        try {
            globalThis.localStorage?.setItem?.('jarvis_voice_input_language', selected);
        } catch {}
        return selected;
    };
    vttButton.addEventListener('click', globalThis.toggleVoiceToText);
    globalThis.addEventListener('jarvis:assistant-processing', event => {
        controller.setProcessing(Boolean(event.detail?.active));
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && controller.getState().listening) {
            controller.stop({ disableConverse: true });
        }
    });
    controller.setProcessing(false);
    return controller;
}
