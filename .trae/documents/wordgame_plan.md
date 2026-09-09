# 末日生存文字游戏 — wordgame.html

## Context
用户要求创建一个纯文字的末日生存游戏，包含个人属性、背包、物品、血量、武器、防具、生活用品等系统。游戏逻辑在 HTML 中，数据分离到 `assets/data/` 目录（JSON 格式）。地图使用"文字+简易符号地图"方式。

## 文件结构

### 新建文件
1. **wordgame.html** — 游戏主页面（HTML + CSS + JS 逻辑）
2. **assets/data/wg_items.json** — 所有物品（武器/防具/生活用品/材料）
3. **assets/data/wg_enemies.json** — 敌人数据（丧尸/变异体/劫匪）
4. **assets/data/wg_map.json** — 地图场景数据（20+ 场景，含连接关系）
5. **assets/data/wg_npc.json** — NPC 数据（商人/幸存者/敌对人类）
6. **assets/data/wg_player.json** — 玩家初始属性

### 复用资源
- 样式风格参考 hello.html 的内嵌 `<style>` 模式
- 数据格式参考 assets/data/ 现有 JSON 文件

## 数据设计

### wg_player.json
```json
{
  "name": "幸存者",
  "hp": 100, "maxHp": 100,
  "hunger": 100, "thirst": 100, "energy": 100,
  "stamina": 10, "level": 1, "exp": 0,
  "attack": 5, "defense": 0,
  "startLocation": "shelter_ruins"
}
```

### wg_items.json
分类：weapon（武器）、armor（防具）、consumable（生活用品/食物水）、material（材料）
每项含：id, name, type, description, stats（攻击力/防御力/恢复量等）, weight, stackable, icon（ASCII符号）

### wg_map.json
网格地图 6×6 = 36 格，每格一个场景。含：id, name, description, position{x,y}, connections{N/E/S/W}, type（城市/废墟/森林/水域/避难所）, loot[], enemies[], npc[]

### wg_enemies.json
含：id, name, hp, attack, defense, exp, loot[], description, difficulty

### wg_npc.json
含：id, name, type（trader/hostile/friendly）, dialog[], trades[]

## 游戏逻辑（wordgame.html）

### 核心系统
1. **状态面板**：显示血量/饥饿/口渴/体力/等级/经验，实时更新
2. **背包系统**：网格显示物品，支持使用/装备/丢弃/合成
3. **装备系统**：武器影响攻击力，防具影响防御力
4. **战斗系统**：回合制文字战斗（攻击/防御/使用物品/逃跑）
5. **探索系统**：移动方向选择 + 场景事件（搜刮/战斗/遭遇NPC）
6. **生存系统**：每行动消耗饥饿/口渴/体力，归零扣血
7. **简易地图**：ASCII 符号网格，显示已探索区域和当前位置

### UI 布局
- 左侧：角色状态 + 简易地图
- 中央：场景描述 + 事件日志（滚动文字）
- 右侧：背包/装备栏
- 底部：行动选项按钮

### 渲染方式
纯 DOM 操作（innerHTML/textContent），无 canvas，无框架

## 验证方式
1. 用 `python3 -m http.server` 本地启动
2. 打开 wordgame.html 验证各系统
3. 测试：移动探索 → 搜刮物品 → 装备武器 → 遇敌战斗 → 使用食物恢复 → 交易
4. 控制台无 JS 报错
