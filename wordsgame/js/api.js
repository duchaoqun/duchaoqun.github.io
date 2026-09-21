/**
 * api.js —— 后端接口封装 + Token 管理
 */

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
  ? 'http://127.0.0.1:5050/api'
  : 'http://127.0.0.1:5050/api';

const TOKEN_KEY = 'wordsgame_token';
const USER_KEY  = 'wordsgame_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
}
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function setUser(u) {
  if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
  else localStorage.removeItem(USER_KEY);
}
export function clearAuth() { setToken(''); setUser(null); }

async function request(path, { method = 'GET', body = null, auth = true, headers = {} } = {}) {
  const url = API_BASE + path;
  const hdrs = { 'Content-Type': 'application/json', ...headers };
  if (auth) {
    const token = getToken();
    if (token) hdrs['Authorization'] = 'Bearer ' + token;
  }
  const opts = { method, headers: hdrs, credentials: 'omit' };
  if (body !== null) opts.body = JSON.stringify(body);

  let resp;
  try { resp = await fetch(url, opts); } catch (err) { throw new Error('网络错误：' + err.message); }

  let json;
  try { json = await resp.json(); } catch { json = null; }

  if (!resp.ok || (json && json.code !== 0)) {
    const msg = (json && json.message) || ('HTTP ' + resp.status);
    const err = new Error(msg);
    err.status = resp.status;
    err.code = json && json.code;
    throw err;
  }
  return json && json.data !== undefined ? json.data : json;
}

// ============ 认证 ============
export const authApi = {
  register: (d) => request('/register', { method: 'POST', body: d, auth: false }),
  login:    (d) => request('/login',    { method: 'POST', body: d, auth: false }),
  me:       () => request('/me'),
  updateMe: (d) => request('/me', { method: 'PUT', body: d }),
};

// ============ 地图 ============
export const mapApi = {
  list: (auth = false) => request('/maps', { auth }),
  load: (id) => request('/maps/' + id),
};

// ============ 玩家位置（瓦片坐标）============
export const posApi = {
  get:  () => request('/player/position'),
  update: (mapId, x, y) => request('/player/position', {
    method: 'PUT', body: { map_id: mapId, x, y },
  }),
  warp: (mapId, x, y) => request('/player/warp', {
    method: 'POST', body: { map_id: mapId, x, y },
  }),
};

// ============ 背包 ============
export const invApi = {
  list:    () => request('/inventory'),
  destroy: (id) => request('/inventory/' + id, { method: 'DELETE' }),
  give:    (code, qty = 1) => request('/inventory/give', { method: 'POST', body: { code, quantity: qty } }),
};

// ============ 物品定义 ============
export const itemApi = {
  list: () => request('/items'),
};

// ============ 地图上互动物品（拾取）============
export const worldItemApi = {
  pickup: (wiId) => request('/world-items/' + wiId + '/pickup', { method: 'POST' }),
};

// ============ 默认头像 ============
export const avatarApi = {
  defaults: () => request('/avatars/defaults', { auth: false }),
};
