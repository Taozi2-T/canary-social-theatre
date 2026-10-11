import { KEY, signature, cacheKey, eligible } from './core.js';

export const WORLD_KEY = `${KEY}_world_info`;
const modes = new Set(['active', 'selected', 'off']);
export function worldMode(settings) { return modes.has(settings.worldInfoMode) ? settings.worldInfoMode : 'active'; }

export async function worldBookNames(ctx, legacy = () => import('/scripts/world-info.js')) {
    // 1.13.2 exposes the loader but not getWorldInfoNames on getContext.
    const names = typeof ctx.getWorldInfoNames === 'function' ? ctx.getWorldInfoNames() : (await legacy()).world_names;
    return [...new Set(Array.isArray(names) ? names : [])].filter(name => typeof name === 'string' && name);
}

export function boundWorldEntries(entries, budget = 10000, substitute = text => text) {
    budget = Math.max(1000, Math.min(30000, Number(budget) || 10000));
    const result = [], seen = new Set();
    let size = 2, truncated = false;
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || entry.disable || typeof entry.content !== 'string' || !entry.content.trim()) continue;
        const normalized = {
            book: String(entry.world || entry.book || '').slice(0, 200),
            uid: String(entry.uid ?? '').slice(0, 60),
            title: String(entry.comment || entry.title || '').slice(0, 200),
            content: substitute(entry.content).trim(),
        };
        const id = JSON.stringify([normalized.book, normalized.uid, normalized.content]);
        if (seen.has(id)) continue;
        seen.add(id);
        const overhead = JSON.stringify({ ...normalized, content: '' }).length + 1;
        const remaining = budget - size - overhead;
        if (result.length >= 200 || remaining < 20) { truncated = true; break; }
        // Count escaped JSON characters too, so the material budget is predictable.
        if (JSON.stringify(normalized.content).length - 2 > remaining) {
            let low = 0, high = normalized.content.length;
            while (low < high) {
                const mid = Math.ceil((low + high) / 2);
                if (JSON.stringify(normalized.content.slice(0, mid)).length - 2 <= remaining) low = mid;
                else high = mid - 1;
            }
            normalized.content = normalized.content.slice(0, low);
            truncated = true;
        }
        size += JSON.stringify(normalized).length + 1;
        result.push(normalized);
        if (truncated) break;
    }
    return { entries: result, truncated };
}

export class WorldInfoMemory {
    constructor({ context, settings, changed = () => {} }) {
        Object.assign(this, { context, settings, changed });
        this.pending = null;
    }
    store(ctx = this.context()) {
        ctx.chatMetadata[WORLD_KEY] ??= { selected: [], records: {} };
        const store = ctx.chatMetadata[WORLD_KEY];
        store.selected ??= [];
        store.records ??= {};
        return store;
    }
    start(type, dryRun) {
        if (dryRun) return;
        // Quiet/impersonation scans and generateRaw calls are not story context.
        this.pending = !this.settings().enabled || worldMode(this.settings()) === 'off' || type === 'quiet' || type === 'impersonate' ? null
            : { metadata: this.context().chatMetadata, entries: [], accepting: true };
    }
    activated(entries) {
        const pending = this.pending;
        if (!this.settings().enabled || worldMode(this.settings()) === 'off' || !pending?.accepting || pending.metadata !== this.context().chatMetadata) return;
        const material = boundWorldEntries(entries, 30000);
        pending.entries = material.entries;
        pending.truncated = material.truncated;
    }
    end() { if (this.pending) this.pending.accepting = false; }
    reset() { this.pending = null; this.changed(); }
    async receive(index, type) {
        if (['quiet', 'impersonate', 'first_message'].includes(type)) return;
        if (!this.settings().enabled || worldMode(this.settings()) === 'off') { this.pending = null; return; }
        const ctx = this.context(), message = ctx.chat[index], pending = this.pending;
        if (!pending || pending.metadata !== ctx.chatMetadata || !eligible(message)) return;
        this.pending = null;
        const source = signature(message), store = this.store(ctx);
        store.records[cacheKey(source)] = { source, entries: pending.entries, truncated: !!pending.truncated, created: Date.now() };
        const keys = Object.keys(store.records).sort((a, b) => store.records[a].created - store.records[b].created);
        for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete store.records[key];
        this.changed();
        await ctx.saveMetadata();
    }
    record(ctx, message) {
        const source = signature(message), record = ctx.chatMetadata[WORLD_KEY]?.records?.[cacheKey(source)];
        return record?.source === source ? record : undefined;
    }
    async read(ctx, message, settings) {
        const mode = worldMode(settings);
        if (mode === 'off') return { mode, available: true, entries: [], truncated: false };
        if (mode === 'active') {
            const record = this.record(ctx, message);
            const material = boundWorldEntries(record?.entries, settings.worldInfoChars);
            return { mode, available: !!record, entries: material.entries, truncated: !!record?.truncated || material.truncated };
        }
        const names = [...new Set(ctx.chatMetadata[WORLD_KEY]?.selected || [])].filter(name => typeof name === 'string' && name).slice(0, 20);
        if (!names.length) throw new Error('请先为当前聊天勾选世界书，或改为读取正文触发条目。');
        if (typeof ctx.loadWorldInfo !== 'function') throw new Error('当前酒馆不支持读取指定世界书，请更新酒馆或改用正文触发模式。');
        const entries = [];
        for (const name of names) {
            let book;
            try { book = await ctx.loadWorldInfo(name); } catch { /* controlled error below */ }
            if (!book?.entries || typeof book.entries !== 'object') throw new Error(`无法读取世界书「${name}」，请检查它是否仍存在或重新选择。`);
            entries.push(...Object.values(book.entries).map(entry => ({ ...entry, world: name })));
        }
        const sub = text => ctx.substituteParams ? ctx.substituteParams(text) : text.replaceAll('{{user}}', ctx.name1 || '用户').replaceAll('{{char}}', message.name || ctx.name2 || '角色');
        return { mode, available: true, ...boundWorldEntries(entries, settings.worldInfoChars, sub) };
    }
}

export function bindWorldInfoSettings(panel, { context, settings, memory, save }) {
    const mode = panel.querySelector('[data-setting="worldInfoMode"]');
    const list = panel.querySelector('#cst-world-books');
    const status = panel.querySelector('#cst-world-status');
    let revision = 0;
    async function refresh() {
        const current = ++revision;
        const ctx = context(), selected = [...memory.store(ctx).selected];
        list.replaceChildren();
        list.hidden = worldMode(settings()) !== 'selected';
        let names = [];
        let failed = false;
        try { names = await worldBookNames(ctx); } catch { failed = true; }
        if (current !== revision || ctx.chatMetadata !== context().chatMetadata) return;
        names = [...new Set([...names, ...selected])].filter(name => typeof name === 'string' && name);
        for (const name of names) {
            const label = document.createElement('label'), input = document.createElement('input');
            input.type = 'checkbox'; input.checked = selected.includes(name);
            label.append(input, document.createTextNode(name));
            input.addEventListener('change', () => {
                const store = memory.store();
                if (input.checked && !store.selected.includes(name)) {
                    if (store.selected.length >= 20) { input.checked = false; status.textContent = '每个聊天最多选择 20 本世界书。'; return; }
                    store.selected.push(name);
                } else if (!input.checked) store.selected = store.selected.filter(n => n !== name);
                save();
            });
            list.append(label);
        }
        if (worldMode(settings()) === 'off') status.textContent = '世界书读取已关闭。';
        else if (worldMode(settings()) === 'selected') status.textContent = failed ? '无法获取世界书列表，请刷新或更新酒馆；正文触发模式仍可使用。' : names.length ? '勾选仅对当前聊天生效。读取未禁用条目，不检查关键词、概率、冷却或角色过滤。' : '尚未找到世界书，请先在酒馆导入，然后刷新列表。';
        else {
            const message = ctx.chat.findLast(eligible);
            const record = message ? memory.record(ctx, message) : undefined;
            status.textContent = record ? `最新回复已记录 ${record.entries.length} 条正文触发设定${record.truncated ? '（已达保存预算）' : ''}。`
                : '下一轮正文生成时自动记录触发条目；旧回复没有快照，可切换指定世界书模式。';
        }
    }
    mode.addEventListener('change', refresh);
    panel.querySelector('#cst-refresh-world-books').addEventListener('click', refresh);
    refresh();
    return refresh;
}
