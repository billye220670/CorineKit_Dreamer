/**
 * Session 和 History 管理器
 * 负责会话状态的持久化和历史记录管理
 */

export class SessionManager {
  static SESSION_KEY = 'corineGen_activeSession';
  static HISTORY_KEY = 'corineGen_history';
  static MAX_HISTORY_BATCHES = 50;
  static SESSION_VERSION = 1;

  /**
   * 保存当前会话到 localStorage
   * @param {Object} sessionData - 会话数据
   * @returns {boolean} 是否保存成功
   */
  static saveSession(sessionData) {
    try {
      const minimalSession = this.minimizeSessionData(sessionData);

      localStorage.setItem(this.SESSION_KEY, JSON.stringify({
        ...minimalSession,
        version: this.SESSION_VERSION,
        timestamp: Date.now()
      }));

      return true;
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage 容量不足，尝试清理历史记录');

        // 清理一半的历史记录
        const history = this.loadHistory();
        history.batches = history.batches.slice(-25);  // 只保留 25 个
        this.saveHistory(history);

        // 重试保存
        try {
          localStorage.setItem(this.SESSION_KEY, JSON.stringify({
            ...minimalSession,
            version: this.SESSION_VERSION,
            timestamp: Date.now()
          }));
          return true;
        } catch (retryError) {
          console.error('清理后仍无法保存，放弃保存');
          return false;
        }
      }

      console.error('保存会话失败:', error);
      return false;
    }
  }

  /**
   * 精简会话数据，只保留必要字段
   * 优化：只保留已完成且成功加载的图片，丢弃所有未完成的占位符
   */
  static minimizeSessionData(sessionData) {
    // 1. 过滤占位符：只保留已完成且成功加载的图片
    const completedPlaceholders = sessionData.placeholders.filter(p =>
      p.status === 'completed' && p.imageUrl && p.imageLoadError !== true
    );

    // 2. 精简占位符数据（不保存临时状态字段）
    // 正在高清化的图片重置为标清状态，只保留已完成高清化的结果
    const minimalPlaceholders = completedPlaceholders.map(p => {
      const isUpscaleCompleted = p.upscaleStatus === 'completed';

      return {
        id: p.id,
        status: p.status,
        imageUrl: p.imageUrl,
        filename: p.filename,
        promptId: p.promptId,
        batchId: p.batchId,
        seed: p.seed,
        aspectRatio: p.aspectRatio,
        displayQuality: p.displayQuality,
        // 只有高清化完成的才保留高清图信息
        hqImageUrl: isUpscaleCompleted ? p.hqImageUrl : undefined,
        hqFilename: isUpscaleCompleted ? p.hqFilename : undefined,
        savedParams: p.savedParams,
        // 正在高清化的重置为 none，已完成的保留
        upscaleStatus: isUpscaleCompleted ? 'completed' : 'none',
        upscaleProgress: isUpscaleCompleted ? p.upscaleProgress : 0,
        // 保存下载状态
        isDownloadedSD: p.isDownloadedSD || false,
        isDownloadedHQ: p.isDownloadedHQ || false
        // 不保存 imageLoadError, imageRetryCount, isLoading - 这些是临时状态
      };
    });

    // 3. 返回精简后的会话数据（清空队列和生成状态）
    return {
      sessionId: sessionData.sessionId,
      queue: [],                          // 清空队列
      placeholders: minimalPlaceholders,
      isGenerating: false,                // 重置生成状态
      recoveryState: {                    // 重置恢复状态
        isPaused: false,
        pausedBatchId: null,
        promptId: null,
        pausedIndex: 0,
        totalCount: 0,
        savedParams: null,
        reason: ''
      },
      nextBatchId: sessionData.nextBatchId,  // 保留批次计数器
      submittedTasks: []                  // 清空已提交任务
    };
  }

  /**
   * 检测是否有活跃会话
   * @returns {boolean}
   */
  static hasActiveSession() {
    const session = this.loadSession();
    return session !== null;
  }

  /**
   * 加载会话
   * @returns {Object|null} 会话数据或 null
   */
  static loadSession() {
    try {
      const saved = localStorage.getItem(this.SESSION_KEY);
      if (!saved) return null;

      const session = JSON.parse(saved);

      // 版本检查
      if (session.version !== this.SESSION_VERSION) {
        console.warn('会话版本不匹配，清空会话');
        this.clearSession();
        return null;
      }

      // 数据验证
      if (!this.validateSession(session)) {
        console.error('会话数据不一致，清空会话');
        this.clearSession();
        return null;
      }

      return session;
    } catch (error) {
      console.error('加载会话失败:', error);
      this.clearSession();
      return null;
    }
  }

  /**
   * 验证会话数据的一致性
   */
  static validateSession(session) {
    // 必须字段检查
    if (!session.sessionId || !Array.isArray(session.queue) || !Array.isArray(session.placeholders)) {
      return false;
    }

    // 检查队列中的 batchId 是否都有对应的占位符
    const placeholderBatchIds = new Set(
      session.placeholders.map(p => p.batchId)
    );

    const queueBatchIds = new Set(
      session.queue.map(q => q.batchId)
    );

    const allValid = Array.from(queueBatchIds).every(
      batchId => placeholderBatchIds.has(batchId)
    );

    return allValid;
  }

  /**
   * 清空当前会话
   */
  static clearSession() {
    localStorage.removeItem(this.SESSION_KEY);
  }

  /**
   * 将会话转为历史记录（用户选择"放弃"时调用）
   */
  static saveToHistory(session) {
    // 只保存已完成的占位符
    const completedBatches = this.extractCompletedBatches(session.placeholders);

    completedBatches.forEach(batch => {
      this.addBatchToHistory(batch);
    });

    this.clearSession();
  }

  /**
   * 从占位符中提取已完成的批次
   */
  static extractCompletedBatches(placeholders) {
    // 按 batchId 分组
    const batchGroups = {};

    placeholders.forEach(p => {
      if (p.status === 'completed') {
        if (!batchGroups[p.batchId]) {
          batchGroups[p.batchId] = [];
        }
        batchGroups[p.batchId].push(p);
      }
    });

    // 转换为批次数组
    return Object.entries(batchGroups).map(([batchId, images]) => {
      // 从第一张图片的 savedParams 中获取提示词
      const firstImage = images[0];
      const promptText = firstImage.savedParams?.positivePrompt || '未知提示词';

      return {
        batchId: parseInt(batchId),
        promptId: firstImage.promptId,
        promptText: promptText,
        images: images.map(img => ({
          id: img.id,
          imageUrl: img.imageUrl,
          filename: img.filename,
          seed: img.seed,
          aspectRatio: img.aspectRatio,
          displayQuality: img.displayQuality,
          hqImageUrl: img.hqImageUrl,
          hqFilename: img.hqFilename,
          savedParams: img.savedParams,
          upscaleStatus: img.upscaleStatus,
          upscaleProgress: img.upscaleProgress,
          isDownloadedSD: img.isDownloadedSD || false,
          isDownloadedHQ: img.isDownloadedHQ || false
        }))
      };
    });
  }

  /**
   * 添加单个批次到历史（生成完成时实时调用）
   * @param {Object} batch - 批次数据
   */
  static addBatchToHistory(batch) {
    const history = this.loadHistory();

    // 检查是否已存在（避免重复添加）
    const exists = history.batches.some(b => b.batchId === batch.batchId);
    if (exists) {
      console.log(`批次 ${batch.batchId} 已存在于历史记录中`);
      return;
    }

    history.batches.push({
      ...batch,
      timestamp: Date.now()
    });

    // 自动清理
    if (history.batches.length > this.MAX_HISTORY_BATCHES) {
      history.batches = history.batches.slice(-this.MAX_HISTORY_BATCHES);
    }

    this.saveHistory(history);
  }

  /**
   * 加载历史记录
   * @returns {Object} 历史记录对象
   */
  static loadHistory() {
    try {
      const saved = localStorage.getItem(this.HISTORY_KEY);
      if (!saved) {
        return { version: this.SESSION_VERSION, batches: [] };
      }

      const history = JSON.parse(saved);

      // 版本兼容性处理
      if (history.version !== this.SESSION_VERSION) {
        console.warn('历史记录版本不匹配，重置历史记录');
        return { version: this.SESSION_VERSION, batches: [] };
      }

      return history;
    } catch (error) {
      console.error('加载历史失败:', error);
      return { version: this.SESSION_VERSION, batches: [] };
    }
  }

  /**
   * 保存历史记录
   */
  static saveHistory(history) {
    try {
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error('保存历史失败:', error);
    }
  }

  /**
   * 清空历史记录
   */
  static clearHistory() {
    localStorage.removeItem(this.HISTORY_KEY);
  }

  /**
   * 获取历史记录统计信息
   */
  static getHistoryStats() {
    const history = this.loadHistory();
    const totalBatches = history.batches.length;
    const totalImages = history.batches.reduce((sum, batch) => sum + batch.images.length, 0);

    return {
      totalBatches,
      totalImages,
      oldestTimestamp: history.batches[0]?.timestamp || null,
      newestTimestamp: history.batches[history.batches.length - 1]?.timestamp || null
    };
  }
}
