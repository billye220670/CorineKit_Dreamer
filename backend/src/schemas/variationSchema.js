/**
 * 变体生成 JSON Schema
 *
 * 用于结构化输出，确保 variation 模式返回统一格式的数据
 */

export const VARIATION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'prompt_variations_schema',
    schema: {
      type: 'object',
      properties: {
        variations: {
          type: 'array',
          description: '提示词变体列表',
          items: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: '完整的提示词文本'
              },
              changes: {
                type: 'string',
                description: '相对原提示词的主要变化说明（可选）'
              }
            },
            required: ['prompt']
          },
          minItems: 3,
          maxItems: 5
        }
      },
      required: ['variations']
    }
  }
};
