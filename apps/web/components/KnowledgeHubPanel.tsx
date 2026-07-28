"use client";

import { useEffect, useRef, useState } from "react";

import { UploadWidget } from "./UploadWidget";
import { cellStyle } from "./dashboard-styles";

interface KnowledgeDocument {
  documentId: string;
  filename: string;
  chunks: number;
  status: string;
  lastCrawledAt: string | null;
  lastUpdated: string | null;
}

interface CrawlTarget {
  id: string;
  url: string;
  status: string;
  pagesEstimated: number | null;
  pagesDone: number;
  lastCrawledAt: string | null;
  lastPageCount: number | null;
  lastChunkCount: number | null;
  lastError: string | null;
}

const ACTIVE_STATUSES = new Set(["queued", "crawling"]);

/** Reused as-is by both the mother dashboard (no businessId = everything)
 * and every per-client dashboard (/dashboard/[businessId]) — one component,
 * so any change here applies everywhere at once. */
export function KnowledgeHubPanel({ businessId }: { businessId?: string }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);
  const [targets, setTargets] = useState<CrawlTarget[] | null>(null);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState("");
  const wasActive = useRef(false);

  function refreshDocuments() {
    const qs = businessId ? `?businessId=${encodeURIComponent(businessId)}` : "";
    fetch(`/api/admin/knowledge${qs}`)
      .then((r) => r.json())
      .then((data) => setDocuments(data.documents));
  }

  function refreshTargets() {
    const qs = businessId ? `?businessId=${encodeURIComponent(businessId)}` : "";
    fetch(`/api/admin/crawler${qs}`)
      .then((r) => r.json())
      .then((data: { targets: CrawlTarget[] }) => {
        setTargets(data.targets);

        const active = data.targets.some((t) => ACTIVE_STATUSES.has(t.status));
        if (wasActive.current && !active) {
          refreshDocuments(); // a crawl just finished — pick up new chunks
        }
        wasActive.current = active;
      });
  }

  useEffect(() => {
    refreshDocuments();
    refreshTargets();

    // Poll every 2s while anything is crawling so the progress bar moves;
    // the interval is cheap to leave running since it's just one query.
    const interval = setInterval(refreshTargets, 2000);
    return () => clearInterval(interval);
  }, [businessId]);

  async function addSite() {
    if (!url.trim()) return;
    setAdding(true);
    setCrawlMessage("");

    try {
      const res = await fetch("/api/admin/crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: businessId ?? "default", url }),
      });
      const result = await res.json();

      if (res.ok) {
        setUrl("");
        refreshTargets();
      } else {
        setCrawlMessage(`Error: ${result.error}`);
      }
    } finally {
      setAdding(false);
    }
  }

  async function recrawl(id: string) {
    await fetch("/api/admin/crawler/recrawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    refreshTargets();
  }

  async function deleteDocument(doc: KnowledgeDocument) {
    const confirmed = window.confirm(
      `Delete "${doc.filename}" (${doc.chunks} chunk${doc.chunks === 1 ? "" : "s"}) from the knowledge base? This cannot be undone.`
    );
    if (!confirmed) return;

    await fetch("/api/admin/knowledge/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: doc.documentId }),
    });
    refreshDocuments();
  }

  return (
    <section>
      <h2>Knowledge Hub</h2>
      <UploadWidget businessId={businessId} onUploaded={refreshDocuments} />

      <h3 style={{ marginTop: 24 }}>Website crawler</h3>
      <p style={{ opacity: 0.6 }}>
        Add a client&apos;s site once — it re-crawls automatically every day
        at 7am BST (Vercel Cron) to keep answers current. Respects
        robots.txt, identifies itself with a real User-Agent, and rate-limits
        itself. It will not attempt to get past CAPTCHAs, WAFs, or other bot
        protection — allowlist our User-Agent on the client&apos;s side if a
        site blocks it.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          placeholder="https://client-site.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addSite();
          }}
        />
        <button onClick={addSite} disabled={adding}>
          {adding ? "Queuing…" : "Add & crawl"}
        </button>
      </div>

      {crawlMessage && <p style={{ fontSize: 13, opacity: 0.8 }}>{crawlMessage}</p>}

      {targets && targets.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={cellStyle}>URL</th>
              <th style={cellStyle}>Progress</th>
              <th style={cellStyle}>Last crawled</th>
              <th style={cellStyle}>Pages / chunks</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td style={cellStyle}>{t.url}</td>
                <td style={cellStyle}>
                  <CrawlProgress target={t} />
                </td>
                <td style={cellStyle}>
                  {t.lastCrawledAt ? new Date(t.lastCrawledAt).toLocaleString() : "never"}
                </td>
                <td style={cellStyle}>
                  {t.lastPageCount ?? "—"} / {t.lastChunkCount ?? "—"}
                </td>
                <td style={cellStyle}>
                  <button
                    onClick={() => recrawl(t.id)}
                    disabled={ACTIVE_STATUSES.has(t.status)}
                  >
                    Recrawl now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>Indexed documents</h3>

      {!documents && <p>Loading…</p>}

      {documents && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Filename</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Chunks</th>
              <th style={cellStyle}>Last updated</th>
              <th style={cellStyle}>Document ID</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.documentId}>
                <td style={cellStyle}>{d.filename}</td>
                <td style={cellStyle}>
                  <DocumentStatus status={d.status} lastCrawledAt={d.lastCrawledAt} />
                </td>
                <td style={cellStyle}>{d.chunks}</td>
                <td style={cellStyle}>
                  {d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : "—"}
                </td>
                <td style={cellStyle}>
                  <code style={{ fontSize: 11 }}>{d.documentId}</code>
                </td>
                <td style={cellStyle}>
                  <button onClick={() => deleteDocument(d)}>Delete</button>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={6}>
                  Nothing indexed yet — upload a file or crawl a site above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CrawlProgress({ target }: { target: CrawlTarget }) {
  if (target.status === "error") {
    return <span title={target.lastError ?? ""}>❌ {target.lastError}</span>;
  }

  if (target.status === "done") {
    return <span>✅ complete</span>;
  }

  if (target.status === "queued") {
    return <span style={{ opacity: 0.6 }}>queued…</span>;
  }

  // "crawling" — inspected the site first (pagesEstimated), now filling
  // the bar in as pages are actually crawled.
  const total = target.pagesEstimated ?? 1;
  const pct = Math.min(100, Math.round((target.pagesDone / total) * 100));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, background: "#333", borderRadius: 4, height: 8, minWidth: 80 }}>
        <div
          style={{
            width: `${pct}%`,
            background: "#4caf50",
            height: "100%",
            borderRadius: 4,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        {target.pagesDone}/{total} ({pct}%)
      </span>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  new: "🆕 new",
  updated: "🔄 updated",
  unchanged: "✅ unchanged",
  uploaded: "📄 uploaded",
};

function DocumentStatus({
  status,
  lastCrawledAt,
}: {
  status: string;
  lastCrawledAt: string | null;
}) {
  return (
    <span title={lastCrawledAt ? `Last crawled ${new Date(lastCrawledAt).toLocaleString()}` : undefined}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
