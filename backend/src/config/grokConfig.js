/**
 * Grok API 配置模块
 *
 * 从环境变量读取配置并验证必需参数
 */

export const GROK_CONFIG = {
  baseURL: process.env.GROK_API_BASE_URL || 'https://api.jiekou.ai/openai',
  apiKey: process.env.GROK_API_KEY,
  model: process.env.GROK_MODEL || 'grok-4-1-fast-reasoning',
  maxTokens: parseInt(process.env.GROK_MAX_TOKENS) || 1000000,
  rateLimitPerMinute: parseInt(process.env.GROK_RATE_LIMIT_PER_MINUTE) || 10
};

// 验证必需配置
if (!GROK_CONFIG.apiKey) {
  console.error('❌ [Grok Config Error] GROK_API_KEY 环境变量未设置');
  console.error('请在 backend/.env 文件中配置 GROK_API_KEY');
  process.exit(1);
}

console.log('✅ [Grok Config] 配置加载成功');
console.log(`   - Base URL: ${GROK_CONFIG.baseURL}`);
console.log(`   - Model: ${GROK_CONFIG.model}`);
console.log(`   - Max Tokens: ${GROK_CONFIG.maxTokens}`);
console.log(`   - Rate Limit: ${GROK_CONFIG.rateLimitPerMinute} 次/分钟`);
