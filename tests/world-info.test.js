import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, buildPrompt, KEY } from '../core.js';
import { WORLD_KEY, WorldInfoMemory, boundWorldEntries, worldBookNames } from '../world-info.js';
import { TheatreRuntime } from '../runtime.js';

const scene = JSON.stringify({ summary: '延续', publicGroup: { messages: [{ name: '甲', text: '消息' }] },
    privateGroup: { messages: [{ name: '乙', text: '消息' }] }, posts: [] });
function setup() {
    const settings = { ...structuredClone(DEFAULTS), platforms: [] };
    let saves = 0;
    let ctx = { chatMetadata: {}, chat: [{ name: '我', is_user: true, mes: '出发' }, { name: '沈先生', mes: '赴宴', send_date: 1 }],
        name1: '晚晚', name2: '沈先生', characters: [], saveMetadata: async () => saves++ };
    const memory = new WorldInfoMemory({ context: () => ctx, settings: () => settings });
    return { memory, settings, get ctx() { return ctx; }, set ctx(value) { ctx = value; }, saves: () => saves };
}
const entry = { world: '京圈', uid: 1, comment: '沈家', content: '沈先生来自京圈沈家。' };
async function run(runtime) { clearTimeout(runtime.timer); await runtime.drain(); clearTimeout(runtime.timer); }

test('world names support both current context and the 1.13.2 official module', async () => {
    assert.deepEqual(await worldBookNames({ getWorldInfoNames: () => ['京圈', '京圈', null] }, () => { throw new Error('unused'); }), ['京圈']);
    assert.deepEqual(await worldBookNames({}, async () => ({ world_names: ['沪圈', '', 12] })), ['沪圈']);
});

test('records the actual activated entries even when generation ended before message received', async () => {
    const h = setup();
    h.memory.start('normal', false);
    h.memory.activated([entry]);
    h.memory.end();
    h.memory.activated([{ ...entry, content: '外部 raw/quiet 请求不应覆盖' }]);
    await h.memory.receive(1, 'normal');
    const material = await h.memory.read(h.ctx, h.ctx.chat[1], h.settings);
    assert.equal(material.available, true);
    assert.equal(material.entries[0].content, entry.content);
    assert.equal(h.saves(), 1);
    const prompt = buildPrompt(h.ctx, 1, h.settings, {}, material);
    assert.ok(prompt.user.includes(entry.content));
    assert.ok(prompt.system.includes('秘密仍须遵守信息差'));
    assert.equal(h.ctx.chat[1].mes, '赴宴');
});

test('a round with no triggered entries is empty, never reuses the previous round', async () => {
    const h = setup();
    h.memory.start('normal', false); h.memory.activated([entry]); await h.memory.receive(1, 'normal');
    h.ctx.chat.push({ name: '沈先生', mes: '下一轮', send_date: 2 });
    h.memory.start('normal', false); await h.memory.receive(2, 'normal');
    const material = await h.memory.read(h.ctx, h.ctx.chat[2], h.settings);
    assert.equal(material.available, true);
    assert.deepEqual(material.entries, []);
    h.ctx.chat[2].mes += '修改';
    assert.equal((await h.memory.read(h.ctx, h.ctx.chat[2], h.settings)).available, false);
});

test('quiet, impersonation, disabled extension, and changed chats cannot contaminate snapshots', async () => {
    const h = setup();
    for (const type of ['quiet', 'impersonate']) {
        h.memory.start(type, false); h.memory.activated([entry]); await h.memory.receive(1, type);
        assert.equal(h.saves(), 0);
    }
    h.settings.enabled = false;
    h.memory.start('normal', false); h.memory.activated([entry]); await h.memory.receive(1, 'normal');
    assert.equal(h.saves(), 0);
    h.settings.enabled = true;
    h.memory.start('normal', false); h.memory.activated([entry]);
    h.ctx = { ...h.ctx, chatMetadata: {} };
    await h.memory.receive(1, 'normal');
    assert.equal(h.saves(), 0);
    h.memory.reset();
    assert.equal(h.memory.pending, null);
});

test('dry-run events leave a real generation snapshot intact and persisted snapshots survive reopening', async () => {
    const h = setup();
    h.memory.start('normal', false); h.memory.activated([entry]);
    h.memory.start('normal', true);
    await h.memory.receive(1, 'normal');
    const reopened = new WorldInfoMemory({ context: () => h.ctx, settings: () => h.settings });
    assert.equal((await reopened.read(h.ctx, h.ctx.chat[1], h.settings)).entries[0].book, '京圈');
});

test('selected books are per-chat, skip disabled entries, substitute macros, and retain source metadata', async () => {
    const h = setup(); h.settings.worldInfoMode = 'selected';
    h.memory.store().selected = ['京圈', '京圈'];
    let loads = 0;
    h.ctx.loadWorldInfo = async name => {
        loads++; assert.equal(name, '京圈');
        return { entries: { 1: { ...entry, content: '{{user}}的金主是{{char}}。' },
            2: { content: '禁用的隐藏设定', disable: true }, 3: { content: '未触发但被明确选择的设定', constant: false } } };
    };
    const material = await h.memory.read(h.ctx, h.ctx.chat[1], h.settings);
    assert.equal(loads, 1);
    assert.equal(material.entries.length, 2);
    assert.equal(material.entries[0].content, '晚晚的金主是沈先生。');
    assert.equal(material.entries[0].book, '京圈');
    h.ctx = { ...h.ctx, chatMetadata: {} };
    await assert.rejects(h.memory.read(h.ctx, h.ctx.chat[1], h.settings), /当前聊天勾选/);
});

test('selected-book failures are actionable, and off mode makes no book requests', async () => {
    const h = setup(); h.settings.worldInfoMode = 'selected'; h.memory.store().selected = ['删除的书'];
    await assert.rejects(h.memory.read(h.ctx, h.ctx.chat[1], h.settings), /更新酒馆/);
    h.ctx.loadWorldInfo = async () => null;
    await assert.rejects(h.memory.read(h.ctx, h.ctx.chat[1], h.settings), /是否仍存在/);
    h.ctx.loadWorldInfo = async () => { throw new Error('secret internal response'); };
    await assert.rejects(h.memory.read(h.ctx, h.ctx.chat[1], h.settings), /无法读取世界书/);
    h.settings.worldInfoMode = 'off';
    assert.deepEqual((await h.memory.read(h.ctx, h.ctx.chat[1], h.settings)).entries, []);
});

test('world material deduplicates and counts escaped content within the JSON character budget', () => {
    const material = boundWorldEntries([entry, entry, { ...entry, uid: 2, content: '"\n'.repeat(2000) }, { ...entry, uid: 3 }], 1000);
    assert.equal(material.entries.length, 2);
    assert.equal(material.truncated, true);
    assert.ok(JSON.stringify(material.entries).length <= 1000);
    assert.equal(material.entries[0].title, '沈家');
});

test('book loading that finishes after chat switching cannot send or save a theatre request', async () => {
    const h = setup(); h.settings.worldInfoMode = 'selected'; h.memory.store().selected = ['京圈'];
    let resolve, calls = 0;
    h.ctx.loadWorldInfo = () => new Promise(r => { resolve = r; });
    h.ctx.generateRaw = async () => { calls++; return scene; };
    const runtime = new TheatreRuntime({ context: () => h.ctx, settings: () => h.settings, apiKey: () => '', worldInfo: h.memory });
    runtime.enqueue(1); clearTimeout(runtime.timer);
    const running = runtime.drain();
    h.ctx = { ...h.ctx, chatMetadata: {} }; runtime.cancel();
    resolve({ entries: { 1: entry } }); await running;
    assert.equal(calls, 0); assert.equal(h.saves(), 0);
    assert.equal(h.ctx.chatMetadata[KEY], undefined);
});

test('foreground generation starting during book load defers theatre until the host finishes', async () => {
    const h = setup(); h.settings.worldInfoMode = 'selected'; h.memory.store().selected = ['京圈'];
    let resolve, calls = 0;
    h.ctx.loadWorldInfo = () => new Promise(r => { resolve = r; });
    h.ctx.generateRaw = async args => { calls++; assert.ok(args.prompt.includes(entry.content)); return scene; };
    const runtime = new TheatreRuntime({ context: () => h.ctx, settings: () => h.settings, apiKey: () => '', worldInfo: h.memory });
    runtime.enqueue(1); clearTimeout(runtime.timer);
    const running = runtime.drain();
    await runtime.hostStarted('normal', {}, false);
    resolve({ entries: { 1: entry } }); await running;
    assert.equal(calls, 0); assert.equal(runtime.queue.length, 1);
    h.ctx.loadWorldInfo = async () => ({ entries: { 1: entry } });
    runtime.hostEnded(); await run(runtime);
    assert.equal(calls, 1);
    assert.equal(runtime.record(h.ctx.chat[1]).worldInfoStatus.count, 1);
    assert.ok(h.ctx.chatMetadata[WORLD_KEY]);
});
