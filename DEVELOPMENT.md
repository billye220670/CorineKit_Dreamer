# CorineGen 开发文档

## 项目概述

CorineGen 是一个基于 ComfyUI 的 React Web 应用程序，提供美观的可自定义主题界面，用于生成 AI 图像。

**技术栈**
- React 18
- Vite 5.4.21
- ComfyUI API (WebSocket + REST)
- localStorage (持久化存储)

**运行环境**
- Node.js 16+
- ComfyUI 运行在 `http://127.0.0.1:8188`

---

## 核心功能清单

### 1. 图像生成功能

#### 1.1 多提示词支持
- **位置**: `App.jsx` L27-33, L111-120
- **功能**:
  - 支持最多 10 个提示词同时管理
  - 每个提示词独立生成图像
  - 自动添加 `yjy，中国女孩` 触发词（如果缺少）
- **UI组件**:
  - 提示词输入框（支持多行）
  - 添加按钮（右上角 `+`）
  - 删除按钮（聚焦时显示 `×`）
  - 发送按钮（右下角 `→`）

#### 1.2 生成方法
- **批次模式** (`batchMethod: 'batch'`):
  - 一次性生成多张图片
  - 所有图片共享进度条
  - 适合快速生成

- **循环模式** (`batchMethod: 'loop'`, 默认):
  - 逐张生成图片
  - 每张图片独立进度
  - 可单独取消队列中的任务

#### 1.3 生成队列系统
- **位置**: `App.jsx` L196-264
- **特性**:
  - 自动队列管理
  - 单提示词点击 `→` 按钮入队
  - "全部生成" 按钮批量入队
  - 显示 Queue 状态的占位符
  - 支持取消队列中的任务（`×` 按钮）

#### 1.4 实时进度反馈
- **WebSocket 监听**: `App.jsx` L292-388 (批次), L476-564 (循环)
- **进度类型**:
  - `queue`: 队列中等待
  - `generating`: 生成中（显示百分比）
  - `revealing`: 图片揭示动画（幕布下降）
  - `completed`: 生成完成
- **动画效果**:
  - 进度条幕布从下到上填充
  - 完成时幕布下降（0.8s）
  - 图片淡入+缩放动画（0.5s）

### 2. 高清化功能

#### 2.1 图片高清化
- **位置**: `App.jsx` L626-795
- **工作流**:
  1. 上传图片到 ComfyUI input 文件夹
  2. 使用 `ImageUpscaleAPI.json` 工作流
  3. SeedVR2 模型进行高清化
- **状态管理**:
  - `none`: 未高清化
  - `queued`: 队列中（可取消）
  - `upscaling`: 高清化中（带进度）
  - `completed`: 已完成（HQ Done）

#### 2.2 高清化队列
- **位置**: `App.jsx` L797-884
- **特性**:
  - 串行处理（一次一张）
  - 使用 `ref` 避免竞态条件
  - 自动队列处理
  - 支持取消队列任务

### 3. 高级设置

#### 3.1 批次数量
- **选项**: 1, 2, 4, 8, 16
- **默认**: 1
- **说明**: 每次生成的图片数量

#### 3.2 采样步数 (Steps)
- **范围**: 8-16
- **默认**: 9
- **说明**: 采样步数越多，图片质量越高，但生成时间越长

#### 3.3 图像比例
- **Square (1:1)**: 1024x1024
- **Portrait (9:16)**: 720x1280
- **Landscape (16:9)**: 1280x720

#### 3.4 种子模式
- **随机** (`random`): 每次使用新的随机种子
- **固定** (`fixed`): 使用指定的种子编号
- **首次固定** (`first-fixed`): 第一次随机，后续使用相同种子

#### 3.5 种子拖拽功能
- **位置**: `App.jsx` L1250-1255
- 生成的图片可拖拽
- 拖拽到种子输入框自动填充种子值

### 4. 主题系统

#### 4.1 动态主题色
- **位置**: `App.jsx` L973-986
- **CSS变量**:
  ```css
  --theme-hue: 色相 (0-360)
  --theme-bg-saturation: 背景饱和度 (0-100)
  --theme-bg-lightness: 背景亮度 (0-30)
  --theme-primary: 主题色
  --theme-primary-dark: 深色主题
  --theme-primary-light: 浅色主题
  --theme-accent: 强调色
  --theme-bg: 背景色
  --theme-bg-card: 卡片背景
  --theme-border: 边框色
  --theme-border-hover: 边框悬停色
  --theme-text: 文字色
  ```

#### 4.2 主题控制器
- **位置**: 右上角 🎨 按钮
- **控制项**:
  - **主题色相**: 0-360°，改变整体色调
  - **背景饱和度**: 0-100%，控制背景鲜艳度
  - **背景亮度**: 0-30%，控制背景明暗
- **预设颜色**: 紫、红、绿、蓝、金、粉

#### 4.3 主题范围
- **仅影响背景**:
  - 页面主背景
  - 表单面板
  - 输入框
  - 单选按钮
  - 滑块
  - 图像占位符
  - 骨架屏

- **不影响前景**:
  - 所有按钮（保持固定 70% 饱和度）
  - 边框和高亮
  - 文字颜色
  - 主题预设按钮

### 5. 数据持久化

#### 5.1 localStorage 存储
- **位置**: `App.jsx` L16-24 (加载), L66-102 (保存)
- **存储键值**:
  ```javascript
  corineGen_themeHue           // 主题色相
  corineGen_themeBgSaturation  // 背景饱和度
  corineGen_themeBgLightness   // 背景亮度
  corineGen_prompts            // 提示词列表
  corineGen_batchSize          // 批次数量
  corineGen_batchMethod        // 批次方法
  corineGen_steps              // 采样步数
  corineGen_aspectRatio        // 图像比例
  corineGen_seedMode           // 种子模式
  corineGen_fixedSeed          // 固定种子值
  corineGen_firstFixedSeed     // 首次固定种子值
  ```

#### 5.2 数据处理
- **保存时**: 去掉运行时状态（`isGenerating`, `focusIndex`）
- **加载时**: 自动添加运行时状态字段
- **容错**: try-catch 包裹，失败时使用默认值

### 6. UI/UX 优化

#### 6.1 响应式布局
- **宽屏** (≥1024px):
  - 左侧表单 (500px)
  - 右侧图像容器（粘性定位）
  - Grid 布局

- **移动端** (<768px):
  - 单列布局
  - 图像网格自适应

#### 6.2 交互细节
- 提示词删除按钮仅在聚焦时显示
- 发送按钮始终显示在右下角
- 取消按钮悬停时显示
- HQ 按钮状态颜色区分
- 进度文字居中固定（防止偏移）
- 图片点击下载（无 tooltip）

#### 6.3 视觉动画
- 按钮悬停放大效果
- 图片卡片悬停上升
- 进度幕布填充动画
- 图片揭示动画（幕布下降+淡入）
- 高清化时图片模糊效果

---

## 技术架构

### 1. 状态管理

#### 1.1 React State
```javascript
// 提示词状态
const [prompts, setPrompts] = useState([])

// 生成控制
const [isGenerating, setIsGenerating] = useState(false)
const [generationQueue, setGenerationQueue] = useState([])

// 高清化控制
const [isUpscaling, setIsUpscaling] = useState(false)
const [upscaleQueue, setUpscaleQueue] = useState([])

// 图像占位符
const [imagePlaceholders, setImagePlaceholders] = useState([])

// 主题设置
const [themeHue, setThemeHue] = useState(270)
const [themeBgSaturation, setThemeBgSaturation] = useState(60)
const [themeBgLightness, setThemeBgLightness] = useState(8)
```

#### 1.2 Ref 同步管理
**重要**: 使用 `ref` 避免闭包陷阱和竞态条件

```javascript
const imagePlaceholdersRef = useRef([])
const generationQueueRef = useRef([])
const upscaleQueueRef = useRef([])
const isUpscalingRef = useRef(false)

// 同步更新函数
const updateImagePlaceholders = (updater) => {
  setImagePlaceholders(prev => {
    const updated = typeof updater === 'function' ? updater(prev) : updater;
    imagePlaceholdersRef.current = updated; // 同步更新 ref
    return updated;
  });
};
```

**为什么需要 ref**:
- WebSocket 回调中使用的是闭包中的旧状态
- 队列处理需要实时读取最新状态
- 高清化队列需要防止重复触发

### 2. ComfyUI 集成

#### 2.1 API 端点
```javascript
const COMFYUI_API = 'http://127.0.0.1:8188'
const COMFYUI_WS = 'ws://127.0.0.1:8188/ws'
```

#### 2.2 工作流文件
- **生成**: `CorineGen.json` (根目录)
  - 节点 5: 提示词文本
  - 节点 4: 种子 + 采样步数
  - 节点 7: 图像尺寸 + 批次大小
  - 节点 44: RepeatLatentBatch (设为 1)

- **高清化**: `ImageUpscaleAPI.json` (根目录)
  - 节点 1145: 加载图像
  - 节点 1146: VAE 模型
  - 节点 1148: 高清化处理
  - 节点 1149: DiT 模型
  - 节点 1078: 保存图像

#### 2.3 WebSocket 消息处理
```javascript
// 进度消息
{ type: 'progress', data: { value, max } }

// 执行状态
{ type: 'executing', data: { node, prompt_id } }
// node === null 表示完成

// 执行错误
{ type: 'execution_error', data: { exception_message } }
```

#### 2.4 图像获取
```javascript
// 从历史记录获取图像
const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`)
const history = await historyResponse.json()
const outputs = history[prompt_id].outputs

// 构建图像 URL
const imageUrl = `${COMFYUI_API}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`
```

### 3. CSS 架构

#### 3.1 主题变量系统
```css
:root {
  --theme-hue: 270;
  --theme-bg-saturation: 60;
  --theme-bg-lightness: 8;
  /* ... 其他变量 ... */
}
```

#### 3.2 动态颜色计算
```css
/* 背景色使用动态饱和度和亮度 */
background: hsla(
  calc(var(--theme-hue) * 1),
  calc(var(--theme-bg-saturation) * 1%),
  calc(var(--theme-bg-lightness) * 1%),
  0.9
);

/* 前景色使用固定值 */
color: hsl(var(--theme-hue), 70%, 65%);
```

**注意**: CSS `calc()` 中百分号的位置
- ❌ 错误: `calc(60 * 1%)` = 0.6
- ✅ 正确: `calc(60 * 1%)` = 60%

---

## 关键问题与解决方案

### 问题 1: WebSocket 闭包陷阱

**问题**: WebSocket 回调中访问的 state 是旧值

**解决方案**:
```javascript
// 使用 ref 保持最新值
const placeholderRef = useRef([])

// 更新时同步 ref
setPlaceholders(prev => {
  const updated = [...prev, newItem]
  placeholderRef.current = updated // 同步
  return updated
})

// WebSocket 中读取最新值
ws.onmessage = () => {
  const latest = placeholderRef.current // 读取最新
}
```

### 问题 2: 高清化队列竞态条件

**问题**: 多个 HQ 按钮同时点击导致重复处理

**解决方案**:
```javascript
// 使用 ref 同步标记状态
const isUpscalingRef = useRef(false)

const queueUpscale = (id) => {
  if (!isUpscalingRef.current) {
    isUpscalingRef.current = true // 立即标记
    setIsUpscaling(true)
    upscaleImage(id)
  } else {
    // 添加到队列
    upscaleQueueRef.current.push(id)
  }
}
```

### 问题 3: 进度文字偏移

**问题**: 进度百分比文字偶尔跳到左上角

**原因**: 依赖 flexbox 隐式居中，受其他 CSS 影响

**解决方案**:
```css
.skeleton-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%); /* 显式居中 */
}
```

### 问题 4: 批次 ID 唯一性

**问题**: 多个提示词生成时占位符 ID 冲突

**解决方案**:
```javascript
// 使用批次计数器确保唯一性
const nextBatchId = useRef(1)

const createPlaceholders = () => {
  const batchId = nextBatchId.current++
  return Array.from({ length: batchSize }, (_, index) => ({
    id: `${promptId}-${batchId}-${index}`, // 唯一 ID
    batchId,
    // ...
  }))
}
```

### 问题 5: 提示词 ID 初始化

**问题**: 从 localStorage 恢复后新提示词 ID 冲突

**解决方案**:
```javascript
// 从保存的提示词中计算下一个 ID
const savedPrompts = loadFromStorage('corineGen_prompts', [{ id: 1 }])
const nextPromptId = useRef(
  Math.max(...savedPrompts.map(p => p.id)) + 1
)
```

### 问题 6: CSS calc() 百分号错误

**问题**: 背景变成白色，计算错误

**错误写法**:
```css
/* ❌ 错误: 60 * 0.01% = 0.006 */
background: hsl(270, calc(var(--sat) * 0.01%), 50%)
```

**正确写法**:
```css
/* ✅ 正确: 60 * 1% = 60% */
background: hsl(270, calc(var(--sat) * 1%), 50%)
```

---

## 代码规范与最佳实践

### 1. 状态更新

#### 1.1 批量更新使用函数式
```javascript
// ✅ 推荐：基于前一个状态更新
setPlaceholders(prev => prev.map(p =>
  p.id === targetId ? { ...p, progress: 100 } : p
))

// ❌ 避免：直接使用当前状态
setPlaceholders(placeholders.map(...)) // 可能是旧值
```

#### 1.2 同步 ref 和 state
```javascript
// ✅ 推荐：同时更新
const updatePlaceholders = (updater) => {
  setPlaceholders(prev => {
    const updated = updater(prev)
    placeholdersRef.current = updated // 同步
    return updated
  })
}

// ❌ 避免：只更新 state
setPlaceholders(newValue) // ref 未同步
```

### 2. 异步处理

#### 2.1 WebSocket 超时处理
```javascript
let timeoutId = setTimeout(() => {
  if (ws) ws.close()
  reject(new Error('超时'))
}, 300000) // 5分钟

// 记得清理
if (timeoutId) clearTimeout(timeoutId)
```

#### 2.2 资源清理
```javascript
try {
  // 异步操作
} catch (err) {
  console.error(err)
} finally {
  // 总是清理资源
  if (ws) ws.close()
  if (timeoutId) clearTimeout(timeoutId)
  processQueue() // 继续队列
}
```

### 3. CSS 最佳实践

#### 3.1 使用 CSS 变量
```css
/* ✅ 推荐：使用变量 */
.button {
  background: var(--theme-primary);
  border: 1px solid var(--theme-border);
}

/* ❌ 避免：硬编码颜色 */
.button {
  background: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.3);
}
```

#### 3.2 calc() 中的单位
```css
/* ✅ 正确 */
calc(var(--value) * 1%)    /* 数字转百分比 */
calc(var(--value) * 1px)   /* 数字转像素 */

/* ❌ 错误 */
calc(var(--value) * 0.01%) /* 结果太小 */
var(--value)%              /* 语法错误 */
```

---

## 性能优化

### 1. 图像占位符

**策略**: 使用虚拟滚动（未实现）
```javascript
// 当图片数量 > 50 时考虑虚拟滚动
// 推荐库: react-window, react-virtualized
```

### 2. WebSocket 连接复用

**当前**: 每次生成创建新连接
**优化方向**: 复用单个 WebSocket 连接，通过 `client_id` 区分

### 3. 图片懒加载

**当前**: 所有图片立即加载
**优化方向**: 使用 `loading="lazy"` 或 Intersection Observer

---

## 已知问题与待改进

### 1. 功能缺陷

- [ ] 没有图片编辑功能（裁剪、调整）
- [ ] 没有批量下载功能
- [ ] 没有历史记录查看
- [ ] 没有图片收藏/标签系统
- [ ] 高清化不支持批量操作

### 2. UX 改进

- [ ] 生成失败时没有重试按钮
- [ ] 没有拖拽排序提示词
- [ ] 没有提示词模板/预设
- [ ] 主题切换没有过渡动画
- [ ] 没有快捷键支持

### 3. 技术债务

- [ ] 没有单元测试
- [ ] 没有 TypeScript 类型定义
- [ ] 图像占位符状态机可以优化
- [ ] WebSocket 错误处理不够完善
- [ ] 没有离线检测和提示

### 4. 性能问题

- [ ] 大量图片时滚动卡顿
- [ ] 没有图片懒加载
- [ ] localStorage 没有大小限制检查
- [ ] WebSocket 没有重连机制

---

## 未来功能规划

### 短期 (1-2周)

1. **批量操作**
   - 批量下载选中图片
   - 批量删除
   - 批量高清化

2. **提示词管理**
   - 拖拽排序
   - 提示词模板库
   - 提示词历史记录

3. **错误处理**
   - 重试机制
   - 离线检测
   - 友好的错误提示

### 中期 (1个月)

1. **图片管理**
   - 图片收藏夹
   - 标签系统
   - 搜索过滤

2. **高级编辑**
   - 图片裁剪
   - 尺寸调整
   - 简单滤镜

3. **性能优化**
   - 虚拟滚动
   - 图片懒加载
   - WebSocket 连接池

### 长期 (3个月+)

1. **AI 功能增强**
   - ControlNet 支持
   - LoRA 模型选择
   - 负面提示词
   - Img2Img 功能

2. **协作功能**
   - 多用户支持
   - 图片分享
   - 项目管理

3. **工作流定制**
   - 可视化工作流编辑器
   - 自定义节点参数
   - 工作流模板市场

---

## 开发环境设置

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
# 默认运行在 http://localhost:3000
```

### 构建生产版本
```bash
npm run build
# 输出到 dist/ 目录
```

### 预览生产构建
```bash
npm run preview
```

---

## 调试技巧

### 1. WebSocket 调试

**Chrome DevTools**:
1. Network -> WS 标签
2. 查看消息收发
3. 检查连接状态

**代码调试**:
```javascript
ws.onmessage = (event) => {
  console.log('[WS] 收到消息:', event.data)
  // 处理消息
}

ws.onerror = (error) => {
  console.error('[WS] 错误:', error)
}
```

### 2. localStorage 调试

**清空所有设置**:
```javascript
// 浏览器控制台执行
Object.keys(localStorage)
  .filter(key => key.startsWith('corineGen_'))
  .forEach(key => localStorage.removeItem(key))
```

**查看当前设置**:
```javascript
Object.keys(localStorage)
  .filter(key => key.startsWith('corineGen_'))
  .forEach(key => console.log(key, localStorage.getItem(key)))
```

### 3. 状态调试

**查看实时状态**:
```javascript
// 在组件中添加
useEffect(() => {
  console.log('[State] Placeholders:', imagePlaceholders)
  console.log('[Ref] Placeholders:', imagePlaceholdersRef.current)
}, [imagePlaceholders])
```

---

## 常见问题 FAQ

### Q1: 为什么生成的图片没有显示？

**检查清单**:
1. ComfyUI 是否在运行？
2. WebSocket 是否连接成功？（查看 Network 标签）
3. 工作流文件是否存在？（`CorineGen.json`）
4. 浏览器控制台是否有错误？

### Q2: 为什么高清化失败？

**可能原因**:
1. 模型文件未下载（`ema_vae_fp16.safetensors`, `seedvr2_ema_3b_fp16.safetensors`）
2. GPU 内存不足
3. 上传图片失败

**解决方法**:
- 检查 ComfyUI 模型目录
- 降低 batch_size 参数
- 查看 ComfyUI 日志

### Q3: 为什么主题颜色没有变化？

**可能原因**:
1. CSS 变量未正确传递
2. 浏览器缓存问题

**解决方法**:
- 硬刷新 (Ctrl+Shift+R)
- 检查浏览器开发工具 -> Elements -> Computed -> CSS 变量值

### Q4: 为什么设置没有保存？

**可能原因**:
1. localStorage 被禁用
2. 浏览器隐私模式
3. localStorage 配额已满

**解决方法**:
- 检查浏览器设置
- 清理 localStorage
- 使用普通模式

---

## 贡献指南

### 代码风格

1. **缩进**: 2 空格
2. **引号**: 单引号（JSX 属性用双引号）
3. **分号**: 必须使用
4. **命名**:
   - 组件: PascalCase
   - 函数: camelCase
   - 常量: UPPER_SNAKE_CASE
   - CSS 类: kebab-case

### 提交规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 添加测试
- `chore`: 构建/工具变动

**示例**:
```
feat(theme): 添加背景饱和度和亮度控制

- 新增 themeBgSaturation 和 themeBgLightness 状态
- 添加两个滑块到主题选择器
- 更新所有背景色使用动态饱和度和亮度
- 修复 CSS calc() 百分号位置错误

Closes #123
```

---

## 项目文件结构

```
CorineGen/
├── public/                 # 静态资源
├── src/
│   ├── App.jsx            # 主应用组件 (1400+ 行)
│   ├── App.css            # 主样式文件 (900+ 行)
│   ├── main.jsx           # 入口文件
│   └── index.css          # 全局样式
├── CorineGen.json         # 图像生成工作流
├── ImageUpscaleAPI.json   # 高清化工作流
├── package.json           # 项目配置
├── vite.config.js         # Vite 配置
├── README.md              # 用户文档
└── DEVELOPMENT.md         # 开发文档（本文件）
```

---

## 重要代码位置索引

### 核心功能
- **提示词管理**: App.jsx L109-129
- **工作流构建**: App.jsx L158-191
- **生成单个提示词**: App.jsx L193-246
- **批次生成**: App.jsx L318-480
- **循环生成**: App.jsx L482-667
- **队列处理**: App.jsx L248-316

### 高清化
- **构建高清化工作流**: App.jsx L669-675
- **高清化单张图片**: App.jsx L677-847
- **高清化队列处理**: App.jsx L849-897
- **添加到高清化队列**: App.jsx L899-952

### UI 组件
- **主题选择器**: App.jsx L1001-1050
- **提示词输入**: App.jsx L1075-1120
- **高级设置**: App.jsx L1134-1340
- **图像占位符**: App.jsx L1357-1429

### 样式
- **主题变量**: App.css L7-18
- **主题按钮**: App.css L42-182
- **表单样式**: App.css L194-570
- **图像样式**: App.css L571-903

---

## 联系与支持

**项目位置**: `C:\Users\billy\Desktop\CorineGen`

**ComfyUI 文档**: https://docs.comfy.org/

**React 文档**: https://react.dev/

**Vite 文档**: https://vitejs.dev/

---

**最后更新**: 2026-01-04
**版本**: 1.0.0
**作者**: Claude + Billy
