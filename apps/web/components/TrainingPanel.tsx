"use client";

import { Fragment, useEffect, useState } from "react";

import { cellStyle } from "./dashboard-styles";

interface ChatAnalysis {
  id: string;
  conversationId: string;
  businessId: string;
  verdict: string;
  findings: string;
  createdAt: string;
}

interface PromptSuggestion {
  id: string;
  businessId: string;
  kind: string;
  proposedSystemPrompt: string | null;
  proposedAppendText: string | null;
  reasoning: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
}

const VERDICT_LABEL: Record<string, string> = {
  kept: "✅ Kept",
  dropped_spam: "🚫 Dropped (spam)",
  dropped_irrelevant: "⚪ Dropped (irrelevant)",
  dropped_harmful: "⛔ Dropped (harmful)",
};

/**
 * Mother-dashboard-only tab (no per-client equivalent — this reviews
 * every client at once). Reads what the daily 5am BST cron
 * (chat-analysis-pipeline + prompt-suggestion-service) already
 * produced; this panel never triggers analysis itself, only lets an
 * admin read the findings and accept/decline a pending suggestion.
 */
export function TrainingPanel() {
  const [analyses, setAnalyses] = useState<ChatAnalysis[] | null>(null);
  const [pending, setPending] = useState<PromptSuggestion[] | null>(null);
  const [decided, setDecided] = useState<PromptSuggestion[] | null>(null);
  const [expandedAnalysisId, setExpandedAnalysisId] = useState<string | null>(null);
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  function refresh() {
    fetch("/api/admin/training/analyses")
      .then((r) => r.json())
      .then((data) => setAnalyses(data.analyses));

    fetch("/api/admin/training/suggestions")
      .then((r) => r.json())
      .then((data) => {
        setPending(data.pending);
        setDecided(data.decided);
      });
  }

  useEffect(refresh, []);

  /** Same pipeline the 5am BST cron runs — lets an admin force a run
   * right after QA'ing a chat or changing something, instead of waiting
   * for the next scheduled run. Can take a while (each conversation is a
   * real reasoning-LLM call, paced ~4s apart to stay under Groq's rate
   * limit), so this just waits for the response rather than polling. */
  async function runNow() {
    setRunning(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/training/run", { method: "POST" });
      const result = await res.json();

      setMessage(
        res.ok
          ? `Run complete — analyzed ${result.analysis.processed} conversation(s) (${result.analysis.kept} kept), ${result.suggestions.suggestionsCreated} new suggestion(s) created.`
          : `Error: ${result.error}`
      );

      if (res.ok) {
        refresh();
      }
    } finally {
      setRunning(false);
    }
  }

  async function decide(id: string, action: "accept" | "decline") {
    setDeciding(id);
    setMessage("");

    try {
      const res = await fetch(`/api/admin/training/suggestions/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await res.json();

      setMessage(
        res.ok
          ? action === "accept"
            ? "Accepted — a new AI Brain version was created for this client."
            : "Declined — the live prompt is unchanged."
          : `Error: ${result.error}`
      );

      if (res.ok) {
        refresh();
      }
    } finally {
      setDeciding(null);
    }
  }

  return (
    <section>
      <h2>Training &amp; Insights</h2>
      <p style={{ opacity: 0.6 }}>
        Every day at 5:00am BST, a reasoning LLM reviews new chat
        sessions across every client — dropping spam/irrelevant/harmful
        ones, extracting useful QA training pairs from the rest, and
        (once enough new signal has accumulated for a client) proposing
        specific edits to that client&apos;s AI Brain prompt. Nothing is
        ever applied automatically — every suggestion below sits pending
        until you Accept or Decline it.
      </p>

      <button onClick={runNow} disabled={running}>
        {running ? "Running… (this can take a minute)" : "Run now"}
      </button>
      {message && <p style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>{message}</p>}

      <h3 style={{ marginTop: 24 }}>Pending suggestions</h3>
      {!pending && <p>Loading…</p>}
      {pending && pending.length === 0 && (
        <p style={{ opacity: 0.6 }}>No pending suggestions right now.</p>
      )}
      {pending && pending.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Client</th>
              <th style={cellStyle}>Kind</th>
              <th style={cellStyle}>Reasoning</th>
              <th style={cellStyle}>When</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td style={cellStyle}>
                    <code style={{ fontSize: 11 }}>{s.businessId}</code>
                  </td>
                  <td style={cellStyle}>{s.kind}</td>
                  <td style={cellStyle}>{s.reasoning}</td>
                  <td style={cellStyle}>{new Date(s.createdAt).toLocaleString()}</td>
                  <td style={cellStyle}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        onClick={() =>
                          setExpandedSuggestionId(expandedSuggestionId === s.id ? null : s.id)
                        }
                      >
                        {expandedSuggestionId === s.id ? "Hide" : "View change"}
                      </button>
                      <button onClick={() => decide(s.id, "accept")} disabled={deciding === s.id}>
                        {deciding === s.id ? "…" : "Accept"}
                      </button>
                      <button onClick={() => decide(s.id, "decline")} disabled={deciding === s.id}>
                        {deciding === s.id ? "…" : "Decline"}
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedSuggestionId === s.id && (
                  <tr>
                    <td style={cellStyle} colSpan={5}>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
                        {s.kind === "append" ? s.proposedAppendText : s.proposedSystemPrompt}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>Decided history</h3>
      {!decided && <p>Loading…</p>}
      {decided && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Client</th>
              <th style={cellStyle}>Kind</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Decided</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((s) => (
              <tr key={s.id}>
                <td style={cellStyle}>
                  <code style={{ fontSize: 11 }}>{s.businessId}</code>
                </td>
                <td style={cellStyle}>{s.kind}</td>
                <td style={cellStyle}>{s.status === "accepted" ? "✅ Accepted" : "❌ Declined"}</td>
                <td style={cellStyle}>
                  {s.decidedAt ? new Date(s.decidedAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {decided.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={4}>
                  No decisions made yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>Findings log</h3>
      <p style={{ opacity: 0.6 }}>
        Every conversation the pipeline has analyzed, kept or dropped —
        the full human-readable audit trail.
      </p>
      {!analyses && <p>Loading…</p>}
      {analyses && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Client</th>
              <th style={cellStyle}>Verdict</th>
              <th style={cellStyle}>Findings</th>
              <th style={cellStyle}>When</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => (
              <Fragment key={a.id}>
                <tr>
                  <td style={cellStyle}>
                    <code style={{ fontSize: 11 }}>{a.businessId}</code>
                  </td>
                  <td style={cellStyle}>{VERDICT_LABEL[a.verdict] ?? a.verdict}</td>
                  <td style={cellStyle}>
                    {a.findings.length > 120 ? `${a.findings.slice(0, 120)}…` : a.findings}
                  </td>
                  <td style={cellStyle}>{new Date(a.createdAt).toLocaleString()}</td>
                  <td style={cellStyle}>
                    <button
                      onClick={() =>
                        setExpandedAnalysisId(expandedAnalysisId === a.id ? null : a.id)
                      }
                    >
                      {expandedAnalysisId === a.id ? "Hide" : "Full text"}
                    </button>
                  </td>
                </tr>
                {expandedAnalysisId === a.id && (
                  <tr>
                    <td style={cellStyle} colSpan={5}>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
                        {a.findings}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {analyses.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={5}>
                  Nothing analyzed yet — runs daily at 5:00am BST, or
                  trigger /api/cron/training-pipeline manually to test.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
