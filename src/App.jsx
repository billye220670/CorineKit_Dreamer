import React, { useState, useRef, useEffect } from 'react';
import Masonry from 'react-masonry-css';
import './App.css';
import workflowTemplate from '../CorineGen.json';
import upscaleTemplate from '../ImageUpscaleAPI.json';

const COMFYUI_API = 'http://127.0.0.1:8188';
const COMFYUI_WS = 'ws://127.0.0.1:8188/ws';

// 生成唯一的客户端ID
const generateClientId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

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
  const [aspectRatio, setAspectRatio] = useState(() => loadFromStorage('corineGen_aspectRatio', 'square'));
  const [seedMode, setSeedMode] = useState(() => loadFromStorage('corineGen_seedMode', 'random'));
  const [fixedSeed, setFixedSeed] = useState(() => loadFromStorage('corineGen_fixedSeed', ''));
  const [firstFixedSeed, setFirstFixedSeed] = useState(() => loadFromStorage('corineGen_firstFixedSeed', ''));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageGroups, setGeneratedImageGroups] = useState([]); // 按提示词分组的图像
  const [imagePlaceholders, setImagePlaceholders] = useState([]); // 骨架占位
  const [error, setError] = useState('');
  const [themeHue, setThemeHue] = useState(() => loadFromStorage('corineGen_themeHue', 270));
  const [themeBgSaturation, setThemeBgSaturation] = useState(() => loadFromStorage('corineGen_themeBgSaturation', 60));
  const [themeBgLightness, setThemeBgLightness] = useState(() => loadFromStorage('corineGen_themeBgLightness', 8));
  const [showThemePicker, setShowThemePicker] = useState(false); // 显示颜色选择器
  const [viewMode, setViewMode] = useState(() => loadFromStorage('corineGen_viewMode', 'medium')); // small, medium, large
  const firstSeedRef = useRef(null);

  // 计算下一个提示词ID
  const savedPromptsForId = loadFromStorage('corineGen_prompts', [{ id: 1 }]);
  const nextPromptId = useRef(Math.max(...savedPromptsForId.map(p => p.id)) + 1);

  const nextBatchId = useRef(1); // 批次计数器，确保每个批次有唯一ID
  const isUpscalingRef = useRef(false); // 同步跟踪高清化状态，避免竞态条件
  const upscaleQueueRef = useRef([]); // 同步跟踪高清化队列，避免状态更新延迟
  const generationQueueRef = useRef([]); // 同步跟踪生成队列，避免状态更新延迟
  const imagePlaceholdersRef = useRef([]); // 同步跟踪占位符，避免闭包陷阱

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

  // 获取图像尺寸
  const getImageDimensions = () => {
    switch (aspectRatio) {
      case 'portrait':
        return { width: 720, height: 1280 };
      case 'landscape':
        return { width: 1280, height: 720 };
      case 'square':
      default:
        return { width: 1024, height: 1024 };
    }
  };

  // 获取图像比例（用于网格布局）
  const getAspectRatioValue = () => {
    switch (aspectRatio) {
      case 'portrait':
        return 720 / 1280; // 0.5625
      case 'landscape':
        return 1280 / 720; // 1.778
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
  const buildWorkflow = (promptText, actualBatchSize = null) => {
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));
    const dimensions = getImageDimensions();
    const seed = getSeed();

    // 处理prompt：如果缺少yjy触发词，自动添加
    let processedPrompt = promptText || '超高清画质。';
    if (!processedPrompt.toLowerCase().includes('yjy')) {
      processedPrompt = 'yjy，中国女孩，' + processedPrompt;
    }

    // 更新prompt
    workflow['5'].inputs.text = processedPrompt;

    // 更新种子
    workflow['4'].inputs.seed = seed;

    // 更新steps
    workflow['4'].inputs.steps = steps;

    // 更新图像尺寸
    workflow['7'].inputs.width = dimensions.width;
    workflow['7'].inputs.height = dimensions.height;

    // 在循环模式下，每次只生成1张；批次模式下使用用户选择的数量
    const batchCount = actualBatchSize !== null ? actualBatchSize : (batchMethod === 'loop' ? 1 : batchSize);
    workflow['7'].inputs.batch_size = batchCount;

    // RepeatLatentBatch的amount设置为1，避免批次数量被平方
    workflow['44'].inputs.amount = 1;

    return { workflow, seed };
  };

  // 生成单个提示词的图像
  const generateForPrompt = async (promptId, promptText, batchId = null) => {
    if (!promptText.trim()) {
      setError('请输入提示词');
      return;
    }

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
      placeholders = Array.from({ length: totalImages }, (_, index) => ({
        id: `${promptId}-${finalBatchId}-${index}`,
        status: 'queue',
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
        aspectRatio: currentAspectRatio // 保存当前图像比例
      }));

      // 先更新ref（同步），再更新state（异步）
      const updated = [...imagePlaceholdersRef.current, ...placeholders];
      imagePlaceholdersRef.current = updated;
      setImagePlaceholders(updated);
    }

    try {
      if (batchMethod === 'batch') {
        await generateBatch(promptId, promptText, placeholders, finalBatchId);
      } else {
        await generateLoop(promptId, promptText, placeholders, finalBatchId);
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

  // 处理队列
  const processQueue = () => {
    if (generationQueueRef.current.length === 0) {
      setIsGenerating(false);
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
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt || !prompt.text.trim()) {
      setError('请输入提示词');
      return;
    }

    // 立即创建骨架占位符
    const batchId = nextBatchId.current++;
    const totalImages = batchSize;
    const currentAspectRatio = getAspectRatioValue();
    const placeholders = Array.from({ length: totalImages }, (_, index) => ({
      id: `${promptId}-${batchId}-${index}`,
      status: 'queue',
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
      aspectRatio: currentAspectRatio // 保存当前图像比例
    }));

    // 先更新ref（同步），再更新state（异步）
    const updated = [...imagePlaceholdersRef.current, ...placeholders];
    imagePlaceholdersRef.current = updated;
    setImagePlaceholders(updated);

    if (!isGenerating) {
      // 队列为空，直接开始
      setIsGenerating(true);
      generateForPrompt(promptId, prompt.text, batchId);
    } else {
      // 添加到队列
      generationQueueRef.current = [...generationQueueRef.current, { promptId, promptText: prompt.text, batchId }];
      setGenerationQueue(generationQueueRef.current);
    }
  };

  // 生成所有提示词 - 简单触发每个提示词的→按钮
  const generateAll = () => {
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
  const generateBatch = async (promptId, promptText, placeholders, batchId) => {
    const clientId = generateClientId();
    let ws = null;
    let timeoutId = null;

    try {
      const { workflow, seed } = buildWorkflow(promptText);

      // 保存种子到所有batchId的占位符
      updateImagePlaceholders(prev => prev.map(p =>
        p.batchId === batchId ? { ...p, seed } : p
      ));

      // 创建WebSocket连接
      ws = new WebSocket(`${COMFYUI_WS}?clientId=${clientId}`);

      ws.onopen = () => {};

      ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
        setError('WebSocket连接失败');
        setIsGenerating(false);
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

          // 进度更新消息 - 批次模式下所有图片共享进度
          if (type === 'progress') {
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
              const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`);
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
                        url: `${COMFYUI_API}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`,
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
                  updateImagePlaceholders(prev => prev.map(p =>
                    p.batchId === batchId ? { ...p, status: 'completed' } : p
                  ));
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
      throw err;
    }
  };

  // 工作流循环执行模式
  const generateLoop = async (promptId, promptText, placeholders, batchId) => {
    for (let i = 0; i < batchSize; i++) {
      // 每次循环前检查该batchId下是否还有queue状态的占位符

      // 使用ref读取最新的占位符状态
      const queuedPlaceholders = imagePlaceholdersRef.current.filter(p => p.batchId === batchId && p.status === 'queue');

      let targetPlaceholder = null;
      if (queuedPlaceholders.length === 0) {
        targetPlaceholder = null;
      } else {
        targetPlaceholder = queuedPlaceholders[0];
      }

      // 如果没有queue状态的占位符了，结束循环
      if (!targetPlaceholder) {
        break;
      }

      const clientId = generateClientId();
      let ws = null;
      let timeoutId = null;

      try {
        const { workflow, seed } = buildWorkflow(promptText, 1);

        // 保存种子到当前占位符
        updateImagePlaceholders(prev => prev.map(p =>
          p.id === targetPlaceholder.id ? { ...p, seed } : p
        ));

        // 创建WebSocket连接
        ws = new WebSocket(`${COMFYUI_WS}?clientId=${clientId}`);

        await new Promise((resolve, reject) => {
          ws.onopen = () => {
            resolve();
          };

          ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            reject(new Error('WebSocket连接失败'));
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

              // 进度更新消息 - 更新当前图片的进度
              if (type === 'progress') {
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
                  // 获取生成的图像
                  const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`);
                  const history = await historyResponse.json();

                  if (history[prompt_id] && history[prompt_id].outputs) {
                    const outputs = history[prompt_id].outputs;

                    for (const nodeId in outputs) {
                      if (outputs[nodeId].images && outputs[nodeId].images[0]) {
                        const img = outputs[nodeId].images[0];
                        const imageUrl = `${COMFYUI_API}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`;

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
                          updateImagePlaceholders(prev =>
                            prev.map(p =>
                              p.id === targetPlaceholder.id ? { ...p, status: 'completed' } : p
                            )
                          );
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
        if (ws) ws.close();
        if (timeoutId) clearTimeout(timeoutId);
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
      ws = new WebSocket(`${COMFYUI_WS}?clientId=${clientId}`);

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
                const historyResponse = await fetch(`${COMFYUI_API}/history/${prompt_id}`);
                const history = await historyResponse.json();

                if (history[prompt_id] && history[prompt_id].outputs) {
                  const outputs = history[prompt_id].outputs;

                  for (const nodeId in outputs) {
                    if (outputs[nodeId].images && outputs[nodeId].images[0]) {
                      const img = outputs[nodeId].images[0];
                      const hqImageUrl = `${COMFYUI_API}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`;

                      // 更新占位符，替换为高清图片
                      updateImagePlaceholders(prev => prev.map(p =>
                        p.id === placeholderId ? {
                          ...p,
                          upscaleStatus: 'completed',
                          upscaleProgress: 100,
                          hqImageUrl: hqImageUrl,
                          hqFilename: img.filename,
                          imageUrl: hqImageUrl // 替换原图
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
    if (!isUpscalingRef.current) {
      // 队列为空，直接开始
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

  return (
    <div className="app" style={{
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
      '--theme-text': `hsl(${themeHue}, 70%, 92%)`,
    }}>
      <div className="container">
        {/* 视图和主题按钮 */}
        <div className="theme-button-container">
          <button
            className="view-toggle-button"
            onClick={toggleViewMode}
            title={`当前视图: ${viewMode === 'small' ? '小' : viewMode === 'medium' ? '中' : '大'}`}
          >
            {getViewIcon()}
          </button>
          <button
            className="theme-button"
            onClick={() => setShowThemePicker(!showThemePicker)}
            title="更改主题颜色"
          >
            🎨
          </button>
          {showThemePicker && (
            <div className="theme-picker">
              <label className="theme-picker-label">主题色相</label>
              <input
                type="range"
                min="0"
                max="360"
                value={themeHue}
                onChange={(e) => setThemeHue(parseInt(e.target.value))}
                className="theme-slider"
              />

              <label className="theme-picker-label" style={{ marginTop: '12px' }}>背景饱和度</label>
              <input
                type="range"
                min="0"
                max="100"
                value={themeBgSaturation}
                onChange={(e) => setThemeBgSaturation(parseInt(e.target.value))}
                className="theme-saturation-slider"
              />

              <label className="theme-picker-label" style={{ marginTop: '12px' }}>背景亮度</label>
              <input
                type="range"
                min="0"
                max="30"
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

        <h1 className="title">✨ CorineGen 图像生成器</h1>

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
                <div className="textarea-wrapper">
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

                  {/* 发送按钮 - 始终显示在右下角 */}
                  <button
                    className="send-prompt-button"
                    onClick={() => queueGeneration(promptItem.id)}
                    disabled={!promptItem.text.trim()}
                    title="发送生成"
                  >
                    →
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
              disabled={isGenerating}
            >
              → 全部生成
            </button>
          </div>

          {/* 高级设置折叠栏 */}
          <details className="advanced-settings">
            <summary className="advanced-settings-summary">高级设置</summary>
            <div className="advanced-settings-content">
              {/* 批次数量 */}
              <div className="form-group">
                <label className="label">批次数量</label>
                <div className="radio-group">
                  {[1, 2, 4, 8, 16].map((size) => (
                    <label key={size} className="radio-label">
                      <input
                        type="radio"
                        name="batchSize"
                        value={size}
                        checked={batchSize === size}
                        onChange={() => setBatchSize(size)}
                        disabled={isGenerating}
                      />
                      <span>{size}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 批次方法 */}
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
                      disabled={isGenerating}
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
                      disabled={isGenerating}
                    />
                    <span>工作流循环执行</span>
                  </label>
                </div>
              </div>

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
                  disabled={isGenerating}
                />
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
                      disabled={isGenerating}
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
                      disabled={isGenerating}
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
                      disabled={isGenerating}
                    />
                    <span>Landscape (16:9)</span>
                  </label>
                </div>
              </div>

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
                      disabled={isGenerating}
                    />
                    <span>随机</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="seedMode"
                      value="fixed"
                      checked={seedMode === 'fixed'}
                      onChange={() => setSeedMode('fixed')}
                      disabled={isGenerating}
                    />
                    <span>固定</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="seedMode"
                      value="first-fixed"
                      checked={seedMode === 'first-fixed'}
                      onChange={() => setSeedMode('first-fixed')}
                      disabled={isGenerating}
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
                    disabled={isGenerating}
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
                    disabled={isGenerating}
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

          {/* 错误信息 */}
          {error && <div className="error">{error}</div>}
        </div>

        {/* 图像展示区域 - 骨架占位图 */}
        <div className="images-container">
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
                    className="image-placeholder"
                    style={{ '--item-aspect-ratio': placeholder.aspectRatio || 1 }}
                  >
                    <div className="skeleton">
                      {/* 背景图片 */}
                      {(placeholder.status === 'revealing' || placeholder.status === 'completed') && placeholder.imageUrl && (
                        <img
                          src={placeholder.imageUrl}
                          alt={`Generated ${placeholder.id}`}
                          onClick={() => placeholder.status === 'completed' && downloadImage(placeholder.imageUrl, placeholder.hqFilename || placeholder.filename)}
                          className={`generated-image ${placeholder.status === 'revealing' || placeholder.status === 'completed' ? 'revealing' : ''} ${placeholder.upscaleStatus === 'upscaling' ? 'upscaling-blur' : ''}`}
                          style={{ pointerEvents: placeholder.status === 'completed' ? 'auto' : 'none' }}
                          draggable={placeholder.status === 'completed' && placeholder.seed !== null}
                          onDragStart={(e) => {
                            if (placeholder.status === 'completed' && placeholder.seed !== null) {
                              e.dataTransfer.setData('seed', placeholder.seed.toString());
                            }
                          }}
                        />
                      )}
                      {/* 取消按钮 - 仅在queue状态显示 */}
                      {placeholder.status === 'queue' && (
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
                        <button
                          className={`hq-button ${placeholder.upscaleStatus === 'completed' ? 'completed' : ''} ${placeholder.upscaleStatus === 'upscaling' ? 'disabled' : ''} ${placeholder.upscaleStatus === 'queued' ? 'queued' : ''}`}
                          onClick={() => {
                            if (placeholder.upscaleStatus === 'none') {
                              queueUpscale(placeholder.id);
                            } else if (placeholder.upscaleStatus === 'queued') {
                              cancelUpscaleTask(placeholder.id);
                            }
                          }}
                          disabled={placeholder.upscaleStatus === 'upscaling'}
                          title={
                            placeholder.upscaleStatus === 'completed' ? '已完成高清化' :
                            placeholder.upscaleStatus === 'queued' ? '点击取消高清化' :
                            placeholder.upscaleStatus === 'upscaling' ? '高清化中...' :
                            '点击高清化'
                          }
                        >
                          {placeholder.upscaleStatus === 'completed' ? 'HQ Done' :
                           placeholder.upscaleStatus === 'queued' ? 'Cancel HQ' :
                           'HQ'}
                        </button>
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
                          <div className="skeleton-text">
                            {placeholder.status === 'queue' ? 'Queue' :
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
              <div className="empty-icon">🖼️</div>
              <p className="empty-text">生成的图像将在这里显示</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
