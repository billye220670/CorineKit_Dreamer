// 首先加载环境变量（必须在所有导入之前）
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { setupWSProxy } from './proxy/wsProxy.js';
import promptController from './controllers/promptController.js';
import { grokRateLimiter } from './middleware/rateLimiter.js';

const app = express();
const server = http.createServer(app);

const COMFYUI_HOST = process.env.COMFYUI_HOST || 'http://127.0.0.1:8188';
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

// CORS 配置
app.use(cors({
  origin: (origin, callback) => {
    // 允许无 origin 的请求（如 curl）或白名单中的域名
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    comfyui: COMFYUI_HOST,
    timestamp: new Date().toISOString()
  });
});

// 处理 multipart/form-data 的代理配置（图片上传）
const uploadProxy = createProxyMiddleware({
  target: COMFYUI_HOST,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  onError: (err, req, res) => {
    console.error('Upload proxy error:', err);
    res.status(502).json({ error: 'ComfyUI connection failed', message: err.message });
  }
});

// 处理 JSON 请求的代理配置
const jsonProxy = createProxyMiddleware({
  target: COMFYUI_HOST,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  onProxyReq: (proxyReq, req) => {
    // 对于有 body 的 POST/PUT 请求，需要重新写入 body
    if (req.body && Object.keys(req.body).length > 0 && req.method !== 'GET') {
      const bodyData = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    }
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(502).json({ error: 'ComfyUI connection failed', message: err.message });
  }
});

// 图片上传路由（不解析 body）
app.use('/api/upload', uploadProxy);

// 其他 API 路由（需要解析 JSON body）
app.use(express.json({ limit: '50mb' }));

// 提示词助理 API（在代理之前注册，避免被代理拦截）
app.post(
  '/api/prompt-assistant/generate',
  grokRateLimiter,
  (req, res) => promptController.generate(req, res)
);

app.get('/api/prompt-assistant/health', (req, res) => {
  res.json({ success: true, service: 'prompt-assistant', timestamp: new Date().toISOString() });
});

// ComfyUI 代理路由（放在最后，作为兜底）
app.use('/api', jsonProxy);

// 设置 WebSocket 代理
const wss = new WebSocketServer({ server, path: '/ws' });
setupWSProxy(wss, COMFYUI_HOST);

// 启动服务器
// 监听 0.0.0.0 以允许外部访问（花生壳穿透需要）
server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('CorineGen Backend Server');
  console.log('='.repeat(50));
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Proxying to ComfyUI at ${COMFYUI_HOST}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
  console.log('='.repeat(50));
});
