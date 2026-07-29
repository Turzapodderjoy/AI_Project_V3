"use client";

import { useState } from "react";

import { cardStyle, subtleTextStyle } from "./dashboard-styles";

interface Message {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  handoff?: boolean;
}

interface ReviewResult {
  verdict: string;
  findings: string;
  suggestion: { id: string; proposedAppendText: string; reasoning: string } | null;
}

function newSessionId(): string {
  return `training-${crypto.randomUUID()}`;
}

/** A chat box for deliberately provoking and correcting the AI's real
 * behavior (retrieval, system prompt, handoff logic — the exact same
 * pipeline a real customer hits), not a simulation. The one difference:
 * the AI keeps responding even after it hands off, since the whole point
 * is to argue with it ("why did you hand off, you could have just said
 * hello") and see how it reasons about the correction. Ending a session
 * runs it through the same analysis the nightly training pipeline uses,
 * on demand, and — if there's real signal — proposes a concrete AI Brain
 * change you can review and Save or Discard, reusing the exact same
 * accept/decline machinery the Training & Insights panel's suggestions do. */
export function TrainingArenaPanel({ businessId }: { businessId: string }) {
  const [sessionId, setSessionId] = useState(newSessionId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [message, setMessage] = useState("");

  function newSession() {
    setSessionId(newSessionId());
    setMessages([]);
    setReview(null);
    setMessage("");
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, businessId }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        res.ok
          ? { role: "assistant", content: data.answer, provider: data.provider, handoff: data.handoff }
          : { role: "assistant", content: `Error: ${data.detail ?? data.error}` },
      ]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${String(err)}` }]);
    } finally {
      setSending(false);
    }
  }

  async function endAndReview() {
    if (messages.length === 0) return;
    setReviewing(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/training/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();

      if (res.ok) {
        setReview(data);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } finally {
      setReviewing(false);
    }
  }

  async function decide(accept: boolean) {
    if (!review?.suggestion) return;
    setDeciding(true);

    try {
      const res = await fetch(`/api/admin/training/suggestions/${accept ? "accept" : "decline"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: review.suggestion.id }),
      });

      setMessage(
        res.ok
          ? accept
            ? "Saved — the AI Brain now has this rule."
            : "Discarded — nothing changed."
          : `Error: ${(await res.json()).error}`
      );

      if (res.ok) {
        newSession();
      }
    } finally {
      setDeciding(false);
    }
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Training Arena</h2>
      <p style={subtleTextStyle}>
        Talk to the AI directly to provoke and correct its real behavior —
        the same retrieval/prompt/handoff pipeline a real customer hits,
        except it keeps responding even after a handoff, so you can argue
        with it and see how it reasons. End the session to review what it
        learned and decide whether to save that as a real AI Brain rule.
      </p>

      <div
        style={{
          border: "1px solid #333",
          borderRadius: 8,
          minHeight: 240,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <p style={subtleTextStyle}>
            Try provoking a mistake — e.g. say something the AI mishandles,
            then tell it what it should have done instead.
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            <strong>{m.role === "user" ? "You" : "Assistant"}:</strong> {m.content}
            {m.handoff && (
              <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>(handed off here)</span>
            )}
          </div>
        ))}

        {sending && <div style={{ opacity: 0.6 }}>Thinking…</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Say something to the AI…"
        />
        <button onClick={send} disabled={sending}>
          Send
        </button>
        <button onClick={newSession}>New session</button>
        <button onClick={endAndReview} disabled={reviewing || messages.length === 0}>
          {reviewing ? "Reviewing…" : "End session & review"}
        </button>
      </div>

      {message && <p style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>{message}</p>}

      {review && (
        <div style={{ ...cardStyle, marginTop: 16, background: "rgba(255,255,255,0.03)" }}>
          <h3 style={{ marginTop: 0 }}>What it learned</h3>
          <p>
            <strong>Verdict:</strong> {review.verdict}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>
            <strong>Findings:</strong> {review.findings || "(none — nothing worth extracting from this session)"}
          </p>

          {review.suggestion ? (
            <>
              <p>
                <strong>Proposed AI Brain addition:</strong>
              </p>
              <pre style={{ whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 4 }}>
                {review.suggestion.proposedAppendText}
              </pre>
              <p style={subtleTextStyle}>Why: {review.suggestion.reasoning}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decide(true)} disabled={deciding}>
                  {deciding ? "…" : "Save to AI Brain"}
                </button>
                <button onClick={() => decide(false)} disabled={deciding}>
                  {deciding ? "…" : "Discard"}
                </button>
              </div>
            </>
          ) : (
            <p style={subtleTextStyle}>
              No concrete rule change proposed from this session — either
              nothing went wrong, or there wasn&apos;t enough signal to act on.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
