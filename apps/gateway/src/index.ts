/**
 * Gateway 入口：启动 HTTP + WebSocket 服务
 */
import { startServer } from "./server.js";

const PORT = Number(process.env.PORT) || 4000;

startServer(PORT)
  .then(() => {
    console.log(`[Gateway] 已启动 http://localhost:${PORT}`);
    console.log(`[Gateway] 健康检查 GET /health`);
    console.log(`[Gateway] WebSocket 连接 ws://localhost:${PORT}`);
  })
  .catch((err) => {
    console.error("[Gateway] 启动失败:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
