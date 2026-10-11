import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, KEY, PLATFORMS, parseScene, renderScene, endpointUrl, requestIndependent, buildPrompt, cacheKey, signature, findRecord } from '../core.js';
import { TheatreRuntime } from '../runtime.js';

export const fixture = {
    title: '七楼的晚风', time: '周四 21:18', summary: '黎蔓压下了有关宴会座次的传闻，温梨借新包试探用户。',
    cast: [{ name: '黎蔓', status: '京圈，管理员，维护用户地位' }],
    publicGroup: { name: '全国雀友互助｜吃瓜勿外传', members: '286人', messages: [
        { name: '小满', tag: '新人', text: '有人知道昨晚京圈那场晚宴的事吗？', tone: 'neutral' },
        { name: '凌晨两点', tag: '匿名', text: '别看朋友圈合照，真正坐主桌的没有发照片。', tone: 'rumor' },
        { name: 'Coco课代表', tag: '卖课', text: '座次这种细节私聊我，我今晚有直播。', tone: 'neutral' },
        { name: '不吃画饼', tag: '潜水', text: '你上周还把同一张邀请函卖了三次。', tone: 'acid' },
        { name: '桃桃', tag: '拼单', text: '先不管座次了，明天下午茶还差两个人。', tone: 'neutral' },
    ] },
    privateGroup: { name: '内场｜七楼不对外', members: '6人', messages: [
        { name: '温梨', tag: '京圈', text: '刚到手的小包。你那边应该早就拿到了吧？我也是随口问问。', tone: 'flex' },
        { name: '乔婉', tag: '沪圈', text: '这个颜色倒是好买，省得等。', tone: 'acid' },
        { name: '宋澄', tag: '京圈', text: '送到手的还得挑一个好不好买？你们的售后挺忙。', tone: 'ally' },
        { name: '黎蔓', tag: '管理员', text: '外面那张名单有问题，别往这里搬。', tone: 'neutral' },
        { name: '许栀', tag: '港圈', text: '收到。有人把旧名单当新瓜，not surprised。', tone: 'rumor' },
    ] },
    posts: PLATFORMS.map(platform => ({ platform, kind: platform === '微信' ? '朋友圈' : '帖子', author: '乔婉', title: '晚上好', text: '［配图：落地窗边的一束花，手袋只露出一角。］\n不用赶最后一班飞机的周四。', location: '上海', likes: '128', comments: [{ name: '许栀', text: '花倒是配得很认真。' }, { name: '温梨', text: '某人今晚也在上海呀？' }] })),
};

test('parses wrapped JSON, normalizes tones, and requires selected channels', () => {
    const input = structuredClone(fixture);
    input.publicGroup.messages[0].tone = 'bad" onclick="alert(1)';
    const scene = parseScene('```json\n' + JSON.stringify(input) + '\n```');
    assert.equal(scene.publicGroup.messages[0].tone, 'neutral');
    assert.equal(scene.posts.length, 6);
    assert.throws(() => parseScene('{"title":"truncated'), /完整JSON/);
    assert.throws(() => parseScene('{}'), /缺少/);
    assert.throws(() => parseScene(JSON.stringify({ ...fixture, posts: [] })), /缺少豆瓣/);
});

test('HTML escapes all model-controlled text and rejects arbitrary classes', () => {
    const input = structuredClone(fixture);
    input.title = '<img src=x onerror=alert(1)>';
    input.publicGroup.messages[0].text = '<script>steal()</script>';
    input.posts[0].comments[0].name = '<svg onload=alert(1)>';
    input.publicGroup.messages[0].tone = 'x" onclick="alert(1)';
    const html = renderScene(input);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<svg'));
    assert.ok(!html.includes('onclick='));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('data-tab="private"'));
});

test('endpoint construction accepts base or full route and blocks credential URLs', () => {
    assert.equal(endpointUrl('https://api.example.test'), 'https://api.example.test/v1/chat/completions');
    assert.equal(endpointUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1/chat/completions');
    assert.equal(endpointUrl('https://example.test/custom/chat/completions'), 'https://example.test/custom/chat/completions');
    assert.throws(() => endpointUrl('javascript:alert(1)'));
    assert.throws(() => endpointUrl('https://secret@example.test/v1'));
    assert.throws(() => endpointUrl('https://example.test/v1?key=secret'));
});

test('independent transport sends correct payload; refuses truncated output', async () => {
    let request;
    const settings = { ...DEFAULTS, endpoint: 'https://example.test/v1', model: 'test-model' };
    const fetcher = async (url, options) => { request = { url, ...options }; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(fixture) } }] }) }; };
    const raw = await requestIndependent(settings, { system: 'sys', user: 'usr' }, 'session-secret', undefined, fetcher);
    assert.equal(parseScene(raw).title, fixture.title);
    assert.equal(request.headers.Authorization, 'Bearer session-secret');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, 'test-model'); assert.equal(payload.stream, false);
    assert.equal(payload.messages[0].role, 'system');
    const clipped = async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length' }] }) });
    await assert.rejects(requestIndependent(settings, { system: '', user: '' }, '', undefined, clipped), /截断/);
});

function mockRuntime(generator) {
    const chat = [{ name: '我', is_user: true, mes: '赴宴', send_date: 1 }, { name: '沈先生', mes: '车停在楼下。', send_date: 2 }];
    const settings = structuredClone(DEFAULTS);
    let saves = 0;
    let ctx = { chat, chatMetadata: {}, name1: '林晚', name2: '沈先生', characters: [], generateRaw: generator, saveMetadata: async () => saves++ };
    const renders = [];
    const runtime = new TheatreRuntime({ context: () => ctx, settings: () => settings, apiKey: () => '', render: index => renders.push({ index, active: !!runtime.active }) });
    return { runtime, settings, get ctx() { return ctx; }, set ctx(value) { ctx = value; }, renders, saves: () => saves };
}

async function run(runtime) { clearTimeout(runtime.timer); await runtime.drain(); clearTimeout(runtime.timer); }

test('auto jobs serialize, deduplicate, save metadata, and never change message text', async () => {
    let calls = 0;
    const mock = mockRuntime(async () => { calls++; return JSON.stringify(fixture); });
    const before = JSON.stringify(mock.ctx.chat);
    mock.runtime.enqueue(1); mock.runtime.enqueue(1);
    await run(mock.runtime);
    assert.equal(calls, 1); assert.equal(mock.saves(), 1);
    assert.equal(JSON.stringify(mock.ctx.chat), before);
    assert.equal(mock.runtime.record(mock.ctx.chat[1]).scene.title, fixture.title);
    assert.equal(mock.renders.at(-1).active, false);
    mock.runtime.enqueue(1); await run(mock.runtime); assert.equal(calls, 1);
    mock.runtime.enqueue(1, true); await run(mock.runtime); assert.equal(calls, 2);
});

test('host generation blocks queued work; next host request waits for raw completion', async () => {
    let finish;
    const mock = mockRuntime(() => new Promise(resolve => { finish = resolve; }));
    mock.runtime.hostBusy = true;
    mock.runtime.enqueue(1); await run(mock.runtime);
    assert.equal(finish, undefined);
    mock.runtime.hostEnded(); clearTimeout(mock.runtime.timer);
    const running = mock.runtime.drain();
    await Promise.resolve(); await Promise.resolve();
    let hostReady = false;
    const host = mock.runtime.hostStarted('normal', {}, false).then(() => { hostReady = true; });
    assert.equal(hostReady, false);
    finish(JSON.stringify(fixture)); await running; await host;
    assert.equal(hostReady, true); assert.equal(mock.runtime.hostBusy, true);
    clearTimeout(mock.runtime.timer);
});

test('switching chat discards stale output and never saves into the new chat', async () => {
    let finish;
    const mock = mockRuntime(() => new Promise(resolve => { finish = resolve; }));
    const old = mock.ctx;
    mock.runtime.enqueue(1); clearTimeout(mock.runtime.timer);
    const running = mock.runtime.drain(); await Promise.resolve(); await Promise.resolve();
    mock.runtime.cancel();
    mock.ctx = { ...old, chat: [{ name: '其他角色', mes: '新聊天' }], chatMetadata: {} };
    finish(JSON.stringify(fixture)); await running;
    assert.equal(mock.saves(), 0);
    assert.deepEqual(old.chatMetadata[KEY], {});
    assert.equal(mock.ctx.chatMetadata[KEY], undefined);
});

test('editing/deleting/swiping a message discards an in-flight result', async () => {
    for (const mutate of [ctx => { ctx.chat[1].mes += '修改'; }, ctx => { ctx.chat.splice(1); }, ctx => { ctx.chat[1].swipe_id = 1; }]) {
        let finish;
        const mock = mockRuntime(() => new Promise(resolve => { finish = resolve; }));
        mock.runtime.enqueue(1); clearTimeout(mock.runtime.timer);
        const running = mock.runtime.drain(); await Promise.resolve(); await Promise.resolve();
        mutate(mock.ctx); finish(JSON.stringify(fixture)); await running;
        assert.equal(mock.saves(), 0);
        assert.deepEqual(mock.ctx.chatMetadata[KEY], {});
    }
});

test('one failed output does not poison subsequent jobs; manual retry works', async () => {
    let calls = 0;
    const mock = mockRuntime(async () => ++calls === 1 ? 'not json' : JSON.stringify(fixture));
    mock.runtime.enqueue(1); await run(mock.runtime);
    assert.match(mock.runtime.errors.get(signature(mock.ctx.chat[1])), /JSON/);
    assert.equal(mock.renders.at(-1).active, false);
    mock.runtime.enqueue(1, true); await run(mock.runtime);
    assert.equal(mock.runtime.errors.size, 0); assert.equal(mock.saves(), 1);
});

test('prompt is bounded, substitutes persona, and uses prior matching scenes only', () => {
    const mock = mockRuntime(() => '');
    const message = mock.ctx.chat[1];
    const source = signature(message);
    const cache = { [cacheKey(source)]: { source, scene: fixture } };
    mock.ctx.chat.push({ name: '沈先生', mes: '第二轮', send_date: 3 });
    const prompt = buildPrompt(mock.ctx, 2, mock.settings, cache);
    assert.ok(prompt.system.includes('林晚'));
    assert.ok(!prompt.system.includes('{{user}}'));
    assert.ok(prompt.user.includes(fixture.summary));
    assert.ok(prompt.user.includes('第二轮'));
    assert.ok(!prompt.user.includes('session-secret'));
    message.mes = '不同版本';
    assert.equal(findRecord(cache, message), undefined);
});

test('platforms use separate native-shaped structures, including group bubbles', () => {
    const html = renderScene(parseScene(JSON.stringify(fixture)));
    for (const theme of ['wechat', 'douban', 'rednote', 'douyin', 'moments', 'twitter', 'instagram']) {
        assert.ok(html.includes(`cst-theme-${theme}`), theme);
    }
    for (const layout of ['cst-wechat-header', 'cst-bubble', 'cst-douban-group', 'cst-note-copy', 'cst-video-rail', 'cst-moments-likes', 'cst-tweet-copy', 'cst-ig-actions']) {
        assert.ok(html.includes(layout), layout);
    }
    assert.equal((html.match(/<details class="cst-replies /g) || []).length, 5);
    assert.ok(html.includes('data-brand="rednote"'));
});

test('media captions are text-only and older inline image descriptions still work', () => {
    const data = structuredClone(fixture);
    data.posts[1].media = '<img src=x onerror="alert(1)">';
    const scene = parseScene(JSON.stringify(data));
    const html = renderScene(scene);
    assert.ok(html.includes('&lt;img src=x'));
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('落地窗边的一束花'));
    assert.ok(!html.includes('［配图：'));
    assert.equal(scene.posts[0].media, '');
});
