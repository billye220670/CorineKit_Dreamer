/**
 * 剧本生成 JSON Schema
 *
 * 用于结构化输出，确保 script 模式返回统一格式的数据
 */

export const SCRIPT_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'script_schema',
    schema: {
      type: 'object',
      properties: {
        shots: {
          type: 'array',
          description: '分镜列表',
          items: {
            type: 'object',
            properties: {
              shot_number: {
                type: 'integer',
                description: '分镜编号（从 1 开始）'
              },
              prompt: {
                type: 'string',
                description: '该分镜的完整提示词'
              },
              description: {
                type: 'string',
                description: '分镜场景简要描述（可选）'
              }
            },
            required: ['shot_number', 'prompt']
          }
        },
        total_shots: {
          type: 'integer',
          description: '总分镜数'
        }
      },
      required: ['shots', 'total_shots']
    }
  }
};
