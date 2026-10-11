import { KEY, eligible, signature, cacheKey, findRecord, buildPrompt, parseScene, requestIndependent } from './core.js';

// Event callbacks never await drain(): SillyTavern awaits message listeners itself.
export class TheatreRuntime {
    constructor({ context, settings, apiKey, status = () => {}, render = () => {} }) {
        Object.assign(this, { context, settings, apiKey, status, render });
        this.queue = [];
        this.epoch = 0;
        this.running = false;
        this.hostBusy = false;
        this.mainRequest = null;
        this.active = null;
        this.timer = null;
        this.errors = new Map();
    }

    cache(ctx = this.context()) {
        if (!ctx.chatMetadata[KEY]) ctx.chatMetadata[KEY] = {};
        return ctx.chatMetadata[KEY];
    }

    record(message) { return findRecord(this.cache(), message); }

    enqueue(index, force = false) {
        const ctx = this.context(), message = ctx.chat[index];
        if (!this.settings().enabled || !eligible(message)) return;
        const source = signature(message);
        if (!force && findRecord(this.cache(ctx), message)) { this.render(index); return; }
        if (this.active?.message === message && this.active.source === source) return;
        if (this.queue.some(j => j.message === message && j.source === source)) return;
        const job = { message, source, epoch: this.epoch, metadata: ctx.chatMetadata, force };
        this.queue.push(job);
        this.errors.delete(source);
        this.status(index, '等待生成…');
        this.schedule();
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.drain(); }, 400);
    }

    valid(job) {
        const ctx = this.context();
        return job.epoch === this.epoch && job.metadata === ctx.chatMetadata && this.settings().enabled
            && ctx.chat.includes(job.message) && eligible(job.message) && signature(job.message) === job.source;
    }

    async hostStarted(_type, _options, dryRun) {
        if (dryRun || _type === 'quiet') return;
        this.hostBusy = true;
        // Raw generation does not emit GENERATION_STARTED. Serialize the main API
        // before SillyTavern assembles the next foreground request.
        if (this.mainRequest) {
            try { await this.mainRequest; } catch { /* reported by drain */ }
        }
    }

    hostEnded() { this.hostBusy = false; this.schedule(); }

    cancel() {
        this.epoch++;
        this.queue = [];
        this.errors.clear();
        clearTimeout(this.timer);
        this.active?.controller?.abort();
        // Main API has no per-request cancellation in the public generateRaw API.
        // Keep the running slot until that promise settles; reject its stale result.
        this.render();
    }

    async drain() {
        if (this.running || this.hostBusy || !this.settings().enabled) return;
        this.running = true;
        try {
            while (this.queue.length && !this.hostBusy) {
                const job = this.queue.shift();
                if (!this.valid(job)) continue;
                const ctx = this.context(), index = ctx.chat.indexOf(job.message);
                const settings = structuredClone(this.settings());
                this.active = job;
                job.controller = new AbortController();
                const timeout = settings.provider === 'independent' ? setTimeout(() => job.controller.abort(), 120000) : null;
                this.status(index, '正在织起圈内风声…');
                try {
                    const prompt = buildPrompt(ctx, index, settings, this.cache(ctx));
                    let raw;
                    if (settings.provider === 'main') {
                        if (typeof ctx.generateRaw !== 'function') throw new Error('酒馆缺少generateRaw接口，请更新SillyTavern。');
                        this.mainRequest = Promise.resolve().then(() => ctx.generateRaw({
                            systemPrompt: prompt.system, prompt: prompt.user,
                            responseLength: settings.maxTokens, trimNames: false,
                        }));
                        raw = await this.mainRequest;
                    } else {
                        raw = await requestIndependent(settings, prompt, this.apiKey(), job.controller.signal);
                    }
                    if (!this.valid(job)) continue;
                    const scene = parseScene(raw, settings.platforms);
                    const current = this.context();
                    const cache = this.cache(current);
                    cache[cacheKey(job.source)] = { source: job.source, scene, created: Date.now() };
                    // Bounded archive. Keep the most recent 300 versions per chat.
                    const keys = Object.keys(cache).sort((a, b) => cache[a].created - cache[b].created);
                    for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete cache[key];
                    this.render(current.chat.indexOf(job.message));
                    await current.saveMetadata();
                } catch (error) {
                    if (this.valid(job)) {
                        let message = error instanceof Error ? error.message : '生成失败，请检查酒馆API连接。';
                        if (error?.name === 'AbortError') message = '独立API请求超时或已取消，可点击重试。';
                        if (error instanceof TypeError && settings.provider === 'independent') message = '无法连接独立API，请检查网络和该端点是否允许浏览器跨域（CORS）。';
                        // Do not echo response bodies or headers; they may contain secrets.
                        this.errors.set(job.source, message.slice(0, 500));
                        this.render(this.context().chat.indexOf(job.message));
                    }
                } finally {
                    clearTimeout(timeout);
                    this.mainRequest = null;
                    this.active = null;
                    if (this.valid(job)) this.render(this.context().chat.indexOf(job.message));
                }
            }
        } finally {
            this.running = false;
            if (this.queue.length && !this.hostBusy) this.schedule();
        }
    }
}
