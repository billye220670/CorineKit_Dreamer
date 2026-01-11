# CorineGen - AI 助手开发指南

这是 CorineGen 项目的 AI 助手上下文文档，帮助 Claude 快速理解项目并提供精准的开发支持。

## 项目概览

**名称**: CorineGen - AI 图像生成器
**类型**: React 单页应用 (SPA)
**用途**: ComfyUI 的 Web 前端界面，用于生成和管理 AI 图像
**当前版本**: 1.0.0
**主要语言**: JavaScript (JSX)

## 技术栈

### 核心框架
- **React 18.2.0** - UI 框架
- **Vite 5.0.8** - 构建工具和开发服务器
- **Lucide React 0.562.0** - 图标库

### 后端集成
- **ComfyUI API** - 运行在 `http://127.0.0.1:8188`
  - REST API: 用于上传图片、获取系统状态、查询模型
  - WebSocket: 用于实时进度推送

### 数据持久化
- **localStorage** - 保存用户设置、提示词、主题配置等

## 项目结构

```
CorineGen/
├── src/
│   ├── App.jsx          # 主应用组件 (1500+ 行)
│   ├── App.css          # 主样式文件
│   └── main.jsx         # React 入口
├── public/              # 静态资源
├── docs/                # 文档目录
├── CorineGen.json       # ComfyUI 图像生成工作流
├── ImageUpscaleAPI.json # ComfyUI 高清化工作流
├── README.md            # 用户文档
├── DEVELOPMENT.md       # 开发文档
├── package.json         # 依赖配置
└── vite.config.js       # Vite 配置
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

## 关键代码位置速查

| 功能 | 文件 | 行号 |
|------|------|------|
| ComfyUI 连接检查 | App.jsx | 471-508 |
| LoRA 列表获取 | App.jsx | 432-442 |
| 图像生成队列 | App.jsx | 196-264 |
| 高清化队列 | App.jsx | 797-884 |
| WebSocket 进度监听 | App.jsx | 292-388 (batch), 476-564 (loop) |
| 主题管理 | App.jsx | 139-151, App.css:1-50 |
| localStorage 持久化 | App.jsx | 50-75 (loadFromStorage) |
| 种子拖拽复制 | App.jsx | 886-943 |
| LoRA 管理器 UI | App.jsx | 1105-1200+ |

## 重要实现细节

### 1. 使用 useRef 避免闭包陷阱
```javascript
const queueRef = useRef([]);
const processingRef = useRef(false);
```
**原因**: 在异步操作中，直接使用 state 可能导致获取到旧值，使用 ref 确保获取最新值。

### 2. WebSocket 连接管理
```javascript
const ws = new WebSocket(`${COMFYUI_WS}?clientId=${clientId}`);
```
- 使用唯一 clientId 识别连接
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

### 修复 Bug
1. 使用 Read 工具阅读相关代码
2. 使用 Grep 搜索相关关键词
3. 使用 Edit 工具修改代码
4. 避免过度工程，只修复当前问题

### 调试技巧
- 检查浏览器控制台的错误信息
- 查看 ComfyUI 终端日志
- 检查 localStorage 中的数据
- 验证 ComfyUI 连接状态

## API 端点

### ComfyUI REST API
- `GET /system_stats` - 系统状态（用于连接检查）
- `GET /object_info/LoraLoader` - 获取可用 LoRA 列表
- `POST /prompt` - 提交生成任务
- `POST /upload/image` - 上传图片
- `GET /view?filename={name}&subfolder=&type=output` - 获取生成的图片

### ComfyUI WebSocket
- `ws://127.0.0.1:8188/ws?clientId={id}` - 实时进度推送

## 已知问题和解决方案

### 1. LoRA 列表未刷新 (已修复)
**症状**: 重新连接 ComfyUI 后，LoRA 列表为空
**原因**: `fetchAvailableLoras` 只在组件挂载时执行一次
**解决**: 在 `checkConnection` 成功后调用 `fetchAvailableLoras()`

### 2. 队列竞态条件
**解决**: 使用 `useRef` 管理队列状态，避免闭包陷阱

### 3. 高清化内存溢出
**解决**: 串行处理，一次只高清化一张图片

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
- `568ed39` 添加长按进入多选模式和批量命名下载功能
- `40c0356` 将Emoji图标替换为Lucide React专业图标库
- `8a3e7eb` 调整亮色模式下标题颜色为深灰色
- `ea42ff4` 添加设置预设功能
- `8c4d6b8` 添加采样设置分类（采样算法和调度方法选项）

## 快速命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview

# Git 操作
git status
git add .
git commit -m "commit message"
git log --oneline -5
```

## 相关文档

- **README.md**: 用户使用指南
- **DEVELOPMENT.md**: 详细开发文档
- **package.json**: 项目依赖和脚本

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

---

最后更新: 2026-01-12
维护者: Claude Code Assistant
