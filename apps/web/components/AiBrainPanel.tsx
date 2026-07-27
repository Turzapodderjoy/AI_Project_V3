"use client";

import { Fragment, useEffect, useState } from "react";

import { cellStyle } from "./dashboard-styles";

interface AiConfig {
  id: string;
  systemPrompt: string;
  handoffFloor: number;
  historyTurns: number;
  changeType: string;
  note: string | null;
  createdAt: string;
}

/** Platform-wide — one "AI brain" shared by every client, editable here
 * instead of hardcoded, with every change kept as a permanent version. */
export function AiBrainPanel() {
  const [current, setCurrent] = useState<AiConfig | null>(null);
  const [history, setHistory] = useState<AiConfig[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [promptDraft, setPromptDraft] = useState("");
  const [floorDraft, setFloorDraft] = useState(0.2);
  const [turnsDraft, setTurnsDraft] = useState(10);
  const [updateNote, setUpdateNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [addText, setAddText] = useState("");
  const [addNote, setAddNote] = useState("");
  const [adding, setAdding] = useState(false);

  function refresh() {
    fetch("/api/admin/ai-config")
      .then((r) => r.json())
      .then((data: AiConfig) => {
        setCurrent(data);
        setPromptDraft(data.systemPrompt);
        setFloorDraft(data.handoffFloor);
        setTurnsDraft(data.historyTurns);
      });

    fetch("/api/admin/ai-config/history")
      .then((r) => r.json())
      .then((data) => setHistory(data.history));
  }

  useEffect(refresh, []);

  async function saveUpdate() {
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: promptDraft,
          handoffFloor: floorDraft,
          historyTurns: turnsDraft,
          note: updateNote,
        }),
      });
      const result = await res.json();

      setMessage(
        res.ok
          ? "Saved — takes effect on the very next chat message, no restart needed."
          : `Error: ${result.error}`
      );

      if (res.ok) {
        setUpdateNote("");
        refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveAppend() {
    if (!addText.trim()) return;
    setAdding(true);

    try {
      const res = await fetch("/api/admin/ai-config/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: addText, note: addNote }),
      });
      const result = await res.json();

      setMessage(
        res.ok
          ? "Added to the end of the current prompt as a new version."
          : `Error: ${result.error}`
      );

      if (res.ok) {
        setAddText("");
        setAddNote("");
        refresh();
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <section>
      <h2>AI Brain</h2>
      <p style={{ opacity: 0.6 }}>
        The system prompt and the two knobs that control how eagerly the AI
        hands off vs. tries to answer — editable here instead of hardcoded
        in the code. Every save creates a new version; nothing is ever
        overwritten, so the full history below is a permanent record of
        what was asked of the AI and when.
      </p>

      {!current && <p>Loading…</p>}

      {current && (
        <>
          <h3>Current prompt</h3>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            style={{
              width: "100%",
              minHeight: 280,
              padding: 8,
              fontFamily: "monospace",
              fontSize: 12,
              boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <label>
              Handoff confidence floor{" "}
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={floorDraft}
                onChange={(e) => setFloorDraft(Number(e.target.value))}
                style={{ width: 80, padding: 4 }}
              />
            </label>
            <label>
              Conversation history turns{" "}
              <input
                type="number"
                min={0}
                value={turnsDraft}
                onChange={(e) => setTurnsDraft(Number(e.target.value))}
                style={{ width: 80, padding: 4 }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              style={{ flex: 1, padding: 8 }}
              placeholder="What changed and why (kept in the history log)"
              value={updateNote}
              onChange={(e) => setUpdateNote(e.target.value)}
            />
            <button onClick={saveUpdate} disabled={saving}>
              {saving ? "Saving…" : "Update"}
            </button>
          </div>

          <h3 style={{ marginTop: 24 }}>Add an instruction</h3>
          <p style={{ opacity: 0.6 }}>
            Appends to the end of the current prompt as a new version,
            instead of retyping the whole thing — e.g. "Never mention
            competitor pricing" or "Always offer the express shipping
            option when discussing delivery."
          </p>
          <textarea
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder="New rule to add…"
            style={{ width: "100%", minHeight: 60, padding: 8, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              style={{ flex: 1, padding: 8 }}
              placeholder="Note (optional — defaults to the added text)"
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
            />
            <button onClick={saveAppend} disabled={adding}>
              {adding ? "Adding…" : "Add"}
            </button>
          </div>

          {message && <p style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>{message}</p>}
        </>
      )}

      <h3 style={{ marginTop: 24 }}>History</h3>
      {!history && <p>Loading…</p>}
      {history && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>When</th>
              <th style={cellStyle}>Type</th>
              <th style={cellStyle}>Note</th>
              <th style={cellStyle}>Floor</th>
              <th style={cellStyle}>Turns</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {history.map((v) => (
              <Fragment key={v.id}>
                <tr>
                  <td style={cellStyle}>{new Date(v.createdAt).toLocaleString()}</td>
                  <td style={cellStyle}>{v.changeType}</td>
                  <td style={cellStyle}>{v.note ?? "—"}</td>
                  <td style={cellStyle}>{v.handoffFloor}</td>
                  <td style={cellStyle}>{v.historyTurns}</td>
                  <td style={cellStyle}>
                    <button onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}>
                      {expandedId === v.id ? "Hide" : "View prompt"}
                    </button>
                  </td>
                </tr>
                {expandedId === v.id && (
                  <tr>
                    <td style={cellStyle} colSpan={6}>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
                        {v.systemPrompt}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {history.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={6}>
                  No history yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
