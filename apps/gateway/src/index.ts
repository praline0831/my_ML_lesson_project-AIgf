/**
 * Gateway 入口：启动 HTTP + WebSocket 服务
 */
// 加载根目录的 .env 文件中的环境变量
import dotenv from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// 获取当前文件的目录路径（ES module 方式）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 从项目根目录加载 .env（相对于 apps/gateway/src 向上两级）
dotenv.config({ path: resolve(__dirname, "../../../.env") });

import { startServer } from "./server.js";

const PORT = Number(process.env.PORT) || 4000;

startServer(PORT)
  .then(() => {
    console.log(`[Gateway] 已启动 http://localhost:${PORT}`);
    console.log(`[Gateway] 健康检查 GET /health`);
    console.log(`[Gateway] WebSocket 连接 ws://localhost:${PORT}`);
    if (process.env.GITHUB_TOKEN) {
      console.log(`[Gateway] ✅ GitHub Token 已配置（速率限制: 5000 次/小时）`);
    } else {
      console.warn(`[Gateway] ⚠️ 未配置 GITHUB_TOKEN（速率限制: 60 次/小时）`);
    }
  })
  .catch((err) => {
    console.error("[Gateway] 启动失败:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
