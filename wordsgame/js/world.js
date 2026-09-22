/**
 * world.js —— 基于瓦片的网格地图
 * 格子坐标 (tx, ty)；玩家在格子中心 (tx + 0.5, ty + 0.5)
 * 点击一个可通行格子 → BFS 寻路 → 平滑移动到目标格中心
 * 地图通过后端 /api/maps/<map_id> 动态加载
 * 地图切换 / 下一关通过 portals（传送门）触发
 */

import * as THREE from 'three';

// ========== 瓦片类型默认颜色 & 是否可通行 ==========
const TILE_STYLE = {
  grass:   { color: 0x86b453, walkable: true,  label: '草地' },
  path:    { color: 0xc9a96e, walkable: true,  label: '土路' },
  sand:    { color: 0xe6d298, walkable: true,  label: '沙地' },
  water:   { color: 0x4a7ab5, walkable: false, label: '水潭' },
  tree:    { color: 0x3f7a2a, walkable: false, label: '树木' },
  rock:    { color: 0x8a8a8a, walkable: false, label: '岩石' },
  floor:   { color: 0xdccfae, walkable: true,  label: '地砖' },
  wall:    { color: 0x6b5a3a, walkable: false, label: '墙' },
};

// ========= 瓦片贴图缓存 =========
// 优先从 assets/tiles/{ttype}.png 加载真实贴图；不存在则 fallback 到 Canvas 手绘
const _tileTextureCache = new Map();  // ttype → THREE.Texture

const TILE_IMAGE_URL = (() => {
  // 用 import.meta.url 推断 base
  const base = new URL('.', import.meta.url);
  return (name) => new URL(`../assets/tiles/${name}.png`, base).href;
})();

// 同步加载：如果贴图文件存在就用它，否则 fallback
// THREE.TextureLoader.load 是异步的，但我们在构造函数里统一预加载，
// makeTileTexture 会直接用缓存好的 THREE.Texture
export async function preloadTileTextures() {
  const loader = new THREE.TextureLoader();
  // 允许跨域
  loader.crossOrigin = 'anonymous';
  
  const types = ['grass', 'path', 'sand', 'water', 'rock'];
  for (const t of types) {
    if (_tileTextureCache.has(t)) continue;
    await new Promise(resolve => {
      try {
        loader.load(
          TILE_IMAGE_URL(t),
          (tex) => {
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearFilter;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.colorSpace !== undefined
              ? (tex.colorSpace = THREE.SRGBColorSpace)
              : (tex.encoding = THREE.sRGBEncoding);
            tex.anisotropy = 4;
            _tileTextureCache.set(t, tex);
            resolve();
          },
          undefined,
          () => resolve()  // onError: 静默 resolve，后面 fallback
        );
      } catch(e) { resolve(); }
    });
  }
}

// 每种瓦片画一个可重复的 Canvas 纹理（512x512 是预留的贴图尺寸）
function makeTileTexture(ttype, tileSize = 64) {
  // ✅ 优先用缓存好的真实贴图
  if (_tileTextureCache.has(ttype)) {
    const tex = _tileTextureCache.get(ttype);
    return tex.clone();  // clone 一份，避免多个 InstancedMesh 共享同一个 UV 变换
  }

  const c = document.createElement('canvas');
  c.width = c.height = 512;    // 预留 512x512；实际渲染时按 tileSize 缩放
  const ctx = c.getContext('2d');
  const style = TILE_STYLE[ttype] || TILE_STYLE.grass;
  ctx.fillStyle = '#' + style.color.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 512, 512);

  // 加一点花纹，让瓦片不那么单调
  ctx.globalAlpha = 0.25;
  switch (ttype) {
    case 'grass':
      ctx.fillStyle = '#73a240';
      for (let i = 0; i < 80; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        ctx.fillRect(x, y, 2, 6);
      }
      break;
    case 'path':
      ctx.fillStyle = '#b08f50';
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        ctx.fillRect(x, y, 4, 3);
      }
      break;
    case 'water':
      ctx.fillStyle = '#6d9dd4';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(0, i * 80 + 20, 512, 2);
      }
      break;
    case 'tree':
      ctx.fillStyle = '#2c5a1c';
      ctx.beginPath(); ctx.arc(256, 256, 160, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a3f1c';
      ctx.fillRect(240, 380, 32, 80);
      break;
    case 'rock':
      ctx.fillStyle = '#6a6a6a';
      ctx.beginPath();
      ctx.moveTo(80, 400); ctx.lineTo(256, 80); ctx.lineTo(432, 400); ctx.closePath(); ctx.fill();
      break;
    case 'floor':
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(512, i * 64); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 512); ctx.stroke();
      }
      break;
  }
  ctx.globalAlpha = 1;

  // 噪点让瓦片更有质感
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // colorSpace 兼容：老版本 Three 用 .encoding
  tex.colorSpace !== undefined
    ? (tex.colorSpace = THREE.SRGBColorSpace)
    : (tex.encoding = THREE.sRGBEncoding);
  return tex;
}


/** BFS —— 在 walkable 网格上寻路，返回从 (fx,fy) 到 (tx,ty) 的路径（不含起点） */
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
      // 回溯
      const path = [];
      let px = cx, py = cy;
      while (!(px === fx && py === fy)) {
        path.push([px, py]);
        [px, py] = prev[py][px];
      }
      return path.reverse();
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (visited[ny][nx]) continue;
      if (!walkable[ny][nx]) continue;
      visited[ny][nx] = true;
      prev[ny][nx] = [cx, cy];
      queue.push([nx, ny]);
    }
  }
  return null;
}


export class TileWorld {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;

    // ⚠️ 关键：永远不对 this.canvas（DOM 上的）调 getContext —— 浏览器会锁死它
    // 只用独立内存 canvas 做预检
    const _dc = document.createElement('canvas');
    const webglOk = !!(
      _dc.getContext('webgl2') || _dc.getContext('webgl') || _dc.getContext('experimental-webgl')
    );
    if (!webglOk) {
      console.error('[TileWorld] 你的浏览器不支持 WebGL，3D 地图无法渲染');
    }

    this.onMapLoaded   = opts.onMapLoaded   || (() => {});
    this.onPlayerMoved = opts.onPlayerMoved || (() => {});
    this.onInteract    = opts.onInteract    || (() => {});
    this.onWarp        = opts.onWarp        || (() => {});
    this.onToast       = opts.onToast       || (() => {});

    this.portalSprites = [];
    this.npcSprites = [];
    this.npcBubbles = [];   // NPC 头顶 💬 气泡
    this.itemSprites = [];

    this._buildRenderer();
    this._bindEvents();

    // 世界状态
    this.mapId = null;
    this.tileSize = 64;

    // 玩家（瓦片中心）
    this.tx = 0; this.ty = 0;
    this.targetPath = [];      // BFS 路径队列
    this.moving = false;
    this.moveProgress = 0;
    this.moveFrom = null;      // {x, y} 世界坐标
    this.moveTo   = null;

    this._animate();
  }

  // ========= 渲染器初始化 =========
  _buildRenderer() {
    this.width  = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;

    // 诊断（用独立内存 canvas，绝不碰 DOM canvas！）
    let diag = { webgl2: false, webgl: false };
    try {
      const dc = document.createElement('canvas');
      diag.webgl2 = !!dc.getContext('webgl2');
      diag.webgl  = !!dc.getContext('webgl');
    } catch(e) {}
    console.log('[TileWorld] 浏览器 WebGL 支持:', diag);
    console.log('[TileWorld] DOM canvas size:', this.canvas.width, '×', this.canvas.height);

    // ⚠️ 关键：第一次对这个 DOM canvas 调 getContext 必须是 THREE 内部的 webgl/webgl2
    // 我们自己绝不先碰 getContext —— 否则 canvas 会被锁死成 2D
    let r;
    try {
      r = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch(e) {
      console.error('[TileWorld] WebGLRenderer 构造失败:', e.message);
      throw new Error('3D 渲染器启动失败 —— 请在 Edge 访问 edge://settings/system 打开硬件加速并重启浏览器');
    }
    this.renderer = r;
    console.log('[TileWorld] WebGLRenderer ✅');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height, false);
    console.log('[TileWorld] renderer size:', this.width, '×', this.height);

    // ⚠️ 如果尺寸为 0（父容器刚从 display:none 变 visible，浏览器还没 layout），
    // 等两帧让浏览器完成 layout，再修正
    if (this.width === 0 || this.height === 0) {
      console.warn('[TileWorld] canvas 尺寸为 0，等待 layout...');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.width  = this.canvas.clientWidth;
        this.height = this.canvas.clientHeight;
        console.log('[TileWorld] 修正后尺寸:', this.width, '×', this.height);
        if (this.width > 0 && this.height > 0) {
          this.renderer.setSize(this.width, this.height, false);
          // 还要更新相机宽高比
          const aspect = this.width / this.height;
          const fs = this.tileSize * 16;
          this.camera.left   = (-fs * aspect) / 2;
          this.camera.right  = ( fs * aspect) / 2;
          this.camera.top    =  fs / 2;
          this.camera.bottom = -fs / 2;
          this.camera.updateProjectionMatrix();
        }
      }));
    }
    this.renderer.setClearColor(0xf4e9c8, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4e9c8);

    // 正交相机：俯视
    const aspect = this.width / this.height;
    this.camera = new THREE.OrthographicCamera(
      (-40 * aspect) / 2, (40 * aspect) / 2,
      40 / 2, -40 / 2,
      0.1, 1000
    );
    this.camera.position.set(0, 60, 0);
    this.camera.lookAt(0, 0, 0);

    const amb = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(amb);
  }

  // ========= 加载地图 =========
  loadMap(mapData) {
    // 防御：任何渲染前都保证这三个数组存在
    this.portalSprites = this.portalSprites || [];
    this.npcSprites = this.npcSprites || [];
    this.itemSprites = this.itemSprites || [];

    this.clear();
    const m = mapData.map;
    const ts = m.tile_size || 64;
    this.mapId = m.map_id;
    this.tileSize = ts;
    this.width  = m.width;
    this.height = m.height;
    this.grid     = mapData.grid;
    this.walkable = mapData.walkable;
    this.textures = mapData.textures;

    // 渲染范围：地图铺满时 frustum 大小 = max(w, h) * ts
    const ww = m.width * ts, wh = m.height * ts;
    const aspect = this.width / this.height;
    const fs = this.tileSize * 16;   // 视野：玩家周围 10 个瓦片
    this.camera.left   = (-40 * aspect) / 2;
    this.camera.right  = ( 40 * aspect) / 2;
    this.camera.top    =  40 / 2;
    this.camera.bottom = -40 / 2;
    this.camera.updateProjectionMatrix();

    this._buildTiles();
    this._buildPortals(mapData.portals || []);
    this._buildNpcs(mapData.npcs || []);
    this._buildWorldItems(mapData.items || []);
    this._buildPlayer();

    // 放置玩家：后端给的位置 > 地图 spawn > (1,1)
    let sx, sy;
    if (mapData.player && mapData.player.map_id === this.mapId) {
      sx = mapData.player.x; sy = mapData.player.y;
    } else {
      sx = m.spawn_x || 1; sy = m.spawn_y || 1;
    }
    // 确保起点可通行
    if (!this.isWalkable(sx, sy)) {
      [sx, sy] = this._findFirstWalkable(1, 1) || [1, 1];
    }
    this.setPlayerTile(sx, sy);
    this.scene.position.set(-this.tileToWorld(sx, sy).x, 0, -this.tileToWorld(sx, sy).z);

    this.onMapLoaded({ mapId: this.mapId, name: m.name, width: m.width, height: m.height });
    this.onPlayerMoved({ mapId: this.mapId, x: this.tx, y: this.ty });
  }

  _findFirstWalkable(sx, sy) {
    for (let r = 0; r < Math.max(this.width, this.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = sx + dx, ny = sy + dy;
          if (this.isWalkable(nx, ny)) return [nx, ny];
        }
      }
    }
    return null;
  }

  clear() {
    // 先把数组重置（防止 render 循环访问 undefined）
    this.portalSprites = [];
    this.npcSprites = [];
    this.npcBubbles = [];   // NPC 头顶 💬 气泡
    this.itemSprites = [];

    // 清场景
    while (this.scene.children.length) {
      const c = this.scene.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
      if (c.texture) c.texture.dispose();
    }
    for (const b of this.npcBubbles) {
      if (b.material?.map) b.material.map.dispose();
      if (b.material) b.material.dispose();
    }
    // 重建灯光
    const amb = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(amb);

    this.tilesMesh = null;
    this.targetMarker = null;
    this.player = null;
    this.playerShadow = null;
    this.pathLine = null;
  }

  // ========== 瓦片渲染：用 InstancedMesh（每种 ttype 一张纹理，高效） ==========
  _buildTiles() {
    const tileCache = new Map();   // ttype → THREE.MeshStandardMaterial
    const meshesPerType = {};      // ttype → { mesh, index }

    const halfW = this.width  * this.tileSize / 2;
    const halfH = this.height * this.tileSize / 2;

    // 先给每种 ttype 收集所有格子
    const groups = {};   // ttype → [[tx,ty], ...]
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const ttype = this.grid[ty][tx] || 'grass';
        // 如果有 url 就跳过（后面支持 512x512 贴图时单独处理）
        groups[ttype] = groups[ttype] || [];
        groups[ttype].push([tx, ty]);
      }
    }

    for (const [ttype, cells] of Object.entries(groups)) {
      const tex = makeTileTexture(ttype, this.tileSize);
      tileCache.set(ttype, tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const geo = new THREE.PlaneGeometry(1, 1);   // 单位正方形
      geo.rotateX(-Math.PI / 2);

      const count = cells.length;
      const mesh = new THREE.InstancedMesh(geo, mat, count);

      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const [tx, ty] = cells[i];
        // 位置：瓦片左下角在格子中心 —— 我们让瓦片左下角对齐 (tx, ty)，
        // 但 Three 平面是中心对齐。所以偏移 -tileSize/2 让左下角落在 (tx*ts, ty*ts)
        dummy.position.set(
          tx * this.tileSize + this.tileSize / 2,  // 中心 x
          0,
          ty * this.tileSize + this.tileSize / 2   // 中心 z
        );
        dummy.scale.set(this.tileSize, 1, this.tileSize);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }

    // 加一层细网格线（让格子更明显）
    const grid = new THREE.GridHelper(
      Math.max(this.width, this.height) * this.tileSize + 4,
      Math.max(this.width, this.height),
      0xd4b870, 0xe0ca94
    );
    grid.position.y = 0.01;
    // 把网格中心对齐到地图中心
    grid.position.x = -halfW + Math.max(this.width, this.height) * this.tileSize / 2;
    grid.position.z = -halfH + Math.max(this.width, this.height) * this.tileSize / 2;
    this.scene.add(grid);
  }

  // ========== 传送门 ==========
  _buildPortals(portals) {
    const spriteTex = this._makePortalTexture();
    for (const p of portals) {
      const mat = new THREE.SpriteMaterial({ map: spriteTex, color: 0x2ecc71, transparent: true, depthTest: false });
      const sp = new THREE.Sprite(mat);
      const { x, z } = this.tileToWorld(p.from_tx, p.from_ty);
      sp.position.set(x, 0.15, z);
      sp.scale.set(this.tileSize * 0.9, this.tileSize * 0.9, 1);
      sp.renderOrder = 10;
      sp.userData = { kind: 'portal', portal: p };
      this.scene.add(sp);
      this.portalSprites.push(sp);
    }
  }

  _buildNpcs(npcs) {
    for (const n of npcs) {
      // 根据 NPC name 匹配 sprite
      let spriteName;
      const name = (n.name || '').toString();
      if (name.includes('小贩') || name.includes('商人') || name.includes('merchant') || name.includes('shop')) {
        spriteName = 'npc_merchant';
      } else if (name.includes('老王') || name.includes('村长') || name.includes('chief')) {
        spriteName = 'npc_chief';
      } else if (name.includes('老者') || name.includes('魔法') || name.includes('sage') || name.includes('wizard')) {
        spriteName = 'npc_sage';
      } else {
        spriteName = 'npc_chief';
      }

      let spriteTex;
      try { spriteTex = this._loadSprite(spriteName); } catch { spriteTex = null; }
      const mat = new THREE.SpriteMaterial({
        map: spriteTex || this._makeNpcTexture(),
        color: spriteTex ? 0xffffff : new THREE.Color(n.color || '#ffd83d'),
        transparent: true, depthTest: false,
      });
      const sp = new THREE.Sprite(mat);
      const { x, z } = this.tileToWorld(n.tx, n.ty);
      sp.position.set(x, 0.2, z);
      sp.scale.set(this.tileSize * 0.7, this.tileSize * 0.95, 1);
      sp.renderOrder = 11;
      sp.userData = { kind: 'npc', npc: n };
      this.scene.add(sp);
      this.npcSprites.push(sp);

      // NPC 头顶 💬 气泡（走近时显示）
      const bubbleTex = this._makeBubbleTexture();
      const bubbleMat = new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthTest: false });
      const bubble = new THREE.Sprite(bubbleMat);
      bubble.position.set(x, 1.2, z);   // 头顶上方
      bubble.scale.set(this.tileSize * 0.55, this.tileSize * 0.4, 1);
      bubble.renderOrder = 15;
      bubble.visible = false;
      this.scene.add(bubble);
      this.npcBubbles.push(bubble);
    }
  }

  // 生成 💬 气泡的 Canvas 纹理
  _makeBubbleTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 96);
    // 圆角白框
    const r = 16, w = 120, h = 70, x = 4, y = 4;
    g.fillStyle = 'rgba(255, 251, 240, 0.95)';
    g.strokeStyle = '#ffd83d';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
    g.fill();
    g.stroke();
    // 三角尾巴（指向下）
    g.beginPath();
    g.moveTo(56, 74); g.lineTo(64, 88); g.lineTo(72, 74); g.closePath();
    g.fill(); g.stroke();
    // 💬 emoji
    g.font = 'bold 36px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#5d4020';
    g.fillText('💬', 64, 38);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildWorldItems(items) {
    const spriteTex = this._makeItemTexture();
    for (const it of items) {
      const mat = new THREE.SpriteMaterial({
        map: spriteTex, color: 0xffffff, transparent: true, depthTest: false,
      });
      const sp = new THREE.Sprite(mat);
      const { x, z } = this.tileToWorld(it.tx, it.ty);
      sp.position.set(x, 0.2, z);
      sp.scale.set(this.tileSize * 0.55, this.tileSize * 0.55, 1);
      sp.renderOrder = 9;
      sp.userData = { kind: 'item', item: it };
      this.scene.add(sp);
      this.itemSprites.push(sp);
    }
  }

  // ========== 玩家 ==========
  _buildPlayer() {
    const group = new THREE.Group();

    // 脚下阴影圈（深色椭圆，增加立体感）
    const shadowTex = this._makeCircleTexture('#000000', 0.28);
    const shadowMat = new THREE.SpriteMaterial({ map: shadowTex, transparent: true, depthTest: false });
    this.playerShadow = new THREE.Sprite(shadowMat);
    this.playerShadow.scale.set(this.tileSize * 0.6, this.tileSize * 0.25, 1);
    this.playerShadow.position.y = 0.05;
    this.playerShadow.renderOrder = 12;
    group.add(this.playerShadow);

    // ✅ 玩家本体 —— 优先用真实 player.png，fallback 到 Canvas 画的金色圈
    let playerTex;
    try { playerTex = this._loadSprite('player'); } catch { playerTex = null; }
    const playerMat = new THREE.SpriteMaterial({
      map: playerTex || this._makePlayerTexture(),
      color: playerTex ? 0xffffff : 0xffd83d,  // 有真实图就不加 tint
      transparent: true, depthTest: false,
    });
    this.player = new THREE.Sprite(playerMat);
    this.player.scale.set(this.tileSize * 0.7, this.tileSize * 0.9, 1);
    this.player.position.y = 0.4;
    this.player.renderOrder = 13;
    group.add(this.player);

    this.scene.add(group);
    this.playerGroup = group;

    // 目标位置标记
    const targetTex = this._makeTargetTexture();
    const targetMat = new THREE.SpriteMaterial({
      map: targetTex, color: 0xe76f51, transparent: true, depthTest: false,
    });
    this.targetMarker = new THREE.Sprite(targetMat);
    this.targetMarker.scale.set(this.tileSize * 0.7, this.tileSize * 0.7, 1);
    this.targetMarker.visible = false;
    this.targetMarker.renderOrder = 14;
    this.scene.add(this.targetMarker);

    // 寻路路径线（地面上的一串小格子）
    const pathGeo = new THREE.BufferGeometry();
    const pathMat = new THREE.PointsMaterial({
      color: 0xffd83d, size: this.tileSize * 0.35,
      sizeAttenuation: false, transparent: true, opacity: 0.8,
      depthTest: false,
    });
    this.pathLine = new THREE.Points(pathGeo, pathMat);
    this.pathLine.renderOrder = 15;
    this.scene.add(this.pathLine);
  }

  // ========== 纹理生成 ==========
  _makeCircleTexture(color, alpha = 1) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(64, 64, 48, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace !== undefined ? (tex.colorSpace = THREE.SRGBColorSpace) : (tex.encoding = THREE.sRGBEncoding);
    return tex;
  }

  _makePlayerTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    // 外发光
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,216,61,0.9)');
    g.addColorStop(1, 'rgba(255,216,61,0.0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    // 白色核心
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(64, 64, 14, 0, Math.PI * 2); ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace !== undefined ? (tex.colorSpace = THREE.SRGBColorSpace) : (tex.encoding = THREE.sRGBEncoding);
    return tex;
  }

  _makeTargetTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(231,111,81,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 64, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, 64); ctx.lineTo(44, 64);
    ctx.moveTo(84, 64); ctx.lineTo(114, 64);
    ctx.moveTo(64, 14); ctx.lineTo(64, 44);
    ctx.moveTo(64, 84); ctx.lineTo(64, 114);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace !== undefined ? (tex.colorSpace = THREE.SRGBColorSpace) : (tex.encoding = THREE.sRGBEncoding);
    return tex;
  }

  _makePortalTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(46,204,113,0.18)';
    ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(46,204,113,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(64, 64, 48, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 64, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 64, 14, 0, Math.PI * 2); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace !== undefined ? (tex.colorSpace = THREE.SRGBColorSpace) : (tex.encoding = THREE.sRGBEncoding);
    return tex;
  }

  _makeNpcTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    // 帽子/头顶
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
    // 身体
    ctx.fillStyle = '#ffd83d';
    ctx.beginPath(); ctx.arc(64, 78, 22, 0, Math.PI * 2); ctx.fill();
    // 头
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(64, 48, 18, 0, Math.PI * 2); ctx.fill();
    // 眼睛
    ctx.fillStyle = '#2d2d2d';
    ctx.beginPath(); ctx.arc(57, 46, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(71, 46, 2.5, 0, Math.PI * 2); ctx.fill();
    // 问号标记
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 98, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace !== undefined ? (tex.colorSpace = THREE.SRGBColorSpace) : (tex.encoding = THREE.sRGBEncoding);
    return tex;
  }

  _makeItemTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '42px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📦', 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace !== undefined ? (tex.colorSpace = THREE.SRGBColorSpace) : (tex.encoding = THREE.sRGBEncoding);
    return tex;
  }

  // ========== 工具：格子 ↔ 世界坐标 ==========
  tileToWorld(tx, ty) {
    // 格子 (tx, ty) 中心的世界坐标
    return {
      x: tx * this.tileSize + this.tileSize / 2,
      z: ty * this.tileSize + this.tileSize / 2,
    };
  }
  worldToTile(wx, wz) {
    return { tx: Math.floor(wx / this.tileSize), ty: Math.floor(wz / this.tileSize) };
  }
  isWalkable(tx, ty) {
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return false;
    return !!this.walkable[ty][tx];
  }

  setPlayerTile(tx, ty) {
    this.tx = tx; this.ty = ty;
    const { x, z } = this.tileToWorld(tx, ty);
    this.playerGroup.position.set(x, 0, z);
  }

  // ========== 点击移动 ==========
  _handleClick(e) {
    if (!this.mapId) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster = this.raycaster || new THREE.Raycaster();
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    this.groundPlane = this.groundPlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!hit) return;

    // worldToTile：scene 平移了 -player 所以 hit.x - scene.position.x = 实际世界
    const worldX = hit.x - this.scene.position.x;
    const worldZ = hit.z - this.scene.position.z;
    const { tx, ty } = this.worldToTile(worldX, worldZ);
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return;

    // 如果点击了 NPC / 传送门 / 互动物品，优先触发交互
    const interacted = this._tryInteractAt(tx, ty);
    if (interacted) return;

    // 不可通行 → 找周围最近可通行格子
    let gotoTx = tx, gotoTy = ty;
    if (!this.isWalkable(tx, ty)) {
      const nxt = this._findNearestWalkable(tx, ty);
      if (!nxt) { this.onToast('这里过不去'); return; }
      gotoTx = nxt[0]; gotoTy = nxt[1];
    }

    this._startMove(gotoTx, gotoTy);
  }

  _findNearestWalkable(tx, ty) {
    for (let r = 1; r <= Math.max(this.width, this.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if (this.isWalkable(nx, ny)) return [nx, ny];
        }
      }
    }
    return null;
  }

  // 切比雪夫距离（允许斜方向 1 格的"面前"也算）
  _distChebyshev(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

  _tryInteractAt(tx, ty) {
    // NPC —— 必须走到 2 格以内才能交互
    const hitNpc = this.npcSprites.find(s => s.userData.kind === 'npc' && s.userData.npc.tx === tx && s.userData.npc.ty === ty);
    if (hitNpc) {
      const n = hitNpc.userData.npc;
      const d = this._distChebyshev(this.tx, this.ty, n.tx, n.ty);
      if (d <= 2) {
        this.onInteract({ type: 'npc', data: n });
      } else {
        this.onToast('走近点再和 ' + n.name + ' 说话');
      }
      return true;
    }
    // 互动物品 —— 也得走到附近
    const hitItem = this.itemSprites.find(s => s.userData.kind === 'item' && s.userData.item.tx === tx && s.userData.item.ty === ty);
    if (hitItem) {
      const it = hitItem.userData.item;
      const d = this._distChebyshev(this.tx, this.ty, it.tx, it.ty);
      if (d <= 2) {
        this.onInteract({ type: 'item', data: it });
      } else {
        this.onToast('走近点才能拾取');
      }
      return true;
    }
    // 传送门
    const hitPortal = this.portalSprites.find(s => s.userData.kind === 'portal' && s.userData.portal.from_tx === tx && s.userData.portal.from_ty === ty);
    if (hitPortal) {
      this.onWarp(hitPortal.userData.portal);
      return true;
    }
    return false;
  }

  _startMove(gotoTx, gotoTy) {
    // 路径线显示 + 标记
    const path = bfs(this.walkable, this.tx, this.ty, gotoTx, gotoTy);
    if (!path) { this.onToast('到不了那个地方'); return; }
    if (path.length === 0) return;   // 目标就是自己

    // 显示目标标记
    const wp = this.tileToWorld(gotoTx, gotoTy);
    this.targetMarker.position.set(wp.x, 0.2, wp.z);
    this.targetMarker.visible = true;

    // 渲染路径点
    const pts = [new THREE.Vector3(...Object.values(this.tileToWorld(this.tx, this.ty)))];
    for (const [px, py] of path) {
      const w = this.tileToWorld(px, py);
      pts.push(new THREE.Vector3(w.x, 0.1, w.z));
    }
    const positions = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z; });
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry();
    this.pathLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.pathLine.visible = true;

    this.targetPath = path;
    this._stepAlongPath();
  }

  _stepAlongPath() {
    if (!this.targetPath.length) { this.moving = false; return; }
    const next = this.targetPath.shift();
    this.moveFrom = this.tileToWorld(this.tx, this.ty);
    this.moveTo   = this.tileToWorld(next[0], next[1]);
    this.tx = next[0]; this.ty = next[1];
    this.moveProgress = 0;
    this.moving = true;
  }

  // ========== 动画循环 ==========
  _animate() {
    const tick = () => {
      requestAnimationFrame(tick);

      const dt = 0.016;
      if (this.moving) {
        // 插值 每步 0.18 秒
        const stepDuration = 0.18;
        this.moveProgress = Math.min(1, this.moveProgress + dt / stepDuration);
        const t = this.moveProgress;
        // 用 easeInOutQuad
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const x = this.moveFrom.x + (this.moveTo.x - this.moveFrom.x) * ease;
        const z = this.moveFrom.z + (this.moveTo.z - this.moveFrom.z) * ease;
        this.playerGroup.position.set(x, 0, z);
        this.scene.position.set(-x, 0, -z);

        if (this.moveProgress >= 1) {
          this.playerGroup.position.set(this.moveTo.x, 0, this.moveTo.z);
          this.scene.position.set(-this.moveTo.x, 0, -this.moveTo.z);
          this.onPlayerMoved({ mapId: this.mapId, x: this.tx, y: this.ty });

          // 检查传送门：到达传送门格自动跳转
          const portal = this.portalSprites.find(s =>
            s.userData.kind === 'portal' &&
            s.userData.portal.from_tx === this.tx &&
            s.userData.portal.from_ty === this.ty
          );
          if (portal) {
            this.moving = false;
            this.targetPath = [];
            this.targetMarker.visible = false;
            this.pathLine.visible = false;
            this.onWarp(portal.userData.portal);
            return;
          }
          // 检查 NPC / 物品：走到格上触发交互提示（不打断自动寻路）
          // 这里不自动触发，让用户自己点

          // 继续下一段
          this._stepAlongPath();
          if (!this.moving) {
            this.targetMarker.visible = false;
            this.pathLine.visible = false;
          }
        }
      }

      // NPC / 物品轻微悬浮 & 玩家本体上下浮动
      const t = performance.now() * 0.003;
      if (this.player) this.player.position.y = 0.4 + Math.sin(t * 2) * 0.08;
      if (this.targetMarker && this.targetMarker.visible) {
        this.targetMarker.material.opacity = 0.6 + Math.abs(Math.sin(t * 1.5)) * 0.4;
        this.targetMarker.material.transparent = true;
        this.targetMarker.position.y = 0.2 + Math.sin(t * 1.8) * 0.05;
      }
      for (const s of this.portalSprites) {
        s.position.y = 0.15 + Math.sin(t * 1.2 + s.position.x) * 0.05;
        s.material.opacity = 0.7 + Math.abs(Math.sin(t * 1.2)) * 0.3;
        s.material.transparent = true;
      }
      // NPC 头顶气泡 proximity 更新
      for (let i = 0; i < this.npcSprites.length; i++) {
        const sp = this.npcSprites[i];
        const b = this.npcBubbles[i];
        if (!b) continue;
        const n = sp.userData.npc;
        const d = this._distChebyshev(this.tx, this.ty, n.tx, n.ty);
        const shouldShow = d <= 2;
        if (b.visible !== shouldShow) b.visible = shouldShow;
        // 气泡呼吸动画
        if (shouldShow) {
          b.position.y = 1.35 + Math.sin(t * 2.2 + i) * 0.08;
          b.material.opacity = 0.85 + Math.abs(Math.sin(t * 2.2)) * 0.15;
          b.material.transparent = true;
        }
      }
      for (const s of this.itemSprites) {
        s.position.y = 0.2 + Math.sin(t * 1.6 + s.position.x) * 0.06;
      }

      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  _bindEvents() {
    this._onResize = () => {
      this.width  = this.canvas.clientWidth;
      this.height = this.canvas.clientHeight;
      const aspect = this.width / this.height;
      const fs = this.tileSize * 16;
      this.camera.left   = (-fs * aspect) / 2;
      this.camera.right  = ( fs * aspect) / 2;
      this.camera.top    =  fs / 2;
      this.camera.bottom = -fs / 2;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height, false);
    };
    this._onClick = (e) => this._handleClick(e);
    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('click', this._onClick);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('click', this._onClick);
  }
}
