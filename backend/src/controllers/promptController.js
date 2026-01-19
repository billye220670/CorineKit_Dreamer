/**
 * 提示词助理控制器
 *
 * 处理 4 种模式的提示词生成请求
 */

import grokClient from '../services/grokClient.js';
import { SYSTEM_PROMPTS } from '../config/systemPrompts.js';
import { VARIATION_SCHEMA } from '../schemas/variationSchema.js';
import { SCRIPT_SCHEMA } from '../schemas/scriptSchema.js';

class PromptController {
  /**
   * 生成提示词（统一处理入口）
   */
  async generate(req, res) {
    const { mode, input } = req.body;

    // 参数验证
    if (!mode || !input) {
      console.log('[PromptController] 参数验证失败: 缺少 mode 或 input');
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: mode 和 input'
      });
    }

    if (!['variation', 'polish', 'continue', 'script'].includes(mode)) {
      console.log(`[PromptController] 参数验证失败: 无效的 mode=${mode}`);
      return res.status(400).json({
        success: false,
        error: '无效的 mode 值，必须是: variation, polish, continue, script'
      });
    }

    console.log(`[PromptController] 收到请求 - 模式: ${mode}, 输入长度: ${input.length}`);

    try {
      let result;

      switch (mode) {
        case 'variation':
          result = await this.generateVariations(input);
          break;
        case 'polish':
          result = await this.polishPrompt(input);
          break;
        case 'continue':
          result = await this.continueStory(input);
          break;
        case 'script':
          result = await this.generateScript(input);
          break;
      }

      console.log(`[PromptController] 生成成功 - 返回 ${result.length} 个结果`);

      res.json({
        success: true,
        mode,
        data: result
      });
    } catch (error) {
      console.error('[PromptController] 生成失败:', error.message);
      res.status(500).json({
        success: false,
        error: error.message || 'API 调用失败'
      });
    }
  }

  /**
   * 生成变体（结构化输出）
   */
  async generateVariations(input) {
    console.log('[PromptController] 生成变体模式');

    const systemPrompt = SYSTEM_PROMPTS.variation;

    const response = await grokClient.generate(
      systemPrompt,
      input,
      {
        temperature: 1.2,  // 提高创造性
        response_format: VARIATION_SCHEMA
      }
    );

    try {
      const parsed = JSON.parse(response);
      const prompts = parsed.variations.map(v => v.prompt);
      console.log(`[PromptController] 解析成功，生成 ${prompts.length} 个变体`);
      return prompts;
    } catch (parseError) {
      console.error('[PromptController] JSON 解析失败:', parseError.message);
      console.error('[PromptController] 原始响应:', response);
      throw new Error('API 返回数据格式错误');
    }
  }

  /**
   * 润色扩写（文本输出）
   */
  async polishPrompt(input) {
    console.log('[PromptController] 扩写润色模式');

    const systemPrompt = SYSTEM_PROMPTS.polish;

    const response = await grokClient.generate(
      systemPrompt,
      input,
      {
        temperature: 0.8  // 适度创造性
      }
    );

    return [response.trim()];  // 返回数组格式保持一致
  }

  /**
   * 脑补后续（文本输出）
   */
  async continueStory(input) {
    console.log('[PromptController] 脑补后续模式');

    const systemPrompt = SYSTEM_PROMPTS.continue;

    const response = await grokClient.generate(
      systemPrompt,
      input,
      {
        temperature: 1.0
      }
    );

    return [response.trim()];
  }

  /**
   * 生成剧本（结构化输出）
   */
  async generateScript(input) {
    console.log('[PromptController] 生成剧本模式');

    const systemPrompt = SYSTEM_PROMPTS.script;

    const response = await grokClient.generate(
      systemPrompt,
      input,
      {
        temperature: 1.0,
        response_format: SCRIPT_SCHEMA
      }
    );

    try {
      const parsed = JSON.parse(response);
      const prompts = parsed.shots.map(shot => shot.prompt);
      console.log(`[PromptController] 解析成功，生成 ${prompts.length} 个分镜`);
      return prompts;
    } catch (parseError) {
      console.error('[PromptController] JSON 解析失败:', parseError.message);
      console.error('[PromptController] 原始响应:', response);
      throw new Error('API 返回数据格式错误');
    }
  }
}

export default new PromptController();
