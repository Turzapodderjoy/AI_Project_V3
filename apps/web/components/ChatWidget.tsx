"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant" | "agent";
  content: string;
  provider?: string;
  tokens?: number;
  confidence?: number;
  cached?: boolean;
}

function getSessionId(businessId: string): string {
  const key = `chatSessionId:${businessId}`;
  const existing = window.localStorage.getItem(key);

  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  window.localStorage.setItem(key, generated);
  return generated;
}

export function ChatWidget({ businessId = "default" }: { businessId?: string }) {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const seenCount = useRef(0);

  useEffect(() => {
    setSessionId(getSessionId(businessId));
  }, [businessId]);

  // Once a human handoff happens, poll for the agent's replies — the
  // server can't push to the browser without a websocket, so this is
  // the simplest thing that works for a first version.
  useEffect(() => {
    if (!waitingForAgent || !sessionId) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/chat/messages?sessionId=${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      const history: { role: string; content: string }[] = data.messages ?? [];
      const agentMessages = history.filter((m) => m.role === "agent");

      if (agentMessages.length > seenCount.current) {
        const newOnes = agentMessages.slice(seenCount.current);
        seenCount.current = agentMessages.length;
        setMessages((prev) => [
          ...prev,
          ...newOnes.map((m) => ({ role: "agent" as const, content: m.content })),
        ]);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [waitingForAgent, sessionId]);

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
        body: JSON.stringify({ sessionId, message, businessId }),
      });

      const data = await res.json();

      if (res.ok && data.handoff) {
        setWaitingForAgent(true);
      }

      setMessages((prev) => [
        ...prev,
        res.ok
          ? {
              role: "assistant",
              content: data.answer,
              provider: data.provider,
              tokens: data.tokens,
              confidence: data.confidence,
              cached: data.cached,
            }
          : { role: "assistant", content: `Error: ${data.detail ?? data.error}` },
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
      <p style={{ opacity: 0.5, fontSize: 12 }}>
        Chat ID: {sessionId}
        {waitingForAgent && " · connected to a human agent"}
      </p>

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
            <div>
              <strong>
                {m.role === "user" ? "You" : m.role === "agent" ? "Agent" : "Assistant"}:
              </strong>{" "}
              {m.content}
            </div>
            {m.role === "assistant" && m.provider && (
              <div style={{ fontSize: 11, opacity: 0.5 }}>
                {m.provider}
                {m.cached && " (cached, 0 tokens)"} ·{" "}
                {Math.round((m.confidence ?? 0) * 100)}% confidence ·{" "}
                {m.tokens} tokens
              </div>
            )}
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
