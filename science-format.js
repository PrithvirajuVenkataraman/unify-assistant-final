(function (global) {
    'use strict';

    const SCI_RE = /(?<![\w.])[-+]?(?:\d+(?:\.\d*)?|\.\d+)[eE][-+]?\d+(?:\s*[A-Za-z][A-Za-z0-9^*/().-]*)?/g;
    const HEX_RE = /\b0x[0-9A-Fa-f]+\b/g;
    const LONG_DECIMAL_RE = /(?<![\w.])[-+]?\d+\.\d{4,}(?:\s*[A-Za-z][A-Za-z0-9^*/().-]*)?/g;
    const ISOTOPE_RE = /\b(?:[A-Z][a-z]?)-\d{1,3}\b/g;
    const CHEM_RE = /\b(?:[A-Z][a-z]?\d*){2,}(?:[+-])?\b/g;
    const TOKEN_RE = /(?<![\w.])[-+]?(?:\d+(?:\.\d*)?|\.\d+)[eE][-+]?\d+(?:\s*[A-Za-z][A-Za-z0-9^*/().-]*)?|\b0x[0-9A-Fa-f]+\b|\b(?:[A-Z][a-z]?)-\d{1,3}\b|(?<![\w.])[-+]?\d+\.\d{4,}(?:\s*[A-Za-z][A-Za-z0-9^*/().-]*)?|\b(?:[A-Z][a-z]?\d*){2,}(?:[+-])?\b/g;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function classifyToken(token) {
        const raw = String(token || '');
        if (/^0x[0-9A-Fa-f]+$/.test(raw)) return 'hex';
        if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)[eE][-+]?\d+/.test(raw)) return 'sci';
        if (/^(?:[A-Z][a-z]?)-\d{1,3}$/.test(raw)) return 'isotope';
        if (/^[-+]?\d+\.\d{4,}/.test(raw)) return 'decimal';
        if (/^(?:[A-Z][a-z]?\d*){2,}(?:[+-])?$/.test(raw) && /[A-Z]/.test(raw) && /\d/.test(raw)) return 'chem';
        return 'value';
    }

    function wrapToken(token) {
        const raw = String(token || '');
        return `<span class="science-value science-value-${classifyToken(raw)}">${escapeHtml(raw)}</span>`;
    }

    function enhancePlainText(text) {
        return escapeHtml(String(text || '')).replace(TOKEN_RE, match => wrapToken(match));
    }

    function enhanceHtml(html) {
        if (!global.document) return enhancePlainText(html);
        const root = global.document.createElement('div');
        root.innerHTML = String(html || '');
        const skip = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
        const walker = global.document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || skip.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                if (!/[A-Z0-9.eE-]/.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            const enhanced = enhancePlainText(node.nodeValue || '');
            if (enhanced === escapeHtml(node.nodeValue || '')) continue;
            const fragHost = global.document.createElement('span');
            fragHost.innerHTML = enhanced;
            node.replaceWith(...Array.from(fragHost.childNodes));
        }
        return root.innerHTML;
    }

    function normalizeScientificNotation(match) {
        const parts = String(match || '').match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))[eE]([-+]?\d+)(.*)$/);
        if (!parts) return match;
        const mantissa = parts[1];
        const exponent = String(Number(parts[2]));
        const unit = normalizeUnitSpeech(parts[3] || '');
        return `${mantissa} times 10 to the ${exponent}${unit ? ` ${unit}` : ''}`;
    }

    function normalizeHex(match) {
        return `hex ${String(match || '').slice(2).toUpperCase().split('').join(' ')}`;
    }

    function normalizeUnitSpeech(unit) {
        return String(unit || '')
            .trim()
            .replace(/\bm\/s\^?2\b/g, 'meters per second squared')
            .replace(/\bm\/s\b/g, 'meters per second')
            .replace(/\^(-?\d+)/g, ' to the $1')
            .replace(/\//g, ' per ')
            .replace(/\*/g, ' times ')
            .replace(/\bkg\b/g, 'kilograms')
            .replace(/\bC\b/g, 'coulombs')
            .replace(/\bN\b/g, 'newtons')
            .replace(/\bJ\b/g, 'joules')
            .replace(/\bPa\b/g, 'pascals')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeChemicalFormula(match) {
        return String(match || '')
            .replace(/([A-Z][a-z]?)(\d*)/g, (_, symbol, count) => `${symbol}${count ? ` ${count}` : ''} `)
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeScienceSpeech(text) {
        return String(text || '')
            .replace(SCI_RE, normalizeScientificNotation)
            .replace(HEX_RE, normalizeHex)
            .replace(ISOTOPE_RE, value => String(value).replace('-', ' '))
            .replace(CHEM_RE, value => /\d/.test(value) ? normalizeChemicalFormula(value) : value)
            .replace(/->|=>|⟶|→/g, ' yields ')
            .replace(/\^(-?\d+)/g, ' to the $1')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const api = {
        enhancePlainText,
        enhanceHtml,
        normalizeScienceSpeech
    };

    global.JarvisScienceFormat = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
