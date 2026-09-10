# hello.html 世界视觉重设计（Slow Roads 风格）

## Context
用户希望参考 slowroads.io 的真实感（天空、草地、世界效果），重新设计 [hello.html](file:///Users/duchaoqun/duchaoqun.github.io/hello.html) 的世界观感。经确认：
- **只改世界视觉**（天空、地面、草地、树木、湖泊、光照、云、雾、昼夜），**现有玩法零改动**（第一人称 WASD 移动/跳跃、弓矢蓄力射击、照片墙 P、交互菜单 E、碰撞、PointerLock、开始覆盖层）。
- 景观：**丘陵草原 + 树林 + 湖泊**（沿用 Water.js，符合项目规范）。
- **支持昼夜切换**（白天/黄昏/夜晚三档，HUD 按钮 + T 键）。

约束（来自项目记忆）：three.js r185；Sky.js（Preetham 散射）；Water.js + waternormals.jpg；地形高度采样必须用 Uint8Array 高度图双线性插值；外部模块放 assets/js/，纹理放 assets/textures/。

## 涉及文件
- [hello.html](file:///Users/duchaoqun/duchaoqun.github.io/hello.html) —— 唯一需要修改的文件
- 复用（只读）：assets/js/three.module.js、assets/js/Sky.js、assets/js/Water.js、assets/textures/waternormals.jpg

## 实施步骤（自上而下编辑 hello.html）

### 1. HTML/CSS：HUD 昼夜按钮
- 在 `#hud` 内（[L355-L369](file:///Users/duchaoqun/duchaoqun.github.io/hello.html#L355-L369)）加 `<button id="daynightBtn" class="hud-btn">白天</button>`。`#hud` 是 `pointer-events:none`，按钮需 `pointer-events:auto`。
- CSS `.hud-btn`：fixed 右上 (top:14px, right:14px)，深蓝半透明底、等宽字体、圆角，与现有 HUD 主题一致。

### 2. 常量区（L658-675）
- 删除 `ISLAND_RADIUS`；`SEA_LEVEL` → `LAKE_WATER_LEVEL = 0.4`；`TERRAIN_SIZE = 220`、`TERRAIN_HEIGHT_SCALE = 0.045`（SEG 保持 255）。
- 新增全局：`lakes`（3 个湖：`[{x:-20,z:-25,r:9},{x:26,z:20,r:7},{x:2,z:-55,r:6}]`）、`lakeMeshes`、`cloudSprites`、`moonSprite`、`ambientLight`、`hemiLight`、`pmrem`、`skyEnvScene`、`skyEnvObj`、`envTex`、`daynightIndex`、`currentSunDir`。
- 新增 `DAYNIGHT_PRESETS` 数据（见步骤 11）。

### 3. `generateHeightMap()`（L678-723）—— 丘陵化
- 保留 4 层 Perlin + `abs()` 叠加；**去掉径向岛屿衰减**。
- 归一化后：① 挖湖——逐像素转世界坐标，对每个湖按 `smoothstep(d/r)` 压至湖底高度；② 边缘最外 6% 向基线平滑过渡（防越界坠落，不做海）。

### 4. `getIslandHeight()`（L811-837）—— 保留双线性约束
- 越界分支改为 clamp 钳制采样（不再返回负深海）。
- 双线性求高后：若点在湖内返回 `max(worldH, LAKE_WATER_LEVEL)`（玩家可"踩水面"走过湖，Water 平面不参与碰撞）。公式 `h*SCALE-0.5` 不变。

### 5. `generateTerrainTexture()`（L726-808）—— 草地纹理（关键）
- **移除烘焙阳光**（`shade = v3.dot(sun)` 那套），否则昼夜切换时地形颜色不变。
- 改为按高度色带：低处深绿 → 中段草绿 → 高处干黄，斜坡混入土色；叠加每像素小噪声斑驳。仍返回 4x CanvasTexture、`SRGBColorSpace`。

### 6. `buildIsland()`（L840-876）
- 材质加 `receiveShadow: true`，`roughness: 0.9`；其余不变（顶点赋值、computeVertexNormals、ClampToEdge）。

### 7. `buildOcean()`（L881-900）→ 替换为 `buildLakes()`
- 删掉 10000×10000 海洋。对每个湖：`Water(PlaneGeometry(r*2.6, r*2.6), {textureWidth:256, textureHeight:256, waterNormals: 共享 waternormals.jpg(RepeatWrapping), sunDirection: currentSunDir, sunColor:0xffffff, waterColor:0x2a7fae, distortionScale:2.2, fog:true})`，position.y = LAKE_WATER_LEVEL，推入 `lakeMeshes`。

### 8. `buildSun()`（L905-948）—— 加阴影 + 月亮
- `sunLight`：`castShadow=true`、`shadow.mapSize 2048×2048`、shadow camera ±50、near 1 far 200；position 用 `currentSunDir*50`。
- 新增 `buildMoon()`：复用太阳 Sprite 画法做灰白月球，`visible=false`。
- 太阳 Sprite 与月亮 Sprite 位置/可见性由昼夜预设驱动。

### 9. `addPalmTrees()`/`createPalmTree()`（L953-1018）→ 替换为 `addGrasslandTrees()`/`createTree()` + `addBushes()`
- 随机撒 60-70 棵温带树（树干 2-3 段圆柱 + 2-3 个叠放球/二十面体树冠，色 0x3f7d3a 系），拒绝条件：湖边、出生点附近、树间过近。
- **碰撞/交互严格照抄原棕榈树模式**（[L1010-1016](file:///Users/duchaoqun/duchaoqun.github.io/hello.html#L1010-L1016)）：透明 Box + `userData={name:'树木', collidable:true, interactive:true, actions:['查看','砍伐']}` → push COLLIDABLE_MESHES / INTERACTIVE_MESHES。
- 树冠 `castShadow:true`；碰撞盒不 castShadow。
- `addBushes()`：40 个压扁小圆球灌木，不参与碰撞。

### 10. `loadScene()`（L485-590）+ `setupLighting()`（L592）+ `init()`（L442）
- Ambient/Hemi 赋给全局变量（供预设覆盖）；`setupLighting` 内三处同样赋全局。
- Sky 参数改用 `DAYNIGHT_PRESETS[0]`；PMREM 相关提升为全局。
- 构建调用改为：`buildIsland(); buildLakes(); buildSun(); buildMoon(); addGrasslandTrees(); addBushes(); addClouds();`（删 buildOcean/addPalmTrees；catch 分支同步）。
- `init()` 渲染器加：`shadowMap.enabled=true; shadowMap.type=PCFSoftShadowMap; toneMapping=ACESFilmicToneMapping; toneMappingExposure≈1.0`。

### 11. 新增昼夜系统
```js
var DAYNIGHT_PRESETS = [
 { name:'白天', sunDir:(0.45,0.55,0.4).n, sun:{c:0xfff4e0,i:1.6}, hemi:{sky:0xbfd8ff,ground:0x557a3a,i:0.75},
   amb:{c:0xffffff,i:0.25}, fog:{c:0xcfe6f5,n:250,f:900}, exp:1.0, sunV:true, moonV:false, cloudC:0xffffff, clearC:0x87b8e8,
   sky:{turb:4,ray:1.8,mie:0.004,mieG:0.8,cloud:0.35,cD:0.5,cE:0.6} },
 { name:'黄昏', sunDir:(-0.35,0.09,-0.45).n, sun:{c:0xff9a3c,i:1.5}, hemi:{sky:0xffc8a0,ground:0x6b4a2a,i:0.5},
   amb:{c:0xffccaa,i:0.2}, fog:{c:0xf2c79b,n:120,f:700}, exp:1.05, sunV:true, moonV:false, cloudC:0xffd9b0, clearC:0xf0a870,
   sky:{turb:8,ray:3.5,mie:0.01,mieG:0.85,cloud:0.3,cD:0.6,cE:0.6} },
 { name:'夜晚', sunDir:(0.5,-0.35,0.6).n, sun:{c:0x88aaff,i:0.35}, hemi:{sky:0x2a3a66,ground:0x1a2a1a,i:0.35},
   amb:{c:0x334466,i:0.18}, fog:{c:0x1a2438,n:60,f:500}, exp:0.85, sunV:false, moonV:true, cloudC:0x8899bb, clearC:0x0a1226,
   sky:{turb:10,ray:1.2,mie:0.002,mieG:0.6,cloud:0.25,cD:0.4,cE:0.5} },
];
```
- `applyDayNightPreset(i)`：更新 skyObj uniforms（sunPosition/rayleigh/mie/cloud*）、sunLight 色/强/`baseDir`、sun/moon Sprite 位置与 visible、ambient/hemi 色与强度、`scene.fog`、`renderer.setClearColor(clearC)`、`toneMappingExposure`、cloudSprites 材质 color、每个 lakeMesh 的 `sunDirection`；同步 skyEnvObj 后重建 `envTex` 并 `scene.environment = envTex`（`envTex.dispose()` 防泄漏）；更新按钮文字。
- `updateShadowCamera()`：每帧在 `update()` 末尾调用——sunLight.position 跟随玩家 + baseDir*50，target 指向玩家，`updateMatrixWorld()`（避免大范围阴影精度抖动）。
- `bindEvents()`：`daynightBtn.onclick` 循环三档；keydown 加 `KeyT` 同样触发（PointerLock 下鼠标点不到按钮）。

### 12. `addClouds()`（L1092-1143）
- 纹理改 256×256 多团云（5-7 个错落径向渐变叠加），数量 60、高度 45-95、scale 30-75；push 到 `cloudSprites` 供预设改色。`updateClouds` 不变。

### 13. `loop()`（L1746-1766）
- `oceanMesh` 时间更新 → `lakeMeshes.forEach(m => m.material.uniforms['time'].value += dt)`。

## 玩法零改动保障
WASD/跳跃/弓矢/照片墙/E 菜单/碰撞盒/PointerLock 全部不动。地形碰撞仍走 `getIslandHeight`（仅内部逻辑改：湖内钳制、越界钳制）。树碰撞沿用原透明 Box 模式，交互菜单无需改。loadScene 的 JSON 物体放置仍调 `getIslandHeight`，自动落到草地上。

## 注意事项
- PointerLock 下补 T 键切换昼夜。
- 255×255 地形 + 2048 阴影 + PCFSoft：每帧一次 shadow pass 可接受；阴影相机 ±50 随玩家移动防精度抖动。
- Water 每湖一张 256 RT；若卡顿降为两湖。
- 湖内不撒树（湖 r+1.5 拒绝）；JSON 物体可能泡在湖里，可接受。
- 越界靠 clamp + 边缘淡出兜底；出生点 (0,28) 已确认在陆地。

## 验证
1. `cd /Users/duchaoqun/duchaoqun.github.io && python3 -m http.server 8080`，开 `http://localhost:8080/hello.html`（数据经 fetch 加载，必须 HTTP）。
2. 白天档：草地丘陵、3 处湖泊反光、树影、云漂移、ACES 柔和光影；行走/跳跃/射箭/照片墙/E 菜单逐项回归。
3. 点按钮或按 T 循环三档：黄昏暖橙雾、夜晚深蓝 + 月亮 + 冷光；三档均无死黑、无天空断层。
4. 走全图边缘不坠落；进湖踩水面；切档时地形颜色随光照实时变化（无烘焙残留）。
5. 帧率目标 60fps（低端机可关阴影自检）。
