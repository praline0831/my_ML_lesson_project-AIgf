import cors from "cors";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { createAgent } from "@agent/runtime";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const agent = createAgent({ verbose: false });

/** 健康检查 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gateway" });
});

/** 根路径 */
app.get("/", (_req, res) => {
  res.json({
    name: "@agent/gateway",
    endpoints: {
      health: "GET /health",
      chat: "POST /chat { \"message\": \"...\" }",
      websocket: "ws://localhost:PORT (echo)",
    },
  });
});

/** Agent 对话：接收用户消息，返回 AI 回复 */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "请提供 message 字符串" });
      return;
    }
    const result = await agent.run(message.trim());
    res.json({
      reply: result.finalOutput,
      steps: result.steps,
      error: result.error,
    });
  } catch (err) {
    console.error("[Gateway] /chat 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * 创建并启动 HTTP + WebSocket 服务
 */
export function startServer(port: number): Promise<void> {
  const server = createServer(app);

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("[Gateway] WebSocket 客户端已连接");
    ws.on("message", (data) => {
      const text = data.toString();
      ws.send(`Echo: ${text}`);
    });
    ws.on("close", () => {
      console.log("[Gateway] WebSocket 客户端已断开");
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`端口 ${port} 已被占用，请先关闭占用该端口的程序，或设置环境变量 PORT=其他端口 后重试。`));
      } else {
        reject(err);
      }
    });
    server.listen(port, () => resolve());
  });
}
