"use client";

import { useEffect, useState } from "react";

import { ChatWidget } from "../../components/ChatWidget";
import { KnowledgeHubPanel } from "../../components/KnowledgeHubPanel";
import { HandoffsPanel } from "../../components/HandoffsPanel";
import { AiBrainPanel } from "../../components/AiBrainPanel";
import { cellStyle, formatBytes } from "../../components/dashboard-styles";

type Tab = "ai" | "brain" | "usage" | "clients" | "knowledge" | "chat" | "handoffs" | "database";

const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "AI Providers" },
  { id: "brain", label: "AI Brain" },
  { id: "usage", label: "Usage" },
  { id: "clients", label: "Clients" },
  { id: "knowledge", label: "Knowledge Hub" },
  { id: "chat", label: "Chat Demo" },
  { id: "handoffs", label: "Handoffs" },
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

interface DatabaseStatus {
  connected: boolean;
  host: string | null;
  error?: string;
}

interface CacheStats {
  size: number;
  totalHits: number;
}

interface Client {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("ai");

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 40 }}>
      <h1>Mother Dashboard</h1>
      <p style={{ opacity: 0.6, marginTop: -8 }}>
        Platform-wide view across every client — no login yet, internal use only.
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

      {/* Every panel stays mounted (hidden via CSS, not unmounted) so
          switching tabs never wipes a panel's local state. */}
      <div style={{ display: tab === "ai" ? "block" : "none" }}>
        <AiProvidersPanel />
      </div>
      <div style={{ display: tab === "brain" ? "block" : "none" }}>
        <AiBrainPanel />
      </div>
      <div style={{ display: tab === "usage" ? "block" : "none" }}>
        <UsagePanel />
      </div>
      <div style={{ display: tab === "clients" ? "block" : "none" }}>
        <ClientsPanel />
      </div>
      <div style={{ display: tab === "knowledge" ? "block" : "none" }}>
        <KnowledgeHubPanel />
      </div>
      <div style={{ display: tab === "chat" ? "block" : "none" }}>
        <ChatWidget />
      </div>
      <div style={{ display: tab === "handoffs" ? "block" : "none" }}>
        <HandoffsPanel />
      </div>
      <div style={{ display: tab === "database" ? "block" : "none" }}>
        <DatabasePanel />
      </div>
    </main>
  );
}

function ClientsPanel() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [storageByClient, setStorageByClient] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  function refresh() {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((data) => {
        const list: Client[] = data.clients;
        setClients(list);

        // One request per client, in parallel — fine for the handful of
        // clients an internal admin panel deals with; revisit if this
        // ever needs to scale to hundreds at once.
        Promise.all(
          list.map((c) =>
            fetch(`/api/admin/storage?businessId=${encodeURIComponent(c.id)}`)
              .then((r) => r.json())
              .then((info) => [c.id, info.knowledgeBytesEstimate as number] as const)
          )
        ).then((pairs) => setStorageByClient(Object.fromEntries(pairs)));
      });
  }

  useEffect(refresh, []);

  async function addClient() {
    if (!name.trim()) return;
    setCreating(true);

    try {
      await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setName("");
      refresh();
    } finally {
      setCreating(false);
    }
  }

  async function deleteClient(client: Client) {
    const confirmed = window.confirm(
      `Delete "${client.name}"? This permanently removes their conversations, crawl targets, and indexed knowledge base — it cannot be undone.`
    );
    if (!confirmed) return;

    await fetch(`/api/admin/clients/${client.id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section>
      <h2>Clients</h2>
      <p style={{ opacity: 0.6 }}>
        Adding a company creates its dashboard immediately — every client
        shares the same dashboard page (/dashboard/[id]), so there&apos;s
        nothing to deploy per client and every future update applies to all
        of them at once.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          placeholder="Company name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addClient();
          }}
        />
        <button onClick={addClient} disabled={creating}>
          {creating ? "Adding…" : "Add company"}
        </button>
      </div>

      {!clients && <p>Loading…</p>}

      {clients && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
          <thead>
            <tr>
              <th style={cellStyle}>Name</th>
              <th style={cellStyle}>Created</th>
              <th style={cellStyle}>Storage used</th>
              <th style={cellStyle}>Dashboard</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td style={cellStyle}>{c.name}</td>
                <td style={cellStyle}>{new Date(c.createdAt).toLocaleDateString()}</td>
                <td style={cellStyle}>
                  {storageByClient[c.id] !== undefined ? formatBytes(storageByClient[c.id]!) : "…"}
                </td>
                <td style={cellStyle}>
                  <a href={`/dashboard/${c.id}`}>/dashboard/{c.id}</a>
                </td>
                <td style={cellStyle}>
                  <button onClick={() => deleteClient(c)}>Delete</button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={5}>
                  No clients yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
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
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [chats, setChats] = useState<ChatUsageEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then((r) => r.json())
      .then((data) => {
        setAiUsage(data.ai);
        setEmbeddingUsage(data.embeddings);
        setCacheStats(data.cache);
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

      {cacheStats && (
        <p style={{ opacity: 0.8 }}>
          Response cache: {cacheStats.size} cached answers, {cacheStats.totalHits}{" "}
          reuses so far — each reuse is a chat answered with 0 LLM tokens.
        </p>
      )}

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
