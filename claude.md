# CorineGen - AI 助手开发指南

这是 CorineGen 项目的 AI 助手上下文文档，帮助 Claude 快速理解项目并提供精准的开发支持。

## 项目概览

**名称**: CorineGen - AI 图像生成器
**架构**: React 前端 + Node.js 后端（前后端分离）
**用途**: ComfyUI 的 Web 前端界面，用于生成和管理 AI 图像
**当前版本**: 1.0.0
**主要语言**: JavaScript (JSX)

## 架构说明

### 完整架构

```
远端用户 ──> Vercel (前端) ──> 花生壳 ──> 本机后端 ──> ComfyUI
                 ↓                        ↓             ↓
            React SPA              Express Proxy   WebSocket API
          (静态部署)              (HTTP + WS)       (图像生成)
```

### 三层结构

1. **前端层 (Vercel)**
   - React 18 + Vite 构建
   - 静态文件部署
   - 环境变量配置后端地址

2. **后端层 (本机)**
   - Express HTTP/WebSocket 代理
   - CORS 处理
   - 请求转发到 ComfyUI
   - 监听 `0.0.0.0:3001`

3. **AI 层 (ComfyUI)**
   - 运行在 `127.0.0.1:8188`
   - 提供图像生成 API

### 网络流程

**开发环境**:
```
浏览器 (localhost:5173) ──> Vite Proxy ──> Backend (3001) ──> ComfyUI (8188)
```

**生产环境**:
```
浏览器 ──> Vercel ──> 花生壳 (6802gd0yf444.vicp.fun) ──> Backend ──> ComfyUI
```

## 技术栈

### 前端 (frontend/)
- **React 18.2.0** - UI 框架
- **Vite 5.0.8** - 构建工具和开发服务器
- **Lucide React 0.562.0** - 图标库
- **React Masonry CSS** - 瀑布流布局

### 后端 (backend/)
- **Node.js + Express** - HTTP 服务器
- **ws** - WebSocket 代理
- **http-proxy-middleware** - HTTP 代理中间件
- **cors** - CORS 处理

### 数据持久化
- **localStorage** - 保存用户设置、提示词、主题配置等

## 项目结构

```
CorineGen/
├── frontend/                       # 前端 (Vercel 部署)
│   ├── src/
│   │   ├── main.jsx               # React 入口
│   │   ├── App.jsx                # 主应用组件
│   │   ├── App.css                # 主样式文件
│   │   ├── config/
│   │   │   └── api.js             # API 配置
│   │   ├── adapters/              # 工作流适配器层
│   │   │   ├── index.js           # 适配器注册
│   │   │   ├── BaseAdapter.js     # 抽象基类
│   │   │   ├── TextToImageAdapter.js
│   │   │   ├── Image2ImageAdapter.js
│   │   │   ├── ControlNetAdapter.js
│   │   │   └── UpscaleAdapter.js
│   │   ├── services/              # API 通信层
│   │   │   ├── apiClient.js       # HTTP 客户端
│   │   │   └── wsClient.js        # WebSocket 客户端
│   │   └── workflows/             # 工作流模板
│   │       ├── TextToImage.json
│   │       ├── Image2Image.json
│   │       ├── ControlNet.json
│   │       └── Upscale.json
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json
│
├── backend/                        # 后端 (本机部署)
│   ├── src/
│   │   ├── index.js               # Express 入口
│   │   └── proxy/
│   │       └── wsProxy.js         # WebSocket 代理
│   ├── package.json
│   └── .env                       # 环境变量配置
│
├── docs/
│   └── deployment.md              # 部署指南
├── CLAUDE.md                      # AI 助手指南（本文件）
├── README.md                      # 用户文档
└── DEVELOPMENT.md                 # 开发文档
```

## 核心功能模块

### 1. 连接管理 (App.jsx:471-508)
```javascript
const checkConnection = async (silent = false) => { ... }
```
- 检测 ComfyUI 连接状态
- 心跳检测机制 (每 5 秒)
- 连接成功后自动刷新 LoRA 列表

### 2. 提示词管理 (App.jsx:27-33, 111-120)
- 最多 10 个提示词
- 自动添加触发词 `yjy，中国女孩`
- localStorage 持久化

### 3. 图像生成队列 (App.jsx:196-264)
**两种模式**:
- `batch`: 批次模式，一次性生成
- `loop`: 循环模式，逐张生成（推荐）

**队列管理**:
- 使用 `useRef` 避免闭包陷阱
- 支持任务取消
- 实时进度显示

### 4. 高清化队列 (App.jsx:626-884)
- 使用 SeedVR2 模型 4x 超分辨率
- 串行处理，避免 GPU 内存溢出
- 状态: `none` → `queued` → `upscaling` → `completed`

### 5. 主题系统 (App.jsx:39-54, 139-151)
**CSS 变量动态主题**:
```css
--theme-hue: 270deg
--theme-saturation: 70%
--theme-lightness: 60%
```
- 色相 (0-360)
- 背景饱和度 (0-100)
- 背景亮度 (0-100)

### 6. LoRA 管理 (App.jsx:432-442, 1105-1200+)
- 从 ComfyUI 获取可用 LoRA 列表
- 用户可启用/禁用 LoRA
- 支持自定义显示名称和触发词
- localStorage 持久化已启用的 LoRA
- 长按进入多选模式
- 批量命名和下载

### 7. 预设管理 (App.jsx:新增功能)
- 保存和加载生成参数预设
- 包括批次数、步数、尺寸、种子设置等
- localStorage 持久化

### 8. 多选模式 (App.jsx:2595-2670)
- 长按图片进入多选模式
- 全选按钮支持三态：全选、半选、全不选
- 批量操作：下载、命名下载、高清化、删除
- 删除操作有确认对话框
- 拖拽种子到输入框时自动滚动页面

### 9. 图生图 & ControlNet (App.jsx:1475-1706)
- 支持两种参考图片生成模式
- **图生图 (Image2Image)**: 直接使用参考图片进行图像到图像转换
- **ControlNet**: 使用参考图片的线稿/深度/姿势进行控制生成
- 工作流文件: `Image2ImageAPI.json`, `ZIT_CNN_API.json`
- 降噪强度默认 `IMG2IMG_DENOISE = 1`
- 不支持 LoRA，忽略用户的 LoRA 设置
- 输出尺寸跟随输入图片
- 支持批量生成（仅循环模式）

**上传方式**:
- 点击提示词框左下角的图片上传按钮
- 拖拽图片到提示词输入框

**模式选择**:
- 直接使用图片 → `Image2ImageAPI.json`
- 使用图片线稿 → `ZIT_CNN_API.json` (index=0)
- 使用图片深度 → `ZIT_CNN_API.json` (index=1)
- 使用图片姿势 → `ZIT_CNN_API.json` (index=2)

### 10. 图片加载恢复机制 (App.jsx:2372-2461, 3695-3696)
**问题**: 图片在渐进式加载过程中如果网络断开，只加载一半后无法恢复

**解决方案**:
- **自动重试**: 监听 `<img>` 的 `onError` 事件，最多重试 3 次（递增延迟 1s/2s/3s）
- **连接恢复**: 重连时自动扫描并重新加载所有失败的图片
- **防止缓存**: 重试时添加时间戳参数 `?t=timestamp`

**新增字段**:
```javascript
imageLoadError: false,   // 图片是否加载失败
imageRetryCount: 0       // 重试次数
```

**核心函数**:
- `handleImageError(placeholderId)`: 处理图片加载失败
- `retryImageLoad(placeholderId)`: 重试加载图片
- `handleImageLoad(placeholderId)`: 处理加载成功
- `reloadFailedImages()`: 批量重新加载失败图片

**触发时机**:
1. 图片加载失败 → 自动重试（最多 3 次）
2. 手动重连成功 → 重新加载所有失败图片
3. 生成时连接恢复 → 重新加载所有失败图片

## API 配置与认证

### 环境判断

```javascript
// frontend/src/config/api.js
const isDevelopment = import.meta.env.DEV;

const baseUrl = isDevelopment
  ? ''  // 开发环境使用 Vite 代理
  : (import.meta.env.VITE_BACKEND_URL || '');  // 生产环境使用环境变量
```

### 认证状态

**当前**: 无认证（已移除 API Key）

```javascript
// frontend/src/config/api.js:64-66
export function isAuthRequired() {
  return false;  // 始终返回 false
}
```

### 后端配置

**backend/.env**:
```bash
COMFYUI_HOST=http://127.0.0.1:8188
PORT=3001
ALLOWED_ORIGINS=http://localhost:5173,https://corine-gen.vercel.app
```

**CORS 配置** (backend/src/index.js:20-31):
- 允许配置的域名访问
- 支持凭证 (credentials: true)
- 后端监听 `0.0.0.0:3001` 以支持花生壳穿透

## 关键代码位置速查

| 功能 | 文件 | 行号 |
|------|------|------|
| API 配置 | config/api.js | 全文 |
| HTTP 客户端 | services/apiClient.js | 全文 |
| WebSocket 客户端 | services/wsClient.js | 全文 |
| 后端入口 | backend/src/index.js | 全文 |
| WebSocket 代理 | backend/src/proxy/wsProxy.js | 全文 |
| ComfyUI 连接检查 | App.jsx | 530-570 |
| LoRA 列表获取 | App.jsx | 512-524 |
| 图像生成队列 | App.jsx | 972-1042 |
| 高清化队列 | App.jsx | 1541-1650 |
| 图生图工作流构建 | App.jsx | 1477-1508 |
| ControlNet工作流构建 | App.jsx | 1510-1539 |
| 参考图片上传处理 | App.jsx | 625-670 |
| 图片加载错误处理 | App.jsx | 2372-2403 |
| 图片加载重试 | App.jsx | 2405-2422 |
| 图片加载成功处理 | App.jsx | 2424-2434 |
| 批量重新加载失败图片 | App.jsx | 2436-2461 |
| 图片 onError/onLoad 事件 | App.jsx | 3695-3696 |
| 主题管理 | App.jsx | 139-151, App.css:1-50 |
| localStorage 持久化 | App.jsx | 50-75 |

## 重要实现细节

### 1. 使用 useRef 避免闭包陷阱
```javascript
const queueRef = useRef([]);
const processingRef = useRef(false);
```
**原因**: 在异步操作中，直接使用 state 可能导致获取到旧值，使用 ref 确保获取最新值。

### 2. WebSocket 连接管理
```javascript
// 前端连接到后端
const ws = new WebSocket(`${COMFYUI_WS}/ws?clientId=${clientId}`);

// 后端代理到 ComfyUI
const comfyWs = new WebSocket(`${wsHost}/ws?clientId=${clientId}`);
```
- 使用唯一 clientId 识别连接
- 前端 → 后端 → ComfyUI 的双层代理
- 监听进度事件: `execution_start`, `progress`, `executing`

### 3. 图片下载文件名规范
```javascript
`${prompt.slice(0, 30)}_${aspect}_batch${batchSize}_seed${seed}_steps${steps}.png`
```

### 4. 高清化图片上传
```javascript
const formData = new FormData();
formData.append('image', blob, filename);
formData.append('overwrite', 'true');
await fetch(`${COMFYUI_API}/upload/image`, { ... });
```

### 5. 连接成功后刷新 LoRA 列表
**修复记录**: 2026-01-12
- 问题: 重新连接后 LoRA 列表未刷新
- 解决: 在 `checkConnection` 成功后调用 `fetchAvailableLoras()`

## 部署流程

### 开发环境

1. **启动后端**:
```bash
cd backend
npm install
npm run dev  # 监听 3001 端口
```

2. **启动前端**:
```bash
cd frontend
npm install
npm run dev  # 访问 localhost:5173
```

### 生产环境

**后端（本机）**:
1. 配置 `.env` 文件，添加 Vercel 域名到 `ALLOWED_ORIGINS`
2. 使用 PM2 启动: `pm2 start src/index.js --name corinegen-backend`
3. 配置花生壳：内网端口 `3001`，外网域名 `6802gd0yf444.vicp.fun`

**前端（Vercel）**:
1. 推送代码到 GitHub
2. Vercel 导入项目，Root Directory 设为 `frontend`
3. 添加环境变量：
   - `VITE_BACKEND_URL=https://6802gd0yf444.vicp.fun`
   - `VITE_BACKEND_WS_URL=wss://6802gd0yf444.vicp.fun`
4. 部署

## API 端点

### 后端代理端点

- `GET /health` - 健康检查（无需认证）
- `GET /api/system_stats` - 转发到 ComfyUI 系统状态
- `GET /api/object_info/LoraLoader` - 转发到 ComfyUI LoRA 列表
- `POST /api/prompt` - 转发到 ComfyUI 提交任务
- `POST /api/upload/image` - 转发到 ComfyUI 上传图片
- `GET /api/view?filename={name}` - 转发到 ComfyUI 获取图片
- `WS /ws?clientId={id}` - WebSocket 代理

### ComfyUI 原始端点

- `GET http://127.0.0.1:8188/system_stats` - 系统状态
- `GET http://127.0.0.1:8188/object_info/LoraLoader` - LoRA 列表
- `POST http://127.0.0.1:8188/prompt` - 提交任务
- `POST http://127.0.0.1:8188/upload/image` - 上传图片
- `GET http://127.0.0.1:8188/view` - 获取图片
- `WS ws://127.0.0.1:8188/ws` - WebSocket 进度推送

## 开发规范

### 代码风格
- 使用函数组件和 Hooks
- 优先使用 `const` 声明
- 使用模板字符串拼接
- 中文注释和用户界面

### 状态管理
- 优先使用 `useState`
- 需要最新值的场景使用 `useRef`
- 使用 `useEffect` 处理副作用
- localStorage 自动持久化

### 命名约定
- 组件: PascalCase
- 函数/变量: camelCase
- 常量: UPPER_SNAKE_CASE
- CSS 类: kebab-case

### 文件操作
- 读取文件: 使用 Read 工具
- 编辑文件: 使用 Edit 工具（不要用 sed/awk）
- 搜索代码: 使用 Grep 工具（不要用 bash grep）
- 查找文件: 使用 Glob 工具（不要用 find）

## 常见开发任务

### 添加新功能
1. 在 App.jsx 中添加状态和函数
2. 更新 JSX 渲染部分
3. 在 App.css 中添加样式
4. 考虑是否需要 localStorage 持久化

### 修改后端配置
1. 编辑 `backend/.env` 文件
2. 重启后端服务
3. 如果修改了代码，提交到 Git

### 修改前端配置
1. 编辑 `frontend/src/config/api.js`
2. 重新构建前端
3. 推送到 GitHub 触发 Vercel 重新部署

### 修复 Bug
1. 使用 Read 工具阅读相关代码
2. 使用 Grep 搜索相关关键词
3. 使用 Edit 工具修改代码
4. 避免过度工程，只修复当前问题

### 调试技巧
- 检查浏览器控制台的错误信息
- 查看 ComfyUI 终端日志
- 检查后端日志（PM2: `pm2 logs`）
- 检查 localStorage 中的数据
- 验证 ComfyUI 连接状态
- 使用 Network 面板检查请求

## 已知问题和解决方案

### 1. LoRA 列表未刷新 (已修复)
**症状**: 重新连接 ComfyUI 后，LoRA 列表为空
**原因**: `fetchAvailableLoras` 只在组件挂载时执行一次
**解决**: 在 `checkConnection` 成功后调用 `fetchAvailableLoras()`

### 2. 队列竞态条件 (已修复)
**解决**: 使用 `useRef` 管理队列状态，避免闭包陷阱

### 3. 高清化内存溢出 (已修复)
**解决**: 串行处理，一次只高清化一张图片

### 4. 拖拽和长按冲突 (已修复)
**症状**: 拖拽图片时会误触发长按进入多选模式
**解决**: 在 `onDragStart` 中调用 `handleLongPressEnd()` 取消长按计时器

### 5. CORS 跨域问题 (已修复)
**症状**: Vercel 前端无法访问后端
**原因**: `ALLOWED_ORIGINS` 配置中域名末尾多了斜杠
**解决**: 移除斜杠，确保格式为 `https://corine-gen.vercel.app`

### 6. 花生壳端口配置错误 (已修复)
**症状**: 访问花生壳域名时返回 Vite 错误
**原因**: 花生壳映射到前端端口 5173 而非后端端口 3001
**解决**: 修改花生壳配置，内网端口改为 3001

### 7. 连接状态横幅显示错误 (已修复 - 2026-01-17)
**症状**: 生成过程中心跳检测失败时显示"无法连接到 ComfyUI"红色横幅，但生成任务实际正常进行
**原因**: 心跳检测（HTTP）和生成连接（WebSocket）是独立的，心跳失败不代表生成连接断开
**解决**:
- 生成过程中（`isGenerating === true`）忽略心跳检测失败
- 收到 ComfyUI 消息时自动恢复连接状态，显示"已重新连接到 ComfyUI"绿色横幅
- 横幅 3 秒后自动收起
**修复记录**: commit `0e4078e`

### 8. 图片加载中断无法恢复 (已修复 - 2026-01-18)
**症状**: 图片在渐进式加载过程中如果网络断开，只加载一半后无法恢复，即使重连也永久显示半张图片
**原因**: 浏览器的 `<img>` 加载失败后不会自动重试，也没有监听 `onError` 事件
**解决**:
- 监听 `<img>` 的 `onError` 事件，检测加载失败
- 自动重试最多 3 次，递增延迟（1s/2s/3s）
- 重试时添加时间戳参数防止浏览器缓存
- 连接恢复时自动扫描并批量重新加载所有失败图片
- 监听 `onLoad` 事件，加载成功后清除错误状态
**修复记录**: commit `3b80d0b`

## 性能优化建议

1. 图片数量控制在 20 张以内
2. 批次大小建议 ≤ 4
3. 采样步数 9-12 步为平衡点
4. 使用循环模式提高用户体验

## Git 提交规范

### 提交消息格式
```
<type>: <description>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### 常用 type
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 代码重构
- `style`: 样式调整
- `docs`: 文档更新
- `perf`: 性能优化

### 最近提交历史
- `3b80d0b` feat: 添加图片加载失败自动恢复机制
- `0e4078e` fix: 修复连接状态横幅显示错误
- `e9b63c3` 更新claude文档
- `d17d7a4` docs: 更新所有文档反映当前架构
- `a87f1fb` refactor: 禁用前端 API Key 认证

## 快速命令

```bash
# 前端
cd frontend
npm install
npm run dev          # 开发服务器
npm run build        # 构建生产版本
npm run preview      # 预览生产构建

# 后端
cd backend
npm install
npm run dev          # 开发模式（nodemon）
npm start            # 生产模式
pm2 start src/index.js --name corinegen-backend  # PM2 启动
pm2 logs             # 查看日志
pm2 restart all      # 重启服务

# Git 操作
git status
git add .
git commit -m "commit message"
git push
git log --oneline -5
```

## 相关文档

- **README.md**: 用户使用指南
- **DEVELOPMENT.md**: 详细开发文档
- **docs/deployment.md**: 部署指南
- **frontend/package.json**: 前端依赖和脚本
- **backend/package.json**: 后端依赖和脚本

## AI 助手工作流程

当用户请求修改或添加功能时:

1. **理解需求**: 仔细阅读用户描述
2. **定位代码**: 使用 Grep/Glob 查找相关代码
3. **阅读现有实现**: 使用 Read 工具了解当前逻辑
4. **规划修改**: 确定修改范围和影响
5. **编辑代码**: 使用 Edit 工具精确修改
6. **验证修改**: 确保语法正确，逻辑完整
7. **解释改动**: 向用户说明修改内容和原因

## 注意事项

1. **不要过度设计**: 只实现用户明确要求的功能
2. **保持风格一致**: 遵循现有代码风格
3. **避免破坏性更改**: 修改前确认影响范围
4. **使用专用工具**: 不要用 bash 命令操作文件
5. **中文优先**: 用户界面和注释使用中文
6. **测试连接**: 修改 API 调用时注意 ComfyUI 连接状态
7. **文档同步**: 重大变更后更新相关文档

## 环境信息

- **工作目录**: `C:\Users\Tintt\Documents\CorineGen`
- **Git 仓库**: 是
- **平台**: Windows (win32)
- **前端端口**: 5173 (开发), Vercel (生产)
- **后端端口**: 3001
- **ComfyUI**: 127.0.0.1:8188
- **花生壳域名**: https://6802gd0yf444.vicp.fun

---

**最后更新**: 2026-01-18
**维护者**: Claude Code Assistant
**当前架构**: 前后端分离 + 无认证
