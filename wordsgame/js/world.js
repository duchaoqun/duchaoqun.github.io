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
  grass:   { color: 0x6ea63f, walkable: true,  label: '草地' },
  path:    { color: 0xb89560, walkable: true,  label: '土路' },
  sand:    { color: 0xe6d298, walkable: true,  label: '沙地' },
  water:   { color: 0x4a7ab5, walkable: false, label: '水潭' },
  tree:    { color: 0x3f7a2a, walkable: false, label: '树木',  block: true, blockH: 0.85, blockTop: 0x4a9e2a, blockSide: 0x2f5e1f },
  rock:    { color: 0x8a8a8a, walkable: false, label: '岩石',  block: true, blockH: 0.55, blockTop: 0xa8a8a8, blockSide: 0x6b6b6b },
  floor:   { color: 0xdccfae, walkable: true,  label: '地砖' },
  wall:    { color: 0x6b5a3a, walkable: false, label: '墙',    block: true, blockH: 1.0,  blockTop: 0x8a7855, blockSide: 0x52442a },
  bush:    { color: 0x5a8f3a, walkable: false, label: '灌木',  block: true, blockH: 0.4,  blockTop: 0x6ea63f, blockSide: 0x466f2c },
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


// 辅助：颜色变亮/变暗（percent 正数亮负数暗）
function shade(hex, percent) {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const f = (c, p) => Math.max(0, Math.min(255, Math.round(c + (percent / 100) * 255)));
  r = f(r, percent); g = f(g, percent); b = f(b, percent);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
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


console.log('🟡 world.js v94 loaded — canStandAt with walkable grid collision');
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

    // 世界状态（必须在 _buildRenderer 之前初始化！）
    this.mapId = null;
    this.tileSize = 64;  // ← _buildRenderer 里会用到它设置相机高度/视野

    this.portalSprites = [];
    this.npcSprites = [];
    this.npcBubbles = [];   // NPC 头顶 💬 气泡
    this.itemSprites = [];

    this._buildRenderer();
    this._bindEvents();

    // 玩家坐标（同时保留瓦片索引用于交互 + 连续世界坐标用于移动）
    this.tx = 0; this.ty = 0;
    this.playerX = 0;  // 世界坐标 float（连续移动用）
    this.playerZ = 0;
    this.keys = new Set();      // 当前按下的键（WASD / 方向键）
    this.targetWorldPos = null; // 点击移动的目标 {x, z}（连续世界坐标）
    this.PLAYER_SPEED = 240;    // world units / sec（瓦片 size=64 → 约 3.75 格/秒）
    this.PLAYER_RADIUS = 12;    // 玩家碰撞半径（world units，tileSize=64 的 18.75%）
    // 兼容旧 BFS 字段（setPlayerTile / loadMap 初始化时用）
    this.targetPath = []; this.moving = false;
    this.moveProgress = 0; this.moveFrom = null; this.moveTo = null;

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
          this._updateCameraFrustum();  // ← 用统一方法，别硬编码
        }
      }));
    }
    this.renderer.setClearColor(0xf4e9c8, 1);

    this.scene = new THREE.Scene();
    // 隐藏的地面平面（raycaster 点击判定用）
    {
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(20000, 20000),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      g.rotation.x = -Math.PI / 2;  // 平铺 xy → xz
      g.raycast = () => {};  // 先禁用，loadMap 时重启用
      this.groundMesh = g;
      this.scene.add(g);
    }
    this.scene.background = new THREE.Color(0xf4e9c8);

    // 正交相机：正俯视（玩家居中，地图向四周滚动）
    // 视野：上下各 6 个瓦片 = 总共 12 个瓦片高度可见
    // 3/4 斜俯视相机（像 Brawl Stars 那样斜 45°）
    this.visibleTilesV = 14;   // 斜视角下多看一点
    this.cameraTiltDeg = 0;    // 正俯视
    this.cameraDist = this.tileSize * 12;
    const tilt = THREE.MathUtils.degToRad(this.cameraTiltDeg);
    // 相机放在 (x=H*cosT? 不对，正确：y=Dist*sin(tilt), xz=Dist*cos(tilt)/√2)
    // 斜向放：x 和 z 各偏移一些，让世界看起来有深度
    const d = this.cameraDist;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    // tilt=0 正俯视 → (0, d, 0) 正上方
    // tilt>0 斜视 → y = d*sin(tilt), xz = d*cos(tilt)/√2 各偏一点
    // 45° 等距视角（经典 isometric）
    // camera 在 Z 方向上方 45° 处 lookAt 原点
    // forward = (0, -d*cos45, -d*sin45) 与 up=(0,1,0) dot=-0.707 → 无 Gimbal Lock ✅
    this.cameraTilt = THREE.MathUtils.degToRad(45);  // 45° 俯角
    this.camera.position.set(0, d * Math.cos(this.cameraTilt), d * Math.sin(this.cameraTilt));
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0);
    this._updateCameraFrustum();

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

    // 相机 frustum（玩家周围 12 个瓦片可见）
    this._updateCameraFrustum();

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
        // 启用 groundMesh raycast（点击判定需要）
    if (this.groundMesh && !this.groundMesh._raycastEnabled) {
      this.groundMesh.raycast = THREE.Mesh.prototype.raycast.bind(this.groundMesh);
      this.groundMesh._raycastEnabled = true;
    }
this.scene.position.set(-this.tileToWorld(sx, sy).x, 0, -this.tileToWorld(sx, sy).z);

    // 强制 window focus，确保键盘 WASD 事件能收到
    try { window.focus?.(); document.body.focus?.(); } catch(e) {}

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

  // ========== 瓦片渲染：地面平面 + 障碍物 3D 方块 ==========
  _buildTiles() {
    const halfW = this.width  * this.tileSize / 2;
    const halfH = this.height * this.tileSize / 2;
    this.tilesGridCenter = { x: -halfW + this.width * this.tileSize / 2, z: -halfH + this.height * this.tileSize / 2 };

    // 先给每种 ttype 收集所有格子
    const groups = {};
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const ttype = this.grid[ty][tx] || 'grass';
        groups[ttype] = groups[ttype] || [];
        groups[ttype].push([tx, ty]);
      }
    }

    // 地面瓦片（全部作为底层，即使该格有障碍物也要覆盖在下面）
    // 简化：每种类型各自渲染（tree 下面先有 grass，再放方块在上面）
    // 但为了简单和性能，我们用一个 InstancedMesh 做地面，一个单独 group 做障碍物
    const groundGeo = new THREE.PlaneGeometry(1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const dummy = new THREE.Object3D();

    // --- 地面层：每种 ttype 一张纹理，InstancedMesh ---
    for (const [ttype, cells] of Object.entries(groups)) {
      const tex = makeTileTexture(ttype, this.tileSize);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const count = cells.length;
      const mesh = new THREE.InstancedMesh(groundGeo, mat, count);
      for (let i = 0; i < count; i++) {
        const [tx, ty] = cells[i];
        dummy.position.set(
          tx * this.tileSize + this.tileSize / 2,
          0,
          ty * this.tileSize + this.tileSize / 2
        );
        dummy.scale.set(this.tileSize, 1, this.tileSize);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }

    // --- 障碍物层：tree/rock/wall/bush 改为 3D 方块（顶亮侧暗） ---
    this.obstaclesGroup = new THREE.Group();
    for (const ttype of Object.keys(groups)) {
      const style = TILE_STYLE[ttype];
      if (!style || !style.block) continue;
      const cells = groups[ttype];
      const blockHeight = (style.blockH || 0.6) * this.tileSize;

      // 一个 BoxGeometry，三种材质（顶亮、侧暗，加侧面高光更有立体感）
      const blockGeo = new THREE.BoxGeometry(this.tileSize, blockHeight, this.tileSize);
      const topMat  = new THREE.MeshStandardMaterial({
        color: style.blockTop || style.color, roughness: 0.55, metalness: 0.05,
        emissive: style.blockTop || style.color, emissiveIntensity: 0.05,
      });
      const sideMat = new THREE.MeshStandardMaterial({
        color: style.blockSide || style.color, roughness: 0.85, metalness: 0,
      });
      // BoxGeometry material 顺序: +x, -x, +y(top), -y(bottom), +z, -z
      const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];

      for (const [tx, ty] of cells) {
        const block = new THREE.Mesh(blockGeo, mats);
        block.position.set(
          tx * this.tileSize + this.tileSize / 2,
          blockHeight / 2,
          ty * this.tileSize + this.tileSize / 2
        );
        block.castShadow = true;
        block.receiveShadow = true;
        this.obstaclesGroup.add(block);
      }
    }
    if (this.obstaclesGroup.children.length) this.scene.add(this.obstaclesGroup);

    // --- 额外点缀：tree 加绿色球体当树冠（比单纯方块好看） ---
    const treeCells = groups['tree'] || [];
    if (treeCells.length) {
      const leavesGeo = new THREE.SphereGeometry(this.tileSize * 0.55, 10, 8);
      const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2f6e1f, roughness: 0.9 });
      for (const [tx, ty] of treeCells) {
        const leaves = new THREE.Mesh(leavesGeo, leavesMat);
        const baseH = (TILE_STYLE.tree.blockH || 0.85) * this.tileSize;
        leaves.position.set(
          tx * this.tileSize + this.tileSize / 2,
          baseH + this.tileSize * 0.3,
          ty * this.tileSize + this.tileSize / 2
        );
        leaves.scale.y = 0.85;
        this.obstaclesGroup && this.obstaclesGroup.add(leaves) || this.scene.add(leaves);
      }
    }

    // 柔和的方向性光（让 3D 方块有立体感）
    if (!this._hasDirLight) {
      const dir = new THREE.DirectionalLight(0xfff5dd, 0.7);
      dir.position.set(this.tileSize * 4, this.tileSize * 10, this.tileSize * 3);
      this.scene.add(dir);
      this._hasDirLight = true;
    }
  }

  // ========== 更新正交相机 frustum ==========
  _updateCameraFrustum() {
    const w = this.width || 300, h = this.height || 300;
    const aspect = Math.max(0.1, w / h);
    const baseTiles = this.visibleTilesV || 14;
    const halfH = baseTiles * this.tileSize / 2;
    const halfW = halfH * aspect;
    this.camera.left   = -halfW;
    this.camera.right  =  halfW;
    this.camera.top    =  halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
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
    // targetMarker 加在 camera 下（不是 scene 下），这样它的 position 就是 world 坐标
    // 不需要 scene.position 补偿，tick 里也不用每帧同步了！
    // 注意：OrthographicCamera 是 parent，所以 marker.world = marker.local
    this.camera.add(this.targetMarker);

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
    // walkable 还没初始化（loadMap 还没跑）→ 放行
    if (!this.walkable || !this.walkable.length) return true;
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return false;
    const row = this.walkable[ty];
    if (!row) return true;
    return row[tx] !== false;
  }

  // 玩家圆形-瓦片网格碰撞：(px,pz) 是 world 坐标，r 是半径（world units）
  // 返回 true = 玩家可以站立（覆盖的所有瓦片都可通行）
  // 圆-瓦片网格精确碰撞：玩家圆心(px,pz)半径r，circle-rect 检测
  canStandAt(px, pz, r) {
    if (r == null) r = this.PLAYER_RADIUS;
    if (!this.walkable || !this.walkable.length) return true;
    const ts = this.tileSize;
    // 玩家圆覆盖的瓦片范围（考虑圆边缘）
    const minTx = Math.floor((px - r) / ts);
    const maxTx = Math.floor((px + r) / ts);
    const minTy = Math.floor((pz - r) / ts);
    const maxTy = Math.floor((pz + r) / ts);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.isWalkable(tx, ty)) continue;  // 可走跳过
        // 不可走：circle-rect 精确检测
        const rectX = tx * ts, rectZ = ty * ts;
        const closestX = Math.max(rectX, Math.min(px, rectX + ts));
        const closestZ = Math.max(rectZ, Math.min(pz, rectZ + ts));
        const dx = px - closestX, dz = pz - closestZ;
        if (dx * dx + dz * dz < r * r) return false;  // 碰撞！
      }
    }
    return true;
  }

  setPlayerTile(tx, ty) {
    this.tx = tx; this.ty = ty;
    const { x, z } = this.tileToWorld(tx, ty);
    this.playerX = x; this.playerZ = z;
    if (this.playerGroup) this.playerGroup.position.set(x, 0, z);
  }

  // ========== 点击移动 ==========
  _handleClick(e) {
    // 暂时禁用点击瞬移，只用 WASD
    return;
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

        // guard: loadMap 还没跑，playerGroup/obstaclesGroup 都没建
        if (!this.playerGroup || !this.player) return;
        
        // tick 诊断（每秒一次）
        if (!this._tickDiag || performance.now() - this._tickDiag > 1000) {
          console.log('[tick]', {
            keys: [...this.keys],
            vx_vz: (function(){ let vx=0,vz=0; if(this.keys.has('d'))vx=1; if(this.keys.has('a'))vx=-1; if(this.keys.has('s'))vz=1; if(this.keys.has('w'))vz=-1; return [vx,vz]; }.call(this)),
            speed: this.PLAYER_SPEED,
            walkable_exists: !!this.walkable,
          });
          this._tickDiag = performance.now();
        }

        try {
          const dt = Math.min(0.05, (performance.now() - (this._lastTickTs || performance.now())) / 1000 || 0.016);
          this._lastTickTs = performance.now();
      
        // ========== 连续移动系统（WASD + 点击直线 + AABB 圆形碰撞）==========
        let vx = 0, vz = 0;
        if (this.keys.has('w') || this.keys.has('arrowup'))    vz -= 1;
        if (this.keys.has('s') || this.keys.has('arrowdown'))  vz += 1;
        if (this.keys.has('a') || this.keys.has('arrowleft'))  vx -= 1;
        if (this.keys.has('d') || this.keys.has('arrowright')) vx += 1;
      
        const hasKeyInput = !!(vx || vz);
        const clickMove = this.targetWorldPos && !hasKeyInput;
        if (clickMove) {
          const dx = this.targetWorldPos.x - this.playerX;
          const dz = this.targetWorldPos.z - this.playerZ;
          const dist = Math.hypot(dx, dz);
          if (dist < this.PLAYER_SPEED * dt) {
            // 离目标不到一帧的步长 → 直接瞬移过去，避免"走到一半"误差
            this.playerX = this.targetWorldPos.x;
            this.playerZ = this.targetWorldPos.z;
            this.targetWorldPos = null;
            if (this.targetMarker) this.targetMarker.visible = false;
          }
          else { vx = dx / dist; vz = dz / dist; }
        }
      
        if (vx || vz) {
          const len = Math.hypot(vx, vz);
          if (len > 1) { vx /= len; vz /= len; }
          const stepX = vx * this.PLAYER_SPEED * dt;
          const stepZ = vz * this.PLAYER_SPEED * dt;
          const oldX = this.playerX, oldZ = this.playerZ;

          // 分轴解算（X 优先 → Z 其次，贴墙滑行）
          let canX = this.canStandAt(this.playerX + stepX, this.playerZ);
          let canZ = this.canStandAt(this.playerX, this.playerZ + stepZ);

          // 如果全被挡，用缩小半径再试（让玩家能从窄缝挤过去）
          if (!canX && !canZ && this.PLAYER_RADIUS > 4) {
            const r2 = Math.max(4, this.PLAYER_RADIUS * 0.5);
            canX = this.canStandAt(this.playerX + stepX, this.playerZ, r2);
            canZ = this.canStandAt(this.playerX, this.playerZ + stepZ, r2);
          }
          if (canX) this.playerX += stepX;
          if (canZ) this.playerZ += stepZ;

          // canX/canZ 诊断 log（每秒一次）
          if (!this._lastCollisionLog || performance.now() - this._lastCollisionLog > 1000) {
            if (!canX || !canZ) {
              console.log('[world] collision', {
                px: Math.round(this.playerX), pz: Math.round(this.playerZ),
                tx: Math.floor(this.playerX / this.tileSize),
                ty: Math.floor(this.playerZ / this.tileSize),
                canX, canZ,
                nextTileX: Math.floor((this.playerX + stepX) / this.tileSize),
                nextTileY: Math.floor((this.playerZ + stepZ) / this.tileSize),
                nextWalkable_X: this.isWalkable(Math.floor((this.playerX + stepX) / this.tileSize), Math.floor(this.playerZ / this.tileSize)),
                nextWalkable_Z: this.isWalkable(Math.floor(this.playerX / this.tileSize), Math.floor((this.playerZ + stepZ) / this.tileSize)),
              });
            }
            this._lastCollisionLog = performance.now();
          }
          // 救援：如果完全没动，只输出 debug 不清目标
          if (this.playerX === oldX && this.playerZ === oldZ && (Math.abs(stepX) > 0 || Math.abs(stepZ) > 0)) {
            if (!this._lastBlockedLog || performance.now() - this._lastBlockedLog > 2000) {
              console.log('[world] FULL_BLOCK', {
                px: Math.round(this.playerX), pz: Math.round(this.playerZ),
                tx: Math.floor(this.playerX / this.tileSize),
                ty: Math.floor(this.playerZ / this.tileSize),
                canX, canZ,
              });
              this._lastBlockedLog = performance.now();
            }
          }
          const newTx = Math.floor(this.playerX / this.tileSize);
          const newTy = Math.floor(this.playerZ / this.tileSize);
          if (newTx !== this.tx || newTy !== this.ty) {
            this.tx = newTx; this.ty = newTy;
            this.onPlayerMoved?.({ mapId: this.mapId, x: newTx, y: newTy });
            const portal = this.portalSprites.find(s =>
              s.userData.kind === 'portal' &&
              s.userData.portal.from_tx === newTx &&
              s.userData.portal.from_ty === newTy
            );
            if (portal) {
              this.targetWorldPos = null;
              this.targetMarker.visible = false;
              this.onWarp(portal.userData.portal);
            }
          }
        }
      
        // 每帧同步玩家位置 + 相机跟随
        this.playerGroup.position.set(this.playerX, 0, this.playerZ);
        this.scene.position.set(-this.playerX, 0, -this.playerZ);
        if (Math.abs(vx) > 0.1 && this.playerGroup) {
          this.playerGroup.scale.x = vx < 0 ? -Math.abs(this.playerGroup.scale.x || 1)
                                            :  Math.abs(this.playerGroup.scale.x || 1);
        }
      
        // NPC / 物品轻微悬浮 & 玩家本体上下浮动
        const t = performance.now() * 0.003;
        if (this.player) this.player.position.y = 0.4 + Math.sin(t * 2) * 0.08;
        if (this.targetMarker && this.targetMarker.visible) {
          // marker 直接在 camera 下 → position 就是 world 坐标，直接同步
          if (this.targetWorldPos) {
            this.targetMarker.position.set(
              this.targetWorldPos.x,
              0.2 + Math.sin(t * 1.8) * 0.05,
              this.targetWorldPos.z
            );
          }
          this.targetMarker.material.opacity = 0.6 + Math.abs(Math.sin(t * 1.5)) * 0.4;
          this.targetMarker.material.transparent = true;
        }
        for (const s of this.portalSprites) {
          s.position.y = 0.15 + Math.sin(t * 1.2 + s.position.x) * 0.05;
          s.material.opacity = 0.7 + Math.abs(Math.sin(t * 1.2)) * 0.3;
          s.material.transparent = true;
        }
        for (let i = 0; i < this.npcSprites.length; i++) {
          const sp = this.npcSprites[i];
          const b = this.npcBubbles[i];
          if (!b) continue;
          const n = sp.userData.npc;
          const d = this._distChebyshev(this.tx, this.ty, n.tx, n.ty);
          const shouldShow = d <= 2;
          if (b.visible !== shouldShow) b.visible = shouldShow;
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
          // 每秒打一次位置诊断
          if (!this._lastTickLog || performance.now() - this._lastTickLog > 1000) {
            console.log('[world] tick:', {
              playerX: this.playerX.toFixed(1), playerZ: this.playerZ.toFixed(1),
              target: this.targetWorldPos ? {x: this.targetWorldPos.x.toFixed(1), z: this.targetWorldPos.z.toFixed(1)} : null,
              keys: [...this.keys],
              dist: this.targetWorldPos ? Math.hypot(this.targetWorldPos.x - this.playerX, this.targetWorldPos.z - this.playerZ).toFixed(1) : null
            });
            this._lastTickLog = performance.now();
          }
        } catch(e) { console.error('[tick]', e?.message || e); }
      }
      tick();

  }

  _bindEvents() {
    this._onResize = () => {
      this.width  = this.canvas.clientWidth;
      this.height = this.canvas.clientHeight;
      this._updateCameraFrustum();
      this.renderer.setSize(this.width, this.height, false);
    };
    this._onClick = (e) => this._handleClick(e);
    this._onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        this.keys.add(k);
        // 开始按键时取消点击移动目标
        this.targetWorldPos = null;
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.key.toLowerCase());
    };
    this._onBlur = () => { this.keys.clear(); };

    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('click', this._onClick);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    // 点击 canvas 时自动聚焦，让 WASD 立刻生效
    this.canvas.addEventListener('click', () => {
        window.focus?.(); document.body.focus?.(); this.canvas.focus?.();
      });
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('click', this._onClick);
  }
}
