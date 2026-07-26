"use client";

import { useEffect, useState } from "react";

import { ChatWidget } from "../../components/ChatWidget";
import { UploadWidget } from "../../components/UploadWidget";

type Tab = "ai" | "usage" | "knowledge" | "chat" | "database";

const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "AI Providers" },
  { id: "usage", label: "Usage" },
  { id: "knowledge", label: "Knowledge Hub" },
  { id: "chat", label: "Chat Demo" },
  { id: "database", label: "Database" },
];

interface ProviderStatus {
  name: string;
  healthy: boolean;
  hasUsableKey: boolean;
}

interface UsageStats {
  [provider: string]: {
    requests: number;
    successes: number;
    failures: number;
    tokens: number;
  };
}

interface KnowledgeDocument {
  documentId: string;
  filename: string;
  chunks: number;
}

interface DatabaseStatus {
  connected: boolean;
  host: string | null;
  error?: string;
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("ai");

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 40 }}>
      <h1>Admin Dashboard</h1>
      <p style={{ opacity: 0.6, marginTop: -8 }}>
        Single control panel — no login yet, internal use only.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "24px 0", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px",
              fontWeight: tab === t.id ? "bold" : "normal",
              border: tab === t.id ? "2px solid #666" : "1px solid #333",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ai" && <AiProvidersPanel />}
      {tab === "usage" && <UsagePanel />}
      {tab === "knowledge" && <KnowledgeHubPanel />}
      {tab === "chat" && <ChatWidget />}
      {tab === "database" && <DatabasePanel />}
    </main>
  );
}

function AiProvidersPanel() {
  const [status, setStatus] = useState<ProviderStatus[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data) => setStatus(data.status));
  }, []);

  return (
    <section>
      <h2>AI Providers</h2>
      <p style={{ opacity: 0.6 }}>
        Only providers registered in <code>bootstrap/register-providers.ts</code>{" "}
        show up here. Add Gemini, Claude, OpenAI, OpenRouter, Ollama, or
        Together by registering them there once you have their API keys — no
        other code changes needed.
      </p>

      {!status && <p>Loading…</p>}

      {status && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Provider</th>
              <th style={cellStyle}>Healthy</th>
              <th style={cellStyle}>Has API key</th>
            </tr>
          </thead>
          <tbody>
            {status.map((p) => (
              <tr key={p.name}>
                <td style={cellStyle}>{p.name}</td>
                <td style={cellStyle}>{p.healthy ? "✅" : "❌"}</td>
                <td style={cellStyle}>{p.hasUsableKey ? "✅" : "❌"}</td>
              </tr>
            ))}
            {status.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={3}>
                  No providers registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function UsagePanel() {
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then((r) => r.json())
      .then(setUsage);
  }, []);

  return (
    <section>
      <h2>Usage</h2>
      <p style={{ opacity: 0.6 }}>
        In-memory counters, reset on server restart — and in local testing
        they didn&apos;t even stay consistent request-to-request, which means
        this dev server is handling requests across more than one worker
        with separate memory. Real numbers need a persisted UsageRecord
        table (Postgres), same fix as conversation history below.
      </p>

      {!usage && <p>Loading…</p>}

      {usage && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Provider</th>
              <th style={cellStyle}>Requests</th>
              <th style={cellStyle}>Successes</th>
              <th style={cellStyle}>Failures</th>
              <th style={cellStyle}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(usage).map(([name, stats]) => (
              <tr key={name}>
                <td style={cellStyle}>{name}</td>
                <td style={cellStyle}>{stats.requests}</td>
                <td style={cellStyle}>{stats.successes}</td>
                <td style={cellStyle}>{stats.failures}</td>
                <td style={cellStyle}>{stats.tokens}</td>
              </tr>
            ))}
            {Object.keys(usage).length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={5}>
                  No requests yet — try the Chat Demo tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function KnowledgeHubPanel() {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);

  function refresh() {
    fetch("/api/admin/knowledge")
      .then((r) => r.json())
      .then((data) => setDocuments(data.documents));
  }

  useEffect(refresh, []);

  return (
    <section>
      <h2>Knowledge Hub</h2>
      <UploadWidget onUploaded={refresh} />

      <h3 style={{ marginTop: 24 }}>Indexed documents</h3>

      {!documents && <p>Loading…</p>}

      {documents && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Filename</th>
              <th style={cellStyle}>Chunks</th>
              <th style={cellStyle}>Document ID</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.documentId}>
                <td style={cellStyle}>{d.filename}</td>
                <td style={cellStyle}>{d.chunks}</td>
                <td style={cellStyle}>
                  <code style={{ fontSize: 11 }}>{d.documentId}</code>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={3}>
                  Nothing indexed yet — upload a file above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DatabasePanel() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);

  useEffect(() => {
    fetch("/api/admin/database")
      .then((r) => r.json())
      .then(setStatus);
  }, []);

  return (
    <section>
      <h2>Database</h2>
      <p style={{ opacity: 0.6 }}>
        Swap <code>DATABASE_URL</code> in your env (local Postgres today, any
        online Postgres — Neon, Supabase, RDS — tomorrow) and this panel
        reflects it. No connection strings are entered or stored through this
        UI.
      </p>

      {!status && <p>Loading…</p>}

      {status && (
        <ul>
          <li>Status: {status.connected ? "✅ Connected" : "❌ Not connected"}</li>
          <li>Host: {status.host ?? "not set"}</li>
          {status.error && <li>Error: {status.error}</li>}
        </ul>
      )}
    </section>
  );
}

const cellStyle: React.CSSProperties = {
  border: "1px solid #333",
  padding: "6px 10px",
  textAlign: "left",
};
