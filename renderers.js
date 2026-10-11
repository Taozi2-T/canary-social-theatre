const THEMES = {
    '豆瓣': 'douban', '小红书': 'rednote', '抖音': 'douyin',
    '微信': 'moments', '推特/X': 'twitter', 'Instagram': 'instagram',
};

// All dynamic values pass through e(). No model HTML, remote images, or scripts.
export function createRenderers(e) {
    const avatar = (name, extra = '') => `<span class="cst-avatar ${extra}">${e(String(name).slice(0, 1))}</span>`;
    const badge = label => `<span class="cst-view-label">${e(label)}</span>`;
    const header = (theme, brand, right = '') => `<header class="cst-appbar cst-appbar-${theme}"><strong>${e(brand)}</strong><span>${e(right)}</span></header>`;
    const comments = (p, theme) => `<details class="cst-replies cst-replies-${theme}" open><summary>评论 / 回复 <span>${p.comments.length}</span></summary><div class="cst-reply-list">${p.comments.map(c => `<article class="cst-reply">${avatar(c.name)}<div><strong>${e(c.name)}</strong><p>${e(c.text)}</p></div></article>`).join('')}</div></details>`;
    const meta = p => `${p.location ? `${e(p.location)} · ` : ''}${e(p.kind)}`;
    const author = (p, suffix = '') => `<div class="cst-author">${avatar(p.author)}<div><strong>${e(p.author)}</strong><span>${meta(p)}</span></div>${suffix}</div>`;
    function splitMedia(p) {
        const match = p.text.match(/［(?:配图|图片|照片|视频)[：:]([^］]+)］/);
        return { caption: p.media || match?.[1] || '', text: match ? p.text.replace(match[0], '').trim() : p.text };
    }
    function media(p, theme, force = false) {
        const { caption } = splitMedia(p);
        if (!caption && !force) return '';
        return `<figure class="cst-media cst-media-${theme}"><div class="cst-media-art" aria-hidden="true"><span class="cst-art-orbit"></span><span class="cst-art-line"></span><span class="cst-art-disc"></span></div><figcaption><span>◫ ${theme === 'douyin' ? '视频画面' : '配图画面'} · 文字描述</span><p>${e(caption || '这条动态没有提供画面描述')}</p></figcaption></figure>`;
    }
    const body = p => `<p class="cst-post-text">${e(splitMedia(p).text)}</p>`;
    const stats = (p, theme) => `<div class="cst-social-stats cst-social-stats-${theme}"><span>♡ ${e(p.likes)}</span><span>◎ ${p.comments.length} 条${theme === 'twitter' ? '回复' : '评论'}</span>${badge('圈内动态')}</div>`;

    function group(g, id, hidden = true) {
        return `<section class="cst-channel cst-theme-wechat" data-channel="${id}" ${hidden ? 'hidden' : ''}>
            <header class="cst-wechat-header"><span aria-hidden="true">‹</span><div><strong>${e(g.name)}</strong><span>${e(g.members)} · ${id === 'private' ? '核心好友群' : '群聊'}</span></div><span aria-hidden="true">···</span></header>
            <div class="cst-wechat-date">以下为本轮群聊记录</div><div class="cst-chat">${g.messages.map(m => `<article class="cst-msg"><span class="cst-avatar cst-avatar-wechat">${e(m.name.slice(0, 1))}</span><div><div class="cst-speaker">${e(m.name)} <span>${e(m.tag)}</span></div><p class="cst-bubble">${e(m.text)}</p></div></article>`).join('')}</div>
            <footer class="cst-chat-footer"><span aria-hidden="true">◉</span><span class="cst-readonly-input">群聊记录 · 等待新的圈内风声</span><span aria-hidden="true">☺ ⊕</span></footer></section>`;
    }

    function post(p) {
        // A group-chat screenshot still uses chat bubbles within its platform page.
        const chatPost = /群聊/.test(p.kind);
        let html;
        switch (p.platform) {
            case '豆瓣':
                html = `${header('douban', '豆瓣', '小组 · 讨论')}<div class="cst-douban-group"><span>雀友匿名讨论组</span>${badge('组内帖子')}</div><article class="cst-douban-post"><h4>${e(p.title)}</h4>${author(p)}${media(p, 'douban')}${body(p)}${stats(p, 'douban')}${comments(p, 'douban')}</article>`;
                break;
            case '小红书':
                html = `${header('rednote', '小红书', '发现 · 好友笔记')}<article class="cst-rednote-post">${author(p, badge('好友'))}${media(p, 'rednote', true)}<div class="cst-note-copy"><h4>${e(p.title)}</h4>${body(p)}<p class="cst-note-location">${p.location ? `⌖ ${e(p.location)} · ` : ''}生活碎片</p>${stats(p, 'rednote')}${comments(p, 'rednote')}</div></article>`;
                break;
            case '抖音':
                html = `${header('douyin', '抖音', '关注　 推荐')}<article class="cst-douyin-post"><div class="cst-video-scene">${media(p, 'douyin', true)}<div class="cst-video-rail">${avatar(p.author)}<div>♥<small>${e(p.likes)}</small></div><div>●<small>${p.comments.length} 评论</small></div><div>♫<small>原声</small></div></div><div class="cst-video-caption"><strong>@${e(p.author)}</strong><h4>${e(p.title)}</h4>${body(p)}<span>♫ ${e(p.author)}的原声 · ${e(p.location || '日常记录')}</span></div></div><div class="cst-video-discussion">${comments(p, 'douyin')}</div></article>`;
                break;
            case '微信':
                html = `${header('moments', '朋友圈', '•••')}<div class="cst-moments-cover"><span>圈内好友</span><strong>生活里，留一点余白。</strong></div><article class="cst-moments-post">${avatar(p.author)}<div class="cst-moments-copy"><strong>${e(p.author)}</strong>${p.title ? `<h4>${e(p.title)}</h4>` : ''}${body(p)}${media(p, 'moments')}<div class="cst-moments-meta"><span>${e(p.location || '仅好友可见')}</span><span>••</span></div><div class="cst-moments-likes">♡ ${e(p.likes)} 位好友觉得很赞</div><div class="cst-moments-comments">${p.comments.map(c => `<p><strong>${e(c.name)}</strong>：${e(c.text)}</p>`).join('')}</div></div></article>`;
                break;
            case '推特/X':
                html = `${header('twitter', '𝕏', '为你推荐　 正在关注')}<article class="cst-twitter-post">${author(p, '<span class="cst-post-menu" aria-hidden="true">···</span>')}<div class="cst-tweet-copy"><h4>${e(p.title)}</h4>${body(p)}${media(p, 'twitter')}${stats(p, 'twitter')}</div>${comments(p, 'twitter')}</article>`;
                break;
            case 'Instagram':
                html = `${header('instagram', 'Instagram', '♡　⌁')}<article class="cst-instagram-post">${author(p, '<span class="cst-post-menu" aria-hidden="true">···</span>')}${media(p, 'instagram', true)}<div class="cst-instagram-copy"><div class="cst-ig-actions" aria-hidden="true">♡　◎　⌁ <span>▱</span></div><strong class="cst-ig-likes">${e(p.likes)} likes</strong><h4>${e(p.title)}</h4>${body(p)}${comments(p, 'instagram')}</div></article>`;
                break;
            default:
                html = `${author(p)}<h4>${e(p.title)}</h4>${body(p)}${comments(p, 'generic')}`;
        }
        if (chatPost) html += `<aside class="cst-chat-excerpt"><span class="cst-chat-excerpt-title">私密群聊节选</span>${p.comments.map(c => `<div class="cst-msg">${avatar(c.name)}<div><div class="cst-speaker">${e(c.name)}</div><p class="cst-bubble">${e(c.text)}</p></div></div>`).join('')}</aside>`;
        return `<div class="cst-platform-page cst-page-${THEMES[p.platform] || 'generic'}">${html}</div>`;
    }

    function scene(scene) {
        const platforms = [...new Set(scene.posts.map(p => p.platform))];
        const tabs = [{ id: 'public', name: '微信 · 大群', theme: 'wechat' }, { id: 'private', name: '微信 · 小群', theme: 'wechat' }, ...platforms.map((p, i) => ({ id: `p${i}`, name: p, theme: THEMES[p] || 'generic' }))];
        return `<div class="cst-topline"><span>CANARY SOCIAL CLUB</span><span>${e(scene.time)}</span></div><h3>${e(scene.title)}</h3><nav class="cst-tabs" aria-label="小剧场频道">${tabs.map((t, i) => `<button type="button" class="cst-tab ${i === 0 ? 'is-active' : ''}" data-tab="${t.id}" data-brand="${t.theme}" aria-pressed="${i === 0}">${e(t.name)}</button>`).join('')}</nav>${group(scene.publicGroup, 'public', false)}${group(scene.privateGroup, 'private')}${platforms.map((platform, i) => `<section class="cst-channel cst-theme-${THEMES[platform] || 'generic'}" data-channel="p${i}" hidden>${scene.posts.filter(p => p.platform === platform).map(post).join('')}</section>`).join('')}<div class="cst-footnote">圈内闲谈 · 虚构剧情 · 不代替你的发言</div>`;
    }
    return { scene };
}
