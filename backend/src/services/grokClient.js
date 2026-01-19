/**
 * Grok API 客户端
 *
 * 使用 OpenAI SDK 调用 JieKou AI 的 Grok API
 */

import OpenAI from 'openai';
import { GROK_CONFIG } from '../config/grokConfig.js';

class GrokClient {
  constructor() {
    this.client = new OpenAI({
      baseURL: GROK_CONFIG.baseURL,
      apiKey: GROK_CONFIG.apiKey,
      timeout: 60000, // 60秒超时
      maxRetries: 2,  // 自动重试2次
    });
    this.model = GROK_CONFIG.model;
  }

  /**
   * 调用 Grok API（非流式）
   *
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户输入
   * @param {object} options - 可选参数
   * @returns {Promise<string>} - 生成的文本
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    const {
      temperature = 1,
      max_tokens = GROK_CONFIG.maxTokens,
      top_k = 50,
      min_p = 0,
      presence_penalty = 0,
      frequency_penalty = 0,
      response_format = { type: 'text' }
    } = options;

    try {
      console.log(`[Grok Client] 调用 API - 模型: ${this.model}, temperature: ${temperature}`);

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        temperature,
        max_tokens,
        top_k,
        min_p,
        presence_penalty,
        frequency_penalty,
        response_format
      });

      const content = completion.choices[0].message.content;
      console.log(`[Grok Client] API 调用成功，返回长度: ${content.length} 字符`);

      return content;
    } catch (error) {
      console.error('[Grok Client] API 调用失败:', error.message);

      // 提供更友好的错误信息
      if (error.status === 401) {
        throw new Error('API Key 无效，请检查 GROK_API_KEY 配置');
      } else if (error.status === 429) {
        throw new Error('API 调用频率超限，请稍后再试');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('无法连接到 Grok API，请检查网络连接');
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error('API 请求超时，请稍后重试');
      } else if (error.code === 'ECONNRESET') {
        throw new Error('连接被重置，请稍后重试');
      } else if (error.message && error.message.includes('timeout')) {
        throw new Error('请求超时，请稍后重试');
      }

      throw new Error(`Grok API 调用失败: ${error.message}`);
    }
  }

  /**
   * 调用 Grok API（流式）
   *
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户输入
   * @param {function} onChunk - 接收到 chunk 的回调函数
   * @param {object} options - 可选参数
   */
  async generateStream(systemPrompt, userPrompt, onChunk, options = {}) {
    const {
      temperature = 1,
      max_tokens = GROK_CONFIG.maxTokens,
      top_k = 50,
      min_p = 0,
      presence_penalty = 0,
      frequency_penalty = 0
    } = options;

    try {
      console.log(`[Grok Client] 流式调用 API - 模型: ${this.model}`);

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: true,
        temperature,
        max_tokens,
        top_k,
        min_p,
        presence_penalty,
        frequency_penalty
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          onChunk(content);
        }
        if (chunk.choices[0]?.finish_reason) {
          onChunk(null, chunk.choices[0].finish_reason);
          console.log(`[Grok Client] 流式调用完成: ${chunk.choices[0].finish_reason}`);
        }
      }
    } catch (error) {
      console.error('[Grok Client] 流式调用失败:', error.message);
      throw new Error(`Grok API 流式调用失败: ${error.message}`);
    }
  }
}

export default new GrokClient();
