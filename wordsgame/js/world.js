/**
 * world.js —— PixiJS v2 渲染
 * 瓦片地图（Sprite sheet 或手绘）+ Player / NPC / Portal / Item
 * WASD/方向键移动 · 圆形-瓦片网格碰撞 · 相机跟随
 */

// ========== BFS 寻路 ==========
function bfs(walkable, fx, fy, tx, ty) {
  const h = walkable.length, w = walkable[0].length;
  if (tx < 0 || tx >= w || ty < 0 || ty >= h) return null;
  if (!walkable[ty][tx]) return null;
  if (fx === tx && fy === ty) return [];
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  const prev = Array.from({ length: h }, () => new Array(w).fill(null));
  const queue = [[fx, fy]];
  visited[fy][fx] = true;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cx === tx && cy === ty) {
      const path = []; let px = cx, py = cy;
      while (!(px === fx && py === fy)) {
        path.push([px, py]); [px, py] = prev[py][px];
      }
      return path.reverse();
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || visited[ny][nx] || !walkable[ny][nx]) continue;
      visited[ny][nx] = true; prev[ny][nx] = [cx, cy]; queue.push([nx, ny]);
    }
  }
  return null;
}

// ========== 瓦片类型默认颜色 ==========
const TILE_STYLE = {
  grass:  { color: 0x6ea63f, label: '草地' },
  path:   { color: 0xb89560, label: '土路' },
  sand:   { color: 0xe6d298, label: '沙地' },
  water:  { color: 0x4a7ab5, label: '水潭' },
  tree:   { color: 0x3f7a2a, label: '树木' },
  rock:   { color: 0x8a8a8a, label: '岩石' },
  floor:  { color: 0xdccfae, label: '地砖' },
  wall:   { color: 0x6b5a3a, label: '墙' },
  bush:   { color: 0x5a8f3a, label: '灌木' },
};

// ========== TileWorld ==========
export class TileWorld {
  constructor(canvas, opts = {}) {
    // 防御：如果 canvas 传的是字符串，按 ID 查找
    if (typeof canvas === 'string') canvas = document.getElementById(canvas);
    if (!canvas) {
      // 等 DOM 就绪后再找
      canvas = document.getElementById('game-canvas');
      if (!canvas) {
        throw new Error('[TileWorld] ❌ canvas 元素找不到！确保 <canvas id="game-canvas"> 在 DOM 中，且 game-view 已显示');
      }
    }
    this.canvas = canvas;
    this.onMapLoaded   = opts.onMapLoaded   || (() => {});
    this.onPlayerMoved = opts.onPlayerMoved || (() => {});
    this.onInteract    = opts.onInteract    || (() => {});
    this.onWarp        = opts.onWarp        || (() => {});
    this.onToast       = opts.onToast       || (() => {});

    this.mapId = null;
    this.tileSize = 64;
    this.width = 0; this.height = 0;

    this.portalSprites = [];
    this.npcSprites = [];
    this.npcBubbles = [];
    this.itemSprites = [];
    this._npcNearPrev = new Map();

    this.tx = 0; this.ty = 0;
    this.playerX = 0; this.playerY = 0;
    this.keys = new Set();
    this.targetPath = []; this.moving = false;
    this.PLAYER_SPEED = 280;
    this.PLAYER_RADIUS = 14;

    this._initPromise = this._initPIXI();
    this._bindEvents();
  }

  // ========== PixiJS 初始化 ==========
  async _initPIXI() {
    try {
      // 等 canvas 有尺寸（最多 60 帧 ~1 秒）
      for (let i = 0; i < 60 && (!this.canvas.clientWidth || !this.canvas.clientHeight); i++) {
        await new Promise(r => requestAnimationFrame(r));
      }
      // 终极兜底：clientWidth 还是 0 → 用 window 尺寸
      const w = this.canvas.clientWidth || window.innerWidth - 40;
      const h = this.canvas.clientHeight || window.innerHeight - 120;
      console.log(`[TileWorld] canvas 尺寸: ${w}x${h} (clientWidth=${this.canvas.clientWidth}, clientHeight=${this.canvas.clientHeight})`);

      this.app = new PIXI.Application();
      await this.app.init({
        canvas: this.canvas,
        width: w,
        height: h,
        antialias: true,
        backgroundColor: 0xf4e9c8,
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
      });
      console.log('[TileWorld] PixiJS ✅');
    } catch (e) {
      console.error('[TileWorld] PixiJS 初始化失败:', e.message);
      throw e;
    }

    this.stage = this.app.stage;

    // 容器层级：底层 map（瓦片），上层 entities（玩家/NPC/物品/传送门）
    this.mapContainer = new PIXI.Container();
    this.mapContainer.label = 'map';
    this.stage.addChild(this.mapContainer);

    this.entityContainer = new PIXI.Container();
    this.entityContainer.label = 'entities';
    this.stage.addChild(this.entityContainer);

    this.app.ticker.add(() => this._tick());
  }

  // ========== 加载地图 ==========
  async loadMap(mapData) {
    if (this._initPromise) await this._initPromise;

    this.portalSprites = [];
    this.npcSprites = [];
    this.npcBubbles = [];
    this.itemSprites = [];
    this._npcNearPrev.clear();

    const m = mapData.map;
    const ts = m.tile_size || 64;
    this.mapId = m.map_id;
    this.tileSize = ts;
    this.width = m.width;
    this.height = m.height;
    this.grid = mapData.grid;
    this.walkable = mapData.walkable;
    this.textures = mapData.textures;
    this.meta = m.meta || {};

    console.log(`[TileWorld] loadMap: ${this.mapId} ${this.width}x${this.height}, meta.tileset=`, !!this.meta?.tileset);

    this._clearContainers();
    await this._buildTiles();
    this._buildPortals(mapData.portals || []);
    this._buildNpcs(mapData.npcs || []);
    this._buildWorldItems(mapData.items || []);
    this._buildPlayer();

    let sx, sy;
    if (mapData.player && mapData.player.map_id === this.mapId) {
      sx = mapData.player.x; sy = mapData.player.y;
    } else {
      sx = m.spawn_x || 1; sy = m.spawn_y || 1;
    }
    if (!this.isWalkable(sx, sy)) {
      [sx, sy] = this._findFirstWalkable(1, 1) || [1, 1];
    }
    this.setPlayerTile(sx, sy);

    try { window.focus?.(); document.body.focus?.(); } catch(e) {}
    this.onMapLoaded({ mapId: this.mapId, name: m.name, width: m.width, height: m.height });
    this.onPlayerMoved({ mapId: this.mapId, x: this.tx, y: this.ty });
  }

  _clearContainers() {
    this.mapContainer.removeChildren();
    this.entityContainer.removeChildren();
    this.mapContainer.position.set(0, 0);
    this.entityContainer.position.set(0, 0);
    this.player = null; this.playerShadow = null; this.playerMarker = null;
    this.targetMarker = null; this.pathGraphics = null;
  }

  _findFirstWalkable(sx, sy) {
    for (let r = 0; r < Math.max(this.width, this.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (this.isWalkable(sx + dx, sy + dy)) return [sx + dx, sy + dy];
        }
      }
    }
    return null;
  }

  // ========== 瓦片渲染 ==========
  async _buildTiles() {
    const ts = this.tileSize;
    const tileset = this.meta?.tileset;

    // ===== 路径 A：后端返回了 tileset 配置 + textures（gids），走 Sprite sheet =====
    if (tileset && this.textures) {
      try {
        await this._buildTilesFromTileset(tileset);
        return;
      } catch (e) {
        console.error('[TileWorld] Sprite sheet 渲染失败，fallback 纯色瓦片:', e.message);
      }
    }

    // ===== 路径 B：Fallback —— 按 grid[ty][tx] 的 ttype 手绘纯色瓦片 =====
    const { Graphics } = PIXI;
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const ttype = (this.grid?.[ty]?.[tx]) || 'grass';
        const style = TILE_STYLE[ttype] || TILE_STYLE.grass;
        const g = new Graphics();
        g.beginFill(style.color);
        g.drawRect(0, 0, ts, ts);
        g.endFill();
        g.x = tx * ts; g.y = ty * ts;
        this.mapContainer.addChild(g);
      }
    }
  }

  async _buildTilesFromTileset(tileset) {
    const ts = this.tileSize;
    const { Assets, Sprite } = PIXI;

    // 拼 Sprite 图 URL
    let url = tileset.url || '';
    if (!url.startsWith('http')) url = '/' + url.replace(/^\/+/, '');

    console.log('[TileWorld] 加载 Sprite sheet:', url);

    const fullTex = await Assets.load(url);

    const cols = tileset.columns;
    const rows = tileset.rows;
    const tw = tileset.tileWidth;
    const th = tileset.tileHeight;
    const maxGid = cols * rows;

    // 预生成每个 gid 的裁切纹理（PixiJS v8 API）
    const tileTextures = {};
    for (let gid = 1; gid <= maxGid; gid++) {
      const col = (gid - 1) % cols;
      const row = Math.floor((gid - 1) / cols);
      tileTextures[gid] = new PIXI.Texture({
        source: fullTex.source,
        frame: { x: col * tw, y: row * th, width: tw, height: th },
      });
    }

    // 用后端返回的 this.textures（gid 字符串二维数组）
    let count = 0;
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const gidStr = this.textures?.[ty]?.[tx];
        const gid = gidStr ? parseInt(gidStr) : 0;
        if (!gid || gid <= 0 || gid > maxGid) continue;
        const tex = tileTextures[gid];
        if (!tex) continue;
        const s = new Sprite(tex);
        s.width = ts; s.height = ts;
        s.x = tx * ts; s.y = ty * ts;
        this.mapContainer.addChild(s);
        count++;
      }
    }
    console.log('[TileWorld] ✅ Sprite sheet 瓦片渲染完成:', count, '个');
  }

  // ========== 纹理生成辅助 ==========
  _makeCircleTexture(color, alpha = 1, radius = 48) {
    const c = document.createElement('canvas');
    c.width = c.height = radius * 2;
    const g = c.getContext('2d');
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath(); g.arc(radius, radius, radius - 4, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    return PIXI.Texture.from(c);
  }

  _makePlayerTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,216,61,0.9)');
    grad.addColorStop(1, 'rgba(255,216,61,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(64, 64, 14, 0, Math.PI * 2); ctx.fill();
    return PIXI.Texture.from(c);
  }

  _makeTargetTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(231,111,81,0.9)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 64, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, 64); ctx.lineTo(44, 64); ctx.moveTo(84, 64); ctx.lineTo(114, 64);
    ctx.moveTo(64, 14); ctx.lineTo(64, 44); ctx.moveTo(64, 84); ctx.lineTo(64, 114);
    ctx.stroke();
    return PIXI.Texture.from(c);
  }

  _makePortalTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(46,204,113,0.18)';
    ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(46,204,113,0.95)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(64, 64, 48, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 64, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 64, 14, 0, Math.PI * 2); ctx.stroke();
    return PIXI.Texture.from(c);
  }

  _makeNpcTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd83d';
    ctx.beginPath(); ctx.arc(64, 78, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(64, 48, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2d2d2d';
    ctx.beginPath(); ctx.arc(57, 46, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(71, 46, 2.5, 0, Math.PI * 2); ctx.fill();
    return PIXI.Texture.from(c);
  }

  _makeItemTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
    ctx.font = '42px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F4E6}', 64, 64);
    return PIXI.Texture.from(c);
  }

  _makeBubbleTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255, 251, 240, 0.95)';
    g.strokeStyle = '#ffd83d'; g.lineWidth = 3;
    const r = 16, w = 120, h = 70, x = 4, y = 4;
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(56, 74); g.lineTo(64, 88); g.lineTo(72, 74); g.closePath(); g.fill(); g.stroke();
    g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#5d4020'; g.fillText('\u{1F4AC}', 64, 38);
    return PIXI.Texture.from(c);
  }

  // ========== Player / NPC / Portal / Item ==========
  _buildPlayer() {
    const { Sprite } = PIXI;
    const ts = this.tileSize;

    this.playerShadow = new Sprite(this._makeCircleTexture('#000000', 0.28, 24));
    this.playerShadow.anchor.set(0.5);
    this.playerShadow.scale.set(ts * 0.6 / 48, ts * 0.25 / 48);
    this.playerShadow.zIndex = 1000;
    this.entityContainer.addChild(this.playerShadow);

    this.player = new Sprite(this._makePlayerTexture());
    this.player.anchor.set(0.5, 0.7);
    this.player.scale.set(ts * 0.7 / 128, ts * 0.9 / 128);
    this.player.zIndex = 1001;
    this.entityContainer.addChild(this.player);

    this.targetMarker = new Sprite(this._makeTargetTexture());
    this.targetMarker.anchor.set(0.5);
    this.targetMarker.scale.set(ts * 0.7 / 128, ts * 0.7 / 128);
    this.targetMarker.visible = false;
    this.targetMarker.zIndex = 999;
    this.entityContainer.addChild(this.targetMarker);
  }

  _buildPortals(portals) {
    const { Sprite } = PIXI;
    const tex = this._makePortalTexture();
    for (const p of portals) {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 0.5);
      s.scale.set(this.tileSize * 0.9 / 128, this.tileSize * 0.9 / 128);
      const { x, y } = this.tileToWorld(p.from_tx, p.from_ty);
      s.x = x; s.y = y;
      s.zIndex = Math.floor(y) + 10;
      s.eventMode = 'static';
      s.userData = { kind: 'portal', portal: p };
      this.entityContainer.addChild(s);
      this.portalSprites.push(s);
    }
  }

  _buildNpcs(npcs) {
    const { Sprite } = PIXI;
    const npTex = this._makeNpcTexture();
    const bubbleTex = this._makeBubbleTexture();
    for (const n of npcs) {
      const sp = new Sprite(npTex);
      sp.anchor.set(0.5, 0.85);
      sp.scale.set(this.tileSize * 0.7 / 128, this.tileSize * 0.95 / 128);
      const { x, y } = this.tileToWorld(n.tx, n.ty);
      sp.x = x; sp.y = y;
      sp.zIndex = Math.floor(y) + 20;
      sp.eventMode = 'static';
      sp.userData = { kind: 'npc', npc: n };
      this.entityContainer.addChild(sp);
      this.npcSprites.push(sp);

      const bubble = new Sprite(bubbleTex);
      bubble.anchor.set(0.5, 1);
      bubble.scale.set(this.tileSize * 0.55 / 128, this.tileSize * 0.4 / 96);
      bubble.x = x; bubble.y = y - this.tileSize * 0.4;
      bubble.zIndex = 5000;
      bubble.visible = false;
      this.entityContainer.addChild(bubble);
      this.npcBubbles.push(bubble);
    }
  }

  _buildWorldItems(items) {
    const { Sprite } = PIXI;
    const tex = this._makeItemTexture();
    for (const it of items) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.85);
      sp.scale.set(this.tileSize * 0.55 / 128, this.tileSize * 0.55 / 128);
      const { x, y } = this.tileToWorld(it.tx, it.ty);
      sp.x = x; sp.y = y;
      sp.zIndex = Math.floor(y) + 15;
      sp.eventMode = 'static';
      sp.userData = { kind: 'item', item: it };
      this.entityContainer.addChild(sp);
      this.itemSprites.push(sp);
    }
  }

  // ========== 工具 ==========
  tileToWorld(tx, ty) {
    return { x: tx * this.tileSize + this.tileSize / 2, y: ty * this.tileSize + this.tileSize / 2 };
  }
  worldToTile(wx, wy) {
    return { tx: Math.floor(wx / this.tileSize), ty: Math.floor(wy / this.tileSize) };
  }
  isWalkable(tx, ty) {
    if (!this.walkable || !this.walkable.length) return true;
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return false;
    const row = this.walkable[ty];
    if (!row) return true;
    return row[tx] !== false;
  }
  canStandAt(px, py, r) {
    if (r == null) r = this.PLAYER_RADIUS;
    if (!this.walkable || !this.walkable.length) return true;
    const ts = this.tileSize;
    const minTx = Math.floor((px - r) / ts);
    const maxTx = Math.floor((px + r) / ts);
    const minTy = Math.floor((py - r) / ts);
    const maxTy = Math.floor((py + r) / ts);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.isWalkable(tx, ty)) continue;
        const rectX = tx * ts, rectY = ty * ts;
        const cx = Math.max(rectX, Math.min(px, rectX + ts));
        const cy = Math.max(rectY, Math.min(py, rectY + ts));
        const dx = px - cx, dy = py - cy;
        if (dx * dx + dy * dy < r * r) return false;
      }
    }
    return true;
  }
  setPlayerTile(tx, ty) {
    this.tx = tx; this.ty = ty;
    const { x, y } = this.tileToWorld(tx, ty);
    this.playerX = x; this.playerY = y;
  }
  _distChebyshev(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

  _tryInteractAt(tx, ty) {
    const hitNpc = this.npcSprites.find(s => s.userData.kind === 'npc' && s.userData.npc.tx === tx && s.userData.npc.ty === ty);
    if (hitNpc) {
      const n = hitNpc.userData.npc;
      const d = this._distChebyshev(this.tx, this.ty, n.tx, n.ty);
      if (d <= 2) this.onInteract({ type: 'npc', data: n });
      else this.onToast('走近点再和 ' + n.name + ' 说话');
      return true;
    }
    const hitItem = this.itemSprites.find(s => s.userData.kind === 'item' && s.userData.item.tx === tx && s.userData.item.ty === ty);
    if (hitItem) {
      const it = hitItem.userData.item;
      const d = this._distChebyshev(this.tx, this.ty, it.tx, it.ty);
      if (d <= 2) this.onInteract({ type: 'item', data: it });
      else this.onToast('走近点才能拾取');
      return true;
    }
    const hitPortal = this.portalSprites.find(s => s.userData.kind === 'portal' && s.userData.portal.from_tx === tx && s.userData.portal.from_ty === ty);
    if (hitPortal) { this.onWarp(hitPortal.userData.portal); return true; }
    return false;
  }

  // ========== 事件绑定 ==========
  _bindEvents() {
    this._onResize = () => {
      if (!this.app) return;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w > 0 && h > 0) {
        this.app.renderer.resize(w, h);
      }
    };
    this._onClick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (this.app.renderer.width / rect.width);
      const cy = (e.clientY - rect.top) * (this.app.renderer.height / rect.height);
      const wx = cx - this.mapContainer.position.x;
      const wy = cy - this.mapContainer.position.y;
      const tx = Math.floor(wx / this.tileSize);
      const ty = Math.floor(wy / this.tileSize);
      this._tryInteractAt(tx, ty);
    };
    this._onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        this.keys.add(k); this.targetPath = []; e.preventDefault();
      }
    };
    this._onKeyUp = (e) => { this.keys.delete(e.key.toLowerCase()); };
    this._onBlur = () => { this.keys.clear(); };

    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('click', this._onClick);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.canvas.addEventListener('click', () => { window.focus?.(); document.body.focus?.(); this.canvas.focus?.(); });
  }

  // ========== Tick ==========
  _tick() {
    if (!this.player) return;
    const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000 || 0.016);

    let vx = 0, vy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup'))    vy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown'))  vy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft'))  vx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) vx += 1;

    if (vx || vy) {
      const len = Math.hypot(vx, vy);
      if (len > 1) { vx /= len; vy /= len; }
      const stepX = vx * this.PLAYER_SPEED * dt;
      const stepY = vy * this.PLAYER_SPEED * dt;

      let canX = this.canStandAt(this.playerX + stepX, this.playerY);
      let canY = this.canStandAt(this.playerX, this.playerY + stepY);
      if (!canX && !canY && this.PLAYER_RADIUS > 4) {
        const r2 = Math.max(4, this.PLAYER_RADIUS * 0.5);
        canX = this.canStandAt(this.playerX + stepX, this.playerY, r2);
        canY = this.canStandAt(this.playerX, this.playerY + stepY, r2);
      }
      if (canX) this.playerX += stepX;
      if (canY) this.playerY += stepY;

      // NPC 边缘触发
      const _isModalOpen = !!document.querySelector('.modal-overlay.open');
      if (!_isModalOpen) {
        for (const ns of this.npcSprites) {
          const _npc = ns.userData.npc;
          const _nx = (_npc.tx + 0.5) * this.tileSize;
          const _ny = (_npc.ty + 0.5) * this.tileSize;
          const _dx = this.playerX - _nx, _dy = this.playerY - _ny;
          const _T2 = (this.tileSize * 0.7) * (this.tileSize * 0.7);
          const _nowNear = (_dx * _dx + _dy * _dy) < _T2;
          const _wasNear = !!this._npcNearPrev.get(_npc.id);
          if (_nowNear && !_wasNear) {
            this._npcNearPrev.set(_npc.id, true);
            this.onInteract({ type: 'npc', data: _npc });
          } else if (!_nowNear && _wasNear) {
            this._npcNearPrev.set(_npc.id, false);
          }
        }
      }

      const newTx = Math.floor(this.playerX / this.tileSize);
      const newTy = Math.floor(this.playerY / this.tileSize);
      if (newTx !== this.tx || newTy !== this.ty) {
        this.tx = newTx; this.ty = newTy;
        this.onPlayerMoved?.({ mapId: this.mapId, x: newTx, y: newTy });
        const portal = this.portalSprites.find(s =>
          s.userData.kind === 'portal' &&
          s.userData.portal.from_tx === newTx &&
          s.userData.portal.from_ty === newTy
        );
        if (portal) this.onWarp(portal.userData.portal);
      }
    }

    // 玩家位置同步
    const ts = this.tileSize;
    this.playerShadow.x = this.playerX;
    this.playerShadow.y = this.playerY + ts * 0.3;
    this.player.x = this.playerX;
    this.player.y = this.playerY;
    if (Math.abs(vx) > 0.1) this.player.scale.x = vx < 0 ? -Math.abs(this.player.scale.x) : Math.abs(this.player.scale.x);

    // 相机跟随（边界 clamp）
    const vw = this.app.renderer.width;
    const vh = this.app.renderer.height;
    const mapW = this.width * ts;
    const mapH = this.height * ts;
    let cx = this.playerX, cy = this.playerY;
    if (mapW > vw) cx = Math.max(vw / 2, Math.min(mapW - vw / 2, this.playerX));
    else cx = mapW / 2;
    if (mapH > vh) cy = Math.max(vh / 2, Math.min(mapH - vh / 2, this.playerY));
    else cy = mapH / 2;
    this.mapContainer.position.set(vw / 2 - cx, vh / 2 - cy);
    this.entityContainer.position.copyFrom(this.mapContainer.position);

    // 目标标记动画
    if (this.targetMarker && this.targetMarker.visible) {
      this.targetMarker.x = this.playerX;
      this.targetMarker.y = this.playerY - 30 + Math.sin(performance.now() * 0.003) * 4;
      this.targetMarker.alpha = 0.6 + Math.abs(Math.sin(performance.now() * 0.0045)) * 0.4;
    }

    // NPC 气泡可见性
    for (let i = 0; i < this.npcSprites.length; i++) {
      const sp = this.npcSprites[i];
      const b = this.npcBubbles[i];
      if (!b) continue;
      const n = sp.userData.npc;
      const d = this._distChebyshev(this.tx, this.ty, n.tx, n.ty);
      const shouldShow = d <= 2;
      if (b.visible !== shouldShow) b.visible = shouldShow;
      if (shouldShow) { b.x = sp.x; b.y = sp.y - ts * 0.3; }
    }

    // 按 y 排序做深度
    this.entityContainer.sortChildren();
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('click', this._onClick);
    if (this.app) { this.app.destroy(true, { children: true, texture: true, baseTexture: true }); }
  }
}

export async function preloadTileTextures() { /* PixiJS Assets.load 自动处理 */ }
