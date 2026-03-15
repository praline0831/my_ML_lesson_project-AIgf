import { useState } from "react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4000";

interface Message {
  role: "user" | "assistant";
  content: string;
  error?: string;
}

export function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", error: data.error ?? "请求失败" },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply ?? "",
          error: data.error,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          error: e instanceof Error ? e.message : "网络错误",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>Agent 对话</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        与后端 Agent 对话（Gateway → Runtime）
      </p>
      <div style={{ marginBottom: 16 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 8,
              background: msg.role === "user" ? "#e3f2fd" : "#f5f5f5",
            }}
          >
            <strong>{msg.role === "user" ? "你" : "Agent"}:</strong>
            {msg.error ? (
              <span style={{ color: "#c62828" }}>{msg.error}</span>
            ) : (
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{msg.content}</div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ color: "#666", marginBottom: 8 }}>思考中…</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="输入消息…"
          style={{ flex: 1, padding: 10, fontSize: 14, borderRadius: 6, border: "1px solid #ccc" }}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: "10px 20px",
            fontSize: 14,
            borderRadius: 6,
            border: "none",
            background: loading ? "#ccc" : "#1976d2",
            color: "#fff",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
