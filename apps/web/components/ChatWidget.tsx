"use client";

import { useEffect, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function getSessionId(): string {
  const existing = window.localStorage.getItem("chatSessionId");

  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  window.localStorage.setItem("chatSessionId", generated);
  return generated;
}

export function ChatWidget() {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  async function send() {
    const message = input.trim();
    if (!message || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.ok ? data.answer : `Error: ${data.detail ?? data.error}`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 8,
          minHeight: 280,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <p style={{ opacity: 0.6 }}>
            Upload a document, then ask a question about it here.
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            <strong>{m.role === "user" ? "You" : "Assistant"}:</strong>{" "}
            {m.content}
          </div>
        ))}

        {loading && <div style={{ opacity: 0.6 }}>Thinking…</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Ask something…"
        />
        <button onClick={send} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}
