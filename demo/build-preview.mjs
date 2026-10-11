import { readFile, writeFile } from 'node:fs/promises';
import { renderScene } from '../core.js';
const msg = (name, tag, text, tone = 'neutral') => ({ name, tag, text, tone });
const scene = {
    title: '七楼的晚风，谁的座次又变了', time: '周四 · 21:18',
    publicGroup: { name: '全国雀友互助｜吃瓜勿外传', members: '286人', messages: [
        msg('小满', '新人', '昨晚京圈那场晚宴，有人去了吗？朋友圈怎么都没照片。'),
        msg('凌晨两点', '匿名', '有照片的坐外面。里面那几桌，手机都收着。', 'rumor'),
        msg('阿棠', '刚入圈', '我只知道临时换了名单。有人到了门口才知道自己进不去。', 'rumor'),
        msg('Coco课代表', '卖课', '我今晚讲这个。识别有效资源，私聊我领资料。'),
        msg('不吃画饼', '潜水', '你上周还把同一张邀请函卖了三次。', 'acid'),
        msg('桃桃', '拼单', '先不管邀请函了，明天下午茶还差两位，只拍照不吃也行。'),
        msg('小满', '新人', '所以那位新来的又没拿到名分？'),
        msg('凌晨两点', '匿名', '别把进场当名分。有人连名字都不能被提，只能叫“那位”。', 'rumor'),
    ] },
    privateGroup: { name: '内场｜七楼不对外', members: '6人', messages: [
        msg('温梨', '京圈', '［图片：香槟色小包放在副驾。］刚到手。晚晚那边应该早就有了吧？我也是随口问问。', 'flex'),
        msg('乔婉', '沪圈', '这个颜色倒是好买，省得等。', 'acid'),
        msg('宋澄', '京圈', '送到手的还得挑好不好买？你们的售后挺忙。', 'ally'),
        msg('温梨', '京圈', '我又没那个意思，别给我扣帽子呀。'),
        msg('许栀', '港圈', '说起来，昨晚那张名单是谁往外传的？旧的也能拿来当新闻。', 'rumor'),
        msg('黎蔓', '管理员', '外面的消息别搬过来。座次的事到此为止。'),
        msg('乔婉', '沪圈', '懂，有些人的位置是不用写在名单上的。', 'acid'),
    ] },
    posts: [
        { platform: '豆瓣', kind: '匿名帖子', author: '橘子汽水不加冰', title: '那张邀请函到底有几版？', text: '朋友给我看了两张，连日期都不一样。别再拿那张旧图说谁失宠了。\n有人知道原图最早从哪个群出来的吗？', likes: '87', comments: [{ name: '不吃画饼', text: '唯一确定的是卖课的今晚又要开播了。' }, { name: '路过七楼', text: '旧图。剩下的别问。' }] },
        { platform: '小红书', kind: '晒单', author: '温梨的周四', title: '被认真记住的小偏好 🥂', text: '［配图：副驾上的香槟色手袋，窗外是夜景。］\n说过一次喜欢这个颜色，没想到真的记住了。今天的小确幸。\n#晚间碎片 #日常记录', location: '北京', likes: '218', comments: [{ name: '乔婉', text: '这个颜色今年铺货挺多，终于不用等了。' }, { name: '温梨的周四', text: '是呀，省得麻烦人。' }] },
        { platform: '抖音', kind: '短视频', author: '阿棠', title: '今日份下班接送', text: '［视频：只拍到车窗外一排灯光，镜头没有转向驾驶座。］\n最后一班地铁，今天不用赶了。', likes: '1206', comments: [{ name: '桃桃', text: '拍得挺像偶像剧。' }, { name: '不吃画饼', text: '明天几点上班？' }] },
        { platform: '微信', kind: '好友朋友圈', author: '乔婉', title: '晚上好', text: '［图片：落地窗旁的白色花束，餐桌只摆了一个杯子。］\n不用赶飞机的周四。', location: '上海', likes: '26', comments: [{ name: '许栀', text: '花选得很认真。' }, { name: '宋澄', text: '别又忙到花谢了才回家。' }] },
        { platform: '推特/X', kind: '小号动态', author: '凌晨两点', title: '有趣', text: '今晚最大的瓜，不是谁换了新包。\n是有人突然删掉了半年没换过的置顶。\n不点名，睡了。', likes: '63', comments: [{ name: '匿名雀友', text: '你每次说睡了都还有下一条。' }, { name: '凌晨两点', text: '今晚真没了。' }] },
        { platform: 'Instagram', kind: '好友动态', author: 'zhi.afterhours', title: 'Quiet evening.', text: '［照片：酒店走廊里的背影，手里拎着一个没有标识的礼品袋。］\nSome things stay off the guest list. 🕯️', location: 'Hong Kong', likes: '309', comments: [{ name: 'wan.q', text: 'Lovely lighting.' }, { name: 'zhi.afterhours', text: 'It makes everything look expensive.' }] },
    ],
};
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>金丝雀社交小剧场 · 展示预览</title><style>${css}\nbody{margin:0;background:#131419;color:#e9e1d6;font:14px/1.7 system-ui,sans-serif;padding:28px 18px}.preview{max-width:850px;margin:auto}.preview>p{color:#aa9f91;font-size:13px;margin:0 0 22px}.preview h1{font-size:23px;font-weight:500;color:#d3b580}.cst-shell{margin:0}</style></head><body><main class="preview"><h1>金丝雀 · 社交小剧场</h1><p>这是手工编写的展示样例，安装后的内容由所选模型根据角色正文生成。点击下方频道切换群聊与好友动态。</p><div class="cst-shell"><div class="cst-content">${renderScene(scene)}</div></div></main><script>document.addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(!button)return;for(const tab of document.querySelectorAll('[data-tab]')){const active=tab===button;tab.classList.toggle('is-active',active);tab.setAttribute('aria-pressed',String(active));}for(const section of document.querySelectorAll('[data-channel]'))section.hidden=section.dataset.channel!==button.dataset.tab;});</script></body></html>`;
await writeFile(new URL('./preview.html', import.meta.url), html, 'utf8');
console.log('展示预览已生成');

