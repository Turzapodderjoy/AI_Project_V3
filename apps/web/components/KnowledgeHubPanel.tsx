"use client";

import { useEffect, useState } from "react";

import { UploadWidget } from "./UploadWidget";
import { cellStyle } from "./dashboard-styles";

interface KnowledgeDocument {
  documentId: string;
  filename: string;
  chunks: number;
}

interface CrawlTarget {
  id: string;
  url: string;
  lastCrawledAt: string | null;
  lastPageCount: number | null;
  lastChunkCount: number | null;
  lastError: string | null;
}

/** Reused as-is by both the mother dashboard (no businessId = everything)
 * and every per-client dashboard (/dashboard/[businessId]) — one component,
 * so any change here applies everywhere at once. */
export function KnowledgeHubPanel({ businessId }: { businessId?: string }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);
  const [targets, setTargets] = useState<CrawlTarget[] | null>(null);
  const [url, setUrl] = useState("");
  const [crawling, setCrawling] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState("");

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
      .then((data) => setTargets(data.targets));
  }

  useEffect(() => {
    refreshDocuments();
    refreshTargets();
  }, [businessId]);

  async function addSite() {
    if (!url.trim()) return;
    setCrawling(true);
    setCrawlMessage("");

    try {
      const res = await fetch("/api/admin/crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: businessId ?? "default", url }),
      });
      const result = await res.json();

      setCrawlMessage(
        res.ok
          ? `Crawled ${result.lastPageCount ?? 0} page(s), ${result.lastChunkCount ?? 0} chunk(s).`
          : `Error: ${result.error}`
      );

      if (res.ok) {
        setUrl("");
        refreshTargets();
        refreshDocuments();
      }
    } finally {
      setCrawling(false);
    }
  }

  async function recrawl(id: string) {
    await fetch("/api/admin/crawler/recrawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    refreshTargets();
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
        <button onClick={addSite} disabled={crawling}>
          {crawling ? "Crawling…" : "Add & crawl now"}
        </button>
      </div>

      {crawlMessage && <p style={{ fontSize: 13, opacity: 0.8 }}>{crawlMessage}</p>}

      {targets && targets.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={cellStyle}>URL</th>
              <th style={cellStyle}>Last crawled</th>
              <th style={cellStyle}>Pages / chunks</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td style={cellStyle}>{t.url}</td>
                <td style={cellStyle}>
                  {t.lastCrawledAt ? new Date(t.lastCrawledAt).toLocaleString() : "never"}
                </td>
                <td style={cellStyle}>
                  {t.lastPageCount ?? "—"} / {t.lastChunkCount ?? "—"}
                </td>
                <td style={cellStyle}>{t.lastError ? `❌ ${t.lastError}` : "✅"}</td>
                <td style={cellStyle}>
                  <button onClick={() => recrawl(t.id)}>Recrawl now</button>
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
