import { KEY, DEFAULTS, PLATFORMS, eligible, signature, escapeHtml, renderScene } from './core.js';
import { TheatreRuntime } from './runtime.js';
import { bindModelPicker } from './models.js';

const context = () => globalThis.SillyTavern.getContext();
let apiKey = ''; // Session-only. Never stored in chat, settings, exports, or logs.
let runtime;
let initialized = false;

function settings() {
    const ctx = context();
    ctx.extensionSettings[KEY] ??= structuredClone(DEFAULTS);
    const value = ctx.extensionSettings[KEY];
    for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
        if (value[key] === undefined) value[key] = structuredClone(defaultValue);
    }
    return value;
}

function mount(index) {
    const messageEl = document.querySelector(`#chat .mes[mesid="${index}"]`);
    if (!messageEl) return null;
    let root = messageEl.querySelector('.cst-shell');
    if (!root) {
        root = document.createElement('details');
        root.className = 'cst-shell';
        root.open = !settings().collapsed;
        root.innerHTML = '<summary><span>✦ 金丝雀 · 社交小剧场</span><span class="cst-summary-status"></span></summary><div class="cst-content"></div><div class="cst-actions"><button type="button" class="cst-regenerate">重新生成</button><button type="button" class="cst-export">导出HTML</button></div>';
        // Outside mes_text: the host's formatting/copy pipeline retains the RP text.
        (messageEl.querySelector('.mes_block') || messageEl).append(root);
    }
    return root;
}

function render(index) {
    if (index === undefined) {
        for (const el of document.querySelectorAll('#chat .mes[mesid]')) render(Number(el.getAttribute('mesid')));
        return;
    }
    const message = context().chat[index];
    if (!settings().enabled || !eligible(message)) {
        document.querySelector(`#chat .mes[mesid="${index}"] .cst-shell`)?.remove();
        return;
    }
    const record = runtime.record(message);
    const source = signature(message);
    const error = runtime.errors.get(source);
    const active = runtime.active?.epoch === runtime.epoch && runtime.active?.source === source;
    const queued = runtime.queue.some(j => j.source === source);
    const root = mount(index);
    if (!root) return;
    root.querySelector('.cst-summary-status').textContent = error ? '失败 · 可重试' : active ? '生成中' : queued ? '等待中' : record ? '已更新' : '待生成';
    root.querySelector('.cst-export').disabled = !record;
    root.querySelector('.cst-regenerate').disabled = active || queued;
    root.querySelector('.cst-regenerate').textContent = record ? '重新生成' : '生成 / 重试';
    const body = root.querySelector('.cst-content');
    if (record) {
        // All model strings are escaped by renderScene; only our own markup executes.
        if (body.dataset.record !== `${source}:${record.created}`) {
            body.innerHTML = renderScene(record.scene);
            body.dataset.record = `${source}:${record.created}`;
        }
        let errorEl = root.querySelector('.cst-error');
        if (error) {
            if (!errorEl) { errorEl = document.createElement('p'); errorEl.className = 'cst-error'; root.querySelector('.cst-actions').before(errorEl); }
            errorEl.textContent = error;
        } else errorEl?.remove();
    } else {
        delete body.dataset.record;
        body.innerHTML = `<p class="${error ? 'cst-error' : 'cst-placeholder'}">${escapeHtml(error || (active ? '正在生成群聊和好友动态…' : queued ? '正文结束后生成小剧场…' : '点击生成，或等待下一条角色回复。'))}</p>`;
    }
}

function status(index) { render(index); }

function notify(message) { globalThis.toastr?.info(message, '金丝雀小剧场'); }

function exportHtml(index) {
    const record = runtime.record(context().chat[index]);
    if (!record) return;
    const cssUrl = new URL('./style.css', import.meta.url);
    fetch(cssUrl).then(r => { if (!r.ok) throw new Error('样式读取失败'); return r.text(); }).then(css => {
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(record.scene.title)}</title><style>${css}\nbody{margin:0;padding:24px;background:#17181c;color:#f3eee8;font-family:system-ui,sans-serif}.cst-shell{max-width:850px;margin:auto}.cst-shell .cst-channel[hidden]{display:block!important}.cst-shell .cst-channel{margin-top:20px}.cst-tabs{display:none}</style></head><body><main class="cst-shell"><div class="cst-content">${renderScene(record.scene)}</div></main></body></html>`;
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `金丝雀小剧场-${index + 1}.html`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }).catch(() => notify('HTML导出失败，请刷新后重试。'));
}

function settingsUI() {
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container) throw new Error('未找到扩展设置面板。');
    const panel = document.createElement('div');
    panel.id = 'cst-settings';
    panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>✦ 金丝雀 · 社交小剧场</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">
        <p class="cst-help">角色回复后自动生成圈内群聊与好友动态。每次小剧场会额外调用一次模型。</p>
        <label class="checkbox_label"><input type="checkbox" data-setting="enabled"><span>启用每轮自动生成</span></label>
        <label class="checkbox_label"><input type="checkbox" data-setting="collapsed"><span>新小剧场默认折叠</span></label>
        <label>生成接口<select class="text_pole" data-setting="provider"><option value="main">酒馆当前主 API</option><option value="independent">独立 API（OpenAI兼容）</option></select></label>
        <div id="cst-independent"><label>API 基础地址或完整 chat/completions 地址<input class="text_pole" data-setting="endpoint" type="url" placeholder="https://api.example.com/v1" autocomplete="off"></label><label>可用模型<select class="text_pole" id="cst-model-list" disabled><option value="">先获取模型列表</option></select></label><button type="button" class="menu_button" id="cst-fetch-models">获取 / 刷新模型列表</button><p class="cst-help" id="cst-model-status" role="status" aria-live="polite"></p><label>当前模型（可手动填写）<input class="text_pole" data-setting="model" placeholder="获取后选择，或填写服务商模型ID"></label><label>API Key（仅本次页面会话保存）<input class="text_pole" id="cst-key" type="password" autocomplete="new-password" placeholder="无鉴权的本地服务可留空"></label><p class="cst-help">请求由浏览器直接发送，端点须允许CORS；HTTPS酒馆不能直连HTTP远端接口。密钥刷新后需重填。</p><label>温度<input class="text_pole" data-setting="temperature" type="number" min="0" max="2" step="0.05"></label></div>
        <div class="cst-setting-grid"><label>小剧场输出 token 上限<input class="text_pole" data-setting="maxTokens" type="number" min="1200" max="16000" step="100"></label><label>最近正文条数<input class="text_pole" data-setting="contextMessages" type="number" min="2" max="40"></label><label>正文字符预算<input class="text_pole" data-setting="contextChars" type="number" min="2000" max="60000" step="1000"></label><label>延续最近几轮小剧场<input class="text_pole" data-setting="memoryRounds" type="number" min="1" max="8"></label></div>
        <div class="cst-platform-options"><span>好友动态平台</span>${PLATFORMS.map(p => `<label><input type="checkbox" data-platform="${p}">${p}</label>`).join('')}</div>
        <label>圈内设定（可使用 {{user}}、{{char}}）<textarea class="text_pole" data-setting="world" rows="12"></textarea></label>
        <label>补充设定 / 文风 / 金主背景<textarea class="text_pole" data-setting="extraPrompt" rows="5" placeholder="例如：我的金主姓沈，京圈家族背景。群聊少用网络热梗，阴阳怪气更克制。"></textarea></label>
        <div class="cst-settings-actions"><button type="button" class="menu_button" id="cst-latest">生成最新回复</button><button type="button" class="menu_button" id="cst-cancel">取消待办 / 丢弃本次结果</button><button type="button" class="menu_button" id="cst-reset-world">恢复默认圈内设定</button></div><p id="cst-settings-status" class="cst-help">小剧场随当前聊天保存。可在每条回复下重试、换频道、导出HTML。</p>
        </div></div>`;
    container.append(panel);
    const value = settings();
    const numeric = { temperature: [0, 2], maxTokens: [1200, 16000], contextMessages: [2, 40], contextChars: [2000, 60000], memoryRounds: [1, 8] };
    for (const input of panel.querySelectorAll('[data-setting]')) {
        const key = input.dataset.setting;
        if (input.type === 'checkbox') input.checked = value[key]; else input.value = value[key];
        input.addEventListener('change', () => {
            let next = input.type === 'checkbox' ? input.checked : input.value;
            if (numeric[key]) {
                const [min, max] = numeric[key];
                next = Math.min(max, Math.max(min, Number(next) || DEFAULTS[key]));
                if (key !== 'temperature') next = Math.round(next);
                input.value = next;
            }
            settings()[key] = next;
            context().saveSettingsDebounced();
            if (key === 'provider' || key === 'enabled') runtime.cancel();
            panel.querySelector('#cst-independent').hidden = settings().provider !== 'independent';
            render();
        });
    }
    panel.querySelector('#cst-independent').hidden = value.provider !== 'independent';
    panel.querySelector('#cst-key').addEventListener('input', event => { apiKey = event.target.value.trim(); });
    bindModelPicker(panel, { settings, apiKey: () => apiKey, save: () => context().saveSettingsDebounced() });
    for (const input of panel.querySelectorAll('[data-platform]')) {
        input.checked = value.platforms.includes(input.dataset.platform);
        input.addEventListener('change', () => {
            settings().platforms = Array.from(panel.querySelectorAll('[data-platform]:checked'), el => el.dataset.platform);
            context().saveSettingsDebounced();
        });
    }
    panel.querySelector('#cst-latest').addEventListener('click', () => {
        const index = context().chat.findLastIndex(eligible);
        if (index < 0) notify('当前聊天还没有角色回复。'); else runtime.enqueue(index, true);
    });
    panel.querySelector('#cst-cancel').addEventListener('click', () => {
        const mainPending = !!runtime.mainRequest;
        runtime.cancel();
        notify(mainPending ? '待办已取消，主API返回结果将被丢弃；正在发送的主API请求仍会等待结束。' : '已取消待办和本次独立API请求。');
    });
    panel.querySelector('#cst-reset-world').addEventListener('click', () => {
        settings().world = DEFAULTS.world;
        panel.querySelector('[data-setting="world"]').value = DEFAULTS.world;
        context().saveSettingsDebounced();
    });
}

function init() {
    if (initialized) return;
    initialized = true;
    try {
        runtime = new TheatreRuntime({ context, settings, apiKey: () => apiKey, status, render });
        settingsUI();
        const ctx = context();
        const events = ctx.eventTypes || ctx.event_types;
        const on = (name, handler) => { if (events?.[name]) ctx.eventSource.on(events[name], handler); };
        on('GENERATION_STARTED', (...args) => runtime.hostStarted(...args));
        on('GENERATION_ENDED', () => runtime.hostEnded());
        on('MESSAGE_RECEIVED', (id, type) => {
            if (type === 'quiet' || type === 'impersonate') return;
            runtime.enqueue(Number(id));
        });
        on('CHARACTER_MESSAGE_RENDERED', id => render(Number(id)));
        on('MESSAGE_UPDATED', id => render(Number(id)));
        on('MESSAGE_EDITED', id => { render(Number(id)); });
        on('MESSAGE_SWIPED', id => { render(Number(id)); });
        on('MESSAGE_DELETED', () => render());
        on('MORE_MESSAGES_LOADED', () => render());
        on('CHAT_CHANGED', () => { runtime.cancel(); runtime.hostBusy = false; setTimeout(render, 100); });
        document.addEventListener('click', event => {
            const button = event.target.closest?.('.cst-shell button');
            if (!button) return;
            const root = button.closest('.cst-shell');
            const index = Number(button.closest('.mes')?.getAttribute('mesid'));
            if (button.classList.contains('cst-tab')) {
                for (const tab of root.querySelectorAll('.cst-tab')) {
                    const active = tab === button; tab.classList.toggle('is-active', active); tab.setAttribute('aria-pressed', String(active));
                }
                for (const channel of root.querySelectorAll('.cst-channel')) channel.hidden = channel.dataset.channel !== button.dataset.tab;
            } else if (button.classList.contains('cst-regenerate')) runtime.enqueue(index, true);
            else if (button.classList.contains('cst-export')) exportHtml(index);
        });
        render();
    } catch {
        console.error('[Canary Theatre] 初始化失败，请检查酒馆版本及扩展设置面板。');
        globalThis.toastr?.error('金丝雀小剧场初始化失败，请使用SillyTavern 1.13.2或更新版本。');
    }
}

const ctx = context();
const eventTypes = ctx.eventTypes || ctx.event_types;
if (eventTypes?.APP_READY) ctx.eventSource.on(eventTypes.APP_READY, () => { setTimeout(init, 0); });
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else setTimeout(init, 0);

