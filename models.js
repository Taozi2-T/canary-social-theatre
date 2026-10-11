import { endpointUrl } from './core.js';

export function modelListUrl(endpoint) {
    const url = new URL(endpointUrl(endpoint));
    url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
    return url.href;
}

export async function requestModels(endpoint, apiKey, signal, fetcher = fetch) {
    const response = await fetcher(modelListUrl(endpoint), {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', signal,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`获取模型失败（HTTP ${response.status}）。请检查地址、密钥或手动填写模型。`);
    const data = await response.json();
    if (data.error || !Array.isArray(data.data)) throw new Error('接口未返回兼容的模型列表，可以手动填写模型名称。');
    const models = [...new Set(data.data.slice(0, 5000).map(item => item?.id)
        .filter(id => typeof id === 'string' && id.trim() && id.length <= 300).map(id => id.trim()))].sort();
    if (!models.length) throw new Error('接口返回的模型列表为空，可以手动填写模型名称。');
    return models;
}

// List and key stay in memory; changing connection details invalidates older requests.
export function bindModelPicker(panel, { settings, apiKey, save, fetcher }) {
    const picker = panel.querySelector('#cst-model-list');
    const model = panel.querySelector('[data-setting="model"]');
    const button = panel.querySelector('#cst-fetch-models');
    const status = panel.querySelector('#cst-model-status');
    let controller, revision = 0;
    function reset() {
        revision++;
        controller?.abort();
        controller = undefined;
        button.disabled = false;
        picker.replaceChildren(new Option('先获取模型列表', ''));
        picker.disabled = true;
        status.textContent = '填好地址和密钥后，离开输入框时自动获取；也可点击刷新。';
    }
    async function refresh() {
        reset();
        if (settings().provider !== 'independent' || !settings().endpoint.trim()) return;
        const current = revision;
        const active = new AbortController();
        controller = active;
        const timeout = setTimeout(() => active.abort(), 20000);
        button.disabled = true;
        status.textContent = '正在获取模型列表…';
        try {
            const models = await requestModels(settings().endpoint, apiKey(), active.signal, fetcher);
            if (current !== revision) return;
            picker.replaceChildren(new Option('选择模型', ''), ...models.map(id => new Option(id, id)));
            picker.disabled = false;
            if (!settings().model.trim()) {
                settings().model = models[0];
                model.value = models[0];
                save();
            }
            picker.value = models.includes(settings().model) ? settings().model : '';
            status.textContent = `已获取 ${models.length} 个模型。请确认所选模型支持对话；服务商未列出的模型也可手动填写。`;
        } catch (error) {
            if (current !== revision) return;
            status.textContent = error.name === 'AbortError' ? '获取超时，请刷新或手动填写模型。'
                : error instanceof TypeError ? '无法连接模型列表，请检查地址、网络和服务商的 CORS 设置；也可手动填写。'
                    : error instanceof SyntaxError ? '模型列表不是有效 JSON，可以手动填写模型。' : error.message;
        } finally {
            clearTimeout(timeout);
            if (current === revision) { button.disabled = false; controller = undefined; }
        }
    }
    button.addEventListener('click', refresh);
    picker.addEventListener('change', () => {
        if (!picker.value) return;
        settings().model = picker.value;
        model.value = picker.value;
        save();
    });
    model.addEventListener('change', () => { picker.value = model.value; });
    for (const input of [panel.querySelector('[data-setting="endpoint"]'), panel.querySelector('#cst-key')]) {
        input.addEventListener('input', reset);
        input.addEventListener('change', refresh);
    }
    panel.querySelector('[data-setting="provider"]').addEventListener('change', () => {
        reset();
        // A persisted private endpoint may require a key, re-entered this session.
        if (apiKey()) refresh();
    });
    reset();
}
