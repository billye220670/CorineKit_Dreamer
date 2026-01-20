import React, { useState, useRef, useEffect } from 'react';
import Masonry from 'react-masonry-css';
import { ClipboardPaste, ArrowRight, Image, Settings, Check, ImagePlus, ChevronDown, X, Wand2 } from 'lucide-react';
import './App.css';

// 导入工作流模板（从新位置）
import workflowTemplate from './workflows/TextToImage.json';
import upscaleTemplate from './workflows/Upscale.json';
import image2imageTemplate from './workflows/Image2Image.json';
import controlnetTemplate from './workflows/ControlNet.json';

// 导入服务层
import { apiClient } from './services/apiClient.js';
import { WsClient } from './services/wsClient.js';
import { API_CONFIG, getApiKey, setApiKey, isAuthRequired } from './config/api.js';
import { generatePrompt } from './services/promptAssistantApi.js';

// 应用版本号
const APP_VERSION = '1.1.4';  // 修复后端未完全启动时继续生成卡queue

// 图生图/ControlNet 降噪强度默认值
const DEFAULT_IMG2IMG_DENOISE = 1;

// 提示词助理模式配置
const PRESET_MODES = [
  {
    id: 'variation',
    label: '创建变体',
    tooltip: '生成 3-5 个提示词变体，使用 # @ () 控制变化'
  },
  {
    id: 'polish',
    label: '扩写润色',
    tooltip: '智能扩充提示词细节，使用 [] ... 控制扩写程度'
  },
  {
    id: 'continue',
    label: '脑补后续',
    tooltip: '根据当前分镜设计下一个场景，保持连贯性'
  },
  {
    id: 'script',
    label: '生成剧本',
    tooltip: '根据故事大纲生成 4-8 个完整分镜'
  }
];

// 提示词助理输入框占位符
const PROMPT_ASSISTANT_PLACEHOLDERS = {
  variation: '输入提示词，使用 # 标记需要变化的部分，@ 后跟 0-1 的权重，() 内写特殊偏好\n例如: a girl, #wearing red dress@0.8(prefer blue tones)',
  polish: '输入提示词，使用 [] 或 【】 标记需要扩写的部分，... 的数量表示扩写程度\n例如: a girl, [wearing dress......], standing in the garden',
  continue: '输入当前分镜的提示词，AI 将为你设计下一个分镜场景\n可选：使用 [] 或 【】 包裹内容来指定希望的剧情发展走向',
  script: '输入故事大纲或情节描述，AI 将生成完整的分镜提示词\n可选：指定需要的分镜数量'
};

// 兼容层：基于 API_CONFIG 生成 API 地址
// 用于渐进式迁移，避免一次性修改所有代码
const COMFYUI_API = API_CONFIG.baseUrl + '/api';
const COMFYUI_WS = API_CONFIG.wsUrl;

// 生成 WebSocket URL（包含认证参数）
const getWebSocketUrl = (clientId) => {
  let url = `${COMFYUI_WS}/ws?clientId=${clientId}`;
  if (isAuthRequired()) {
    const apiKey = getApiKey();
    if (apiKey) {
      url += `&apiKey=${encodeURIComponent(apiKey)}`;
    }
  }
  return url;
};

// 获取认证头
const getAuthHeaders = () => {
  const headers = {};
  if (isAuthRequired()) {
    const apiKey = getApiKey();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
  }
  return headers;
};

// 生成带认证的图片 URL
const getImageUrl = (filename, subfolder = '', type = 'output') => {
  let url = `${COMFYUI_API}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}&t=${Date.now()}`;
  if (isAuthRequired()) {
    const apiKey = getApiKey();
    if (apiKey) {
      url += `&apiKey=${encodeURIComponent(apiKey)}`;
    }
  }
  return url;
};

// 生成唯一的客户端ID（使用 apiClient 中的方法）
const generateClientId = () => apiClient.generateClientId();

const App = () => {
  // 从localStorage加载保存的设置
  const loadFromStorage = (key, defaultValue) => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? JSON.parse(saved) : defaultValue;
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error);
      return defaultValue;
    }
  };

  // 提示词列表状态
  const [prompts, setPrompts] = useState(() => {
    const savedPrompts = loadFromStorage('corineGen_prompts', [
      { id: 1, text: '' }
    ]);
    // 恢复时添加运行时状态
    return savedPrompts.map(p => ({ ...p, isGenerating: false, focusIndex: null }));
  });
  const [focusedPromptId, setFocusedPromptId] = useState(null);
  const [generationQueue, setGenerationQueue] = useState([]); // 生成队列（用于UI显示）
  const [upscaleQueue, setUpscaleQueue] = useState([]); // 高清化队列（用于UI显示）
  const [isUpscaling, setIsUpscaling] = useState(false); // 高清化进行中

  const [batchSize, setBatchSize] = useState(() => loadFromStorage('corineGen_batchSize', 1));
  const [batchMethod, setBatchMethod] = useState(() => loadFromStorage('corineGen_batchMethod', 'loop'));
  const [steps, setSteps] = useState(() => loadFromStorage('corineGen_steps', 9));
  const [resolutionScale, setResolutionScale] = useState(() => loadFromStorage('corineGen_resolutionScale', 1));
  const [aspectRatio, setAspectRatio] = useState(() => loadFromStorage('corineGen_aspectRatio', 'square'));
  const [seedMode, setSeedMode] = useState(() => loadFromStorage('corineGen_seedMode', 'random'));
  const [fixedSeed, setFixedSeed] = useState(() => loadFromStorage('corineGen_fixedSeed', ''));
  const [firstFixedSeed, setFirstFixedSeed] = useState(() => loadFromStorage('corineGen_firstFixedSeed', ''));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageGroups, setGeneratedImageGroups] = useState([]); // 按提示词分组的图像
  const [imagePlaceholders, setImagePlaceholders] = useState([]); // 骨架占位
  const [error, setError] = useState('');

  // ComfyUI连接状态
  const [connectionStatus, setConnectionStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected' | 'reconnecting' | 'failed'
  const [connectionMessage, setConnectionMessage] = useState('');
  const [showNotification, setShowNotification] = useState(false);
  const [notificationEmphasis, setNotificationEmphasis] = useState(false);

  const [themeHue, setThemeHue] = useState(() => loadFromStorage('corineGen_themeHue', 270));
  const [themeBgSaturation, setThemeBgSaturation] = useState(() => loadFromStorage('corineGen_themeBgSaturation', 60));
  const [themeBgLightness, setThemeBgLightness] = useState(() => loadFromStorage('corineGen_themeBgLightness', 8));
  const [viewMode, setViewMode] = useState(() => loadFromStorage('corineGen_viewMode', 'medium')); // small, medium, large
  const [prioritizeGeneration, setPrioritizeGeneration] = useState(() => loadFromStorage('corineGen_prioritizeGeneration', false)); // 生图队列优先
  const [autoUpscaleAfterGen, setAutoUpscaleAfterGen] = useState(() => loadFromStorage('corineGen_autoUpscaleAfterGen', false)); // 生图后自动高清化

  // LoRA 设置
  const [loraEnabled, setLoraEnabled] = useState(() => loadFromStorage('corineGen_loraEnabled', false));
  const [loraName, setLoraName] = useState(() => loadFromStorage('corineGen_loraName', 'YJY\\Lora_YJY_000002750.safetensors'));
  const [loraStrengthModel, setLoraStrengthModel] = useState(() => loadFromStorage('corineGen_loraStrengthModel', 1));
  const [loraStrengthClip, setLoraStrengthClip] = useState(() => loadFromStorage('corineGen_loraStrengthClip', 1));

  // 采样设置
  const [samplerName, setSamplerName] = useState(() => loadFromStorage('corineGen_samplerName', 'euler'));
  const [scheduler, setScheduler] = useState(() => loadFromStorage('corineGen_scheduler', 'simple'));

  // LoRA 管理
  const [availableLoras, setAvailableLoras] = useState([]); // 从ComfyUI获取的所有LoRA
  // enabledLoras结构: [{ name: 'xxx.safetensors', displayName: '自定义名', triggerWord: '触发词' }, ...]
  const [enabledLoras, setEnabledLoras] = useState(() => {
    const saved = loadFromStorage('corineGen_enabledLoras', []);
    // 兼容旧格式：如果是字符串数组，转换为对象数组
    if (saved.length > 0 && typeof saved[0] === 'string') {
      return saved.map(name => ({ name, displayName: '', triggerWord: '' }));
    }
    return saved;
  });
  const [showSettingsPanel, setShowSettingsPanel] = useState(false); // 设置面板显示状态
  const [showThemeSection, setShowThemeSection] = useState(false); // 主题区域展开状态
  const [showLoraManager, setShowLoraManager] = useState(false); // LoRA管理列表展开状态
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false); // 多选模式
  const [selectedImages, setSelectedImages] = useState(new Set()); // 选中的图片ID集合

  // 设置预设相关状态
  const [settingsPresets, setSettingsPresets] = useState(() =>
    loadFromStorage('corineGen_settingsPresets', [])
  );
  const [activePresetId, setActivePresetId] = useState(() =>
    loadFromStorage('corineGen_activePresetId', null)
  );
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [showNewPresetPanel, setShowNewPresetPanel] = useState(false);

  // 提示词助理状态
  const [promptAssistantOpen, setPromptAssistantOpen] = useState(false); // Modal 显示状态
  const [assistantMode, setAssistantMode] = useState(() => loadFromStorage('corineGen_assistantMode', 'variation'));
  const [assistantInput, setAssistantInput] = useState(() => loadFromStorage('corineGen_assistantInput', ''));
  // 每个模式独立存储结果
  const [assistantResults, setAssistantResults] = useState(() => loadFromStorage('corineGen_assistantResults', {
    variation: [],
    polish: [],
    continue: [],
    script: []
  }));
  const [selectedResultIndex, setSelectedResultIndex] = useState(() => loadFromStorage('corineGen_selectedResultIndex', 0));
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false); // 生成中
  const [assistantError, setAssistantError] = useState(null); // 错误信息
  const [assistantSourcePromptId, setAssistantSourcePromptId] = useState(null); // 记录从哪个提示词打开的助理
  const [newPresetName, setNewPresetName] = useState('');
  const [hoveredPresetId, setHoveredPresetId] = useState(null);

  // 批量命名下载相关状态
  const [showBatchDownloadModal, setShowBatchDownloadModal] = useState(false);
  const [batchDownloadPrefix, setBatchDownloadPrefix] = useState('');

  // 批量删除确认对话框状态
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);

  // 恢复状态
  const [recoveryState, setRecoveryState] = useState({
    isPaused: false,
    pausedBatchId: null,
    promptId: null,
    pausedIndex: 0,
    totalCount: 0,
    savedParams: null,
    reason: ''
  });

  // 参考图片下拉菜单状态
  const [showRefImageMenu, setShowRefImageMenu] = useState({});

  const firstSeedRef = useRef(null);
  const heartbeatRef = useRef(null); // 心跳检测定时器
  const heartbeatFailCountRef = useRef(0); // 心跳失败计数
  const recoveryStateRef = useRef(recoveryState); // 同步跟踪恢复状态
  const longPressTimerRef = useRef(null); // 长按计时器
  const longPressTriggeredRef = useRef(false); // 长按是否已触发
  const imageInputRefs = useRef({}); // 图片上传input的refs

  // 计算下一个提示词ID
  const savedPromptsForId = loadFromStorage('corineGen_prompts', [{ id: 1 }]);
  const nextPromptId = useRef(Math.max(...savedPromptsForId.map(p => p.id)) + 1);

  const nextBatchId = useRef(1); // 批次计数器，确保每个批次有唯一ID
  const isUpscalingRef = useRef(false); // 同步跟踪高清化状态，避免竞态条件
  const upscaleQueueRef = useRef([]); // 同步跟踪高清化队列，避免状态更新延迟
  const generationQueueRef = useRef([]); // 同步跟踪生成队列，避免状态更新延迟
  const imagePlaceholdersRef = useRef([]); // 同步跟踪占位符，避免闭包陷阱
  const imagesContainerRef = useRef(null); // 图片容器ref，用于自动滚动

  // 平滑滚动到图片容器底部
  const scrollToBottom = () => {
    if (imagesContainerRef.current) {
      setTimeout(() => {
        const container = imagesContainerRef.current;
        const targetScroll = container.scrollHeight - container.clientHeight;
        const startScroll = container.scrollTop;
        const distance = targetScroll - startScroll;

        if (distance <= 0) return; // 已经在底部或不需要滚动

        const duration = 600; // 滚动动画时长 ms
        const startTime = performance.now();

        // 缓动函数 - easeOutCubic
        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

        const animateScroll = (currentTime) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easedProgress = easeOutCubic(progress);

          container.scrollTop = startScroll + distance * easedProgress;

          if (progress < 1) {
            requestAnimationFrame(animateScroll);
          }
        };

        requestAnimationFrame(animateScroll);

        // 闪烁动画结束后移除 isNew 标记（动画时长 1.6s）
        setTimeout(() => {
          updateImagePlaceholders(prev => prev.map(p =>
            p.isNew ? { ...p, isNew: false } : p
          ));
        }, 1600);
      }, 100); // 延迟确保DOM已更新
    }
  };

  // 保存设置到localStorage
  useEffect(() => {
    localStorage.setItem('corineGen_themeHue', JSON.stringify(themeHue));
  }, [themeHue]);

  useEffect(() => {
    localStorage.setItem('corineGen_themeBgSaturation', JSON.stringify(themeBgSaturation));
  }, [themeBgSaturation]);

  useEffect(() => {
    localStorage.setItem('corineGen_themeBgLightness', JSON.stringify(themeBgLightness));
  }, [themeBgLightness]);

  useEffect(() => {
    // 保存prompts时去掉isGenerating状态（这是运行时状态，不应该保存）
    const promptsToSave = prompts.map(p => ({ id: p.id, text: p.text }));
    localStorage.setItem('corineGen_prompts', JSON.stringify(promptsToSave));
  }, [prompts]);

  useEffect(() => {
    localStorage.setItem('corineGen_batchSize', JSON.stringify(batchSize));
  }, [batchSize]);

  useEffect(() => {
    localStorage.setItem('corineGen_batchMethod', JSON.stringify(batchMethod));
  }, [batchMethod]);

  useEffect(() => {
    localStorage.setItem('corineGen_steps', JSON.stringify(steps));
  }, [steps]);

  useEffect(() => {
    localStorage.setItem('corineGen_resolutionScale', JSON.stringify(resolutionScale));
  }, [resolutionScale]);

  useEffect(() => {
    localStorage.setItem('corineGen_aspectRatio', JSON.stringify(aspectRatio));
  }, [aspectRatio]);

  useEffect(() => {
    localStorage.setItem('corineGen_seedMode', JSON.stringify(seedMode));
  }, [seedMode]);

  useEffect(() => {
    localStorage.setItem('corineGen_fixedSeed', JSON.stringify(fixedSeed));
  }, [fixedSeed]);

  useEffect(() => {
    localStorage.setItem('corineGen_firstFixedSeed', JSON.stringify(firstFixedSeed));
  }, [firstFixedSeed]);

  useEffect(() => {
    localStorage.setItem('corineGen_viewMode', JSON.stringify(viewMode));
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('corineGen_prioritizeGeneration', JSON.stringify(prioritizeGeneration));
  }, [prioritizeGeneration]);

  useEffect(() => {
    localStorage.setItem('corineGen_autoUpscaleAfterGen', JSON.stringify(autoUpscaleAfterGen));
  }, [autoUpscaleAfterGen]);

  // LoRA 设置保存
  useEffect(() => {
    localStorage.setItem('corineGen_loraEnabled', JSON.stringify(loraEnabled));
  }, [loraEnabled]);

  useEffect(() => {
    localStorage.setItem('corineGen_loraName', JSON.stringify(loraName));
  }, [loraName]);

  useEffect(() => {
    localStorage.setItem('corineGen_loraStrengthModel', JSON.stringify(loraStrengthModel));
  }, [loraStrengthModel]);

  useEffect(() => {
    localStorage.setItem('corineGen_loraStrengthClip', JSON.stringify(loraStrengthClip));
  }, [loraStrengthClip]);

  useEffect(() => {
    localStorage.setItem('corineGen_enabledLoras', JSON.stringify(enabledLoras));
  }, [enabledLoras]);

  // 采样设置保存
  useEffect(() => {
    localStorage.setItem('corineGen_samplerName', JSON.stringify(samplerName));
  }, [samplerName]);

  useEffect(() => {
    localStorage.setItem('corineGen_scheduler', JSON.stringify(scheduler));
  }, [scheduler]);

  // 预设相关 - localStorage持久化
  useEffect(() => {
    localStorage.setItem('corineGen_settingsPresets', JSON.stringify(settingsPresets));
  }, [settingsPresets]);

  useEffect(() => {
    localStorage.setItem('corineGen_activePresetId', JSON.stringify(activePresetId));
  }, [activePresetId]);

  // 同步 recoveryState 到 ref（用于异步操作中获取最新值）
  useEffect(() => {
    recoveryStateRef.current = recoveryState;
  }, [recoveryState]);

  // ESC 键关闭提示词助理 Modal
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape' && promptAssistantOpen) {
        setPromptAssistantOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscKey);
    return () => window.removeEventListener('keydown', handleEscKey);
  }, [promptAssistantOpen]);

  // 提示词助理状态持久化
  useEffect(() => {
    localStorage.setItem('corineGen_assistantMode', JSON.stringify(assistantMode));
  }, [assistantMode]);

  useEffect(() => {
    localStorage.setItem('corineGen_assistantInput', JSON.stringify(assistantInput));
  }, [assistantInput]);

  useEffect(() => {
    localStorage.setItem('corineGen_assistantResults', JSON.stringify(assistantResults));
  }, [assistantResults]);

  useEffect(() => {
    localStorage.setItem('corineGen_selectedResultIndex', JSON.stringify(selectedResultIndex));
  }, [selectedResultIndex]);

  // 获取当前所有预设参数的快照
  const getCurrentSettingsSnapshot = () => ({
    batchSize,
    steps,
    samplerName,
    scheduler,
    loraEnabled,
    loraName,
    loraStrengthModel,
    loraStrengthClip,
    resolutionScale,
    aspectRatio,
    seedMode,
    fixedSeed,
    firstFixedSeed,
  });

  // 保存当前设置为预设
  const saveCurrentAsPreset = (name) => {
    const existingIndex = settingsPresets.findIndex(p => p.name === name);
    const now = Date.now();

    if (existingIndex >= 0) {
      // 名称重复 → 覆盖已有预设
      const updatedPresets = [...settingsPresets];
      updatedPresets[existingIndex] = {
        ...updatedPresets[existingIndex],
        updatedAt: now,
        settings: getCurrentSettingsSnapshot(),
      };
      setSettingsPresets(updatedPresets);
      setActivePresetId(updatedPresets[existingIndex].id);
    } else {
      // 创建新预设
      const newPreset = {
        id: `preset_${now}`,
        name,
        createdAt: now,
        updatedAt: now,
        settings: getCurrentSettingsSnapshot(),
      };
      setSettingsPresets(prev => [...prev, newPreset]);
      setActivePresetId(newPreset.id);
    }

    setShowNewPresetPanel(false);
    setNewPresetName('');
    setShowPresetDropdown(false);
  };

  // 加载预设
  const loadPreset = (presetId) => {
    const preset = settingsPresets.find(p => p.id === presetId);
    if (!preset) return;

    const { settings } = preset;

    // 检查LoRA可用性
    if (settings.loraEnabled && settings.loraName) {
      const loraAvailable = enabledLoras.some(lora => {
        const loraValue = typeof lora === 'string' ? lora : lora.name;
        return loraValue === settings.loraName;
      });

      if (!loraAvailable) {
        alert(`预设中的 LoRA "${settings.loraName}" 不可用，已禁用 LoRA 设置`);
        // 仍然加载其他设置，但禁用LoRA
        setBatchSize(settings.batchSize);
        setSteps(settings.steps);
        setSamplerName(settings.samplerName);
        setScheduler(settings.scheduler);
        setLoraEnabled(false);  // 禁用LoRA
        setResolutionScale(settings.resolutionScale);
        setAspectRatio(settings.aspectRatio);
        setSeedMode(settings.seedMode);
        setFixedSeed(settings.fixedSeed);
        setFirstFixedSeed(settings.firstFixedSeed);
        setActivePresetId(null);  // 因为LoRA不匹配，变为自定义状态
        setShowPresetDropdown(false);
        return;
      }
    }

    // 正常加载所有设置
    setBatchSize(settings.batchSize);
    setSteps(settings.steps);
    setSamplerName(settings.samplerName);
    setScheduler(settings.scheduler);
    setLoraEnabled(settings.loraEnabled);
    setLoraName(settings.loraName);
    setLoraStrengthModel(settings.loraStrengthModel);
    setLoraStrengthClip(settings.loraStrengthClip);
    setResolutionScale(settings.resolutionScale);
    setAspectRatio(settings.aspectRatio);
    setSeedMode(settings.seedMode);
    setFixedSeed(settings.fixedSeed);
    setFirstFixedSeed(settings.firstFixedSeed);

    setActivePresetId(presetId);
    setShowPresetDropdown(false);
  };

  // 删除预设
  const deletePreset = (presetId) => {
    setSettingsPresets(prev => prev.filter(p => p.id !== presetId));

    // 如果删除的是当前使用的预设，变为"自定义"状态
    if (activePresetId === presetId) {
      setActivePresetId(null);
    }
  };

  // 参数变更检测 - 使预设变为"自定义"状态
  useEffect(() => {
    if (activePresetId) {
      const preset = settingsPresets.find(p => p.id === activePresetId);
      if (!preset) {
        setActivePresetId(null);
        return;
      }

      const current = getCurrentSettingsSnapshot();
      const saved = preset.settings;

      // 深度比较所有参数
      const isDifferent =
        current.batchSize !== saved.batchSize ||
        current.steps !== saved.steps ||
        current.samplerName !== saved.samplerName ||
        current.scheduler !== saved.scheduler ||
        current.loraEnabled !== saved.loraEnabled ||
        current.loraName !== saved.loraName ||
        current.loraStrengthModel !== saved.loraStrengthModel ||
        current.loraStrengthClip !== saved.loraStrengthClip ||
        current.resolutionScale !== saved.resolutionScale ||
        current.aspectRatio !== saved.aspectRatio ||
        current.seedMode !== saved.seedMode ||
        current.fixedSeed !== saved.fixedSeed ||
        current.firstFixedSeed !== saved.firstFixedSeed;

      if (isDifferent) {
        setActivePresetId(null);
      }
    }
  }, [
    batchSize, steps, samplerName, scheduler,
    loraEnabled, loraName, loraStrengthModel, loraStrengthClip,
    resolutionScale, aspectRatio, seedMode, fixedSeed, firstFixedSeed
  ]);

  // 点击外部关闭预设下拉菜单
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showPresetDropdown && !e.target.closest('.preset-selector-wrapper')) {
        setShowPresetDropdown(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showPresetDropdown]);

  // 点击外部关闭参考图片模式菜单
  useEffect(() => {
    const handleClickOutside = (e) => {
      // 检查是否有任何菜单打开
      const hasOpenMenu = Object.values(showRefImageMenu).some(v => v);
      if (hasOpenMenu && !e.target.closest('.ref-image-container')) {
        setShowRefImageMenu({});
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showRefImageMenu]);

  // 拖拽时自动滚动页面（当拖拽到边缘时）
  useEffect(() => {
    let scrollInterval = null;
    const SCROLL_ZONE = 80; // 距离边缘多少像素触发滚动
    const SCROLL_SPEED = 15; // 滚动速度

    const handleDragOver = (e) => {
      const { clientY } = e;
      const windowHeight = window.innerHeight;

      // 清除之前的滚动
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }

      // 接近顶部边缘，向上滚动
      if (clientY < SCROLL_ZONE) {
        scrollInterval = setInterval(() => {
          window.scrollBy(0, -SCROLL_SPEED);
        }, 16);
      }
      // 接近底部边缘，向下滚动
      else if (clientY > windowHeight - SCROLL_ZONE) {
        scrollInterval = setInterval(() => {
          window.scrollBy(0, SCROLL_SPEED);
        }, 16);
      }
    };

    const handleDragEnd = () => {
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('drop', handleDragEnd);

    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('drop', handleDragEnd);
      if (scrollInterval) {
        clearInterval(scrollInterval);
      }
    };
  }, []);

  // 阻止全局拖拽默认行为（防止浏览器打开图片）
  useEffect(() => {
    const preventDefaultDrop = (e) => {
      // 只在非 textarea-wrapper 区域阻止默认行为
      if (!e.target.closest('.textarea-wrapper')) {
        e.preventDefault();
      }
    };

    document.addEventListener('dragover', preventDefaultDrop);
    document.addEventListener('drop', preventDefaultDrop);

    return () => {
      document.removeEventListener('dragover', preventDefaultDrop);
      document.removeEventListener('drop', preventDefaultDrop);
    };
  }, []);

  // 获取可用的LoRA列表
  const fetchAvailableLoras = async () => {
    try {
      const loraList = await apiClient.getLoraList();
      if (loraList && loraList.length > 0) {
        setAvailableLoras(loraList);
      }
    } catch (error) {
      console.error('获取LoRA列表失败:', error);
    }
  };

  // 启动心跳检测
  const startHeartbeat = () => {
    if (heartbeatRef.current) return;
    heartbeatRef.current = setInterval(() => {
      checkConnection(true);
    }, 5000);
  };

  // 停止心跳检测
  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  // 触发连接提示强调动画
  const triggerConnectionEmphasis = () => {
    setShowNotification(true);
    setNotificationEmphasis(true);
    setTimeout(() => setNotificationEmphasis(false), 600);
  };

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

  // 检测ComfyUI连接状态
  const checkConnection = async (silent = false) => {
    if (!silent) setConnectionStatus('checking');
    try {
      const result = await apiClient.checkConnection(3000);

      if (result.connected) {
        const wasDisconnected = connectionStatus === 'disconnected' || connectionStatus === 'failed';
        setConnectionStatus('connected');

        // 连接成功，重置心跳失败计数
        heartbeatFailCountRef.current = 0;

        if (!silent) {
          setConnectionMessage(wasDisconnected ? '已重新连接到 ComfyUI' : 'ComfyUI 连接成功，一切就绪');
          setShowNotification(true);
          setTimeout(() => setShowNotification(false), 3000);
          fetchAvailableLoras(); // 连接成功后刷新LoRA列表
        }

        // 如果是从断开恢复的，重新加载失败的图片
        if (wasDisconnected) {
          reloadFailedImages();
        }

        startHeartbeat();
      } else if (result.authRequired) {
        // 需要认证
        setConnectionStatus('auth_required');
        setConnectionMessage('请输入 API Key 进行认证');
        setShowNotification(true);
      } else {
        throw new Error(result.error || '连接失败');
      }
    } catch (error) {
      // 更精确的检测：不仅检查 isGenerating，还要检查实际的占位符状态
      if (hasActiveGenerationActivity()) {
        console.warn('心跳检测失败，但有活跃的生成/加载活动，暂不显示错误横幅');

        // 记录失败次数，连续失败 3 次才真正警告
        heartbeatFailCountRef.current++;

        if (heartbeatFailCountRef.current >= 3) {
          // 连续 3 次失败（15 秒），确实有问题
          console.error('心跳连续 3 次失败，可能真的断开了，但由于有活跃任务，仍不显示横幅');
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

      // 如果不是静默检查，3秒后自动隐藏横幅
      if (!silent) {
        setTimeout(() => setShowNotification(false), 3000);
      }
    }
  };

  // 页面加载时检测连接
  useEffect(() => {
    checkConnection();
  }, []);

  // 切换视图模式
  const toggleViewMode = () => {
    const modes = ['small', 'medium', 'large'];
    const currentIndex = modes.indexOf(viewMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setViewMode(modes[nextIndex]);
  };

  // 获取视图图标
  const getViewIcon = () => {
    switch (viewMode) {
      case 'small':
        return '⊞'; // 小格子
      case 'medium':
        return '⊟'; // 中格子
      case 'large':
        return '▢'; // 大格子
      default:
        return '⊟';
    }
  };

  // 辅助函数：更新占位符并同步ref
  const updateImagePlaceholders = (updater) => {
    setImagePlaceholders(prev => {
      const updated = typeof updater === 'function' ? updater(prev) : updater;
      imagePlaceholdersRef.current = updated;
      return updated;
    });
  };

  // 添加提示词
  const addPrompt = () => {
    if (prompts.length >= 10) return; // 最多10个
    setPrompts([...prompts, {
      id: nextPromptId.current++,
      text: '',
      isGenerating: false
    }]);
  };

  // 删除提示词
  const deletePrompt = (id) => {
    if (prompts.length <= 1) return; // 至少保留一个
    const promptToDelete = prompts.find(p => p.id === id);
    if (promptToDelete?.isGenerating) return; // 生成中不能删除
    setPrompts(prev => prev.filter(p => p.id !== id));
  };

  // 更新提示词文本
  const updatePromptText = (id, text) => {
    setPrompts(prev => prev.map(p => p.id === id ? { ...p, text } : p));
  };

  // 处理参考图片上传
  const handleRefImageUpload = (promptId, file) => {
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setPrompts(prev => prev.map(p =>
        p.id === promptId
          ? {
              ...p,
              refImage: {
                file: file,
                preview: e.target.result,
                mode: 'direct',  // 默认模式：直接使用图片
                denoise: DEFAULT_IMG2IMG_DENOISE  // 默认降噪强度
              }
            }
          : p
      ));
    };
    reader.readAsDataURL(file);
  };

  // 移除参考图片
  const removeRefImage = (promptId) => {
    setPrompts(prev => prev.map(p =>
      p.id === promptId ? { ...p, refImage: null } : p
    ));
    // 同时关闭下拉菜单
    setShowRefImageMenu(prev => ({ ...prev, [promptId]: false }));
  };

  // 设置参考图片模式
  const setRefImageMode = (promptId, mode) => {
    setPrompts(prev => prev.map(p =>
      p.id === promptId && p.refImage
        ? { ...p, refImage: { ...p.refImage, mode } }
        : p
    ));
    // 选择后关闭下拉菜单
    setShowRefImageMenu(prev => ({ ...prev, [promptId]: false }));
  };

  // 设置参考图片降噪强度
  const setRefImageDenoise = (promptId, denoise) => {
    // 限制在 0-1 范围内
    const clampedValue = Math.max(0, Math.min(1, denoise));
    setPrompts(prev => prev.map(p =>
      p.id === promptId && p.refImage
        ? { ...p, refImage: { ...p.refImage, denoise: clampedValue } }
        : p
    ));
  };

  // 切换参考图片下拉菜单
  const toggleRefImageMenu = (promptId) => {
    setShowRefImageMenu(prev => ({ ...prev, [promptId]: !prev[promptId] }));
  };

  // 获取图像尺寸
  const getImageDimensions = () => {
    let baseWidth, baseHeight;
    switch (aspectRatio) {
      case 'portrait':
        baseWidth = 720;
        baseHeight = 1280;
        break;
      case 'landscape':
        baseWidth = 1280;
        baseHeight = 720;
        break;
      case '4:3':
        baseWidth = 1152;
        baseHeight = 864;
        break;
      case '3:4':
        baseWidth = 864;
        baseHeight = 1152;
        break;
      case '2.35:1':
        baseWidth = 1536;
        baseHeight = 656;
        break;
      case 'square':
      default:
        baseWidth = 1024;
        baseHeight = 1024;
    }

    // 应用超分倍率
    return {
      width: Math.round(baseWidth * resolutionScale),
      height: Math.round(baseHeight * resolutionScale)
    };
  };

  // 获取图像比例（用于网格布局）
  const getAspectRatioValue = () => {
    switch (aspectRatio) {
      case 'portrait':
        return 720 / 1280; // 0.5625
      case 'landscape':
        return 1280 / 720; // 1.778
      case '4:3':
        return 1152 / 864; // 1.333
      case '3:4':
        return 864 / 1152; // 0.75
      case '2.35:1':
        return 1536 / 656; // 2.341
      case 'square':
      default:
        return 1; // 1:1
    }
  };

  // 生成或获取种子
  const getSeed = () => {
    if (seedMode === 'fixed') {
      return parseInt(fixedSeed) || Math.floor(Math.random() * 1000000000000000);
    } else if (seedMode === 'first-fixed') {
      if (firstSeedRef.current === null) {
        // 使用用户输入的种子，如果没有输入则随机生成
        firstSeedRef.current = parseInt(firstFixedSeed) || Math.floor(Math.random() * 1000000000000000);
      }
      return firstSeedRef.current;
    } else {
      return Math.floor(Math.random() * 1000000000000000);
    }
  };

  // 构建ComfyUI工作流
  const buildWorkflow = (promptText, actualBatchSize = null, savedParams = null, uniqueId = null) => {
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));

    // 如果提供了保存的参数，使用保存的参数；否则使用当前全局状态
    const currentAspectRatio = savedParams?.aspectRatio || aspectRatio;
    const currentResolutionScale = savedParams?.resolutionScale || resolutionScale;
    const currentSteps = savedParams?.steps || steps;

    // 计算尺寸（使用保存的参数）
    let baseWidth, baseHeight;
    switch (currentAspectRatio) {
      case 'portrait':
        baseWidth = 720;
        baseHeight = 1280;
        break;
      case 'landscape':
        baseWidth = 1280;
        baseHeight = 720;
        break;
      case '4:3':
        baseWidth = 1152;
        baseHeight = 864;
        break;
      case '3:4':
        baseWidth = 864;
        baseHeight = 1152;
        break;
      case '2.35:1':
        baseWidth = 1536;
        baseHeight = 656;
        break;
      case 'square':
      default:
        baseWidth = 1024;
        baseHeight = 1024;
    }

    const dimensions = {
      width: Math.round(baseWidth * currentResolutionScale),
      height: Math.round(baseHeight * currentResolutionScale)
    };

    const seed = getSeed();

    let processedPrompt = promptText || '';

    // 如果启用了LoRA，检查是否有触发词需要添加
    if (loraEnabled && loraName) {
      const currentLoraConfig = enabledLoras.find(l => l.name === loraName);
      if (currentLoraConfig?.triggerWord) {
        processedPrompt = `${currentLoraConfig.triggerWord}, ${processedPrompt}`;
      }
    }

    // 在固定种子模式下，添加唯一标识符来禁用ComfyUI的执行缓存
    // 使用零宽空格（不影响生成结果，但使每次请求的prompt不同）
    if (uniqueId) {
      const cacheBreaker = `\u200B${uniqueId}\u200B${Date.now()}`;
      processedPrompt = processedPrompt + cacheBreaker;
    }

    // 更新prompt
    workflow['5'].inputs.text = processedPrompt;

    // 更新种子
    workflow['4'].inputs.seed = seed;

    // 更新steps（使用保存的参数）
    workflow['4'].inputs.steps = currentSteps;

    // 更新采样算法和调度方法
    workflow['4'].inputs.sampler_name = samplerName;
    workflow['4'].inputs.scheduler = scheduler;

    // 更新图像尺寸
    workflow['7'].inputs.width = dimensions.width;
    workflow['7'].inputs.height = dimensions.height;

    // 在循环模式下，每次只生成1张；批次模式下使用用户选择的数量
    const batchCount = actualBatchSize !== null ? actualBatchSize : (batchMethod === 'loop' ? 1 : batchSize);
    workflow['7'].inputs.batch_size = batchCount;

    // RepeatLatentBatch的amount设置为1，避免批次数量被平方
    workflow['44'].inputs.amount = 1;

    // 设置唯一的文件名前缀，避免固定种子模式下文件名重复
    if (uniqueId) {
      workflow['24'].inputs.filename_prefix = `Corine_${uniqueId}_`;
    }

    // LoRA 设置
    if (loraEnabled && loraName) {
      workflow['36'].inputs.lora_name = loraName;
      workflow['36'].inputs.strength_model = loraStrengthModel;
      workflow['36'].inputs.strength_clip = loraStrengthClip;
    } else {
      // 禁用 LoRA：将权重设为 0
      workflow['36'].inputs.strength_model = 0;
      workflow['36'].inputs.strength_clip = 0;
    }

    return { workflow, seed };
  };

  // 生成单个提示词的图像
  const generateForPrompt = async (promptId, promptText, batchId = null) => {
    if (!promptText.trim()) {
      setError('请输入提示词');
      return;
    }

    console.log('[generateForPrompt] 开始生成 - promptId:', promptId, 'batchId:', batchId, 'seedMode:', seedMode);

    // 标记提示词为生成中（仅用于UI反馈，不再用于禁用按钮）
    setPrompts(prev => prev.map(p => p.id === promptId ? { ...p, isGenerating: true } : p));
    setError('');

    let finalBatchId = batchId;
    let placeholders;

    // 如果没有传入batchId，说明是单独点击箭头，需要创建新占位符
    if (finalBatchId === null) {
      finalBatchId = nextBatchId.current++;
      const totalImages = batchSize;
      const currentAspectRatio = getAspectRatioValue();

      // 保存当前生成参数
      const savedParams = {
        aspectRatio: aspectRatio,
        resolutionScale: resolutionScale,
        steps: steps
      };

      placeholders = Array.from({ length: totalImages }, (_, index) => ({
        id: `${promptId}-${finalBatchId}-${index}`,
        status: 'queue',
        isLoading: false, // 是否正在加载模型
        isNew: true, // 新创建的占位符，用于闪烁动画
        progress: 0,
        imageUrl: null,
        filename: null,
        promptId: promptId,
        batchId: finalBatchId,
        upscaleStatus: 'none',
        upscaleProgress: 0,
        hqImageUrl: null,
        hqFilename: null,
        seed: null,
        aspectRatio: currentAspectRatio, // 保存当前图像比例（用于显示）
        savedParams: savedParams, // 保存生成参数（用于生成）
        displayQuality: 'hq', // 当前显示的清晰度：'sq' 标清 或 'hq' 高清
        showQualityMenu: false, // 是否显示清晰度切换菜单
        imageLoadError: false, // 图片加载是否失败
        imageRetryCount: 0 // 图片加载重试次数
      }));

      console.log('[generateForPrompt] 创建占位符:', placeholders.map(p => ({ id: p.id, status: p.status, imageUrl: p.imageUrl })));

      // 先更新ref（同步），再更新state（异步）
      const updated = [...imagePlaceholdersRef.current, ...placeholders];
      imagePlaceholdersRef.current = updated;
      setImagePlaceholders(updated);

      // 新任务加入时自动滚动到底部
      scrollToBottom();
    }

    // 从占位符中获取保存的生成参数
    const batchPlaceholders = imagePlaceholdersRef.current.filter(p => p.batchId === finalBatchId);
    const savedParams = batchPlaceholders[0]?.savedParams || null;

    // 获取当前提示词对象（用于检查是否有参考图片）
    const currentPrompt = prompts.find(p => p.id === promptId);

    try {
      // 检查是否有参考图片，如果有则使用图生图/ControlNet流程
      if (currentPrompt?.refImage) {
        await generateWithRefImageLoop(promptId, promptText, currentPrompt.refImage, finalBatchId, savedParams);
      } else if (batchMethod === 'batch') {
        await generateBatch(promptId, promptText, placeholders, finalBatchId, savedParams);
      } else {
        await generateLoop(promptId, promptText, placeholders, finalBatchId, savedParams);
      }
    } catch (err) {
      console.error('[generateForPrompt] 生成错误:', err);
      setError('生成失败: ' + err.message);
    } finally {
      // 标记提示词为非生成中
      setPrompts(prev => prev.map(p => p.id === promptId ? { ...p, isGenerating: false } : p));
      processQueue();
    }
  };

  // 暂停生成
  const pauseGeneration = (reason) => {
    // 将所有 generating 和 queue 状态的占位符标记为 paused
    const generatingPlaceholders = imagePlaceholdersRef.current.filter(
      p => ['queue', 'generating'].includes(p.status)
    );

    if (generatingPlaceholders.length === 0) return;

    const firstPlaceholder = generatingPlaceholders[0];

    updateImagePlaceholders(prev => prev.map(p =>
      p.batchId === firstPlaceholder.batchId &&
      ['queue', 'generating'].includes(p.status)
        ? {
            ...p,
            status: 'paused',
            isLoading: false,  // 重置加载状态
            progress: 0  // 重置进度
          }
        : p
    ));

    setRecoveryState({
      isPaused: true,
      pausedBatchId: firstPlaceholder.batchId,
      promptId: firstPlaceholder.promptId || prompts[0]?.id,
      pausedIndex: 0,  // 简化：重连后从头开始生成剩余部分
      totalCount: generatingPlaceholders.length,
      savedParams: firstPlaceholder.savedParams || null,
      reason: reason
    });

    setIsGenerating(false);
  };

  // 继续生成
  const handleContinueGeneration = async () => {
    if (connectionStatus !== 'connected') {
      alert('请先连接到 ComfyUI');
      return;
    }

    // 将 paused 恢复为 queue
    updateImagePlaceholders(prev => prev.map(p =>
      p.batchId === recoveryState.pausedBatchId && p.status === 'paused'
        ? { ...p, status: 'queue' }
        : p
    ));

    const { promptId, pausedBatchId, savedParams } = recoveryState;

    // 不立即清除恢复状态，等 WebSocket 连接成功后再清除
    // 如果连接失败，恢复状态会保持，用户可以重试

    // 找到对应的提示词
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt) {
      console.error('未找到对应的提示词');
      // 恢复到暂停状态
      updateImagePlaceholders(prev => prev.map(p =>
        p.batchId === pausedBatchId && p.status === 'queue'
          ? { ...p, status: 'paused', isLoading: false, progress: 0 }
          : p
      ));
      return;
    }

    // 直接调用 generateForPrompt 继续生成，传入 batchId
    setIsGenerating(true);
    generateForPrompt(promptId, prompt.text, pausedBatchId);
  };

  // 取消剩余任务
  const handleCancelRemaining = () => {
    if (!confirm(`确定取消剩余 ${recoveryState.totalCount} 张图片的生成？`)) {
      return;
    }

    // 删除所有 paused 状态的占位符
    updateImagePlaceholders(prev =>
      prev.filter(p => !(p.batchId === recoveryState.pausedBatchId && p.status === 'paused'))
    );

    setRecoveryState({
      isPaused: false,
      pausedBatchId: null,
      promptId: null,
      pausedIndex: 0,
      totalCount: 0,
      savedParams: null,
      reason: ''
    });
    setIsGenerating(false);
  };

  // 处理队列
  const processQueue = () => {
    if (generationQueueRef.current.length === 0) {
      setIsGenerating(false);

      // 如果启用了生图队列优先，且高清化队列有任务等待，启动高清化
      if (prioritizeGeneration && upscaleQueueRef.current.length > 0 && !isUpscalingRef.current) {
        isUpscalingRef.current = true;
        setIsUpscaling(true);
        const nextPlaceholderId = upscaleQueueRef.current[0];
        upscaleQueueRef.current = upscaleQueueRef.current.slice(1);
        setUpscaleQueue(upscaleQueueRef.current);
        upscaleImage(nextPlaceholderId);
      }

      return;
    }

    const nextTask = generationQueueRef.current[0];
    generationQueueRef.current = generationQueueRef.current.slice(1);
    setGenerationQueue(generationQueueRef.current);
    setIsGenerating(true);
    generateForPrompt(nextTask.promptId, nextTask.promptText, nextTask.batchId);
  };

  // 添加到队列并开始生成
  const queueGeneration = (promptId) => {
    // 检查连接状态
    if (connectionStatus !== 'connected') {
      triggerConnectionEmphasis();
      return;
    }

    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt || !prompt.text.trim()) {
      setError('请输入提示词');
      return;
    }

    // 立即创建骨架占位符
    const batchId = nextBatchId.current++;
    const totalImages = batchSize;
    const currentAspectRatio = getAspectRatioValue();

    // 保存当前生成参数
    const savedParams = {
      aspectRatio: aspectRatio,
      resolutionScale: resolutionScale,
      steps: steps
    };

    const placeholders = Array.from({ length: totalImages }, (_, index) => ({
      id: `${promptId}-${batchId}-${index}`,
      status: 'queue',
      isLoading: false, // 是否正在加载模型
      isNew: true, // 新创建的占位符，用于闪烁动画
      progress: 0,
      imageUrl: null,
      filename: null,
      promptId: promptId,
      batchId: batchId,
      upscaleStatus: 'none',
      upscaleProgress: 0,
      hqImageUrl: null,
      hqFilename: null,
      seed: null,
      aspectRatio: currentAspectRatio, // 保存当前图像比例（用于显示）
      savedParams: savedParams, // 保存生成参数（用于生成）
      displayQuality: 'hq', // 当前显示的清晰度：'sq' 标清 或 'hq' 高清
      showQualityMenu: false, // 是否显示清晰度切换菜单
      imageLoadError: false, // 图片加载是否失败
      imageRetryCount: 0 // 图片加载重试次数
    }));

    // 先更新ref（同步），再更新state（异步）
    const updated = [...imagePlaceholdersRef.current, ...placeholders];
    imagePlaceholdersRef.current = updated;
    setImagePlaceholders(updated);

    // 新任务加入时自动滚动到底部
    scrollToBottom();

    if (!isGenerating) {
      // 队列为空，直接开始
      setIsGenerating(true);
      generateForPrompt(promptId, prompt.text, batchId);
    } else {
      // 添加到队列，同时保存生成参数
      generationQueueRef.current = [...generationQueueRef.current, { promptId, promptText: prompt.text, batchId, savedParams }];
      setGenerationQueue(generationQueueRef.current);
    }
  };

  // 生成所有提示词 - 简单触发每个提示词的→按钮
  const generateAll = () => {
    // 检查连接状态
    if (connectionStatus !== 'connected') {
      triggerConnectionEmphasis();
      return;
    }

    const validPrompts = prompts.filter(p => p.text.trim());

    if (validPrompts.length === 0) {
      setError('请至少输入一个提示词');
      return;
    }

    // 依次触发每个提示词的生成
    validPrompts.forEach(prompt => {
      queueGeneration(prompt.id);
    });
  };

  // 一次性批次模式
  const generateBatch = async (promptId, promptText, placeholders, batchId, savedParams = null) => {
    const clientId = generateClientId();
    let ws = null;
    let timeoutId = null;

    try {
      const { workflow, seed } = buildWorkflow(promptText, null, savedParams, batchId);

      // 保存种子到所有batchId的占位符
      updateImagePlaceholders(prev => prev.map(p =>
        p.batchId === batchId ? { ...p, seed } : p
      ));

      // 创建WebSocket连接
      ws = new WebSocket(getWebSocketUrl(clientId));

      ws.onopen = () => {};

      ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
        setError('WebSocket连接失败');
        setIsGenerating(false);
      };

      // 监听WebSocket异常关闭
      ws.onclose = (event) => {
        // 1000 是正常关闭，其他都是异常
        if (event.code !== 1000 && event.code !== 1005) {
          console.error('WebSocket异常关闭:', event.code, event.reason);
          // 触发暂停机制
          pauseGeneration('WebSocket连接断开');
        }
      };

      // 监听WebSocket消息
      ws.onmessage = async (event) => {
        try {
          // 过滤掉Blob类型的消息（预览图片）
          if (typeof event.data !== 'string') {
            return;
          }

          const message = JSON.parse(event.data);
          const { type, data } = message;

          // execution_start 消息 - 任务开始执行（模型可能正在加载）
          if (type === 'execution_start') {
            // 如果收到执行消息，说明连接是正常的，自动恢复连接状态
            if (connectionStatus !== 'connected') {
              setConnectionStatus('connected');
              setConnectionMessage('已重新连接到 ComfyUI');
              setShowNotification(true);
              setTimeout(() => setShowNotification(false), 3000);
              startHeartbeat();
              reloadFailedImages();
            }

            updateImagePlaceholders(prev => prev.map(p =>
              p.batchId === batchId && p.status === 'queue' ? {
                ...p,
                isLoading: true
              } : p
            ));
          }

          // 进度更新消息 - 批次模式下所有图片共享进度
          if (type === 'progress') {
            // 如果收到进度消息，说明连接是正常的，自动恢复连接状态
            if (connectionStatus !== 'connected') {
              setConnectionStatus('connected');
              setConnectionMessage('已重新连接到 ComfyUI');
              setShowNotification(true);
              setTimeout(() => setShowNotification(false), 3000);
              startHeartbeat();
              reloadFailedImages();
            }

            const { value, max } = data;
            if (max > 0) {
              const progressPercent = Math.floor((value / max) * 100);

              // 只更新当前batchId的占位符
              updateImagePlaceholders(prev => prev.map(p =>
                p.batchId === batchId ? {
                  ...p,
                  status: 'generating',
                  progress: progressPercent
                } : p
              ));
            }
          }

          // 执行状态消息
          if (type === 'executing') {
            const { node, prompt_id } = data;

            // 当node为null时，表示执行完成
            if (node === null && prompt_id) {
              // 获取生成的图像
              const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`, {
                headers: getAuthHeaders()
              });
              const history = await historyResponse.json();

              if (history[prompt_id] && history[prompt_id].outputs) {
                const outputs = history[prompt_id].outputs;
                const images = [];

                for (const nodeId in outputs) {
                  if (outputs[nodeId].images) {
                    outputs[nodeId].images.forEach((img) => {
                      images.push({
                        filename: img.filename,
                        subfolder: img.subfolder,
                        type: img.type,
                        url: getImageUrl(img.filename, img.subfolder, img.type),
                      });
                    });
                  }
                }

                // 更新占位符为revealing状态，触发动画（只更新当前batchId）
                setImagePlaceholders(prev => {
                  const updated = prev.map((p, index) => {
                    if (p.batchId !== batchId) return p;
                    const localIndex = prev.filter(pl => pl.batchId === batchId).indexOf(p);
                    return {
                      ...p,
                      status: 'revealing',
                      progress: 100,
                      imageUrl: images[localIndex]?.url || null,
                      filename: images[localIndex]?.filename || null
                    };
                  });
                  imagePlaceholdersRef.current = updated;
                  return updated;
                });

                // 延迟后设置为completed，显示图片
                setTimeout(() => {
                  updateImagePlaceholders(prev => {
                    const completedPlaceholders = prev.map(p =>
                      p.batchId === batchId ? { ...p, status: 'completed' } : p
                    );

                    // 如果启用了自动高清化，将完成的图片加入高清化队列
                    if (autoUpscaleAfterGen) {
                      completedPlaceholders.forEach(p => {
                        if (p.batchId === batchId && p.status === 'completed') {
                          // 异步调用 queueUpscale，避免在状态更新中同步调用
                          setTimeout(() => queueUpscale(p.id), 0);
                        }
                      });
                    }

                    return completedPlaceholders;
                  });
                }, 800);
              }

              setIsGenerating(false);
              if (ws) ws.close();
              if (timeoutId) clearTimeout(timeoutId);
            }
          }

          // 执行错误消息
          if (type === 'execution_error') {
            console.error('执行错误:', data);
            setError('生成失败: ' + (data.exception_message || '未知错误'));
            setIsGenerating(false);
            if (ws) ws.close();
            if (timeoutId) clearTimeout(timeoutId);
          }
        } catch (err) {
          console.error('消息处理错误:', err);
        }
      };

      // 等待WebSocket连接建立
      await new Promise((resolve) => {
        if (ws.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          ws.addEventListener('open', resolve, { once: true });
        }
      });

      // 提交prompt到ComfyUI
      const promptResponse = await fetch(`${COMFYUI_API}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: clientId
        }),
      });

      if (!promptResponse.ok) {
        throw new Error('提交任务失败');
      }

      const result = await promptResponse.json();

      // 设置超时
      timeoutId = setTimeout(() => {
        if (ws) ws.close();
        setError('生成超时，请检查ComfyUI是否正常运行');
        setIsGenerating(false);
      }, 300000);

    } catch (err) {
      console.error('批次生成错误:', err);

      // 重置所有 batchId 对应的占位符为 failed
      updateImagePlaceholders(prev => prev.map(p =>
        p.batchId === batchId && p.status === 'generating'
          ? { ...p, status: 'failed', error: err.message }
          : p
      ));

      // 如果是连接错误，触发暂停
      if (err.message.includes('WebSocket') || err.message.includes('连接') || err.message.includes('超时')) {
        pauseGeneration(err.message);
        return;  // 不再 throw，避免进一步错误处理
      }

      throw err;
    }
  };

  // 工作流循环执行模式
  const generateLoop = async (promptId, promptText, placeholders, batchId, savedParams = null) => {
    console.log('[generateLoop] 开始循环 - batchId:', batchId, 'batchSize:', batchSize);

    for (let i = 0; i < batchSize; i++) {
      console.log(`[generateLoop] 循环 ${i + 1}/${batchSize}`);

      // 每次循环前检查该batchId下是否还有queue状态的占位符

      // 使用ref读取最新的占位符状态
      const queuedPlaceholders = imagePlaceholdersRef.current.filter(p => p.batchId === batchId && p.status === 'queue');

      let targetPlaceholder = null;
      if (queuedPlaceholders.length === 0) {
        targetPlaceholder = null;
      } else {
        targetPlaceholder = queuedPlaceholders[0];
      }

      console.log('[generateLoop] 找到的队列占位符数量:', queuedPlaceholders.length, 'targetPlaceholder:', targetPlaceholder?.id);

      // 如果没有queue状态的占位符了，结束循环
      if (!targetPlaceholder) {
        console.log('[generateLoop] 没有更多队列占位符，结束循环');
        break;
      }

      const clientId = generateClientId();
      let ws = null;
      let timeoutId = null;

      try {
        const { workflow, seed } = buildWorkflow(promptText, 1, savedParams, targetPlaceholder.id);

        console.log('[generateLoop] 构建工作流 - seed:', seed, 'targetPlaceholder:', targetPlaceholder.id, 'prompt长度:', workflow['5'].inputs.text.length);

        // 保存种子到当前占位符
        updateImagePlaceholders(prev => prev.map(p =>
          p.id === targetPlaceholder.id ? { ...p, seed } : p
        ));

        // 创建WebSocket连接
        ws = new WebSocket(getWebSocketUrl(clientId));

        await new Promise((resolve, reject) => {
          ws.onopen = () => {
            console.log('WebSocket 连接成功');

            // WebSocket 连接成功，清除恢复状态（如果是恢复操作）
            if (batchId && recoveryStateRef.current.pausedBatchId === batchId) {
              console.log('恢复操作成功，清除恢复状态');
              setRecoveryState({
                isPaused: false,
                pausedBatchId: null,
                promptId: null,
                pausedIndex: 0,
                totalCount: 0,
                savedParams: null,
                reason: ''
              });
            }

            resolve();
          };

          ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            reject(new Error('WebSocket连接失败'));
          };

          // 监听WebSocket异常关闭
          ws.onclose = (event) => {
            // 1000 是正常关闭，其他都是异常
            if (event.code !== 1000 && event.code !== 1005) {
              console.error('WebSocket异常关闭:', event.code, event.reason);
              reject(new Error('WebSocket连接断开'));
            }
          };

          // 监听WebSocket消息
          ws.onmessage = async (event) => {
            try {
              // 过滤掉Blob类型的消息（预览图片）
              if (typeof event.data !== 'string') {
                return;
              }

              const message = JSON.parse(event.data);
              const { type, data } = message;

              // execution_start 消息 - 任务开始执行（模型可能正在加载）
              if (type === 'execution_start') {
                // 如果收到执行消息，说明连接是正常的，自动恢复连接状态
                if (connectionStatus !== 'connected') {
                  setConnectionStatus('connected');
                  setConnectionMessage('已重新连接到 ComfyUI');
                  setShowNotification(true);
                  setTimeout(() => setShowNotification(false), 3000);
                  startHeartbeat();
                }

                updateImagePlaceholders(prev => prev.map(p =>
                  p.id === targetPlaceholder.id && p.status === 'queue' ? {
                    ...p,
                    isLoading: true
                  } : p
                ));
              }

              // 进度更新消息 - 更新当前图片的进度
              if (type === 'progress') {
                // 如果收到进度消息，说明连接是正常的，自动恢复连接状态
                if (connectionStatus !== 'connected') {
                  setConnectionStatus('connected');
                  setConnectionMessage('已重新连接到 ComfyUI');
                  setShowNotification(true);
                  setTimeout(() => setShowNotification(false), 3000);
                  startHeartbeat();
                  reloadFailedImages();
                }

                const { value, max } = data;
                if (max > 0) {
                  const progressPercent = Math.floor((value / max) * 100);

                  // 更新当前占位符的进度
                  updateImagePlaceholders(prev =>
                    prev.map(p =>
                      p.id === targetPlaceholder.id ? {
                        ...p,
                        status: 'generating',
                        progress: progressPercent
                      } : p
                    )
                  );
                }
              }

              // 执行状态消息
              if (type === 'executing') {
                const { node, prompt_id } = data;

                // 当node为null时，表示执行完成
                if (node === null && prompt_id) {
                  console.log('[generateLoop] 执行完成 - prompt_id:', prompt_id, 'targetPlaceholder:', targetPlaceholder.id);

                  // 获取生成的图像
                  const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`, {
                headers: getAuthHeaders()
              });
                  const history = await historyResponse.json();

                  if (history[prompt_id] && history[prompt_id].outputs) {
                    const outputs = history[prompt_id].outputs;

                    for (const nodeId in outputs) {
                      if (outputs[nodeId].images && outputs[nodeId].images[0]) {
                        const img = outputs[nodeId].images[0];
                        const imageUrl = getImageUrl(img.filename, img.subfolder, img.type);

                        console.log('[generateLoop] 获取到图片 - filename:', img.filename, 'imageUrl:', imageUrl, '准备更新占位符:', targetPlaceholder.id);

                        // 更新当前占位符为revealing状态，触发动画
                        updateImagePlaceholders(prev =>
                          prev.map(p =>
                            p.id === targetPlaceholder.id ? {
                              ...p,
                              status: 'revealing',
                              progress: 100,
                              imageUrl: imageUrl,
                              filename: img.filename
                            } : p
                          )
                        );

                        // 延迟后设置为completed，显示图片
                        setTimeout(() => {
                          updateImagePlaceholders(prev => {
                            const completedPlaceholders = prev.map(p =>
                              p.id === targetPlaceholder.id ? { ...p, status: 'completed' } : p
                            );

                            console.log('[generateLoop] 占位符标记为completed:', targetPlaceholder.id);

                            // 如果启用了自动高清化，将完成的图片加入高清化队列
                            if (autoUpscaleAfterGen) {
                              const completedPlaceholder = completedPlaceholders.find(p => p.id === targetPlaceholder.id);
                              if (completedPlaceholder && completedPlaceholder.status === 'completed') {
                                setTimeout(() => queueUpscale(completedPlaceholder.id), 0);
                              }
                            }

                            return completedPlaceholders;
                          });
                        }, 800);
                      }
                    }
                  }

                  if (ws) ws.close();
                  if (timeoutId) clearTimeout(timeoutId);
                  resolve();
                }
              }

              // 执行错误消息
              if (type === 'execution_error') {
                console.error('执行错误:', data);
                if (ws) ws.close();
                if (timeoutId) clearTimeout(timeoutId);
                reject(new Error(data.exception_message || '未知错误'));
              }
            } catch (err) {
              console.error('消息处理错误:', err);
            }
          };
        });

        // 等待WebSocket连接建立
        if (ws.readyState !== WebSocket.OPEN) {
          await new Promise((resolve) => {
            ws.addEventListener('open', resolve, { once: true });
          });
        }

        // 提交prompt到ComfyUI
        const promptResponse = await fetch(`${COMFYUI_API}/prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: workflow,
            client_id: clientId
          }),
        });

        if (!promptResponse.ok) {
          throw new Error('提交任务失败');
        }

        const result = await promptResponse.json();

        // 设置超时
        timeoutId = setTimeout(() => {
          if (ws) ws.close();
          throw new Error('生成超时');
        }, 300000);

        // 等待当前循环完成
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (ws.readyState === WebSocket.CLOSED) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });

      } catch (err) {
        console.error(`[generateLoop] 循环 ${i + 1} 错误:`, err);

        // 重置当前占位符为 failed
        updateImagePlaceholders(prev => prev.map(p =>
          p.id === targetPlaceholder.id && p.status === 'generating'
            ? { ...p, status: 'failed', error: err.message }
            : p
        ));

        if (ws) ws.close();
        if (timeoutId) clearTimeout(timeoutId);

        // 如果是连接错误，触发暂停
        if (err.message.includes('WebSocket') || err.message.includes('连接') || err.message.includes('超时')) {
          pauseGeneration(err.message);
          break;  // 中断循环
        }

        throw err;
      }
    }
  };

  // 图生图/ControlNet 循环执行模式
  const generateWithRefImageLoop = async (promptId, promptText, refImage, batchId, savedParams = null) => {
    console.log('[generateWithRefImageLoop] 开始 - batchId:', batchId, 'mode:', refImage.mode);

    // 首先上传参考图片到 ComfyUI（只上传一次）
    const formData = new FormData();
    const uploadFilename = `ref_${promptId}_${Date.now()}.png`;
    formData.append('image', refImage.file, uploadFilename);
    formData.append('overwrite', 'true');

    const uploadResponse = await fetch(`${COMFYUI_API}/upload/image`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });

    if (!uploadResponse.ok) {
      throw new Error('参考图片上传失败');
    }

    const uploadResult = await uploadResponse.json();
    const uploadedFilename = uploadResult.name;
    console.log('[generateWithRefImageLoop] 参考图片上传成功:', uploadedFilename);

    // 循环生成每张图片
    for (let i = 0; i < batchSize; i++) {
      console.log(`[generateWithRefImageLoop] 循环 ${i + 1}/${batchSize}`);

      // 使用ref读取最新的占位符状态
      const queuedPlaceholders = imagePlaceholdersRef.current.filter(p => p.batchId === batchId && p.status === 'queue');
      let targetPlaceholder = queuedPlaceholders.length > 0 ? queuedPlaceholders[0] : null;

      // 如果没有queue状态的占位符了，结束循环
      if (!targetPlaceholder) {
        console.log('[generateWithRefImageLoop] 没有更多队列占位符，结束循环');
        break;
      }

      const clientId = generateClientId();
      const uniqueId = `${batchId}_${i}`;
      let ws = null;
      let timeoutId = null;

      try {
        // 根据模式构建工作流
        let workflowData;
        const denoise = refImage.denoise ?? DEFAULT_IMG2IMG_DENOISE;
        if (refImage.mode === 'direct') {
          workflowData = buildImage2ImageWorkflow(uploadedFilename, promptText, savedParams, uniqueId, denoise);
        } else {
          workflowData = buildControlnetWorkflow(uploadedFilename, promptText, refImage.mode, savedParams, uniqueId, denoise);
        }

        const { workflow, seed } = workflowData;
        console.log('[generateWithRefImageLoop] 构建工作流 - mode:', refImage.mode, 'seed:', seed);

        // 保存种子到当前占位符
        updateImagePlaceholders(prev => prev.map(p =>
          p.id === targetPlaceholder.id ? { ...p, seed } : p
        ));

        // 创建WebSocket连接
        ws = new WebSocket(getWebSocketUrl(clientId));

        await new Promise((resolve, reject) => {
          ws.onopen = () => {
            console.log('WebSocket 连接成功');

            // WebSocket 连接成功，清除恢复状态（如果是恢复操作）
            if (batchId && recoveryStateRef.current.pausedBatchId === batchId) {
              console.log('恢复操作成功，清除恢复状态');
              setRecoveryState({
                isPaused: false,
                pausedBatchId: null,
                promptId: null,
                pausedIndex: 0,
                totalCount: 0,
                savedParams: null,
                reason: ''
              });
            }

            resolve();
          };

          ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            reject(new Error('WebSocket连接失败'));
          };

          // 监听WebSocket异常关闭
          ws.onclose = (event) => {
            // 1000 是正常关闭，其他都是异常
            if (event.code !== 1000 && event.code !== 1005) {
              console.error('WebSocket异常关闭:', event.code, event.reason);
              reject(new Error('WebSocket连接断开'));
            }
          };

          // 监听WebSocket消息
          ws.onmessage = async (event) => {
            try {
              // 过滤掉Blob类型的消息（预览图片）
              if (typeof event.data !== 'string') {
                return;
              }

              const message = JSON.parse(event.data);
              const { type, data } = message;

              // execution_start 消息 - 任务开始执行
              if (type === 'execution_start') {
                // 如果收到执行消息，说明连接是正常的，自动恢复连接状态
                if (connectionStatus !== 'connected') {
                  setConnectionStatus('connected');
                  setConnectionMessage('已重新连接到 ComfyUI');
                  setShowNotification(true);
                  setTimeout(() => setShowNotification(false), 3000);
                  startHeartbeat();
                }

                updateImagePlaceholders(prev => prev.map(p =>
                  p.id === targetPlaceholder.id && p.status === 'queue' ? {
                    ...p,
                    isLoading: true
                  } : p
                ));
              }

              // 进度更新消息 - 只显示KSampler节点(节点4)的进度
              if (type === 'progress') {
                const { value, max, node } = data;
                // 只处理采样器节点的进度，忽略预处理器进度
                if (max > 0 && node === '4') {
                  // 如果收到进度消息，说明连接是正常的，自动恢复连接状态
                  if (connectionStatus !== 'connected') {
                    setConnectionStatus('connected');
                    setConnectionMessage('已重新连接到 ComfyUI');
                    setShowNotification(true);
                    setTimeout(() => setShowNotification(false), 3000);
                    startHeartbeat();
                    reloadFailedImages();
                  }

                  const progressPercent = Math.floor((value / max) * 100);
                  updateImagePlaceholders(prev =>
                    prev.map(p =>
                      p.id === targetPlaceholder.id ? {
                        ...p,
                        status: 'generating',
                        progress: progressPercent
                      } : p
                    )
                  );
                }
              }

              // 执行状态消息
              if (type === 'executing') {
                const { node, prompt_id } = data;

                // 当node为null时，表示执行完成
                if (node === null && prompt_id) {
                  console.log('[generateWithRefImageLoop] 执行完成 - prompt_id:', prompt_id);

                  // 获取生成的图像
                  const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`, {
                headers: getAuthHeaders()
              });
                  const history = await historyResponse.json();

                  if (history[prompt_id] && history[prompt_id].outputs) {
                    const outputs = history[prompt_id].outputs;

                    // 收集所有图像，优先选择 SaveImage 节点的输出 (type='output')
                    let savedImages = [];
                    let previewImages = [];

                    for (const nodeId in outputs) {
                      if (outputs[nodeId].images) {
                        outputs[nodeId].images.forEach(img => {
                          if (img.type === 'output') {
                            savedImages.push(img);
                          } else {
                            previewImages.push(img);
                          }
                        });
                      }
                    }

                    // 优先使用 SaveImage 的输出，否则使用 PreviewImage 的输出
                    const finalImage = savedImages[0] || previewImages[0];

                    if (finalImage) {
                      const imageUrl = getImageUrl(finalImage.filename, finalImage.subfolder, finalImage.type);

                      console.log('[generateWithRefImageLoop] 获取到图片:', finalImage.filename, 'type:', finalImage.type);

                      // 更新当前占位符为revealing状态
                      updateImagePlaceholders(prev =>
                        prev.map(p =>
                          p.id === targetPlaceholder.id ? {
                            ...p,
                            status: 'revealing',
                            progress: 100,
                            imageUrl: imageUrl,
                            filename: finalImage.filename
                          } : p
                        )
                      );

                      // 延迟后设置为completed
                      setTimeout(() => {
                        updateImagePlaceholders(prev => {
                          const completedPlaceholders = prev.map(p =>
                            p.id === targetPlaceholder.id ? { ...p, status: 'completed' } : p
                          );

                          // 如果启用了自动高清化
                          if (autoUpscaleAfterGen) {
                            const completedPlaceholder = completedPlaceholders.find(p => p.id === targetPlaceholder.id);
                            if (completedPlaceholder && completedPlaceholder.status === 'completed') {
                              setTimeout(() => queueUpscale(completedPlaceholder.id), 0);
                            }
                          }

                          return completedPlaceholders;
                        });
                      }, 800);
                    }
                  }

                  if (ws) ws.close();
                  if (timeoutId) clearTimeout(timeoutId);
                  resolve();
                }
              }

              // 执行错误消息
              if (type === 'execution_error') {
                console.error('执行错误:', data);
                if (ws) ws.close();
                if (timeoutId) clearTimeout(timeoutId);
                reject(new Error(data.exception_message || '未知错误'));
              }
            } catch (err) {
              console.error('消息处理错误:', err);
            }
          };
        });

        // 等待WebSocket连接建立
        if (ws.readyState !== WebSocket.OPEN) {
          await new Promise((resolve) => {
            ws.addEventListener('open', resolve, { once: true });
          });
        }

        // 提交prompt到ComfyUI
        const promptResponse = await fetch(`${COMFYUI_API}/prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: workflow,
            client_id: clientId
          }),
        });

        if (!promptResponse.ok) {
          const errorData = await promptResponse.json().catch(() => ({}));
          console.error('[generateWithRefImageLoop] ComfyUI 错误响应:', errorData);
          console.error('[generateWithRefImageLoop] 发送的工作流:', JSON.stringify(workflow, null, 2));
          throw new Error(`提交任务失败: ${errorData.error || errorData.node_errors ? JSON.stringify(errorData.node_errors || errorData.error) : promptResponse.status}`);
        }

        // 设置超时
        timeoutId = setTimeout(() => {
          if (ws) ws.close();
        }, 180000); // 3分钟超时

        // 等待当前循环完成
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (ws.readyState === WebSocket.CLOSED) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });

      } catch (err) {
        console.error(`[generateWithRefImageLoop] 循环 ${i + 1} 错误:`, err);

        // 重置当前占位符为 failed
        updateImagePlaceholders(prev => prev.map(p =>
          p.id === targetPlaceholder.id && p.status === 'generating'
            ? { ...p, status: 'failed', error: err.message }
            : p
        ));

        if (ws) ws.close();
        if (timeoutId) clearTimeout(timeoutId);

        // 如果是连接错误，触发暂停
        if (err.message.includes('WebSocket') || err.message.includes('连接') || err.message.includes('超时')) {
          pauseGeneration(err.message);
          break;  // 中断循环
        }

        throw err;
      }
    }
  };

  // 构建高清化工作流
  const buildUpscaleWorkflow = (filename) => {
    const workflow = JSON.parse(JSON.stringify(upscaleTemplate));
    // 设置要加载的图片文件名
    workflow['1145'].inputs.image = filename;
    return workflow;
  };

  // 构建图生图工作流
  const buildImage2ImageWorkflow = (imageFilename, promptText, savedParams = null, uniqueId = null, denoise = DEFAULT_IMG2IMG_DENOISE) => {
    const workflow = JSON.parse(JSON.stringify(image2imageTemplate));

    // 设置参考图片
    workflow['52'].inputs.image = imageFilename;

    // 设置提示词（不参与LoRA，不添加触发词）
    let processedPrompt = promptText || '';
    // 在固定种子模式下，添加唯一标识符来禁用ComfyUI的执行缓存
    if (uniqueId) {
      const cacheBreaker = `\u200B${uniqueId}\u200B${Date.now()}`;
      processedPrompt = processedPrompt + cacheBreaker;
    }
    workflow['44'].inputs.text = processedPrompt;

    // 设置采样器参数
    const currentSteps = savedParams?.steps || steps;
    const seed = getSeed();
    workflow['4'].inputs.seed = seed;
    workflow['4'].inputs.steps = currentSteps;
    workflow['4'].inputs.sampler_name = samplerName;
    workflow['4'].inputs.scheduler = scheduler;
    workflow['4'].inputs.denoise = denoise;

    // 设置唯一的文件名前缀
    if (uniqueId) {
      workflow['24'].inputs.filename_prefix = `Img2Img_${uniqueId}_`;
    }

    return { workflow, seed };
  };

  // 构建 ControlNet 工作流
  const buildControlnetWorkflow = (imageFilename, promptText, controlMode, savedParams = null, uniqueId = null, denoise = DEFAULT_IMG2IMG_DENOISE) => {
    const workflow = JSON.parse(JSON.stringify(controlnetTemplate));

    // 设置参考图片
    workflow['11'].inputs.image = imageFilename;

    // 设置提示词（不参与LoRA）
    let processedPrompt = promptText || '';
    if (uniqueId) {
      const cacheBreaker = `\u200B${uniqueId}\u200B${Date.now()}`;
      processedPrompt = processedPrompt + cacheBreaker;
    }
    workflow['5'].inputs.text = processedPrompt;

    // 设置控制模式: 0=线稿, 1=深度, 2=骨骼(姿势)
    const modeIndex = { 'lineart': 0, 'depth': 1, 'pose': 2 }[controlMode];
    workflow['28'].inputs.index = modeIndex;

    // 设置采样器参数
    const currentSteps = savedParams?.steps || steps;
    const seed = getSeed();
    workflow['4'].inputs.seed = seed;
    workflow['4'].inputs.steps = currentSteps;
    workflow['4'].inputs.sampler_name = samplerName;
    workflow['4'].inputs.scheduler = scheduler;
    workflow['4'].inputs.denoise = denoise;

    // 设置唯一的文件名前缀
    if (uniqueId) {
      workflow['48'].inputs.filename_prefix = `CNN_${uniqueId}_`;
    }

    return { workflow, seed };
  };

  // 高清化单张图片
  const upscaleImage = async (placeholderId) => {
    const placeholder = imagePlaceholdersRef.current.find(p => p.id === placeholderId);
    if (!placeholder || !placeholder.filename) {
      processUpscaleQueue();
      return;
    }

    const clientId = generateClientId();
    let ws = null;
    let timeoutId = null;

    try {
      // 更新占位符状态为upscaling
      updateImagePlaceholders(prev => prev.map(p =>
        p.id === placeholderId ? { ...p, upscaleStatus: 'upscaling', upscaleProgress: 0 } : p
      ));

      // 步骤1: 先将图片上传到ComfyUI的input文件夹
      const imageBlob = await fetch(placeholder.imageUrl).then(r => r.blob());
      const formData = new FormData();
      formData.append('image', imageBlob, placeholder.filename);
      formData.append('overwrite', 'true');

      const uploadResponse = await fetch(`${COMFYUI_API}/upload/image`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('图片上传失败');
      }

      const uploadResult = await uploadResponse.json();

      // 步骤2: 使用上传的文件名构建工作流
      const uploadedFilename = uploadResult.name || placeholder.filename;
      const workflow = buildUpscaleWorkflow(uploadedFilename);

      // 创建WebSocket连接并等待执行完成
      ws = new WebSocket(getWebSocketUrl(clientId));

      const executionPromise = new Promise((resolve, reject) => {
        ws.onopen = () => {};

        ws.onerror = (error) => {
          console.error('WebSocket错误:', error);
          reject(new Error('WebSocket连接失败'));
        };

        // 监听WebSocket消息
        ws.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);
            const { type, data } = message;

            // 进度更新消息
            if (type === 'progress') {
              const { value, max } = data;
              if (max > 0) {
                const progressPercent = Math.floor((value / max) * 100);
                updateImagePlaceholders(prev => prev.map(p =>
                  p.id === placeholderId ? { ...p, upscaleProgress: progressPercent } : p
                ));
              }
            }

            // 执行状态消息
            if (type === 'executing') {
              const { node, prompt_id } = data;

              // 当node为null时，表示执行完成
              if (node === null && prompt_id) {
                // 获取生成的图像
                const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`, {
                headers: getAuthHeaders()
              });
                const history = await historyResponse.json();

                if (history[prompt_id] && history[prompt_id].outputs) {
                  const outputs = history[prompt_id].outputs;

                  for (const nodeId in outputs) {
                    if (outputs[nodeId].images && outputs[nodeId].images[0]) {
                      const img = outputs[nodeId].images[0];
                      const hqImageUrl = getImageUrl(img.filename, img.subfolder, img.type);

                      // 更新占位符，保存高清图片（不替换原图，以便用户切换清晰度）
                      updateImagePlaceholders(prev => prev.map(p =>
                        p.id === placeholderId ? {
                          ...p,
                          upscaleStatus: 'completed',
                          upscaleProgress: 100,
                          hqImageUrl: hqImageUrl,
                          hqFilename: img.filename
                          // 不再替换 imageUrl，保留原始标清图
                        } : p
                      ));
                    }
                  }
                }

                if (ws) ws.close();
                if (timeoutId) clearTimeout(timeoutId);
                resolve();
              }
            }

            // 执行错误消息
            if (type === 'execution_error') {
              console.error('执行错误:', data);
              if (ws) ws.close();
              if (timeoutId) clearTimeout(timeoutId);
              reject(new Error(data.exception_message || '未知错误'));
            }
          } catch (err) {
            console.error('消息处理错误:', err);
          }
        };
      });

      // 等待WebSocket连接建立
      await new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        }
      });

      // 提交prompt到ComfyUI
      const promptResponse = await fetch(`${COMFYUI_API}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: clientId
        }),
      });

      if (!promptResponse.ok) {
        const errorData = await promptResponse.json();
        console.error('提交失败:', errorData);
        throw new Error('提交任务失败: ' + JSON.stringify(errorData));
      }

      const result = await promptResponse.json();

      // 设置超时
      timeoutId = setTimeout(() => {
        if (ws) ws.close();
        reject(new Error('高清化超时'));
      }, 300000);

      // 等待执行完成
      await executionPromise;

    } catch (err) {
      console.error('高清化错误:', err);
      // 错误时恢复状态
      updateImagePlaceholders(prev => prev.map(p =>
        p.id === placeholderId ? { ...p, upscaleStatus: 'none', upscaleProgress: 0 } : p
      ));
      if (ws) ws.close();
      if (timeoutId) clearTimeout(timeoutId);
    } finally {
      // 无论成功还是失败，都处理队列中的下一个
      processUpscaleQueue();
    }
  };

  // 处理高清化队列
  const processUpscaleQueue = () => {
    if (upscaleQueueRef.current.length === 0) {
      isUpscalingRef.current = false;
      setIsUpscaling(false);
      return;
    }

    const nextPlaceholderId = upscaleQueueRef.current[0];
    upscaleQueueRef.current = upscaleQueueRef.current.slice(1);
    setUpscaleQueue(upscaleQueueRef.current);
    upscaleImage(nextPlaceholderId);
  };

  // 添加到高清化队列
  const queueUpscale = (placeholderId) => {
    const placeholder = imagePlaceholdersRef.current.find(p => p.id === placeholderId);

    // 检查是否已完成或正在进行
    if (!placeholder || placeholder.status !== 'completed') {
      return;
    }

    if (placeholder.upscaleStatus !== 'none') {
      return;
    }

    // 标记为queued
    updateImagePlaceholders(prev => prev.map(p =>
      p.id === placeholderId ? { ...p, upscaleStatus: 'queued' } : p
    ));

    // 使用ref同步检查，避免竞态条件
    // 如果启用了生图队列优先，且当前正在生成，只添加到队列不立即执行
    if (!isUpscalingRef.current && !(prioritizeGeneration && isGenerating)) {
      // 队列为空且（没有启用优先级或没有正在生成），直接开始
      isUpscalingRef.current = true;
      setIsUpscaling(true);
      upscaleImage(placeholderId);
    } else {
      // 添加到队列 - 同步更新ref
      upscaleQueueRef.current = [...upscaleQueueRef.current, placeholderId];
      setUpscaleQueue(upscaleQueueRef.current);
    }
  };

  // 取消队列中的单个任务
  const cancelQueuedTask = (placeholderId) => {
    const placeholder = imagePlaceholdersRef.current.find(p => p.id === placeholderId);
    if (!placeholder) return;

    const batchId = placeholder.batchId;

    // 先标记为正在移除，触发动画
    updateImagePlaceholders(prev => prev.map(p =>
      p.id === placeholderId ? { ...p, isRemoving: true } : p
    ));

    // 动画结束后再真正移除（动画时长 400ms）
    setTimeout(() => {
      // 删除该占位符 - 先更新ref再更新state
      const filtered = imagePlaceholdersRef.current.filter(p => p.id !== placeholderId);
      imagePlaceholdersRef.current = filtered;
      setImagePlaceholders(filtered);

      // 检查该batchId下是否还有其他queue状态的占位符
      setTimeout(() => {
        const remainingQueuedForBatch = imagePlaceholdersRef.current.filter(p => p.batchId === batchId && p.status === 'queue');

        // 如果该batchId下没有queue占位符了，从队列中移除该任务
        if (remainingQueuedForBatch.length === 0) {
          generationQueueRef.current = generationQueueRef.current.filter(task => task.batchId !== batchId);
          setGenerationQueue(generationQueueRef.current);
        }
      }, 0);
    }, 400);
  };

  // 取消高清化队列中的单个任务
  const cancelUpscaleTask = (placeholderId) => {
    const placeholder = imagePlaceholdersRef.current.find(p => p.id === placeholderId);
    if (!placeholder) return;

    // 只能取消queued状态的任务，不能取消正在upscaling的任务
    if (placeholder.upscaleStatus !== 'queued') return;

    // 将upscaleStatus改回none - 先更新ref再更新state
    const updated = imagePlaceholdersRef.current.map(p =>
      p.id === placeholderId ? { ...p, upscaleStatus: 'none', upscaleProgress: 0 } : p
    );
    imagePlaceholdersRef.current = updated;
    setImagePlaceholders(updated);

    // 从高清化队列中移除
    upscaleQueueRef.current = upscaleQueueRef.current.filter(id => id !== placeholderId);
    setUpscaleQueue(upscaleQueueRef.current);
  };

  // 切换清晰度菜单的显示/隐藏
  const toggleQualityMenu = (placeholderId) => {
    updateImagePlaceholders(prev => prev.map(p =>
      p.id === placeholderId
        ? { ...p, showQualityMenu: !p.showQualityMenu }
        : { ...p, showQualityMenu: false } // 关闭其他菜单
    ));
  };

  // 切换显示的清晰度
  const setDisplayQuality = (placeholderId, quality) => {
    updateImagePlaceholders(prev => prev.map(p =>
      p.id === placeholderId
        ? { ...p, displayQuality: quality, showQualityMenu: false }
        : p
    ));
  };

  // 处理图片加载错误
  const handleImageError = (placeholderId) => {
    const placeholder = imagePlaceholdersRef.current.find(p => p.id === placeholderId);
    if (!placeholder) return;

    const maxRetries = 3;

    // 如果重试次数未超过最大值，标记错误并准备重试
    if (placeholder.imageRetryCount < maxRetries) {
      console.warn(`[handleImageError] 图片加载失败，准备重试 (${placeholder.imageRetryCount + 1}/${maxRetries}):`, placeholderId);

      updateImagePlaceholders(prev => prev.map(p =>
        p.id === placeholderId ? {
          ...p,
          imageLoadError: true,
          imageRetryCount: p.imageRetryCount + 1
        } : p
      ));

      // 延迟后重试加载
      setTimeout(() => {
        retryImageLoad(placeholderId);
      }, 1000 * placeholder.imageRetryCount); // 递增延迟：1秒, 2秒, 3秒
    } else {
      console.error(`[handleImageError] 图片加载失败，已达最大重试次数:`, placeholderId);
      updateImagePlaceholders(prev => prev.map(p =>
        p.id === placeholderId ? {
          ...p,
          imageLoadError: true
        } : p
      ));
    }
  };

  // 重试加载图片
  const retryImageLoad = (placeholderId) => {
    console.log(`[retryImageLoad] 重试加载图片:`, placeholderId);

    // 通过更新 imageUrl 触发重新加载（添加时间戳防止缓存）
    updateImagePlaceholders(prev => prev.map(p => {
      if (p.id !== placeholderId) return p;

      const baseUrl = p.imageUrl?.split('?')[0] || p.imageUrl;
      const newUrl = baseUrl ? `${baseUrl}?t=${Date.now()}` : null;

      return {
        ...p,
        imageUrl: newUrl,
        imageLoadError: false
      };
    }));
  };

  // 处理图片加载成功
  const handleImageLoad = (placeholderId) => {
    // 清除错误状态和重试计数
    updateImagePlaceholders(prev => prev.map(p =>
      p.id === placeholderId ? {
        ...p,
        imageLoadError: false,
        imageRetryCount: 0
      } : p
    ));
  };

  // 重新加载所有失败的图片（连接恢复时调用）
  const reloadFailedImages = () => {
    const failedPlaceholders = imagePlaceholdersRef.current.filter(
      p => p.imageLoadError && p.imageUrl && p.status === 'completed'
    );

    if (failedPlaceholders.length > 0) {
      console.log(`[reloadFailedImages] 重新加载 ${failedPlaceholders.length} 张失败的图片`);

      failedPlaceholders.forEach(p => {
        // 重置重试计数，给一次新的机会
        updateImagePlaceholders(prev => prev.map(placeholder =>
          placeholder.id === p.id ? {
            ...placeholder,
            imageRetryCount: 0,
            imageLoadError: false
          } : placeholder
        ));

        // 延迟一下再重试，避免同时请求太多
        setTimeout(() => {
          retryImageLoad(p.id);
        }, Math.random() * 500); // 随机延迟0-500ms
      });
    }
  };

  // 删除单张图片（仅前端UI）
  const deleteImage = (placeholderId) => {
    updateImagePlaceholders(prev => prev.filter(p => p.id !== placeholderId));
    // 如果在多选模式下，也从选中集合中移除
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      newSet.delete(placeholderId);
      return newSet;
    });
  };

  // 切换图片选中状态
  const toggleImageSelection = (placeholderId) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(placeholderId)) {
        newSet.delete(placeholderId);
      } else {
        newSet.add(placeholderId);
      }
      return newSet;
    });
  };

  // 退出多选模式
  const exitMultiSelectMode = () => {
    setIsMultiSelectMode(false);
    setSelectedImages(new Set());
  };

  // 批量删除选中的图片
  const batchDeleteImages = () => {
    if (selectedImages.size === 0) return;
    updateImagePlaceholders(prev => prev.filter(p => !selectedImages.has(p.id)));
    setSelectedImages(new Set());
  };

  // 批量下载选中的图片
  const batchDownloadImages = async () => {
    if (selectedImages.size === 0) return;
    const selectedPlaceholders = imagePlaceholdersRef.current.filter(
      p => selectedImages.has(p.id) && p.status === 'completed'
    );
    for (const placeholder of selectedPlaceholders) {
      const isHQ = placeholder.upscaleStatus === 'completed' && placeholder.displayQuality === 'hq' && placeholder.hqImageUrl;
      const url = isHQ ? placeholder.hqImageUrl : placeholder.imageUrl;
      const filename = isHQ ? placeholder.hqFilename : placeholder.filename;
      await downloadImage(url, filename);
      // 稍微延迟以避免浏览器阻止多个下载
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  };

  // 批量高清化选中的图片（自动跳过已高清化的）
  const batchUpscaleImages = () => {
    if (selectedImages.size === 0) return;
    const selectedPlaceholders = imagePlaceholdersRef.current.filter(
      p => selectedImages.has(p.id) &&
           p.status === 'completed' &&
           p.upscaleStatus === 'none' // 只对未高清化的图片执行
    );
    for (const placeholder of selectedPlaceholders) {
      queueUpscale(placeholder.id);
    }
  };

  // 下载图片
  const downloadImage = async (imageUrl, filename) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('下载失败:', err);
      setError('下载失败: ' + err.message);
    }
  };

  // 长按开始 - 进入多选模式
  const handleLongPressStart = (placeholderId) => {
    longPressTimerRef.current = setTimeout(() => {
      // 标记长按已触发
      longPressTriggeredRef.current = true;
      // 进入多选模式并选中当前图片
      setIsMultiSelectMode(true);
      setSelectedImages(new Set([placeholderId]));
    }, 500); // 500ms长按
  };

  // 长按结束 - 取消计时器
  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // 批量命名并下载
  const batchDownloadWithPrefix = async () => {
    if (selectedImages.size === 0 || !batchDownloadPrefix.trim()) return;

    const selectedPlaceholders = imagePlaceholdersRef.current.filter(
      p => selectedImages.has(p.id) && p.status === 'completed'
    );

    let index = 1;
    for (const placeholder of selectedPlaceholders) {
      const isHQ = placeholder.upscaleStatus === 'completed' && placeholder.displayQuality === 'hq' && placeholder.hqImageUrl;
      const url = isHQ ? placeholder.hqImageUrl : placeholder.imageUrl;
      const originalFilename = isHQ ? placeholder.hqFilename : placeholder.filename;
      // 获取文件扩展名
      const ext = originalFilename?.split('.').pop() || 'png';
      const newFilename = `${batchDownloadPrefix.trim()}_${String(index).padStart(3, '0')}.${ext}`;

      await downloadImage(url, newFilename);
      // 稍微延迟以避免浏览器阻止多个下载
      await new Promise(resolve => setTimeout(resolve, 300));
      index++;
    }

    // 关闭模态框并重置
    setShowBatchDownloadModal(false);
    setBatchDownloadPrefix('');
  };

  // ==================== 提示词助理相关函数 ====================

  // 生成提示词
  const handlePromptGenerate = async () => {
    if (!assistantInput.trim()) {
      return;
    }

    setIsGeneratingPrompt(true);
    setAssistantError(null);

    try {
      console.log(`[Prompt Assistant] 开始生成，模式: ${assistantMode}`);

      const response = await generatePrompt(assistantMode, assistantInput.trim());

      if (response.success && response.data) {
        // 更新对应模式的结果
        setAssistantResults(prev => ({
          ...prev,
          [assistantMode]: response.data
        }));
        setSelectedResultIndex(0); // 默认选中第一个
        console.log(`[Prompt Assistant] 生成成功，返回 ${response.data.length} 个结果`);
      } else {
        throw new Error('生成失败：返回数据格式错误');
      }
    } catch (error) {
      console.error('[Prompt Assistant] 生成失败:', error);
      setAssistantError(error.message || '生成失败，请稍后重试');

      // 3 秒后自动清除错误
      setTimeout(() => {
        setAssistantError(null);
      }, 3000);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // 应用选中的提示词
  const handlePromptApply = () => {
    if (assistantResults.length === 0) {
      return;
    }

    const selectedPrompt = assistantResults[selectedResultIndex];

    // 找到当前 focus 的提示词，如果没有则使用第一个
    const targetPromptId = focusedPromptId || prompts[0]?.id;

    if (targetPromptId) {
      // 更新提示词
      updatePromptText(targetPromptId, selectedPrompt);
      console.log(`[Prompt Assistant] 应用提示词到 ID: ${targetPromptId}`);
    }

    // 关闭 Modal
    setPromptAssistantOpen(false);
  };

  // 添加带文本的提示词到主界面
  const addPromptWithText = (text) => {
    if (prompts.length >= 10) {
      alert('最多只能添加 10 个提示词');
      return;
    }

    setPrompts([...prompts, {
      id: nextPromptId.current++,
      text: text,
      isGenerating: false
    }]);

    console.log(`[Prompt Assistant] 添加新提示词: ${text.slice(0, 50)}...`);
  };

  // 替换来源提示词的文本（长按触发）
  const replacePromptWithText = (text) => {
    const targetId = assistantSourcePromptId || prompts[0]?.id;
    if (targetId) {
      updatePromptText(targetId, text);
      console.log(`[Prompt Assistant] 替换提示词 ID ${targetId}: ${text.slice(0, 50)}...`);
    }
  };

  // 长按计时器
  const longPressTimerRef = useRef(null);
  const isLongPressRef = useRef(false);

  // 处理按下（开始长按计时）
  const handleAddButtonMouseDown = (text) => {
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      replacePromptWithText(text);
    }, 500); // 500ms 触发长按
  };

  // 处理松开（取消长按或执行点击）
  const handleAddButtonMouseUp = (text) => {
    clearTimeout(longPressTimerRef.current);
    if (!isLongPressRef.current) {
      // 短按：添加新提示词
      addPromptWithText(text);
    }
    isLongPressRef.current = false;
  };

  // 处理离开（取消长按）
  const handleAddButtonMouseLeave = () => {
    clearTimeout(longPressTimerRef.current);
    isLongPressRef.current = false;
  };

  // 下载分镜脚本
  const downloadScript = () => {
    const scriptResults = assistantResults.script || [];
    if (scriptResults.length === 0) return;

    // 生成txt内容
    let content = '# 分镜脚本\n\n';
    scriptResults.forEach((prompt, index) => {
      content += `## 分镜 ${index + 1}\n${prompt}\n\n`;
    });

    // 创建Blob并下载
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `分镜脚本_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[Prompt Assistant] 下载分镜脚本，共 ${scriptResults.length} 个分镜`);
  };

  return (
    <div className={`app ${themeBgLightness > 40 ? 'light-mode' : ''}`} style={{
      '--theme-hue': themeHue,
      '--theme-bg-saturation': themeBgSaturation,
      '--theme-bg-lightness': themeBgLightness,
      '--theme-primary': `hsl(${themeHue}, 70%, 65%)`,
      '--theme-primary-dark': `hsl(${themeHue}, 65%, 54%)`,
      '--theme-primary-light': `hsl(${themeHue}, 75%, 75%)`,
      '--theme-accent': `hsl(${(themeHue + 30) % 360}, 75%, 65%)`,
      '--theme-bg': `hsl(${themeHue}, ${themeBgSaturation}%, ${themeBgLightness - 3}%)`,
      '--theme-bg-card': `hsl(${themeHue}, ${themeBgSaturation - 10}%, ${themeBgLightness + 2}%)`,
      '--theme-border': `hsla(${themeHue}, 70%, 65%, 0.3)`,
      '--theme-border-hover': `hsl(${themeHue}, 70%, 65%)`,
      '--theme-text': themeBgLightness > 40 ? `hsl(${themeHue}, 50%, 15%)` : `hsl(${themeHue}, 70%, 92%)`,
    }}>
      {/* 顶部连接状态通知 */}
      <div className={`connection-notification ${showNotification ? 'show' : ''} ${connectionStatus} ${notificationEmphasis ? 'emphasis' : ''}`}>
        <span className="notification-message">
          {connectionStatus === 'checking' && (
            <>正在检查连接<span className="loading-dots"></span></>
          )}
          {connectionStatus === 'reconnecting' && (
            <>正在重连<span className="loading-dots"></span></>
          )}
          {connectionStatus === 'connected' && connectionMessage}
          {connectionStatus === 'disconnected' && connectionMessage}
          {connectionStatus === 'failed' && connectionMessage}
        </span>

        {connectionStatus === 'reconnecting' && (
          <button className="retry-link" onClick={() => {
            setConnectionStatus('disconnected');
            setShowNotification(false);
          }}>
            取消重连
          </button>
        )}

        {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
          <button className="retry-link" onClick={() => checkConnection()}>
            重新连接
          </button>
        )}
      </div>

      <div className="container">
        {/* 设置按钮 */}
        <div className="theme-button-container">
          <button
            className="settings-button"
            onClick={() => setShowSettingsPanel(!showSettingsPanel)}
            title="设置"
          >
            <Settings size={20} />
          </button>
          {showSettingsPanel && (
            <>
              <div className="settings-overlay" onClick={() => setShowSettingsPanel(false)} />
              <div className="settings-panel">
                <div className="settings-content">
                {/* 主题区域 */}
                <div className="settings-section">
                  <button
                    className="settings-section-header"
                    onClick={() => setShowThemeSection(!showThemeSection)}
                  >
                    <span>主题</span>
                    <span className={`settings-arrow ${showThemeSection ? 'expanded' : ''}`}>▶</span>
                  </button>
                  {showThemeSection && (
                    <div className="theme-settings-content">
                      <label className="theme-picker-label">主题色相</label>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        value={themeHue}
                        onChange={(e) => setThemeHue(parseInt(e.target.value))}
                        className="theme-slider"
                      />
                      <label className="theme-picker-label">背景饱和度</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={themeBgSaturation}
                        onChange={(e) => setThemeBgSaturation(parseInt(e.target.value))}
                        className="theme-saturation-slider"
                      />
                      <label className="theme-picker-label">背景亮度</label>
                      <input
                        type="range"
                        min="0"
                        max="80"
                        value={themeBgLightness}
                        onChange={(e) => setThemeBgLightness(parseInt(e.target.value))}
                        className="theme-lightness-slider"
                      />
                      <div className="theme-presets">
                        <button onClick={() => setThemeHue(270)} className="theme-preset" style={{ background: 'hsl(270, 70%, 65%)' }}>紫</button>
                        <button onClick={() => setThemeHue(0)} className="theme-preset" style={{ background: 'hsl(0, 70%, 65%)' }}>红</button>
                        <button onClick={() => setThemeHue(120)} className="theme-preset" style={{ background: 'hsl(120, 70%, 65%)' }}>绿</button>
                        <button onClick={() => setThemeHue(200)} className="theme-preset" style={{ background: 'hsl(200, 70%, 65%)' }}>蓝</button>
                        <button onClick={() => setThemeHue(40)} className="theme-preset" style={{ background: 'hsl(40, 70%, 65%)' }}>金</button>
                        <button onClick={() => setThemeHue(300)} className="theme-preset" style={{ background: 'hsl(300, 70%, 65%)' }}>粉</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* LoRA管理区域 */}
                <div className="settings-section">
                  <button
                    className="settings-section-header"
                    onClick={() => setShowLoraManager(!showLoraManager)}
                  >
                    <span>LoRA 管理</span>
                    <span className={`settings-arrow ${showLoraManager ? 'expanded' : ''}`}>▶</span>
                  </button>
                  {showLoraManager && (
                    <div className="lora-manager-list">
                      {connectionStatus !== 'connected' ? (
                        <div className="lora-manager-empty">未连接 ComfyUI</div>
                      ) : availableLoras.length === 0 ? (
                        <div className="lora-manager-empty">暂无可用 LoRA</div>
                      ) : (
                        availableLoras.map((lora) => {
                          const loraConfig = enabledLoras.find(l => l.name === lora);
                          const isEnabled = !!loraConfig;
                          return (
                            <div key={lora} className="lora-manager-item">
                              <label className="lora-manager-checkbox">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEnabledLoras([...enabledLoras, { name: lora, displayName: '', triggerWord: '' }]);
                                    } else {
                                      setEnabledLoras(enabledLoras.filter(l => l.name !== lora));
                                    }
                                  }}
                                />
                                <span className="lora-manager-name" title={lora}>{lora}</span>
                              </label>
                              {isEnabled && (
                                <div className="lora-manager-fields">
                                  <input
                                    type="text"
                                    className="lora-field-input"
                                    placeholder="显示名称"
                                    value={loraConfig.displayName}
                                    onChange={(e) => {
                                      setEnabledLoras(enabledLoras.map(l =>
                                        l.name === lora ? { ...l, displayName: e.target.value } : l
                                      ));
                                    }}
                                  />
                                  <input
                                    type="text"
                                    className="lora-field-input"
                                    placeholder="触发词"
                                    value={loraConfig.triggerWord}
                                    onChange={(e) => {
                                      setEnabledLoras(enabledLoras.map(l =>
                                        l.name === lora ? { ...l, triggerWord: e.target.value } : l
                                      ));
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="header-container">
          <h1 className="title">CorineGen</h1>
          <div className="version-info">v{APP_VERSION}</div>
        </div>

        <div className="form">
          {/* 提示词列表 */}
          <div className="form-group">
            <div className="label-with-button">
              <label className="label">提示词 (Prompt)</label>
              <button
                className="add-prompt-button"
                onClick={addPrompt}
                disabled={prompts.length >= 10}
                title="添加提示词"
              >
                +
              </button>
            </div>

            {prompts.map((promptItem, index) => (
              <div key={promptItem.id} className="prompt-item">
                <div
                  className="textarea-wrapper"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.add('drag-over');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('drag-over');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('drag-over');
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                      handleRefImageUpload(promptItem.id, file);
                    }
                  }}
                >
                  <textarea
                    className="textarea"
                    value={promptItem.text}
                    onChange={(e) => updatePromptText(promptItem.id, e.target.value)}
                    onFocus={() => setFocusedPromptId(promptItem.id)}
                    onBlur={() => setFocusedPromptId(null)}
                    placeholder={`提示词 ${index + 1}...`}
                    rows={3}
                  />

                  {/* 删除按钮 - 仅在focus且数量>1时显示 */}
                  {focusedPromptId === promptItem.id && prompts.length > 1 && (
                    <button
                      className="delete-prompt-button"
                      onMouseDown={(e) => {
                        e.preventDefault(); // 防止textarea失焦
                        deletePrompt(promptItem.id);
                      }}
                      title="删除此提示词"
                    >
                      ×
                    </button>
                  )}

                  {/* 粘贴按钮 - 左下角（有参考图时在缩略图右侧） */}
                  <button
                    className={`paste-prompt-button ${promptItem.refImage ? 'with-ref-image' : ''}`}
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          updatePromptText(promptItem.id, text);
                        }
                      } catch (err) {
                        console.error('无法读取剪贴板:', err);
                      }
                    }}
                    title="粘贴剪贴板内容"
                  >
                    <ClipboardPaste size={16} />
                  </button>

                  {/* 图片上传按钮 - 粘贴按钮右侧，有图片时隐藏 */}
                  {!promptItem.refImage && (
                    <>
                      <button
                        className="upload-image-button"
                        onClick={() => imageInputRefs.current[promptItem.id]?.click()}
                        title="添加参考图片"
                      >
                        <ImagePlus size={16} />
                      </button>
                      <input
                        type="file"
                        ref={el => imageInputRefs.current[promptItem.id] = el}
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          handleRefImageUpload(promptItem.id, e.target.files[0]);
                          e.target.value = ''; // 重置input，允许重复选择同一文件
                        }}
                      />
                    </>
                  )}

                  {/* 魔法棒按钮 - 提示词助理入口 */}
                  <button
                    className="prompt-assistant-button"
                    onClick={() => {
                      // 打开 Modal 时自动填充当前提示词并记录来源
                      setAssistantInput(promptItem.text);
                      setAssistantSourcePromptId(promptItem.id);
                      setPromptAssistantOpen(true);
                    }}
                    disabled={isGeneratingPrompt}
                    title="提示词助理 - AI 优化提示词"
                  >
                    <Wand2 size={16} />
                  </button>

                  {/* 参考图片缩略图和下拉菜单 */}
                  {promptItem.refImage && (
                    <div className="ref-image-container">
                      <div
                        className="ref-image-thumbnail"
                        onClick={() => toggleRefImageMenu(promptItem.id)}
                      >
                        <img src={promptItem.refImage.preview} alt="参考图" />
                        <span className="ref-image-mode-label">
                          {promptItem.refImage.mode === 'direct' && '直接'}
                          {promptItem.refImage.mode === 'lineart' && '线稿'}
                          {promptItem.refImage.mode === 'depth' && '深度'}
                          {promptItem.refImage.mode === 'pose' && '姿势'}
                        </span>
                        <ChevronDown size={12} className="dropdown-icon" />

                        {/* 降噪强度输入框 */}
                        <input
                          type="number"
                          className="denoise-input"
                          value={promptItem.refImage.denoise ?? DEFAULT_IMG2IMG_DENOISE}
                          min="0"
                          max="1"
                          step="0.1"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value)) {
                              setRefImageDenoise(promptItem.id, value);
                            }
                          }}
                          onFocus={(e) => {
                            // 聚焦时添加非被动滚轮监听器以阻止页面滚动
                            const input = e.target;
                            const promptId = promptItem.id;
                            const handleWheel = (evt) => {
                              evt.preventDefault();
                              evt.stopPropagation();
                              const delta = evt.deltaY > 0 ? -0.1 : 0.1;
                              // 从 input 元素直接读取当前值，避免闭包陷阱
                              const parsedValue = parseFloat(input.value);
                              const currentValue = isNaN(parsedValue) ? DEFAULT_IMG2IMG_DENOISE : parsedValue;
                              setRefImageDenoise(promptId, Math.round((currentValue + delta) * 10) / 10);
                            };
                            input._wheelHandler = handleWheel;
                            input.addEventListener('wheel', handleWheel, { passive: false });
                          }}
                          onBlur={(e) => {
                            // 失焦时移除滚轮监听器
                            const input = e.target;
                            if (input._wheelHandler) {
                              input.removeEventListener('wheel', input._wheelHandler);
                              delete input._wheelHandler;
                            }
                          }}
                          title="降噪强度 (0-1)"
                        />

                        {/* 移除图片按钮 - iOS徽章风格 */}
                        <button
                          className="remove-ref-image"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRefImage(promptItem.id);
                          }}
                          title="移除参考图片"
                        >
                          <X size={10} />
                        </button>
                      </div>

                      {/* 下拉菜单 */}
                      {showRefImageMenu[promptItem.id] && (
                        <div className="ref-image-menu">
                          <div
                            className={`menu-item ${promptItem.refImage.mode === 'direct' ? 'active' : ''}`}
                            onClick={() => setRefImageMode(promptItem.id, 'direct')}
                          >
                            直接使用图片
                          </div>
                          <div
                            className={`menu-item ${promptItem.refImage.mode === 'lineart' ? 'active' : ''}`}
                            onClick={() => setRefImageMode(promptItem.id, 'lineart')}
                          >
                            使用图片线稿
                          </div>
                          <div
                            className={`menu-item ${promptItem.refImage.mode === 'depth' ? 'active' : ''}`}
                            onClick={() => setRefImageMode(promptItem.id, 'depth')}
                          >
                            使用图片深度
                          </div>
                          <div
                            className={`menu-item ${promptItem.refImage.mode === 'pose' ? 'active' : ''}`}
                            onClick={() => setRefImageMode(promptItem.id, 'pose')}
                          >
                            使用图片姿势
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 发送按钮 - 始终显示在右下角 */}
                  <button
                    className="send-prompt-button"
                    onClick={() => queueGeneration(promptItem.id)}
                    disabled={!promptItem.text.trim()}
                    title="发送生成"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 全部发送按钮 */}
          <div className="form-group">
            <button
              className="generate-all-button"
              onClick={generateAll}
            >
              <ArrowRight size={18} /> 全部生成
            </button>
          </div>

          {/* 高级设置折叠栏 */}
          <details className="advanced-settings">
            <summary className="advanced-settings-summary" onClick={(e) => {
              // 只有点击箭头区域才触发展开/折叠，其他区域都阻止
              const isToggle = e.target.closest('.advanced-settings-toggle');
              if (!isToggle) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}>
              {/* 展开/折叠箭头 */}
              <span className="advanced-settings-toggle">▶</span>

              {/* 预设选择器 */}
              <div className="preset-selector-wrapper">
                <div
                  className={`preset-selector ${settingsPresets.length === 0 ? 'disabled' : ''}`}
                  onClick={() => {
                    // 没有预设时不打开下拉框
                    if (settingsPresets.length > 0) {
                      setShowPresetDropdown(!showPresetDropdown);
                    }
                  }}
                >
                  <span className="preset-current-name">
                    {activePresetId
                      ? settingsPresets.find(p => p.id === activePresetId)?.name || '自定义'
                      : '自定义'}
                  </span>
                  {settingsPresets.length > 0 && (
                    <span className={`preset-arrow ${showPresetDropdown ? 'open' : ''}`}>▼</span>
                  )}
                </div>

                <button
                  className="preset-add-button"
                  onClick={() => setShowNewPresetPanel(true)}
                  title="新建预设"
                >
                  +
                </button>

                {/* 预设下拉菜单 */}
                {showPresetDropdown && settingsPresets.length > 0 && (
                  <div className="preset-dropdown">
                    {settingsPresets.map(preset => (
                      <div
                        key={preset.id}
                        className={`preset-option ${activePresetId === preset.id ? 'active' : ''}`}
                        onMouseEnter={() => setHoveredPresetId(preset.id)}
                        onMouseLeave={() => setHoveredPresetId(null)}
                        onClick={() => loadPreset(preset.id)}
                      >
                        <span className="preset-option-name">{preset.name}</span>
                        {hoveredPresetId === preset.id && (
                          <button
                            className="preset-delete-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePreset(preset.id);
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </summary>
            <div className="advanced-settings-content">

              {/* 生成设置分组 */}
              <details className="settings-group-collapsible" open>
                <summary className="settings-group-summary">
                  <span className="settings-group-title">生成设置</span>
                </summary>
                <div className="settings-group-content">

                {/* 批次数量 */}
                <div className="form-group">
                  <label className="label">批次数量</label>
                  <div className="radio-group">
                    {[1, 2, 4, 8].map((size) => (
                      <label key={size} className="radio-label">
                        <input
                          type="radio"
                          name="batchSize"
                          value={size}
                          checked={batchSize === size}
                          onChange={() => setBatchSize(size)}
                        />
                        <span>{size}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 批次方法 - 暂时隐藏一次性执行选项 */}
                {/*
                <div className="form-group">
                  <label className="label">批次方法</label>
                  <div className="radio-group">
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="batchMethod"
                        value="batch"
                        checked={batchMethod === 'batch'}
                        onChange={() => setBatchMethod('batch')}
                      />
                      <span>一次性执行</span>
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="batchMethod"
                        value="loop"
                        checked={batchMethod === 'loop'}
                        onChange={() => setBatchMethod('loop')}
                      />
                      <span>工作流循环执行</span>
                    </label>
                  </div>
                </div>
                */}

                {/* Steps滑块 */}
                <div className="form-group">
                  <label className="label">采样步数 (Steps): {steps}</label>
                  <input
                    type="range"
                    min="8"
                    max="16"
                    step="1"
                    value={steps}
                    onChange={(e) => setSteps(parseInt(e.target.value))}
                    className="slider"
                  />
                </div>
                </div>
              </details>

              {/* 采样设置分组 */}
              <details className="settings-group-collapsible" open>
                <summary className="settings-group-summary">
                  <span className="settings-group-title">采样设置</span>
                </summary>
                <div className="settings-group-content">

                {/* 采样算法 */}
                <div className="form-group">
                  <label className="label">采样算法 (Sampler)</label>
                  <div className="radio-group">
                    {[
                      { value: 'euler', label: 'Euler' },
                      { value: 'euler_ancestral', label: 'Euler A' },
                      { value: 'res_multistep', label: 'Res Multistep' },
                      { value: 'dpmpp_2m_sde', label: 'DPM++ 2M SDE' }
                    ].map((sampler) => (
                      <label key={sampler.value} className="radio-label">
                        <input
                          type="radio"
                          name="samplerName"
                          value={sampler.value}
                          checked={samplerName === sampler.value}
                          onChange={() => setSamplerName(sampler.value)}
                        />
                        <span>{sampler.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 调度方法 */}
                <div className="form-group">
                  <label className="label">调度方法 (Scheduler)</label>
                  <div className="radio-group">
                    {[
                      { value: 'simple', label: 'Simple' },
                      { value: 'beta', label: 'Beta' },
                      { value: 'ddim_uniform', label: 'DDIM Uniform' }
                    ].map((sched) => (
                      <label key={sched.value} className="radio-label">
                        <input
                          type="radio"
                          name="scheduler"
                          value={sched.value}
                          checked={scheduler === sched.value}
                          onChange={() => setScheduler(sched.value)}
                        />
                        <span>{sched.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                </div>
              </details>

              {/* LoRA 设置分组 */}
              <details className="settings-group-collapsible" open>
                <summary className="settings-group-summary">
                  <span className="settings-group-title">LoRA 设置</span>
                </summary>
                <div className="settings-group-content">
                <label className="queue-control-item">
                  <input
                    type="checkbox"
                    checked={loraEnabled}
                    onChange={(e) => setLoraEnabled(e.target.checked)}
                  />
                  <span className="queue-control-label">启用 LoRA</span>
                </label>

                {loraEnabled && (
                  <div className="lora-options">
                    <div className="lora-input-group">
                      <label className="label">选择 LoRA</label>
                      {enabledLoras.length === 0 ? (
                        <p className="lora-empty-hint">请先在设置中启用 LoRA</p>
                      ) : (
                        <div className="radio-group lora-radio-group">
                          {enabledLoras.map((lora) => {
                            const loraValue = typeof lora === 'string' ? lora : lora.name;
                            const loraDisplay = typeof lora === 'string' ? lora : (lora.displayName || lora.name);
                            return (
                              <label key={loraValue} className="radio-label">
                                <input
                                  type="radio"
                                  name="lora-selection"
                                  value={loraValue}
                                  checked={loraName === loraValue}
                                  onChange={(e) => setLoraName(e.target.value)}
                                />
                                <span>{loraDisplay}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="lora-sliders">
                      <div className="lora-slider-group">
                        <label className="label">模型权重: {loraStrengthModel.toFixed(2)}</label>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.05"
                          value={loraStrengthModel}
                          onChange={(e) => setLoraStrengthModel(parseFloat(e.target.value))}
                          className="slider"
                        />
                      </div>

                      <div className="lora-slider-group">
                        <label className="label">CLIP 权重: {loraStrengthClip.toFixed(2)}</label>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.05"
                          value={loraStrengthClip}
                          onChange={(e) => setLoraStrengthClip(parseFloat(e.target.value))}
                          className="slider"
                        />
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </details>

              {/* 图像设置分组 */}
              <details className="settings-group-collapsible" open>
                <summary className="settings-group-summary">
                  <span className="settings-group-title">图像设置</span>
                </summary>
                <div className="settings-group-content">

                {/* 超分倍率滑块 */}
                <div className="form-group">
                <label className="label">超分倍率: {resolutionScale.toFixed(1)}x</label>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={resolutionScale}
                  onChange={(e) => setResolutionScale(parseFloat(e.target.value))}
                  className="slider"
                />
                <p className="resolution-display">
                  目标分辨率: {getImageDimensions().width} × {getImageDimensions().height}
                </p>
              </div>

              {/* 图像比例 */}
              <div className="form-group">
                <label className="label">图像比例</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value="square"
                      checked={aspectRatio === 'square'}
                      onChange={() => setAspectRatio('square')}
                    />
                    <span>Square (1:1)</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value="portrait"
                      checked={aspectRatio === 'portrait'}
                      onChange={() => setAspectRatio('portrait')}
                    />
                    <span>Portrait (9:16)</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value="landscape"
                      checked={aspectRatio === 'landscape'}
                      onChange={() => setAspectRatio('landscape')}
                    />
                    <span>Landscape (16:9)</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value="4:3"
                      checked={aspectRatio === '4:3'}
                      onChange={() => setAspectRatio('4:3')}
                    />
                    <span>4:3</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value="3:4"
                      checked={aspectRatio === '3:4'}
                      onChange={() => setAspectRatio('3:4')}
                    />
                    <span>3:4</span>
                  </label>
                  {/* 2.35:1 暂时隐藏
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value="2.35:1"
                      checked={aspectRatio === '2.35:1'}
                      onChange={() => setAspectRatio('2.35:1')}
                    />
                    <span>2.35:1 (Cinema)</span>
                  </label>
                  */}
                </div>
              </div>
              </div>
              </details>

              {/* 种子设置分组 */}
              <details className="settings-group-collapsible" open>
                <summary className="settings-group-summary">
                  <span className="settings-group-title">种子设置</span>
                </summary>
                <div className="settings-group-content">

                {/* 种子模式 */}
                <div className="form-group">
                <label className="label">种子模式</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="seedMode"
                      value="random"
                      checked={seedMode === 'random'}
                      onChange={() => setSeedMode('random')}
                    />
                    <span>随机</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="seedMode"
                      value="fixed"
                      checked={seedMode === 'fixed'}
                      onChange={() => {
                        setSeedMode('fixed');
                        // 切换时同步种子值：将首次固定的值同步到固定种子
                        if (firstFixedSeed) {
                          setFixedSeed(firstFixedSeed);
                        }
                      }}
                    />
                    <span>固定</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="seedMode"
                      value="first-fixed"
                      checked={seedMode === 'first-fixed'}
                      onChange={() => {
                        setSeedMode('first-fixed');
                        // 切换时同步种子值：将固定种子的值同步到首次固定
                        if (fixedSeed) {
                          setFirstFixedSeed(fixedSeed);
                        }
                      }}
                    />
                    <span>首次固定</span>
                  </label>
                </div>
              </div>

              {/* 固定种子输入 */}
              {seedMode === 'fixed' && (
                <div className="form-group">
                  <label className="label">种子编号</label>
                  <input
                    type="number"
                    className="input seed-input"
                    value={fixedSeed}
                    onChange={(e) => setFixedSeed(e.target.value)}
                    placeholder="输入种子编号或拖拽图片到此"
                    onDrop={(e) => {
                      e.preventDefault();
                      const seed = e.dataTransfer.getData('seed');
                      if (seed) {
                        setFixedSeed(seed);
                      }
                      e.currentTarget.classList.remove('drag-over');
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('drag-over');
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('drag-over');
                    }}
                  />
                </div>
              )}

              {/* 首次固定种子输入 */}
              {seedMode === 'first-fixed' && (
                <div className="form-group">
                  <label className="label">首次种子编号（留空则随机）</label>
                  <input
                    type="number"
                    className="input seed-input"
                    value={firstFixedSeed}
                    onChange={(e) => setFirstFixedSeed(e.target.value)}
                    placeholder="输入首次种子编号或拖拽图片到此"
                    onDrop={(e) => {
                      e.preventDefault();
                      const seed = e.dataTransfer.getData('seed');
                      if (seed) {
                        setFirstFixedSeed(seed);
                      }
                      e.currentTarget.classList.remove('drag-over');
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('drag-over');
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('drag-over');
                    }}
                  />
                </div>
              )}
              </div>
              </details>
            </div>
          </details>

          {/* 队列控制设置 */}
          <div className="queue-controls">
            <label className="queue-control-item">
              <input
                type="checkbox"
                checked={prioritizeGeneration}
                onChange={(e) => setPrioritizeGeneration(e.target.checked)}
              />
              <span className="queue-control-label">生图队列优先</span>
            </label>

            <label className="queue-control-item">
              <input
                type="checkbox"
                checked={autoUpscaleAfterGen}
                onChange={(e) => setAutoUpscaleAfterGen(e.target.checked)}
              />
              <span className="queue-control-label">生图后自动高清化</span>
            </label>
          </div>

          {/* 错误信息 */}
          {error && <div className="error">{error}</div>}
        </div>

        {/* 右侧图片区域 */}
        <div className="images-section">
          {/* 恢复对话框 */}
          {recoveryState.isPaused && (
            <div className="recovery-dialog-overlay">
              <div className="recovery-dialog">
                <h3>⏸ 生成已暂停</h3>
                <p className="recovery-reason">原因: {recoveryState.reason}</p>
                <p className="recovery-progress">剩余: {recoveryState.totalCount} 张图片</p>

                <div className="recovery-actions">
                  <button
                    className="button-continue"
                    onClick={handleContinueGeneration}
                    disabled={connectionStatus !== 'connected'}
                  >
                    继续生成剩余 {recoveryState.totalCount} 张
                    {connectionStatus !== 'connected' && ' (等待连接...)'}
                  </button>
                  <button
                    className="button-cancel"
                    onClick={handleCancelRemaining}
                  >
                    取消剩余任务
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 图像展示区域 - 骨架占位图 */}
          <div className="images-container" ref={imagesContainerRef}>
          {/* 控制栏 */}
          <div className="images-toolbar">
            {/* 多选模式下的全选按钮 - 最左侧 */}
            {isMultiSelectMode && (() => {
              const completedImages = imagePlaceholders.filter(p => p.status === 'completed');
              const completedIds = new Set(completedImages.map(p => p.id));
              const selectedCompletedCount = [...selectedImages].filter(id => completedIds.has(id)).length;
              const totalCompleted = completedImages.length;

              // 判断选中状态：全选、半选、全不选
              const selectState = totalCompleted === 0 ? 'none' :
                selectedCompletedCount === totalCompleted ? 'all' :
                selectedCompletedCount > 0 ? 'partial' : 'none';

              const handleSelectAllToggle = () => {
                if (selectState === 'none') {
                  // 全不选 -> 全选
                  setSelectedImages(new Set(completedImages.map(p => p.id)));
                } else {
                  // 全选或半选 -> 全不选
                  setSelectedImages(new Set());
                }
              };

              return (
                <button
                  className={`select-all-button ${selectState}`}
                  onClick={handleSelectAllToggle}
                  disabled={totalCompleted === 0}
                  title={selectState === 'all' ? '取消全选' : selectState === 'partial' ? '取消选择' : '全选'}
                >
                  <span className="select-all-checkbox">
                    {selectState === 'all' && '✓'}
                    {selectState === 'partial' && '−'}
                  </span>
                  <span className="select-all-label">
                    {selectState === 'all' ? '全选' : selectState === 'partial' ? '部分' : '全选'}
                  </span>
                </button>
              );
            })()}
            {/* 多选模式下的批量操作按钮 */}
            {isMultiSelectMode && (
              <div className="batch-actions">
                <span className="selected-count">{selectedImages.size} 已选</span>
                <button
                  className="batch-action-button download"
                  onClick={batchDownloadImages}
                  disabled={selectedImages.size === 0}
                  title="批量下载"
                >
                  批量下载
                </button>
                <button
                  className="batch-action-button rename-download"
                  onClick={() => setShowBatchDownloadModal(true)}
                  disabled={selectedImages.size === 0}
                  title="批量命名并下载"
                >
                  批量命名并下载
                </button>
                <button
                  className="batch-action-button upscale"
                  onClick={batchUpscaleImages}
                  disabled={selectedImages.size === 0}
                  title="批量高清化"
                >
                  批量高清
                </button>
                <button
                  className="batch-action-button delete"
                  onClick={() => setShowDeleteConfirmModal(true)}
                  disabled={selectedImages.size === 0}
                  title="批量删除"
                >
                  批量删除
                </button>
              </div>
            )}
            <button
              className={`multi-select-button ${isMultiSelectMode ? 'active' : ''}`}
              onClick={() => isMultiSelectMode ? exitMultiSelectMode() : setIsMultiSelectMode(true)}
              title={isMultiSelectMode ? '退出多选' : '多选'}
            >
              {isMultiSelectMode ? '完成' : '多选'}
            </button>
            <button
              className="view-toggle-button"
              onClick={toggleViewMode}
              title={`当前视图: ${viewMode === 'small' ? '小' : viewMode === 'medium' ? '中' : '大'}`}
            >
              {getViewIcon()}
            </button>
          </div>
          {imagePlaceholders.length > 0 ? (
            <>
              <Masonry
                breakpointCols={{
                  default: viewMode === 'large' ? 1 : viewMode === 'medium' ? 2 : 3,
                  768: 1
                }}
                className="images-grid"
                columnClassName="images-grid-column"
              >
                {imagePlaceholders.map((placeholder) => (
                  <div
                    key={placeholder.id}
                    className={`image-placeholder ${placeholder.status} ${isMultiSelectMode && placeholder.status === 'completed' ? 'multi-select-mode' : ''} ${selectedImages.has(placeholder.id) ? 'selected' : ''}`}
                    style={{ '--item-aspect-ratio': placeholder.aspectRatio || 1 }}
                  >
                    <div className={`skeleton ${placeholder.isNew ? 'skeleton-new' : ''} ${placeholder.isRemoving ? 'skeleton-removing' : ''}`}>
                      {/* 多选模式选中指示器 */}
                      {isMultiSelectMode && placeholder.status === 'completed' && (
                        <div
                          className={`selection-indicator ${selectedImages.has(placeholder.id) ? 'checked' : ''}`}
                          onClick={() => toggleImageSelection(placeholder.id)}
                        >
                          {selectedImages.has(placeholder.id) ? <Check size={14} strokeWidth={3} /> : ''}
                        </div>
                      )}
                      {/* 背景图片 */}
                      {(placeholder.status === 'revealing' || placeholder.status === 'completed') && placeholder.imageUrl && (
                        <img
                          src={
                            // 根据清晰度选择显示的图片
                            placeholder.upscaleStatus === 'completed' && placeholder.displayQuality === 'hq' && placeholder.hqImageUrl
                              ? placeholder.hqImageUrl
                              : placeholder.imageUrl
                          }
                          alt={`Generated ${placeholder.id}`}
                          onError={() => handleImageError(placeholder.id)}
                          onLoad={() => handleImageLoad(placeholder.id)}
                          onClick={() => {
                            // 如果刚触发了长按，跳过点击事件
                            if (longPressTriggeredRef.current) {
                              longPressTriggeredRef.current = false;
                              return;
                            }
                            if (placeholder.status === 'completed') {
                              if (isMultiSelectMode) {
                                // 多选模式下点击是选中/取消选中
                                toggleImageSelection(placeholder.id);
                              } else {
                                // 非多选模式下点击是下载
                                const isHQ = placeholder.upscaleStatus === 'completed' && placeholder.displayQuality === 'hq' && placeholder.hqImageUrl;
                                const url = isHQ ? placeholder.hqImageUrl : placeholder.imageUrl;
                                const filename = isHQ ? placeholder.hqFilename : placeholder.filename;
                                downloadImage(url, filename);
                              }
                            }
                          }}
                          onMouseDown={() => {
                            if (placeholder.status === 'completed' && !isMultiSelectMode) {
                              handleLongPressStart(placeholder.id);
                            }
                          }}
                          onMouseUp={handleLongPressEnd}
                          onMouseLeave={handleLongPressEnd}
                          onTouchStart={() => {
                            if (placeholder.status === 'completed' && !isMultiSelectMode) {
                              handleLongPressStart(placeholder.id);
                            }
                          }}
                          onTouchEnd={handleLongPressEnd}
                          onTouchCancel={handleLongPressEnd}
                          className={`generated-image ${placeholder.status === 'revealing' || placeholder.status === 'completed' ? 'revealing' : ''} ${placeholder.upscaleStatus === 'upscaling' ? 'upscaling-blur' : ''}`}
                          style={{ pointerEvents: placeholder.status === 'completed' ? 'auto' : 'none' }}
                          draggable={placeholder.status === 'completed' && placeholder.seed !== null && !isMultiSelectMode}
                          onDragStart={(e) => {
                            if (placeholder.status === 'completed' && placeholder.seed !== null && !isMultiSelectMode) {
                              // 拖拽开始时取消长按计时器，避免与长按冲突
                              handleLongPressEnd();
                              e.dataTransfer.setData('seed', placeholder.seed.toString());
                            }
                          }}
                        />
                      )}
                      {/* 删除按钮 - 仅在completed状态且非upscaling时显示，悬停可见 */}
                      {placeholder.status === 'completed' && placeholder.upscaleStatus !== 'upscaling' && !isMultiSelectMode && (
                        <button
                          className="delete-image-button"
                          onClick={() => deleteImage(placeholder.id)}
                          title="删除图片"
                        >
                          ×
                        </button>
                      )}
                      {/* 取消按钮 - 仅在queue状态且非loading时显示 */}
                      {placeholder.status === 'queue' && !placeholder.isLoading && (
                        <button
                          className="cancel-queue-button"
                          onClick={() => cancelQueuedTask(placeholder.id)}
                          title="取消任务"
                        >
                          ×
                        </button>
                      )}
                      {/* HQ按钮 - 仅在completed状态显示 */}
                      {placeholder.status === 'completed' && (
                        <div className="hq-button-container">
                          <button
                            className={`hq-button ${placeholder.upscaleStatus === 'completed' ? 'completed' : ''} ${placeholder.upscaleStatus === 'upscaling' ? 'disabled' : ''} ${placeholder.upscaleStatus === 'queued' ? 'queued' : ''}`}
                            onClick={() => {
                              if (placeholder.upscaleStatus === 'completed') {
                                toggleQualityMenu(placeholder.id);
                              } else if (placeholder.upscaleStatus === 'none') {
                                queueUpscale(placeholder.id);
                              } else if (placeholder.upscaleStatus === 'queued') {
                                cancelUpscaleTask(placeholder.id);
                              }
                            }}
                            disabled={placeholder.upscaleStatus === 'upscaling'}
                            title={
                              placeholder.upscaleStatus === 'completed' ? '点击切换清晰度' :
                              placeholder.upscaleStatus === 'queued' ? '点击取消高清化' :
                              placeholder.upscaleStatus === 'upscaling' ? '高清化中...' :
                              '点击高清化'
                            }
                          >
                            {placeholder.upscaleStatus === 'completed' ? (
                              <>
                                {placeholder.displayQuality === 'hq' ? 'HQ' : 'SQ'}
                                <span className="quality-arrow">▲</span>
                              </>
                            ) :
                             placeholder.upscaleStatus === 'queued' ? 'Cancel HQ' :
                             'HQ'}
                          </button>
                          {/* 清晰度切换菜单 */}
                          {placeholder.showQualityMenu && placeholder.upscaleStatus === 'completed' && (
                            <div className="quality-menu">
                              <button
                                className={`quality-option ${placeholder.displayQuality === 'sq' ? 'active' : ''}`}
                                onClick={() => setDisplayQuality(placeholder.id, 'sq')}
                              >
                                SQ 标清
                              </button>
                              <button
                                className={`quality-option ${placeholder.displayQuality === 'hq' ? 'active' : ''}`}
                                onClick={() => setDisplayQuality(placeholder.id, 'hq')}
                              >
                                HQ 高清
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {/* 进度条幕布 - 生成中或高清化中显示 */}
                      {(placeholder.status !== 'completed' || placeholder.upscaleStatus === 'upscaling') && (
                        <>
                          <div
                            className={`skeleton-progress ${placeholder.status === 'revealing' ? 'revealing' : ''}`}
                            style={{
                              height: placeholder.status === 'revealing' ? '100%' :
                                      placeholder.upscaleStatus === 'upscaling' ? `${placeholder.upscaleProgress}%` :
                                      `${placeholder.progress}%`
                            }}
                          ></div>
                          <div className={`skeleton-text ${
                            placeholder.status === 'queue' ? (placeholder.isLoading ? 'loading-state' : 'queue-pulse') : ''
                          }`}>
                            {placeholder.status === 'queue' ? (
                              placeholder.isLoading ? (
                                <span>Loading<span className="loading-dots"></span></span>
                              ) : 'Queue'
                            ) :
                             placeholder.status === 'revealing' ? '' :
                             placeholder.upscaleStatus === 'upscaling' ? `${placeholder.upscaleProgress}%` :
                             `${placeholder.progress}%`}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </Masonry>
            </>
          ) : (
            // 无图像时的占位区域
            <div className="empty-placeholder">
              <div className="empty-icon"><Image size={64} strokeWidth={1} /></div>
              <p className="empty-text">生成的图像将在这里显示</p>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 批量命名下载模态框 */}
      {showBatchDownloadModal && (
        <div className="preset-modal-overlay" onClick={() => setShowBatchDownloadModal(false)}>
          <div className="preset-modal batch-download-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preset-modal-header">
              <h3>批量命名并下载</h3>
              <button
                className="preset-modal-close"
                onClick={() => setShowBatchDownloadModal(false)}
              >
                ×
              </button>
            </div>
            <div className="preset-modal-content">
              <div className="batch-download-info">
                将下载 {selectedImages.size} 张图片
              </div>
              <label className="batch-download-label">文件名前缀</label>
              <input
                type="text"
                className="batch-download-input"
                value={batchDownloadPrefix}
                onChange={(e) => setBatchDownloadPrefix(e.target.value)}
                placeholder="例如: my_images"
                autoFocus
              />
              <div className="batch-download-preview">
                文件名预览: {batchDownloadPrefix || 'prefix'}_001.png
              </div>
            </div>
            <div className="preset-modal-actions">
              <button
                className="preset-modal-cancel"
                onClick={() => {
                  setShowBatchDownloadModal(false);
                  setBatchDownloadPrefix('');
                }}
              >
                取消
              </button>
              <button
                className="preset-modal-confirm"
                onClick={batchDownloadWithPrefix}
                disabled={!batchDownloadPrefix.trim()}
              >
                下载
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量删除确认对话框 */}
      {showDeleteConfirmModal && (
        <div className="preset-modal-overlay" onClick={() => setShowDeleteConfirmModal(false)}>
          <div className="preset-modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preset-modal-header">
              <h3>确认删除</h3>
              <button
                className="preset-modal-close"
                onClick={() => setShowDeleteConfirmModal(false)}
              >
                ×
              </button>
            </div>
            <div className="preset-modal-content">
              <div className="delete-confirm-message">
                确认删除 {selectedImages.size} 个项目？
              </div>
            </div>
            <div className="preset-modal-actions">
              <button
                className="preset-modal-cancel"
                onClick={() => setShowDeleteConfirmModal(false)}
              >
                取消
              </button>
              <button
                className="preset-modal-confirm delete"
                onClick={() => {
                  batchDeleteImages();
                  setShowDeleteConfirmModal(false);
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建预设面板 */}
      {showNewPresetPanel && (
        <div className="preset-modal-overlay" onClick={() => setShowNewPresetPanel(false)}>
          <div className="preset-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preset-modal-header">
              <h3>保存当前设置为预设</h3>
              <button
                className="preset-modal-close"
                onClick={() => setShowNewPresetPanel(false)}
              >
                ×
              </button>
            </div>
            <div className="preset-modal-content">
              <input
                type="text"
                className="preset-name-input"
                placeholder="输入预设名称..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPresetName.trim()) {
                    saveCurrentAsPreset(newPresetName.trim());
                  }
                }}
                autoFocus
              />
            </div>
            <div className="preset-modal-actions">
              <button
                className="preset-cancel-button"
                onClick={() => {
                  setShowNewPresetPanel(false);
                  setNewPresetName('');
                }}
              >
                取消
              </button>
              <button
                className="preset-save-button"
                disabled={!newPresetName.trim()}
                onClick={() => saveCurrentAsPreset(newPresetName.trim())}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提示词助理 Modal */}
      {promptAssistantOpen && (
        <div className="prompt-assistant-backdrop">
          <div className="prompt-assistant-modal">
            {/* 关闭按钮 */}
            <button
              className="prompt-assistant-close"
              onClick={() => setPromptAssistantOpen(false)}
              title="关闭"
            >
              <X size={20} />
            </button>

            {/* Modal 标题 */}
            <div className="prompt-assistant-header">
              <h2>✨ 提示词助理</h2>
              <p className="prompt-assistant-subtitle">使用 AI 优化和生成提示词</p>
            </div>

            {/* Tab 切换器 */}
            <div className="prompt-assistant-tabs">
              {PRESET_MODES.map(mode => (
                <button
                  key={mode.id}
                  className={`prompt-assistant-tab ${assistantMode === mode.id ? 'active' : ''}`}
                  onClick={() => setAssistantMode(mode.id)}
                  title={mode.tooltip}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Modal 内容 - 左右布局 */}
            <div className="prompt-assistant-content">
              {/* 左边：输入区 */}
              <div className="prompt-assistant-left">
                {/* 输入框 */}
                <textarea
                  className="prompt-assistant-textarea"
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  placeholder={PROMPT_ASSISTANT_PLACEHOLDERS[assistantMode]}
                  rows={10}
                />
                <div className="prompt-assistant-char-count">
                  {assistantInput.length} 字符
                </div>

                {/* 特殊字符指南 - 永远显示 */}
                {(assistantMode === 'variation' || assistantMode === 'polish' || assistantMode === 'continue' || assistantMode === 'script') && (
                  <div className="prompt-assistant-guide">
                    {assistantMode === 'variation' && (
                      <>
                        <p className="guide-title">💡 特殊字符：</p>
                        <div className="guide-content">
                          <span><strong>#</strong> 标记变化内容</span>
                          <span><strong>@0-1</strong> 变化程度</span>
                          <span><strong>()</strong> 偏好说明</span>
                        </div>
                        <p className="guide-example">
                          例: 少女，#穿着红色连衣裙@0.8(希望蓝色调)，站在花园里
                        </p>
                      </>
                    )}
                    {assistantMode === 'polish' && (
                      <>
                        <p className="guide-title">💡 特殊字符：</p>
                        <div className="guide-content">
                          <span><strong>[]</strong> 标记扩写部分</span>
                          <span><strong>.</strong> 轻微</span>
                          <span><strong>..</strong> 适度</span>
                          <span><strong>...</strong> 中等</span>
                          <span><strong>....</strong> 深度</span>
                        </div>
                        <p className="guide-example">
                          例: 少女，[穿着裙子......]，站在[花园..]里
                        </p>
                      </>
                    )}
                    {assistantMode === 'continue' && (
                      <>
                        <p className="guide-title">💡 特殊字符（可选）：</p>
                        <div className="guide-content">
                          <span><strong>[]</strong> 或 <strong>【】</strong> 指定剧情走向</span>
                        </div>
                        <p className="guide-example">
                          例: 少女站在森林边缘，[她发现了一只受伤的小鹿]
                        </p>
                      </>
                    )}
                    {assistantMode === 'script' && (
                      <>
                        <p className="guide-title">💡 提示：</p>
                        <div className="guide-content">
                          <span>输入故事大纲或情节描述</span>
                          <span>可选：指定需要的分镜数量</span>
                        </div>
                        <p className="guide-example">
                          例: 一个少女在森林中迷路，遇到了一只会说话的狐狸，狐狸带她找到了回家的路。请生成 4 个分镜。
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* 生成按钮 */}
                <button
                  className="prompt-assistant-generate-button"
                  onClick={handlePromptGenerate}
                  disabled={!assistantInput.trim() || isGeneratingPrompt}
                >
                  {isGeneratingPrompt ? '生成中...' : '生成'}
                </button>

                {/* 错误提示 */}
                {assistantError && (
                  <div className="prompt-assistant-error">
                    ⚠️ {assistantError}
                  </div>
                )}
              </div>

              {/* 右边：结果区 */}
              <div className="prompt-assistant-right">
                {/* 结果列表容器（可滚动） */}
                <div className="prompt-assistant-results-container">
                  <div className="prompt-assistant-results">
                    {/* 空状态 - 没有结果 */}
                    {!isGeneratingPrompt && (!assistantResults[assistantMode] || assistantResults[assistantMode].length === 0) && !assistantError && (
                      <div className="prompt-assistant-empty-state">
                        <p className="empty-state-text">点击"生成"按钮获取 AI 优化建议</p>
                      </div>
                    )}

                    {/* 加载状态 */}
                    {isGeneratingPrompt && (
                      <div className="prompt-assistant-loading">
                        <div className="loading-spinner"></div>
                        <p className="loading-text">AI 正在思考中...</p>
                      </div>
                    )}

                    {/* variation 模式：多个变体，每个有+按钮 */}
                    {!isGeneratingPrompt && assistantResults[assistantMode]?.length > 0 && assistantMode === 'variation' && (
                      <div className="prompt-assistant-results-list">
                        <p className="results-header">
                          生成了 {assistantResults[assistantMode].length} 个变体（单击"+"新增提示词，长按替换来源提示词）
                        </p>
                        {assistantResults[assistantMode].map((result, index) => (
                          <div key={index} className="result-card-with-action">
                            <div className="result-content">
                              <span className="result-number">#{index + 1}</span>
                              <p className="result-text">{result}</p>
                            </div>
                            <button
                              className="result-add-button"
                              onMouseDown={() => handleAddButtonMouseDown(result)}
                              onMouseUp={() => handleAddButtonMouseUp(result)}
                              onMouseLeave={handleAddButtonMouseLeave}
                              title="单击新增，长按替换"
                            >
                              +
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* polish 和 continue 模式：单个结果，有+按钮 */}
                    {!isGeneratingPrompt && assistantResults[assistantMode]?.length > 0 && (assistantMode === 'polish' || assistantMode === 'continue') && (
                      <div className="prompt-assistant-results-list">
                        <p className="results-header">
                          {assistantMode === 'polish' ? '扩写润色结果（单击"+"新增提示词，长按替换来源提示词）' : '后续分镜提示词（单击"+"新增提示词，长按替换来源提示词）'}
                        </p>
                        <div className="result-card-with-action">
                          <div className="result-content">
                            <p className="result-text">{assistantResults[assistantMode][0]}</p>
                          </div>
                          <button
                            className="result-add-button"
                            onMouseDown={() => handleAddButtonMouseDown(assistantResults[assistantMode][0])}
                            onMouseUp={() => handleAddButtonMouseUp(assistantResults[assistantMode][0])}
                            onMouseLeave={handleAddButtonMouseLeave}
                            title="单击新增，长按替换"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}

                    {/* script 模式：多个分镜，每个有+按钮 */}
                    {!isGeneratingPrompt && assistantResults[assistantMode]?.length > 0 && assistantMode === 'script' && (
                      <div className="prompt-assistant-results-list">
                        <p className="results-header">
                          生成了 {assistantResults[assistantMode].length} 个分镜（单击"+"新增提示词，长按替换来源提示词）
                        </p>
                        {assistantResults[assistantMode].map((result, index) => (
                          <div key={index} className="result-card-with-action">
                            <div className="result-content">
                              <span className="result-number">分镜 {index + 1}</span>
                              <p className="result-text">{result}</p>
                            </div>
                            <button
                              className="result-add-button"
                              onMouseDown={() => handleAddButtonMouseDown(result)}
                              onMouseUp={() => handleAddButtonMouseUp(result)}
                              onMouseLeave={handleAddButtonMouseLeave}
                              title="单击新增，长按替换"
                            >
                              +
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 底部按钮（固定底部） - 只在有结果时显示 */}
                {!isGeneratingPrompt && assistantResults[assistantMode]?.length > 0 && (
                  <div className="prompt-assistant-apply-section">
                    {assistantMode === 'script' ? (
                      <button
                        className="prompt-assistant-apply-button"
                        onClick={downloadScript}
                      >
                        下载分镜脚本
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
