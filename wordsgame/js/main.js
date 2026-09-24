/**
 * main.js —— 入口协调
 * 登录 → 加载玩家当前地图 → TileWorld 渲染 → 点击寻路 →
 *         到达传送门 → 自动加载下一张地图 → NPC 对话 → 物品拾取
 */

import { initAuthForm, checkAuth, logout } from './auth.js';
import { authApi, mapApi, posApi, moneyApi, shopApi, itemApi, invApi,
         formatMoney, setToken, setUser, clearAuth, getToken } from './api.js';
// world.js 延迟加载——只有进入游戏时才加载，不阻塞登录页
// import { TileWorld, preloadTileTextures } from './world.js';
let _TileWorld = null;  // 动态 import 后赋值
let _preloadTileTextures = null;
import { initInventory, openWorldItem, showToast } from './inventory.js';

// ============ 气泡背景 ============
(function initBubbles() {
  const c = document.getElementById('bubble-container');
  function create() {
    const b = document.createElement('div');
    const size = Math.random() * 15 + 3;
    b.className = 'bubble';
    b.style.width = b.style.height = size + 'px';
    b.style.left = Math.random() * 100 + '%';
    b.style.animationDuration = (Math.random() * 8 + 6) + 's';
    b.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
    b.style.opacity = size < 8 ? '0.5' : '0.85';
    c.appendChild(b);
    setTimeout(() => b.remove(), 14000);
  }
  setInterval(create, 280);
})();

// ============ WebGL 预检（页面加载时立即检查）============
(function checkWebGL() {
  let ok = false;
  try {
    const c = document.createElement('canvas');
    ok = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch(e) {}
  if (!ok) {
    console.error('❌ WebGL 不可用！');
    // 给用户看一个醒目提示
    document.addEventListener('DOMContentLoaded', () => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2d1b1b;color:#ffb0b0;padding:30px;border-radius:12px;border:2px solid #ff6666;text-align:center;max-width:500px;font-family:sans-serif;z-index:99999';
      box.innerHTML = `
        <h2 style="margin:0 0 15px;font-size:20px">❌ WebGL 不可用</h2>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.6">你的浏览器/显卡不支持 WebGL 2，3D 地图无法渲染。</p>
        <p style="margin:0 0 10px;font-size:13px;color:#ff9999">请尝试：</p>
        <ol style="margin:0 0 10px;font-size:12px;text-align:left;color:#ffaaaa">
          <li>Chrome 设置 → 高级 → 系统 → 启用"硬件加速"</li>
          <li>访问 <code>chrome://gpu</code> 查看 WebGL 是否启用</li>
          <li>更新显卡驱动</li>
          <li>换 Safari / Firefox / Chrome 试试</li>
        </ol>
      `;
      document.body.appendChild(box);
    });
  } else {
    console.log('✅ WebGL 可用');
  }
})();

// ============ 视图切换 ============
const authView = document.getElementById('auth-view');
const gameView = document.getElementById('game-view');
let currentShopNpc = null;

function showAuth() {
  authView.classList.add('active');
  gameView.classList.remove('active');
  if (window.__world) { window.__world.destroy(); window.__world = null; }
  hidePortalBanner();
}
function showGame() {
  authView.classList.remove('active');
  gameView.classList.add('active');
  // 强制 reflow 让 canvas 有正确 clientWidth
  void gameView.offsetHeight;
}

// ============ 渲染用户信息 ============
function renderUser(user) {
  const nick = user && (user.nickname || user.username);
  document.getElementById('mini-nick').textContent = nick || '冒险者';

  // 刷新金币
  refreshMoney();
  const avatar = user && user.avatar;
  const ma = document.getElementById('mini-avatar');
  ma.innerHTML = '';
  if (avatar) {
    const img = document.createElement('img');
    img.src = avatar;
    img.onerror = () => { ma.textContent = '👤'; };
    ma.appendChild(img);
  } else { ma.textContent = '👤'; }
}

// ============ 加载地图 ============
let _worldModule = null;  // 缓存动态 import 的 world 模块

async function enterGame() {
  showGame();

  // 等 CSS transition 完成再读 canvas 尺寸
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // 动态 import world.js（避免模块加载时的错误阻塞登录页）
  if (!_worldModule) {
    try {
      _worldModule = await import('./world.js?v=107');
    } catch(err) {
      console.error('❌ world.js 加载失败:', err);
      alert('3D 引擎加载失败：' + (err.message || err) + '\n\n请打开浏览器控制台(F12)查看详情');
      showAuth();
      return;
    }
  }
  const { TileWorld: TW, preloadTileTextures: PT } = _worldModule;
  _TileWorld = TW;
  _preloadTileTextures = PT;

  // 预加载真实 512×512 瓦片贴图（如果网络慢或文件不存在，会 fallback 到 Canvas 手绘）
  try { await _preloadTileTextures(); } catch(e) { console.warn('preloadTileTextures 失败:', e.message); }

  // 先查后端玩家位置
  let playerPos = null;
  try { playerPos = await posApi.get(); } catch {}

  const startMapId = (playerPos && playerPos.map_id) || 'main';
  await loadMap(startMapId, playerPos);
}

async function loadMap(mapId, playerPos = null) {
  try {
    const data = await mapApi.load(mapId);

    // 如果提供了 playerPos（通常是 warp 之后），就用它覆盖后端返回
    if (playerPos) data.player = playerPos;

    if (!window.__world) {
      const canvas = document.getElementById('game-canvas');
      if (!_TileWorld) { await import('./world.js?v=107').then(m => { _TileWorld = m.TileWorld; }); }
      window.__world = new _TileWorld(canvas, {
        onPlayerMoved: handlePlayerMoved,
        onInteract: handleInteract,
        onWarp: handleWarp,
        onToast: showToast,
        onMapLoaded: handleMapLoaded,
      });
    }
    window.__world.loadMap(data);

    // 主动触发一次 resize（确保 canvas 拿到正确尺寸）
    requestAnimationFrame(() => window.__world._onResize?.());

    // 刷新金币显示
    refreshMoney();

    // 刷新背包
    if (window.__invApi) await window.__invApi.load();
  } catch (err) {
    console.error('loadMap failed:', err);
    showToast('加载地图失败：' + err.message, 'error');
  }
}

function handleMapLoaded({ mapId, name, width, height }) {
  document.getElementById('mini-map').textContent = name + ` · ${width}×${height}`;
  document.getElementById('stat-map').textContent = name;
}

function handlePlayerMoved({ mapId, x, y }) {
  document.getElementById('mini-pos')?.setAttribute?.('data-pos', `${x},${y}`);  // mini-pos 已整合到底部栏，这里只保留 stat-pos
  document.getElementById('stat-pos').textContent  = `${x}, ${y}`;

  // 节流 1.2s 上报后端
  const now = Date.now();
  if (!handlePlayerMoved._lastSync || now - handlePlayerMoved._lastSync > 1200) {
    handlePlayerMoved._lastSync = now;
    posApi.update(mapId, x, y).catch(() => {});
  }
}

function handleInteract(info) {
  if (info.type === 'npc') showNpcDialog(info.data);
  else if (info.type === 'item') openWorldItem(info.data);
}

function showNpcDialog(npc) {
  document.getElementById('npc-title').textContent =
    (npc.title ? npc.title + ' · ' : '') + npc.name;
  document.getElementById('npc-avatar').textContent = npc.name[0] || '?';
  document.getElementById('npc-dialog').textContent = npc.dialog || '...';

  const menuBox = document.getElementById('npc-menu');
  menuBox.innerHTML = '';
  const menu = (npc.menu && npc.menu.length) ? npc.menu : [{ label: '再见', action: 'close' }];
  for (const opt of menu) {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.addEventListener('click', () => handleNpcAction(npc, opt.action));
    menuBox.appendChild(btn);
  }
  document.getElementById('npc-modal').classList.add('open');
}

async function handleNpcAction(npc, action) {
  switch (action) {
    case 'close':
      document.getElementById('npc-modal').classList.remove('open');
      return;
    case 'replay_dialog':
      document.getElementById('npc-dialog').textContent = npc.dialog || '...';
      return;
    case 'give_apple':
    case 'give_potion': {
      const code = action === 'give_apple' ? 'apple' : 'potion';
      try {
        await (await import('./api.js')).invApi.give(code, 1);
        showToast('获得 ' + (code === 'apple' ? '苹果' : '药水') + ' ×1', 'success');
        if (window.__invApi) await window.__invApi.load();
      } catch (err) { showToast('失败：' + err.message, 'error'); }
      return;
    }
    case 'open_shop':
    case 'open_sell': {
      try {
        document.getElementById('npc-modal')?.classList.remove('open');
      } catch {}
      await openShop(npc, action === 'open_shop' ? 'buy' : 'sell');
      return;
    }
    case 'hint_secret':
      document.getElementById('npc-dialog').textContent =
        '据说水潭的中心藏着一颗红宝石，可惜被一棵树挡住了去路...';
      return;
    default:
      showToast('动作 ' + action + ' 暂未实现', '');
  }
}



// ============ 商店系统 ============
async function openShop(npc, defaultTab) {
  try {
    currentShopNpc = npc;
    // 先关所有 modal-overlay（防止 NPC modal 挡在上面）
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    // 强制 reflow，避免浏览器同时 add/remove 冲突
    document.body.offsetHeight;

    const el = document.getElementById('shop-modal');
    if (!el) { showToast('shop-modal DOM 没找到', 'error'); return; }
    document.getElementById('shop-title').textContent = (npc.title ? npc.title + ' · ' : '') + npc.name;
    el.classList.add('open');
    initShopTabsAndPager();
    // 每次打开商店重置到购买 Tab + 第 1 页
    document.querySelectorAll('.shop-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'buy'));
    document.getElementById('shop-panel-buy').classList.remove('hidden');
    document.getElementById('shop-panel-sell').classList.add('hidden');
    shopState.mode = 'buy';
    shopState.page = 1;
    await refreshShop();
  } catch(e) {
    console.error('[openShop]', e);
    showToast('打开商店失败: ' + e.message, 'error');
  }
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

// 商店分页状态
const SHOP_PAGE_SIZE = 6;
const shopState = {
  mode: 'buy',          // 'buy' | 'sell'
  buyData: [],          // [{def, price}]
  sellData: [],         // [item]
  page: 1,
};

function initShopTabsAndPager() {
  document.querySelectorAll('.shop-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shop-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      shopState.mode = btn.dataset.tab;
      shopState.page = 1;
      document.getElementById('shop-panel-buy').classList.toggle('hidden', shopState.mode !== 'buy');
      document.getElementById('shop-panel-sell').classList.toggle('hidden', shopState.mode !== 'sell');
      renderShopPage();
    });
  });
  document.getElementById('shop-prev').addEventListener('click', () => {
    if (shopState.page > 1) { shopState.page--; renderShopPage(); }
  });
  document.getElementById('shop-next').addEventListener('click', () => {
    const total = shopState.mode === 'buy' ? shopState.buyData.length : shopState.sellData.length;
    const maxPage = Math.max(1, Math.ceil(total / SHOP_PAGE_SIZE));
    if (shopState.page < maxPage) { shopState.page++; renderShopPage(); }
  });
}

function renderShopPage() {
  const list = shopState.mode === 'buy' ? document.getElementById('shop-buy-list') : document.getElementById('shop-sell-list');
  const data = shopState.mode === 'buy' ? shopState.buyData : shopState.sellData;
  list.innerHTML = '';
  if (!data.length) {
    list.innerHTML = '<div class="shop-list-empty">' + (shopState.mode === 'buy' ? '商人今天没货 🛒' : '背包空空如也') + '</div>';
  } else {
    const maxPage = Math.max(1, Math.ceil(data.length / SHOP_PAGE_SIZE));
    if (shopState.page > maxPage) shopState.page = maxPage;
    const start = (shopState.page - 1) * SHOP_PAGE_SIZE;
    const slice = data.slice(start, start + SHOP_PAGE_SIZE);
    for (const row of slice) {
      if (shopState.mode === 'buy') list.appendChild(buildShopBuyRow(row.def, row.price));
      else list.appendChild(buildShopSellRow(row));
    }
  }
  // 分页控件
  const total = data.length;
  const maxPage = Math.max(1, Math.ceil(total / SHOP_PAGE_SIZE));
  document.getElementById('shop-page-info').textContent = `${shopState.page} / ${maxPage}（共 ${total}）`;
  document.getElementById('shop-prev').disabled = shopState.page <= 1;
  document.getElementById('shop-next').disabled = shopState.page >= maxPage;
}

async function refreshShop() {
  if (!currentShopNpc) return;
  document.getElementById('shop-money').textContent = formatMoney(await getMoney());

  // 购买数据（缓存）
  try {
    const r = await itemApi.list();
    const itemList = Array.isArray(r) ? r : (r.data || []);
    const shopItems = currentShopNpc.shop_items || [];
    shopState.buyData = [];
    for (const si of shopItems) {
      const def = itemList.find(d => d.code === si.code);
      if (def) shopState.buyData.push({ def, price: si.price });
    }
  } catch(e) { console.error('[refreshShop] buyData error:', e); shopState.buyData = []; }

  // 出售数据（缓存）
  try {
    const inv = await invApi.list();
    shopState.sellData = Array.isArray(inv) ? inv : (inv.data || []);
  } catch(e) { console.error('[refreshShop] sellData error:', e); shopState.sellData = []; }

  shopState.page = 1;
  renderShopPage();
}

function buildShopBuyRow(def, price) {
  const row = document.createElement('div');
  row.className = 'shop-item buy-row';
  row.innerHTML = `
    <div class="si-icon">📦</div>
    <div class="si-info">
      <div class="si-name">${def.name}</div>
      <div class="si-meta">${def.description || ''}</div>
    </div>
    <div class="si-price">💰${price}</div>
    <div class="si-qty"><input type="number" min="1" max="99" value="1"></div>
    <button class="si-btn">买</button>
  `;
  const input = row.querySelector('input');
  const btn = row.querySelector('.si-btn');
  btn.onclick = async () => {
    const qty = parseInt(input.value) || 1;
    try {
      const r = await shopApi.buy(def.code, qty);
      showToast(`买了 ${def.name} ×${qty}`, 'success');
      document.getElementById('stat-money').textContent = formatMoney(r.money);
      if (window.__invApi) await window.__invApi.load();
      await refreshShop();
    } catch (e) { showToast(e.message || '购买失败', 'error'); }
  };
  return row;
}

function buildShopSellRow(it) {
  const sellPrice = Math.max(1, Math.floor((it.price || 0) * 0.6));
  const row = document.createElement('div');
  row.className = 'shop-item sell-row';
  row.innerHTML = `
    <div class="si-icon">📦</div>
    <div class="si-info">
      <div class="si-name">${it.name} ×${it.quantity}</div>
      <div class="si-meta">${it.description || ''}</div>
    </div>
    <div class="si-price">💰${sellPrice}</div>
    <div class="si-qty"><input type="number" min="1" max="${it.quantity}" value="1"></div>
    <button class="si-btn">卖</button>
  `;
  const input = row.querySelector('input');
  const btn = row.querySelector('.si-btn');
  btn.onclick = async () => {
    const qty = Math.min(parseInt(input.value) || 1, it.quantity);
    try {
      const r = await shopApi.sell(it.code, qty);
      showToast(`卖了 ${it.name} ×${qty}，得 ${r.item.unit_price * qty} 💰`, 'success');
      document.getElementById('stat-money').textContent = formatMoney(r.money);
      if (window.__invApi) await window.__invApi.load();
      await refreshShop();
    } catch (e) { showToast(e.message || '出售失败', 'error'); }
  };
  return row;
}

async function getMoney() {
  try {
    const r = await moneyApi.get();
    return r.money;
  } catch(e) { console.warn('[getMoney]', e); return 0; }
}


// 拾取完成：让 world 把这个 item 从场景里移除
window.addEventListener('worlditem:pickup', () => {
  if (!window.__world) return;
  const wi = window.__world.itemSprites.find(s => s.userData.item && !s.userData.item.removed);
  // 简单做法：直接重加载当前地图
  loadMap(window.__world.mapId).catch(() => {});
});

// ============ 传送门：走到格子上自动跳转 ============
let _warping = false;
async function handleWarp(portal) {
  if (_warping) return;
  _warping = true;
  hidePortalBanner();

  // 给一点过渡动画的感觉
  showToast('→ ' + (portal.label || '前往下一张地图'), 'success');

  try {
    // 先更新玩家坐标（到达新地图入口）
    await posApi.warp(portal.to_map_id, portal.to_tx, portal.to_ty);
    // 加载新地图
    await loadMap(portal.to_map_id, { map_id: portal.to_map_id, x: portal.to_tx, y: portal.to_ty });
  } catch (err) {
    showToast('跳转失败：' + err.message, 'error');
  } finally {
    _warping = false;
  }
}

// 额外：玩家靠近传送门格时显示一个提示条（让用户知道这里可以下一关）
setInterval(() => {
  if (!window.__world || !window.__world.mapId) return;
  const { tx, ty, portalSprites } = window.__world;
  for (const s of portalSprites) {
    const p = s.userData.portal;
    const d = Math.abs(p.from_tx - tx) + Math.abs(p.from_ty - ty);
    if (d <= 1) {
      showPortalBanner(p);
      return;
    }
  }
  hidePortalBanner();
}, 350);

function showPortalBanner(portal) {
  const banner = document.getElementById('portal-banner');
  document.getElementById('portal-text').textContent = portal.label || '前往下一关';
  banner.style.display = 'flex';
  document.getElementById('btn-warp').onclick = () => handleWarp(portal);
}
function hidePortalBanner() {
  document.getElementById('portal-banner').style.display = 'none';
}

// ============ 退出 ============
document.getElementById('btn-logout').addEventListener('click', () => {
  logout();
  showAuth();
  showToast('已退出登录', 'success');
});

// ============ 启动 ============
initInventory();
initAuthForm({ onLoginSuccess: enterGame });

if (checkAuth()) {
  authApi.me().then(user => {
    setUser(user);
    renderUser(user);
    enterGame();
  }).catch(() => {
    clearAuth(); showAuth();
  });
} else {
  showAuth();
}


// ============ 金币刷新 ============
async function refreshMoney() {
  try {
    const r = await moneyApi.get();
    const el = document.getElementById('stat-money');
    if (el) el.textContent = formatMoney(r.money);
    // 同时更新 localStorage 里的 user.money
    const cur = getUser();
    if (cur) { cur.money = r.money; setUser(cur); }
  } catch {}
}

