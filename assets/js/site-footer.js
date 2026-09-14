/*
 * 站点通用页脚组件（与 index.html 首页底部保持一致，供全站复用）
 *
 * 用法：在页面中引入本文件，并放置一个挂载点：
 *   <div data-site-footer></div>
 *   <script src="assets/js/site-footer.js"></script>
 *
 * 可选模式（data-mode）：
 *   - "flow"    （默认）普通文档流页脚，适合内容页（如 notes.html）
 *   - "overlay" 绝对定位悬浮在页面底部，适合全屏首页（如 index.html）
 *
 * 也可手动调用：siteFooter.mount(element, mode)
 */
(function () {
  'use strict';

  /* 底部快捷链接（全站统一，在此处维护） */
  var FOOTER_LINKS = [
    { name: '我的导航', url: 'nav.html' },
    { name: '我的笔记', url: 'notes.html' },
    { name: '提示词器', url: 'prompt.html' },
    { name: '学习单词', url: 'words.html' },
    { name: '梦幻国度', url: 'dreamland.html' },
    { name: '颜色代码', url: 'tools/color.html' }
  ];

  var CSS = ''
    + '.site-footer{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);'
    + 'display:flex;flex-direction:column;align-items:center;gap:6px;z-index:10;}'
    + '.site-footer[data-mode="flow"]{position:static;transform:none;padding:40px 16px 28px;}'
    + '.site-footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 10px;max-width:92vw;}'
    + '.site-footer-links a{padding:4px 10px;border-radius:8px;font-size:12px;'
    + 'color:rgba(22,23,28,0.55);background:rgba(255,255,255,0.5);'
    + 'border:1px solid rgba(22,23,28,0.06);transition:all 0.15s;white-space:nowrap;}'
    + '.site-footer-links a:hover{color:rgba(22,23,28,0.88);background:#ffd83d;border-color:#ffd83d;}'
    + '.site-footer-links a.is-external::after{content:" ↗";opacity:0.6;}'
    + '.site-footer-copy{font-size:12px;color:rgba(22,23,28,0.55);letter-spacing:1px;'
    + 'text-shadow:0 1px 4px rgba(255,255,255,0.65);margin:0;}'
    + '@media (max-width:768px){.site-footer{bottom:8px;}.site-footer-copy{font-size:10px;}}'
    + '@media (max-width:480px){.site-footer{bottom:6px;}.site-footer-copy{font-size:9px;padding:0 10px;text-align:center;}}';

  function injectStyle() {
    if (document.getElementById('site-footer-style')) return;
    var style = document.createElement('style');
    style.id = 'site-footer-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function buildFooterHtml() {
    var year = new Date().getFullYear();
    var links = FOOTER_LINKS.map(function (item) {
      return '<a href="' + item.url + '">' + item.name + '</a>';
    }).join('');
    return '<nav class="site-footer-links">' + links + '</nav>'
      + '<p class="site-footer-copy">Copyright 2011-' + year + ' DuChaoQun Design · Made with ❤️</p>';
  }

  /* 将页脚渲染到指定容器 */
  function mount(el, mode) {
    if (!el) return;
    injectStyle();
    el.setAttribute('data-site-footer', '');
    el.setAttribute('data-mode', mode || el.getAttribute('data-mode') || 'flow');
    el.classList.add('site-footer');
    el.innerHTML = buildFooterHtml();
  }

  /* 自动挂载页面上所有 [data-site-footer] 元素 */
  function autoMount() {
    var nodes = document.querySelectorAll('[data-site-footer]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  window.siteFooter = { mount: mount, links: FOOTER_LINKS };
})();
