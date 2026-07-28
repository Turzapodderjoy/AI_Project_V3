"use client";

import { Fragment, useEffect, useState } from "react";

import { cellStyle } from "./dashboard-styles";

interface QaFeedback {
  messageId: string;
  businessId: string;
  verdict: "pass" | "fail";
  note: string | null;
  createdAt: string;
  messageContent: string;
  processed: boolean;
  analysisVerdict: string | null;
  analysisFindings: string | null;
}

const ANALYSIS_VERDICT_LABEL: Record<string, string> = {
  kept: "✅ Kept",
  dropped_spam: "🚫 Dropped (spam)",
  dropped_irrelevant: "⚪ Dropped (irrelevant)",
  dropped_harmful: "⛔ Dropped (harmful)",
};

/**
 * Mother-dashboard-only tab — every QA pass/fail submitted from any
 * client's Chat Demo tab, in one place, with whether the daily training
 * pipeline (chat-analysis-pipeline.ts) has processed that conversation
 * yet and what it actually concluded. The findings text (when processed)
 * already narrates how the QA annotation was used — that's the honest
 * "what changed as a result of this QA" answer, not a guessed link to
 * any specific prompt suggestion.
 */
export function QaReviewPanel() {
  const [feedback, setFeedback] = useState<QaFeedback[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function refresh() {
    fetch("/api/admin/qa-feedback")
      .then((r) => r.json())
      .then((data) => setFeedback(data.feedback));
  }

  useEffect(refresh, []);

  return (
    <section>
      <h2>QA Review</h2>
      <p style={{ opacity: 0.6 }}>
        Every Pass/Fail submitted from any client&apos;s Chat Demo tab.
        Once the daily training pipeline (5:00am BST) analyzes the
        conversation a QA&apos;d message belongs to, its real verdict and
        findings show up here too — that&apos;s the direct record of what
        the training module concluded from this feedback.
      </p>

      {!feedback && <p>Loading…</p>}

      {feedback && feedback.length === 0 && (
        <p style={{ opacity: 0.6 }}>
          No QA feedback yet — Pass/Fail a response in any client&apos;s
          Chat Demo tab.
        </p>
      )}

      {feedback && feedback.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Client</th>
              <th style={cellStyle}>Verdict</th>
              <th style={cellStyle}>Response</th>
              <th style={cellStyle}>Note</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>When</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {feedback.map((f) => (
              <Fragment key={f.messageId}>
                <tr>
                  <td style={cellStyle}>
                    <code style={{ fontSize: 11 }}>{f.businessId}</code>
                  </td>
                  <td style={cellStyle}>{f.verdict === "pass" ? "✓ Pass" : "✗ Fail"}</td>
                  <td style={cellStyle}>
                    {f.messageContent.length > 80
                      ? `${f.messageContent.slice(0, 80)}…`
                      : f.messageContent}
                  </td>
                  <td style={cellStyle}>{f.note ?? "—"}</td>
                  <td style={cellStyle}>
                    {f.processed
                      ? `✅ Processed — ${ANALYSIS_VERDICT_LABEL[f.analysisVerdict ?? ""] ?? f.analysisVerdict}`
                      : "⏳ Not processed yet"}
                  </td>
                  <td style={cellStyle}>{new Date(f.createdAt).toLocaleString()}</td>
                  <td style={cellStyle}>
                    {f.processed && (
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === f.messageId ? null : f.messageId)
                        }
                      >
                        {expandedId === f.messageId ? "Hide" : "View findings"}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === f.messageId && (
                  <tr>
                    <td style={cellStyle} colSpan={7}>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
                        {f.analysisFindings}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
