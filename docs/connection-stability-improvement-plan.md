# CorineGen 连接稳定性全面改进计划

## 用户需求

### 需求 1: 添加版本号显示
在界面标题下方添加小字版本号，方便辨别是否是缓存问题。

### 需求 2: 修复手机端连接断开提示问题
**现象**: 手机端打开 Vercel app 在生图过程中会弹出"连接断开"提示，但生图队列依然正常执行。

**用户体验问题**: 虽然功能正常，但误导性的错误提示让用户困惑。

---

## 场景分析

### 当前架构的双连接机制

```
前端
├── HTTP 心跳检测 (每 5 秒) ──> 后端 ──> ComfyUI
│   └── 用途: 监控整体连接状态
│   └── 失败时: 显示"连接断开"横幅
│
└── WebSocket 生成连接 (按需创建) ──> 后端 wsProxy ──> ComfyUI
    └── 用途: 实时传输生成消息
    └── 失败时: 暂停生成，保存恢复状态
```

### 关键代码逻辑（App.jsx:648-651）

```javascript
if (isGenerating) {
  console.warn('心跳检测失败，但生成任务正在进行中，忽略此错误');
  return;  // 不更新 connectionStatus
}
```

**问题**: 这个逻辑只在生成时忽略心跳失败，但：
1. 只检查了 `isGenerating` 状态
2. 没有考虑占位符的具体状态（queue, loading, generating, revealing）
3. 没有考虑图片加载阶段（completed 但图片还在加载）

---

## 五大场景详细分析

### 场景 1: 生图 queue 中，后端重启
- **占位符状态**: `status: 'queue'`
- **`isGenerating`**: `true`
- **当前行为**: ✅ 正常工作（不显示横幅，弹出恢复对话框）

### 场景 2: 生图 loading 中，后端重启
- **占位符状态**: `status: 'queue'`, `isLoading: true`
- **`isGenerating`**: `true`
- **当前行为**: ✅ 正常工作

### 场景 3: 生图进度条跑进度时，后端重启
- **占位符状态**: `status: 'generating'`, `progress: 45%`
- **`isGenerating`**: `true`
- **当前行为**: ✅ 正常工作

### 场景 4: 生图结束后正在回传图片（渐进加载）时，后端重启
- **占位符状态**: `status: 'revealing'` 或 `status: 'completed'`
- **`isGenerating`**: 可能是 `true` 或 `false`
- **当前行为**:
  - ⚠️ 如果是最后一张图（`isGenerating=false`），会显示"连接断开"横幅
  - ⚠️ 图片加载失败后没有更明确的提示

### 场景 5: 手机打开/关闭飞行模式 或 刷新页面
- **打开飞行模式**: ⚠️ 如果 `isGenerating=true`，心跳失败被忽略，不显示横幅
- **关闭飞行模式**: ✅ 自动恢复连接
- **刷新页面**: ❌ 所有状态丢失

---

## 根本问题诊断

### 问题 1: `isGenerating` 状态不够精确
**当前逻辑**只是一个布尔值，无法区分：
- 正在生成新图片
- 图片已生成，正在回传/加载
- 队列中还有待处理的任务

**改进方向**: 应该检查占位符的实际状态，而不仅仅是 `isGenerating`。

### 问题 2: 心跳失败和图片加载失败混淆
**场景**: 最后一张图片正在加载时后端重启
- 用户看到红色横幅："无法连接到 ComfyUI"
- 图片显示一半或加载失败图标
- 实际上是两个独立事件

**改进方向**: 区分"后端连接失败"和"图片加载失败"。

### 问题 3: 手机端网络波动更频繁
**手机特性**:
- 网络信号不稳定（4G/5G/WiFi 切换）
- 锁屏时系统可能限制网络
- 浏览器后台时连接可能被挂起

**当前机制的不足**:
- 心跳检测间隔 5 秒，可能在短暂波动时误判
- WebSocket 已有 ping/pong 保活机制，但需要确保正确启用

### 问题 4: 页面刷新丢失状态
**当前**: 所有生成状态都在内存中（React state），刷新后丢失。

**改进方向**: 将关键状态持久化到 localStorage。

---

## 解决方案设计

### 核心设计原则

1. **精确的状态检测**: 不仅检查 `isGenerating`，还要检查占位符的实际状态
2. **分层的错误提示**: 区分后端连接失败、图片加载失败、网络波动
3. **智能的横幅显示**: 根据当前活动优先级决定是否显示
4. **状态持久化**: 关键状态保存到 localStorage，刷新后可恢复

---

## 方案 1: 智能横幅显示逻辑（核心改进）

### 1.1 新增状态检测函数

**文件**: `frontend/src/App.jsx`

```javascript
// 检查是否有任何活跃的生成或加载活动
const hasActiveGenerationActivity = () => {
  const placeholders = imagePlaceholdersRef.current;

  // 检查是否有正在生成、加载或揭示的占位符
  const hasActiveTask = placeholders.some(p =>
    ['queue', 'generating', 'revealing'].includes(p.status) ||
    (p.status === 'queue' && p.isLoading)
  );

  // 检查是否有正在加载的图片（completed 但可能还在加载）
  const hasLoadingImages = placeholders.some(p =>
    p.status === 'completed' && p.imageUrl && !p.imageLoadError
  );

  // 检查是否有恢复对话框打开
  const hasRecoveryDialog = recoveryState.isPaused;

  return hasActiveTask || hasLoadingImages || hasRecoveryDialog;
};
```

### 1.2 改进心跳检测逻辑

**修改**: `checkConnection` 函数（App.jsx:648-651）

```javascript
catch (error) {
  // 更精确的检测：不仅检查 isGenerating，还要检查实际的占位符状态
  if (hasActiveGenerationActivity()) {
    console.warn('心跳检测失败，但有活跃的生成/加载活动，暂不显示错误横幅');

    // 记录失败次数，连续失败 3 次才真正断开
    if (!heartbeatFailCountRef.current) {
      heartbeatFailCountRef.current = 0;
    }
    heartbeatFailCountRef.current++;

    if (heartbeatFailCountRef.current >= 3) {
      // 连续 3 次失败（15 秒），确实有问题
      console.error('心跳连续 3 次失败，可能真的断开了');
      // 但仍然不显示横幅，让 WebSocket 的错误处理来接管
    }
    return;
  }

  // 重置失败计数
  heartbeatFailCountRef.current = 0;

  stopHeartbeat();
  setConnectionStatus('disconnected');
  setConnectionMessage('无法连接到 ComfyUI，请确保服务已启动');
  setShowNotification(true);
}
```

**新增 ref**:
```javascript
const heartbeatFailCountRef = useRef(0);  // 心跳失败计数
```

---

## 方案 2: 图片加载失败的专用提示

### 2.1 新增图片加载状态

**修改**: 占位符状态增加字段

```javascript
{
  // ... 现有字段
  imageLoadError: false,
  imageRetryCount: 0,
  imageLoadErrorMessage: '',  // 新增：错误详情
}
```

### 2.2 图片加载失败的独立横幅

**UI 组件**: 在连接横幅下方添加图片加载横幅

```jsx
{/* 图片加载失败提示（独立于连接状态） */}
{(() => {
  const failedImages = imagePlaceholders.filter(p =>
    p.imageLoadError && p.imageRetryCount >= 3
  );

  if (failedImages.length === 0) return null;

  return (
    <div className="image-load-notification error">
      <span className="notification-message">
        ⚠️ {failedImages.length} 张图片加载失败
      </span>
      <button onClick={() => {
        failedImages.forEach(p => {
          updateImagePlaceholders(prev => prev.map(placeholder =>
            placeholder.id === p.id ? {
              ...placeholder,
              imageRetryCount: 0,
              imageLoadError: false
            } : placeholder
          ));
          setTimeout(() => retryImageLoad(p.id), Math.random() * 500);
        });
      }}>
        重新加载
      </button>
    </div>
  );
})()}
```

---

## 方案 3: WebSocket 保活优化

**验证**: WebSocket 保活机制已实现（wsClient.js 和 wsProxy.js），只需确保正常工作。

---

## 方案 4: 状态持久化（可选）

### 4.1 持久化生成状态

**目标**: 页面刷新后可以恢复未完成的生成任务

**实现**:

```javascript
// 保存生成状态到 localStorage
const saveGenerationState = () => {
  const state = {
    placeholders: imagePlaceholders.filter(p =>
      ['queue', 'generating', 'paused'].includes(p.status)
    ),
    recoveryState: recoveryState,
    timestamp: Date.now()
  };

  localStorage.setItem('generationState', JSON.stringify(state));
};

// 页面加载时恢复状态
useEffect(() => {
  const savedState = localStorage.getItem('generationState');
  if (savedState) {
    try {
      const state = JSON.parse(savedState);

      // 检查是否过期（超过 1 小时）
      if (Date.now() - state.timestamp < 3600000) {
        // 恢复占位符（状态为 paused）
        const restoredPlaceholders = state.placeholders.map(p => ({
          ...p,
          status: 'paused',
          isNew: false
        }));

        setImagePlaceholders(restoredPlaceholders);
        imagePlaceholdersRef.current = restoredPlaceholders;

        // 恢复恢复状态
        if (state.recoveryState.isPaused) {
          setRecoveryState(state.recoveryState);
        }

        // 显示提示
        alert('检测到未完成的生成任务，已恢复到暂停状态。请检查连接后点击"继续生成"。');
      }

      // 清除已过期的状态
      localStorage.removeItem('generationState');
    } catch (err) {
      console.error('恢复生成状态失败:', err);
    }
  }
}, []);
```

---

## 方案 5: 添加版本号显示

### 5.1 定义版本号

**文件**: `frontend/src/App.jsx`（顶部常量）

```javascript
const APP_VERSION = '1.1.0';
```

### 5.2 UI 显示

**位置**: 标题下方（App.jsx:2789）

```jsx
<h1 className="title">CorineGen</h1>
<div className="version-info">v{APP_VERSION}</div>
```

### 5.3 样式

**文件**: `frontend/src/App.css`

```css
.version-info {
  font-size: 0.75rem;
  color: #888;
  margin-top: -8px;
  margin-bottom: 12px;
  text-align: center;
  user-select: none;
}
```

---

## 实施计划

### 优先级划分

| 优先级 | 功能 | 原因 |
|--------|------|------|
| **P0** | 智能横幅显示逻辑 | 解决核心问题：误导性的"连接断开" |
| **P0** | 版本号显示 | 简单且立即有用 |
| **P1** | 图片加载失败专用提示 | 改善用户体验，区分错误类型 |
| **P2** | 状态持久化 | 增强健壮性，但复杂度较高 |
| **验证** | WebSocket 保活检查 | 确认已有机制正常工作 |

### P0 实施步骤

> **重要提醒**: 每次完成改动后，务必提交代码并推送到远程仓库！
> ```bash
> git add .
> git commit -m "描述改动内容"
> git push
> ```

#### 步骤 1: 添加版本号显示

**文件**: `frontend/src/App.jsx`

- [x] 1. 在文件顶部添加版本号常量（行 17-18）
- [x] 2. 在标题 JSX 中添加版本显示（行 2792-2793）

**文件**: `frontend/src/App.css`

- [x] 3. 添加 `.version-info` 样式（行 585-594）

**预计代码量**: ~10 行 ✅

#### 步骤 2: 实现智能横幅显示逻辑

**文件**: `frontend/src/App.jsx`

- [x] 1. 添加 `hasActiveGenerationActivity()` 函数（行 619-638）
- [x] 2. 添加 `heartbeatFailCountRef` ref（行 180）
- [x] 3. 修改 `checkConnection` 的 catch 块（行 674-697）
- [x] 4. 在心跳成功时重置失败计数（行 650-651）

**预计代码量**: ~40 行 ✅

---

## 测试场景

### 场景 1: 生成中途后端重启（手机端）
**步骤**:
1. 手机打开 Vercel app
2. 发起 batchSize=10 的生成
3. 生成到第 3 张时，停止后端

**预期结果**（P0 实施后）:
- ❌ 不显示"无法连接"红色横幅
- ✅ 弹出"生成已暂停"对话框
- ✅ 重启后端后，点击"继续生成"可以恢复

### 场景 2: 最后一张图片加载时后端重启（手机端）
**步骤**:
1. 手机打开 Vercel app
2. 发起 batchSize=1 的生成
3. 图片生成完成，开始加载时，停止后端

**预期结果**（P0 实施后）:
- ❌ 不显示"无法连接"红色横幅
- ✅ 图片加载失败，自动重试 3 次
- ✅ 重启后端后，图片自动恢复加载

### 场景 3: 手机开关飞行模式
**步骤**:
1. 手机打开 Vercel app
2. 发起 batchSize=5 的生成
3. 生成到第 2 张时，打开飞行模式
4. 等待 10 秒
5. 关闭飞行模式

**预期结果**（P0 实施后）:
- ❌ 不显示"无法连接"红色横幅
- ✅ 弹出"生成已暂停"对话框
- ✅ 关闭飞行模式后，自动或手动重连
- ✅ 点击"继续生成"恢复

---

## 关键文件清单

| 文件 | 优先级 | 主要改动 | 预计代码量 |
|------|--------|---------|-----------|
| `frontend/src/App.jsx` | P0 | 版本号 + 智能横幅逻辑 | ~50 行 |
| `frontend/src/App.css` | P0 | 版本号样式 | ~10 行 |
| `frontend/src/App.jsx` | P1 | 图片加载失败提示 | ~60 行 |
| `frontend/src/App.css` | P1 | 图片加载横幅样式 | ~30 行 |
| `frontend/src/App.jsx` | P2 | 状态持久化 | ~80 行 |

**总计**: P0 ~60 行，P0+P1 ~150 行，P0+P1+P2 ~230 行

---

## 实施时间估算

- **P0 功能**: 1-2 小时
  - 版本号显示: 15 分钟
  - 智能横幅逻辑: 1-1.5 小时

- **P1 功能**: 1-1.5 小时
- **P2 功能**: 2-3 小时
- **测试**: 1-2 小时

**总计**: P0 需 1-2 小时

---

## 建议实施顺序

- [x] **第一步**: 实现 P0（版本号 + 智能横幅）✅
- [ ] **第二步**: 在手机端充分测试 P0
- [ ] **第三步**: 根据测试结果决定是否实施 P1
- [ ] **第四步**: 根据用户反馈决定是否实施 P2

---

## 总结

### 核心问题
**现象**: 手机端生图时显示"连接断开"，但队列正常执行。

**根本原因**:
1. 心跳检测（HTTP）和生成连接（WebSocket）是独立的
2. 当前逻辑只检查 `isGenerating`，不够精确
3. 没有考虑图片加载阶段

### 最佳解决方案
**P0 - 智能横幅显示**:
- 新增 `hasActiveGenerationActivity()` 函数
- 检查占位符的实际状态
- 心跳失败计数机制（连续 3 次才判定断开）
- ✅ 解决核心问题，最小改动，最大收益

### 预期效果

| 场景 | 当前 | P0 实施后 |
|------|------|-----------|
| 生成中后端重启 | ❌ 显示"连接断开" | ✅ 不显示，弹出恢复对话框 |
| 最后一张图加载时断开 | ❌ 显示"连接断开" | ✅ 不显示 |
| 手机开关飞行模式 | ❌ 显示"连接断开" | ✅ 不显示，弹出恢复对话框 |

---

**文档创建时间**: 2026-01-18
**实施状态**: 待开始
