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
  maskedKey: string | null;
}

interface CatalogEntry {
  id: string;
  label: string;
}

interface ProvidersResponse {
  active: string[];
  status: ProviderStatus[];
  catalog: {
    available: CatalogEntry[];
    planned: CatalogEntry[];
  };
}

interface AiUsage {
  [provider: string]: {
    requests: number;
    successes: number;
    failures: number;
    tokens: number;
  };
}

interface EmbeddingUsage {
  [provider: string]: {
    requests: number;
    tokens: number;
  };
}

interface ChatUsageEntry {
  chatId: string;
  provider: string;
  tokens: number;
  confidence: number;
  createdAt: string;
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
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function refresh() {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then(setData);
  }

  useEffect(refresh, []);

  useEffect(() => {
    const first = data?.catalog.available[0];
    if (first && !selected) {
      setSelected(first.id);
    }
  }, [data, selected]);

  async function activate() {
    if (!selected || !apiKey.trim()) return;
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/providers/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected, apiKey }),
      });
      const result = await res.json();

      setMessage(
        res.ok
          ? `Activated "${result.activated}". In-memory only for now — resets on restart until keys move to persisted config.`
          : `Error: ${result.error}`
      );

      if (res.ok) {
        setApiKey("");
        refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>AI Providers</h2>

      {!data && <p>Loading…</p>}

      {data && (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Provider</th>
                <th style={cellStyle}>Healthy</th>
                <th style={cellStyle}>Has API key</th>
                <th style={cellStyle}>API key</th>
              </tr>
            </thead>
            <tbody>
              {data.status.map((p) => (
                <tr key={p.name}>
                  <td style={cellStyle}>{p.name}</td>
                  <td style={cellStyle}>{p.healthy ? "✅" : "❌"}</td>
                  <td style={cellStyle}>{p.hasUsableKey ? "✅" : "❌"}</td>
                  <td style={cellStyle}>
                    <code style={{ fontSize: 12 }}>{p.maskedKey ?? "—"}</code>
                  </td>
                </tr>
              ))}
              {data.status.length === 0 && (
                <tr>
                  <td style={cellStyle} colSpan={4}>
                    No providers active yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h3 style={{ marginTop: 24 }}>Add / activate a provider</h3>
          <p style={{ opacity: 0.6 }}>
            Only providers with a real, coded adapter can be activated —
            picking one just needs an API key, no redeploy or code change.
            Planned but not-yet-coded providers are listed below for
            visibility.
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{ padding: 8 }}
            >
              {data.catalog.available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              style={{ padding: 8, flex: 1, minWidth: 200 }}
              placeholder="API key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button onClick={activate} disabled={saving}>
              {saving ? "Saving…" : "Activate"}
            </button>
          </div>

          {message && <p style={{ fontSize: 13, opacity: 0.8 }}>{message}</p>}

          <p style={{ opacity: 0.5, fontSize: 12, marginTop: 12 }}>
            Not implemented yet: {data.catalog.planned.map((p) => p.label).join(", ")}.
            Each needs its adapter written once (implements the same
            AIProvider interface as Groq) before it can be activated here.
          </p>
        </>
      )}
    </section>
  );
}

function UsagePanel() {
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [embeddingUsage, setEmbeddingUsage] = useState<EmbeddingUsage | null>(null);
  const [chats, setChats] = useState<ChatUsageEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then((r) => r.json())
      .then((data) => {
        setAiUsage(data.ai);
        setEmbeddingUsage(data.embeddings);
      });

    fetch("/api/admin/chat-usage")
      .then((r) => r.json())
      .then((data) => setChats(data.chats));
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

      <h3>By chat</h3>
      {!chats && <p>Loading…</p>}
      {chats && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Chat ID</th>
              <th style={cellStyle}>Provider</th>
              <th style={cellStyle}>Confidence</th>
              <th style={cellStyle}>Tokens</th>
              <th style={cellStyle}>When</th>
            </tr>
          </thead>
          <tbody>
            {chats.map((c, i) => (
              <tr key={i}>
                <td style={cellStyle}>
                  <code style={{ fontSize: 11 }}>{c.chatId}</code>
                </td>
                <td style={cellStyle}>{c.provider}</td>
                <td style={cellStyle}>{Math.round(c.confidence * 100)}%</td>
                <td style={cellStyle}>{c.tokens}</td>
                <td style={cellStyle}>{new Date(c.createdAt).toLocaleTimeString()}</td>
              </tr>
            ))}
            {chats.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={5}>
                  No chats yet — try the Chat Demo tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>AI providers (totals)</h3>
      {!aiUsage && <p>Loading…</p>}
      {aiUsage && (
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
            {Object.entries(aiUsage).map(([name, stats]) => (
              <tr key={name}>
                <td style={cellStyle}>{name}</td>
                <td style={cellStyle}>{stats.requests}</td>
                <td style={cellStyle}>{stats.successes}</td>
                <td style={cellStyle}>{stats.failures}</td>
                <td style={cellStyle}>{stats.tokens}</td>
              </tr>
            ))}
            {Object.keys(aiUsage).length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={5}>
                  No AI requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>Embeddings (Jina, etc.)</h3>
      {!embeddingUsage && <p>Loading…</p>}
      {embeddingUsage && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Provider</th>
              <th style={cellStyle}>Requests</th>
              <th style={cellStyle}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(embeddingUsage).map(([name, stats]) => (
              <tr key={name}>
                <td style={cellStyle}>{name}</td>
                <td style={cellStyle}>{stats.requests}</td>
                <td style={cellStyle}>{stats.tokens}</td>
              </tr>
            ))}
            {Object.keys(embeddingUsage).length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={3}>
                  No embedding calls yet — upload a document or ask a
                  question (retrieval embeds the query too).
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
