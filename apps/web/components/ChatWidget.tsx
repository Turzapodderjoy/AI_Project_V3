"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant" | "agent";
  content: string;
  provider?: string;
  tokens?: number;
  confidence?: number;
  cached?: boolean;
  /** The persisted assistant Message's id — absent for the "waiting on a
   * human agent" notice and for client-side error messages, neither of
   * which is a real recorded answer worth QA'ing. */
  messageId?: string;
}

interface QaState {
  /** Locally selected, not yet sent — Submit is what actually saves it. */
  verdict: "pass" | "fail" | null;
  note: string;
  submitting: boolean;
  saved: boolean;
}

function sessionKey(businessId: string): string {
  return `chatSessionId:${businessId}`;
}

function getSessionId(businessId: string): string {
  const key = sessionKey(businessId);
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
  const [qa, setQa] = useState<Record<string, QaState>>({});
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
              messageId: data.messageId,
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

  function newChat() {
    window.localStorage.removeItem(sessionKey(businessId));
    setSessionId(getSessionId(businessId));
    setMessages([]);
    setWaitingForAgent(false);
    setQa({});
    seenCount.current = 0;
  }

  function selectQaVerdict(messageId: string, verdict: "pass" | "fail") {
    setQa((prev) => ({
      ...prev,
      [messageId]: { verdict, note: prev[messageId]?.note ?? "", submitting: false, saved: false },
    }));
  }

  function setQaNote(messageId: string, note: string) {
    setQa((prev) => ({
      ...prev,
      [messageId]: { ...(prev[messageId] ?? { verdict: null, submitting: false, saved: false }), note },
    }));
  }

  async function submitQa(messageId: string) {
    const state = qa[messageId];
    if (!state?.verdict) return;

    setQa((prev) => ({ ...prev, [messageId]: { ...state, submitting: true, saved: false } }));

    try {
      const res = await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, businessId, verdict: state.verdict, note: state.note }),
      });

      setQa((prev) => ({
        ...prev,
        [messageId]: { ...state, submitting: false, saved: res.ok },
      }));
    } catch {
      setQa((prev) => ({ ...prev, [messageId]: { ...state, submitting: false, saved: false } }));
    }
  }

  return (
    <div>
      <p style={{ opacity: 0.5, fontSize: 12 }}>
        Chat ID: {sessionId}
        {waitingForAgent && " · connected to a human agent"}
        {" · "}
        <button
          onClick={newChat}
          style={{ fontSize: 12, padding: "1px 6px", cursor: "pointer" }}
        >
          New chat
        </button>
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
            Upload a document, then ask a question about it here. Every
            answer gets a QA pass/fail button below it — use it to flag
            good and bad answers for the training pipeline.
          </p>
        )}

        {messages.map((m, i) => {
          const state = m.messageId ? qa[m.messageId] : undefined;

          return (
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

              {m.role === "assistant" && m.messageId && (
                <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => selectQaVerdict(m.messageId!, "pass")}
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      background: state?.verdict === "pass" ? "#1a5" : "transparent",
                      color: state?.verdict === "pass" ? "#fff" : "inherit",
                      border: "1px solid #1a5",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    ✓ Pass
                  </button>
                  <button
                    onClick={() => selectQaVerdict(m.messageId!, "fail")}
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      background: state?.verdict === "fail" ? "#c33" : "transparent",
                      color: state?.verdict === "fail" ? "#fff" : "inherit",
                      border: "1px solid #c33",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    ✗ Fail
                  </button>
                  {state?.verdict && (
                    <>
                      <input
                        placeholder="Why? (optional — feeds the training pipeline)"
                        value={state.note}
                        onChange={(e) => setQaNote(m.messageId!, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitQa(m.messageId!);
                        }}
                        style={{ fontSize: 11, padding: "3px 6px", flex: 1, minWidth: 160 }}
                      />
                      <button
                        onClick={() => submitQa(m.messageId!)}
                        disabled={state.submitting}
                        style={{ fontSize: 11, padding: "2px 10px", cursor: "pointer" }}
                      >
                        {state.submitting ? "Submitting…" : "Submit"}
                      </button>
                    </>
                  )}
                  {state?.saved && !state.submitting && (
                    <span style={{ fontSize: 11, opacity: 0.5 }}>Saved ✓</span>
                  )}
                </div>
              )}
            </div>
          );
        })}

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
