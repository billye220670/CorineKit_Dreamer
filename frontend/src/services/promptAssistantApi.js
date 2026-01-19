/**
 * 提示词助理 API 客户端
 *
 * 提供与后端 LLM 服务通信的方法
 */

import { API_CONFIG } from '../config/api.js';

/**
 * 生成提示词
 *
 * @param {string} mode - 模式: 'variation' | 'polish' | 'continue' | 'script'
 * @param {string} input - 用户输入的提示词
 * @returns {Promise<{success: boolean, mode: string, data: string[]}>}
 */
export async function generatePrompt(mode, input) {
  try {
    console.log(`[Prompt Assistant API] 调用 ${mode} 模式，输入长度: ${input.length}`);

    const response = await fetch(`${API_CONFIG.baseUrl}/api/prompt-assistant/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mode, input })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[Prompt Assistant API] ${mode} 模式成功，返回 ${result.data?.length || 0} 个结果`);

    return result;
  } catch (error) {
    console.error('[Prompt Assistant API] 请求失败:', error.message);

    // 将错误转换为用户友好的消息
    let userMessage = error.message;

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      userMessage = '无法连接到服务器，请检查网络连接';
    } else if (error.message.includes('429')) {
      userMessage = 'API 调用过于频繁，请稍后再试（每分钟限制 10 次）';
    } else if (error.message.includes('401')) {
      userMessage = 'API 认证失败，请检查服务器配置';
    } else if (error.message.includes('timeout')) {
      userMessage = '请求超时，请稍后重试';
    }

    throw new Error(userMessage);
  }
}

/**
 * 检查提示词助理服务健康状态
 *
 * @returns {Promise<{success: boolean, service: string}>}
 */
export async function checkHealth() {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/api/prompt-assistant/health`);
    return await response.json();
  } catch (error) {
    console.error('[Prompt Assistant API] 健康检查失败:', error);
    return { success: false, service: 'prompt-assistant' };
  }
}
