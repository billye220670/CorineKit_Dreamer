/**
 * API 限流中间件
 *
 * 防止 Grok API 被滥用
 */

import rateLimit from 'express-rate-limit';
import { GROK_CONFIG } from '../config/grokConfig.js';

// Grok API 限流器
export const grokRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: GROK_CONFIG.rateLimitPerMinute, // 从配置读取
  message: {
    success: false,
    error: 'API 调用过于频繁，请稍后再试'
  },
  standardHeaders: true, // 在 RateLimit-* 头部返回限流信息
  legacyHeaders: false, // 禁用 X-RateLimit-* 头部
  handler: (req, res) => {
    console.log(`[Rate Limiter] IP ${req.ip} 触发限流`);
    res.status(429).json({
      success: false,
      error: `API 调用过于频繁，每分钟最多 ${GROK_CONFIG.rateLimitPerMinute} 次请求，请稍后再试`
    });
  }
});

console.log(`✅ [Rate Limiter] 限流中间件已加载 - ${GROK_CONFIG.rateLimitPerMinute} 次/分钟`);
