# LLM 提示词助理功能 - 开发上下文总结

> **最后更新**: 2026-01-19
> **当前阶段**: Phase 1 - 后端基础搭建
> **状态**: 🚀 开发中

---

## 项目概述

为 CorineGen 添加 LLM 驱动的提示词优化功能，集成 Grok API（通过 JieKou AI）。

**核心功能**:
- 创建变体 (variation) - 生成 3-5 个提示词变体
- 扩写润色 (polish) - 智能扩充提示词细节
- 脑补后续 (continue) - 设计下一个分镜
- 生成剧本 (script) - 生成完整分镜剧本

**技术架构**:
```
前端 React → 后端 Express → Grok API (JieKou AI)
```

---

## 关键文件位置

### 需求文档
- **完整需求**: `LLM_Integration/RequirementDraft.md`
- **进度追踪**: `LLM_Integration/DevelopmentProgress.md` ⭐
- **本文档**: `LLM_Integration/CONTEXT_SUMMARY.md`

### Grok API 文档
- **API 请求示例**: `LLM_Integration/GrokAPI请求示例.md`
- **详细文档**: `LLM_Integration/Grok详细文档.md`
- **结构化输出**: `LLM_Integration/如何使用结构化输出.md`
- **系统提示词**: `LLM_Integration/系统提示词预设模板.md`

### 项目文档
- **AI 助手指南**: `CLAUDE.md`
- **开发文档**: `DEVELOPMENT.md`
- **用户文档**: `README.md`

---

## 后端实现要点

### 环境配置 (backend/.env)
```bash
GROK_API_KEY=<YOUR JIEKOU API Key>
GROK_API_BASE_URL=https://api.jiekou.ai/openai
GROK_MODEL=grok-4-1-fast-reasoning
GROK_RATE_LIMIT_PER_MINUTE=10
GROK_MAX_TOKENS=1000000
```

### 依赖包
```bash
npm install openai express-rate-limit
```

### 文件结构
```
backend/src/
├── config/
│   ├── grokConfig.js           # Grok 配置
│   └── systemPrompts.js        # 4 种模式的系统提示词
├── services/
│   └── grokClient.js           # Grok API 客户端（OpenAI SDK）
├── controllers/
│   └── promptController.js     # 提示词生成控制器
├── schemas/
│   ├── variationSchema.js      # 变体生成 JSON Schema
│   └── scriptSchema.js         # 剧本生成 JSON Schema
└── middleware/
    └── rateLimiter.js          # 限流中间件（10次/分钟）
```

### API 端点
- `POST /api/prompt-assistant/generate` - 生成提示词
- `GET /api/prompt-assistant/health` - 健康检查

### 请求/响应格式
**请求**:
```json
{
  "mode": "variation",
  "input": "a girl, #wearing red dress@0.8(prefer blue tones)"
}
```

**响应**:
```json
{
  "success": true,
  "mode": "variation",
  "data": ["prompt1", "prompt2", "prompt3"]
}
```

### 系统提示词配置

#### 1. variation (创建变体)
- 特殊字符: `#` (标记变化内容), `@` (权重 0-1), `()` (偏好说明)
- 输出: 3-5 个变体
- Temperature: 1.2
- 使用结构化输出

#### 2. polish (扩写润色)
- 特殊字符: `[]`/`【】` (标记扩写), `...` (扩写程度)
- 输出: 1 个扩写后的提示词
- Temperature: 0.8

#### 3. continue (脑补后续)
- 输入: 当前分镜提示词
- 输出: 下一个分镜提示词
- Temperature: 1.0
- 注意连贯性

#### 4. script (生成剧本)
- 输入: 故事大纲
- 输出: 4-8 个分镜提示词
- Temperature: 1.0
- 使用结构化输出

---

## 前端实现要点

### 入口按钮
- **位置**: 提示词输入框左下角
- **图标**: `Wand2` (lucide-react)
- **Tooltip**: "提示词助理"
- **禁用条件**: `!connected || isGenerating`

### Modal 面板
- **尺寸**: 800x600px
- **布局**: 左右分栏（输入 | 结果）
- **主题**: 使用 CSS 变量自适应

### 状态管理 (App.jsx)
```javascript
const [promptAssistantOpen, setPromptAssistantOpen] = useState(false);
const [assistantMode, setAssistantMode] = useState('variation');
const [assistantInput, setAssistantInput] = useState('');
const [assistantResults, setAssistantResults] = useState([]);
const [selectedResultIndex, setSelectedResultIndex] = useState(0);
const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
const [assistantError, setAssistantError] = useState(null);
```

### localStorage 持久化
- 保存: mode, input, results, selectedIndex
- 关闭 Modal 不清空状态

---

## 开发进度

### ✅ Phase 0: 准备阶段
- [✅] 阅读文档
- [✅] 完善需求文档
- [✅] 创建进度追踪
- [✅] Git 提交并推送

### 🔄 Phase 1: 后端基础搭建 (当前)
**下一步任务**:
1. 获取 JieKou AI API Key
2. 配置环境变量
3. 安装依赖包
4. 创建文件结构
5. 实现核心模块

**检查点**:
- 🔍 检查点 1.1: 系统提示词审核
- 🔍 检查点 1.2: 后端 API 验收

### ⏳ Phase 2: 前端基础开发
- Modal UI 组件
- Tab 切换
- 输入框和结果预览
- 主题适配

### ⏳ Phase 3: 功能集成与联调
- 前后端联调
- 状态持久化
- 错误处理

### ⏳ Phase 4: 优化、测试与部署
- 性能优化
- 边界测试
- 生产部署

---

## 关键决策记录

1. **API 提供商**: JieKou AI（支持 Grok 模型）
2. **非流式输出**: 简化实现，后续可扩展
3. **限流策略**: 10 次/分钟
4. **结构化输出**: variation 和 script 使用 JSON Schema
5. **状态持久化**: localStorage（关闭不清空）

---

## 重要提醒

### 开发规范
- ✅ 每完成一个任务，更新 `DevelopmentProgress.md`
- ✅ 遇到检查点 🔍，暂停等待用户确认
- ✅ 使用 Edit/Write 工具操作文件，不用 sed/awk
- ✅ Git 提交使用中文描述 + Co-Authored-By

### API 调用注意事项
- 使用 OpenAI SDK，设置 `baseURL: "https://api.jiekou.ai/openai"`
- 结构化输出使用 `response_format: { type: 'json_schema', ... }`
- 非结构化输出使用 `response_format: { type: 'text' }`
- 错误处理要友好，提供用户可理解的错误信息

### 前端注意事项
- Modal 必须主题自适应（使用 CSS 变量）
- 结果列表必须有一个选中项（不允许空选）
- 关闭 Modal 不清空状态
- 特殊字符指南在对应模式下显示

---

## 下一步行动

**立即执行**:
1. ✅ 创建 `backend/src/config/grokConfig.js`
2. ✅ 创建 `backend/src/config/systemPrompts.js`
3. ✅ 创建 `backend/src/services/grokClient.js`
4. ✅ 创建其他必需文件

**需要用户提供**:
- JieKou AI API Key（配置到 `.env`）

**检查点**:
- 完成系统提示词后需要用户审核

---

## 快速参考

### 测试命令
```bash
# 后端测试
curl -X POST http://localhost:3001/api/prompt-assistant/generate \
  -H "Content-Type: application/json" \
  -d '{"mode":"variation","input":"a girl, wearing red dress"}'

# 健康检查
curl http://localhost:3001/api/prompt-assistant/health
```

### 启动命令
```bash
# 后端
cd backend
npm run dev

# 前端
cd frontend
npm run dev
```

---

**保持专注，逐步推进，每个检查点都要确认！** 🚀
