/**
 * inventory.js —— 背包 + 物品详情 + 拾取世界物品
 */

import { invApi, worldItemApi } from './api.js';

const KIND_ICON = {
  material:    '🧱',
  consumable:  '🍎',
  weapon:      '⚔️',
  armor:       '🛡️',
  key:         '🗝️',
};
const RARITY_CLASS = {
  common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary',
};

export function initInventory() {
  const grid = document.getElementById('inventory-grid');
  const emptyTip = document.getElementById('inventory-empty');

  const listBtn = document.getElementById('btn-inventory');
  const invModal = document.getElementById('inventory-modal');
  const itemModal = document.getElementById('item-modal');
  listBtn.addEventListener('click', () => openModal(invModal));

  document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => closeModal(document.getElementById(b.dataset.close)));
  });
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
  });

  // 详情弹窗
  document.getElementById('btn-close-item').addEventListener('click', () => closeModal(itemModal));
  document.getElementById('btn-destroy').addEventListener('click', async () => {
    const id = document.getElementById('btn-destroy').dataset.id;
    if (!id) return;
    try {
      await invApi.destroy(parseInt(id, 10));
      closeModal(itemModal);
      await load();
      showToast('已销毁', 'success');
    } catch (err) { showToast(err.message || '销毁失败', 'error'); }
  });

  const api = { load, getCount };
  return api;

  async function load() {
    let rows = [];
    try { rows = await invApi.list(); } catch { rows = []; }

    document.getElementById('stat-inv-count').textContent = rows.length + ' 件';

    const SLOT_COUNT = 25;
    grid.innerHTML = '';
    emptyTip.style.display = rows.length === 0 ? 'block' : 'none';

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      const item = rows[i];
      if (!item) { slot.classList.add('empty'); grid.appendChild(slot); continue; }

      const icon = KIND_ICON[item.kind] || '📦';
      slot.innerHTML = `
        <span class="inv-icon">${icon}</span>
        <span class="inv-qty">×${item.quantity}</span>
        <span class="inv-name">${item.name}</span>
      `;
      slot.title = item.name + '\n' + (item.description || '');
      slot.addEventListener('click', () => showDetail(item));
      grid.appendChild(slot);
    }
  }

  function getCount() { return grid.querySelectorAll('.inv-slot:not(.empty)').length; }

  function showDetail(item) {
    const icon = KIND_ICON[item.kind] || '📦';
    document.getElementById('item-name').textContent = item.name;
    document.getElementById('item-icon-big').textContent = icon;
    document.getElementById('item-kind').textContent = kindLabel(item.kind);
    const rarityEl = document.getElementById('item-rarity');
    rarityEl.textContent = rarityLabel(item.rarity);
    rarityEl.className = 'meta-value rarity ' + (RARITY_CLASS[item.rarity] || 'common');
    document.getElementById('item-qty').textContent = '×' + item.quantity;
    document.getElementById('item-desc').textContent = item.description || '—';
    document.getElementById('btn-destroy').dataset.id = item.id;
    openModal(itemModal);
  }
}

// ========== 世界可拾取物品弹窗 ==========
let currentWorldItem = null;
export function openWorldItem(item) {
  currentWorldItem = item;
  const d = item.item_def || {};
  const icon = KIND_ICON[d.kind] || '📦';
  document.getElementById('wi-title').textContent = item.label || d.name || '神秘物品';
  document.getElementById('wi-icon').textContent = icon;
  document.getElementById('wi-kind').textContent = kindLabel(d.kind);
  const rarityEl = document.getElementById('wi-rarity');
  rarityEl.textContent = rarityLabel(d.rarity);
  rarityEl.className = 'meta-value rarity ' + (RARITY_CLASS[d.rarity] || 'common');
  document.getElementById('wi-qty').textContent = '×' + item.quantity;
  document.getElementById('wi-desc').textContent = d.description || '—';
  openModal(document.getElementById('world-item-modal'));
}

document.addEventListener('click', async (e) => {
  if (e.target.id !== 'btn-pickup') return;
  if (!currentWorldItem) return;
  try {
    await worldItemApi.pickup(currentWorldItem.id);
    closeModal(document.getElementById('world-item-modal'));
    showToast('已拾取 ' + (currentWorldItem.item_def?.name || '物品'), 'success');
    currentWorldItem = null;
    // 通知 main.js 刷新世界物品 + 背包
    window.dispatchEvent(new CustomEvent('worlditem:pickup'));
  } catch (err) { showToast(err.message || '拾取失败', 'error'); }
});

function kindLabel(k) {
  return ({ material: '材料', consumable: '消耗品', weapon: '武器', armor: '防具', key: '钥匙' })[k] || k || '—';
}
function rarityLabel(r) {
  return ({ common: '普通', uncommon: '优良', rare: '稀有', epic: '史诗', legendary: '传说' })[r] || r || '—';
}

function openModal(m) { m.classList.add('open'); }
function closeModal(m) { m.classList.remove('open'); }

let toastTimer = null;
export function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
