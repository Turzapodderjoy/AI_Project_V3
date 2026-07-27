"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { ChatWidget } from "../../../components/ChatWidget";
import { KnowledgeHubPanel } from "../../../components/KnowledgeHubPanel";
import { HandoffsPanel } from "../../../components/HandoffsPanel";

type Tab = "knowledge" | "chat" | "handoffs";

const TABS: { id: Tab; label: string }[] = [
  { id: "knowledge", label: "Knowledge Hub" },
  { id: "chat", label: "Chat Demo" },
  { id: "handoffs", label: "Handoffs" },
];

interface Client {
  id: string;
  name: string;
}

/**
 * One dynamic route serves every client — there is no per-company file to
 * generate or deploy. Adding a company on the mother dashboard's Clients
 * tab makes its dashboard exist here immediately, and any future edit to
 * this page or the shared panels it renders applies to every client at
 * once, not one at a time.
 */
export default function ClientDashboardPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params.businessId;

  const [tab, setTab] = useState<Tab>("knowledge");
  const [client, setClient] = useState<Client | null>(null);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((data) => {
        const match = (data.clients as Client[]).find((c) => c.id === businessId);
        setClient(match ?? null);
      });
  }, [businessId]);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 40 }}>
      <h1>{client?.name ?? businessId}</h1>
      <p style={{ opacity: 0.6, marginTop: -8 }}>
        Client dashboard — no login yet, internal use only.{" "}
        <a href="/dashboard">Back to mother dashboard</a>
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

      <div style={{ display: tab === "knowledge" ? "block" : "none" }}>
        <KnowledgeHubPanel businessId={businessId} />
      </div>
      <div style={{ display: tab === "chat" ? "block" : "none" }}>
        <ChatWidget businessId={businessId} />
      </div>
      <div style={{ display: tab === "handoffs" ? "block" : "none" }}>
        <HandoffsPanel businessId={businessId} />
      </div>
    </main>
  );
}
