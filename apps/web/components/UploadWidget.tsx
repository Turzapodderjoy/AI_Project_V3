"use client";

import { useState } from "react";

export function UploadWidget({
  businessId = "default",
  onUploaded,
}: {
  businessId?: string;
  onUploaded?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function upload(file: File) {
    setLoading(true);

    const form = new FormData();
    form.append("file", file);
    form.append("businessId", businessId);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      setMessage(JSON.stringify(data, null, 2));
      onUploaded?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        disabled={loading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          upload(file);
        }}
      />

      {loading && <p style={{ opacity: 0.6 }}>Uploading…</p>}

      {message && (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{message}</pre>
      )}
    </div>
  );
}
