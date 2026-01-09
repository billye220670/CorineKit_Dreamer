# WebLLM 本地 AI 生图助手 - 实施计划

## 项目概述

为 CorineGen 应用添加基于 WebLLM 的本地 AI 助手功能，用于优化和生成 Stable Diffusion 提示词。

---

## 一、项目分析结果

### 1.1 技术栈
| 项目 | 技术 |
|------|------|
| 框架 | React 18.2.0 |
| 构建 | Vite 5.0.8 |
| 样式 | 原生 CSS + CSS 变量（无 Tailwind） |
| 状态 | React Hooks (useState/useRef) |
| 持久化 | LocalStorage |

### 1.2 当前结构
```
CorineGen/
├── src/
│   ├── App.jsx          # 主应用组件（1877行，单文件架构）
│   ├── App.css          # 全局样式
│   ├── main.jsx         # 入口
│   └── index.css        # CSS变量定义
├── vite.config.js
└── package.json
```

### 1.3 关键发现
- **输入框位置**: `App.jsx` L1372-1442，使用 `<textarea>` + `.textarea-wrapper` 容器
- **设置区域**: `App.jsx` L1455-1698 的 `<details className="advanced-settings">`
- **LocalStorage 模式**: `loadFromStorage()` 函数 + `useEffect` 自动保存
- **CSS 变量系统**: 支持动态主题 (`--theme-hue`, `--theme-primary` 等)

---

## 二、模块化架构设计

### 2.1 目录结构
```
src/
└── modules/
    └── ai-assistant/
        ├── constants.js        # 配置常量
        ├── types.js            # 类型定义（JSDoc）
        ├── useLocalModel.js    # WebLLM Hook
        └── AIPromptOverlay.jsx # UI 组件
```

### 2.2 文件职责

#### `constants.js`
```javascript
// HuggingFace 镜像配置
export const HF_MIRROR_BASE = 'https://hf-mirror.com';
export const MODEL_ID = 'Qwen2-0.5B-Instruct-q4f16_1-MLC';
export const MODEL_URL = `${HF_MIRROR_BASE}/mlc-ai/${MODEL_ID}/resolve/main/`;
export const MODEL_LIB_URL = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0.2.48/Qwen2-0.5B-Instruct-q4f16_1-MLC-webgpu.wasm';

// System Prompts
export const SYSTEM_PROMPTS = {
  optimize: `You are a Stable Diffusion prompt expert...`,
  variant: `You are a creative prompt engineer...`
};

// LocalStorage 键
export const STORAGE_KEY = 'corineGen_aiAssistantEnabled';
```

#### `types.js`
```javascript
/**
 * @typedef {'optimize' | 'variant'} ActionType
 * @typedef {'idle' | 'downloading' | 'ready' | 'generating'} ModelStatus
 * @typedef {{
 *   status: ModelStatus,
 *   progress: number,
 *   error: string | null,
 *   preload: () => Promise<void>,
 *   generate: (prompt: string, action: ActionType) => Promise<string>
 * }} UseLocalModelReturn
 */
```

#### `useLocalModel.js`
- 封装 `@mlc-ai/web-llm` 的 `MLCEngineInterface`
- 状态机管理：`idle` → `downloading` (0-100%) → `ready` → `generating`
- 注入 `AppConfig` 强制使用 hf-mirror
- 暴露 `preload()` 和 `generate()` 方法

#### `AIPromptOverlay.jsx`
- 无状态 UI 组件
- Props: `status`, `progress`, `onOptimize`, `onVariant`, `disabled`
- 包含 Split Button（主按钮 + 下拉菜单）

---

## 三、集成方案

### 3.1 设置页面集成

**位置**: `App.jsx` 高级设置区域

**新增内容**:
```jsx
{/* AI 助手开关 - 插入到高级设置顶部 */}
<div className="setting-group ai-assistant-setting">
  <label className="checkbox-label">
    <input
      type="checkbox"
      checked={aiAssistantEnabled}
      onChange={handleAIToggle}
    />
    <span>AI 助手 (Beta)</span>
  </label>
  {aiAssistantEnabled && (
    <div className="ai-status">
      {/* 状态指示器：下载进度 / 已就绪 */}
    </div>
  )}
</div>
```

**交互流程**:
1. 用户点击开启 → 显示确认弹窗 ("需下载约 350MB 模型")
2. 确认后 → 调用 `useLocalModel().preload()`
3. 显示下载进度条 → 完成后保存到 LocalStorage

### 3.2 输入框集成

**位置**: `App.jsx` 的 `.textarea-wrapper` 内部

**修改方案**:
```jsx
<div className="textarea-wrapper">
  <textarea ... />

  {/* 新增：AI 助手悬浮按钮 */}
  {aiAssistantEnabled && (
    <AIPromptOverlay
      status={modelStatus}
      progress={modelProgress}
      onOptimize={() => handleAIAction('optimize', promptItem.id)}
      onVariant={() => handleAIAction('variant', promptItem.id)}
      disabled={isGenerating}
    />
  )}

  {/* 现有按钮保持不变 */}
  <button className="delete-prompt-button">×</button>
  <button className="paste-prompt-button">📋</button>
  <button className="send-button">→</button>
</div>
```

**CSS 布局**:
```css
.ai-assistant-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
}
```

### 3.3 状态管理

**新增 State**:
```javascript
// AI 助手状态
const [aiAssistantEnabled, setAIAssistantEnabled] = useState(() =>
  loadFromStorage('corineGen_aiAssistantEnabled', false)
);

// useLocalModel Hook 提供的状态通过 context 或直接使用
```

---

## 四、Vercel 部署配置

**新建文件**: `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        }
      ]
    }
  ]
}
```

**说明**: 这些 Headers 是 SharedArrayBuffer 所需的，WebLLM/WebGPU 需要此功能。

---

## 五、实施步骤

### Phase 1: 基础设施
- [ ] 安装依赖 `@mlc-ai/web-llm`
- [ ] 创建 `src/modules/ai-assistant/` 目录
- [ ] 编写 `constants.js`
- [ ] 编写 `types.js`

### Phase 2: 核心 Hook
- [ ] 编写 `useLocalModel.js`
- [ ] 实现状态机逻辑
- [ ] 配置 hf-mirror 镜像
- [ ] 添加错误处理

### Phase 3: UI 组件
- [ ] 编写 `AIPromptOverlay.jsx`
- [ ] 添加对应 CSS 样式到 `App.css`
- [ ] 实现 Split Button 交互

### Phase 4: 集成
- [ ] 修改 `App.jsx` 添加设置开关
- [ ] 在输入框区域集成 Overlay
- [ ] 实现确认弹窗
- [ ] 处理生成结果回填

### Phase 5: 部署配置
- [ ] 创建 `vercel.json`
- [ ] 本地测试 CORS Headers

---

## 六、关键文件清单

| 操作 | 文件路径 |
|------|----------|
| 新建 | `src/modules/ai-assistant/constants.js` |
| 新建 | `src/modules/ai-assistant/types.js` |
| 新建 | `src/modules/ai-assistant/useLocalModel.js` |
| 新建 | `src/modules/ai-assistant/AIPromptOverlay.jsx` |
| 新建 | `vercel.json` |
| 修改 | `src/App.jsx` |
| 修改 | `src/App.css` |
| 修改 | `package.json` (添加依赖) |

---

## 七、验证方案

1. **单元测试**: 验证 `useLocalModel` 状态机转换
2. **集成测试**:
   - 开启 AI 助手 → 验证下载进度显示
   - 输入提示词 → 点击优化 → 验证结果回填
   - 测试变体模式
3. **部署测试**:
   - 验证 Vercel 上 CORS Headers 正确
   - 验证 hf-mirror 模型下载成功

---

## 八、注意事项

1. **网络问题**: GitHub Raw 可能在国内不可达，WASM 文件可能需要手动下载
2. **浏览器兼容**: WebGPU 需要 Chrome 113+ / Edge 113+
3. **首次加载**: 350MB 模型下载需要时间，需提供良好的进度反馈
4. **内存占用**: Qwen2-0.5B 模型约占用 500MB 显存
