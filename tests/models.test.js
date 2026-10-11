import test from 'node:test';
import assert from 'node:assert/strict';
import { modelListUrl, requestModels, bindModelPicker } from '../models.js';

test('model list derives the same base path and rejects unsafe URLs', () => {
    assert.equal(modelListUrl('https://example.com'), 'https://example.com/v1/models');
    assert.equal(modelListUrl('https://example.com/v1/'), 'https://example.com/v1/models');
    assert.equal(modelListUrl('https://example.com/proxy/v1/chat/completions'), 'https://example.com/proxy/v1/models');
    assert.throws(() => modelListUrl('https://key@example.com/v1'));
    assert.throws(() => modelListUrl('https://example.com/v1?key=secret'));
});

test('model list sends session key, normalizes IDs, and omits cookies', async () => {
    const controller = new AbortController();
    const models = await requestModels('https://example.com/v1', 'test-key', controller.signal, async (url, init) => {
        assert.equal(url, 'https://example.com/v1/models');
        assert.equal(init.method, 'GET');
        assert.equal(init.headers.Authorization, 'Bearer test-key');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error');
        assert.equal(init.signal, controller.signal);
        return { ok: true, json: async () => ({ data: [{ id: 'z' }, { id: ' a ' }, { id: 'a' }, { id: '' }, { id: 123 }, null] }) };
    });
    assert.deepEqual(models, ['a', 'z']);
});

test('unsupported, empty, and failed lists do not expose provider error bodies', async () => {
    for (const data of [{ data: [] }, { models: ['a'] }, { error: 'secret' }, { data: [{ id: ' ' }] }]) {
        await assert.rejects(requestModels('https://example.com', '', undefined, async () => ({ ok: true, json: async () => data })), /手动填写/);
    }
    await assert.rejects(requestModels('https://example.com', '', undefined, async () => ({ ok: false, status: 401,
        json: () => { throw new Error('must not read secret error body'); } })), /HTTP 401/);
});

function harness() {
    const nodes = new Map();
    const selectors = ['#cst-model-list', '[data-setting="model"]', '#cst-fetch-models', '#cst-model-status', '[data-setting="endpoint"]', '#cst-key', '[data-setting="provider"]'];
    for (const selector of selectors) nodes.set(selector, { value: '', listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; },
        replaceChildren(...children) { this.children = children; } });
    const settings = { provider: 'independent', endpoint: 'https://example.com/v1', model: '' };
    let pending = [], saves = 0;
    bindModelPicker({ querySelector: selector => nodes.get(selector) }, { settings: () => settings, apiKey: () => 'test-key',
        save: () => saves++, fetcher: (url, init) => new Promise(resolve => pending.push({ resolve, init })) });
    return { nodes, settings, pending, saves: () => saves,
        resolve(i, ids) { pending[i].resolve({ ok: true, json: async () => ({ data: ids.map(id => ({ id })) }) }); } };
}

test('picker discards an old connection response and retains manual models', async () => {
    const previous = globalThis.Option;
    globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
    try {
        const h = harness();
        const button = h.nodes.get('#cst-fetch-models');
        const first = button.listeners.click();
        h.nodes.get('#cst-key').listeners.input();
        assert.equal(h.pending[0].init.signal.aborted, true);
        h.resolve(0, ['stale-model']);
        await first;
        assert.equal(h.settings.model, '');
        const second = button.listeners.click();
        h.resolve(1, ['new-model']);
        await second;
        assert.equal(h.settings.model, 'new-model');
        assert.equal(h.saves(), 1);
        h.settings.model = 'manual-model';
        const third = button.listeners.click();
        h.resolve(2, ['different-model']);
        await third;
        assert.equal(h.settings.model, 'manual-model');
        assert.equal(h.nodes.get('#cst-model-list').value, '');
        assert.equal(h.nodes.get('#cst-fetch-models').disabled, false);
    } finally { globalThis.Option = previous; }
});
