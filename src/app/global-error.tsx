"use client";

// Last resort when the root layout itself fails, so it brings its own <html>.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "80px auto", padding: "0 16px", lineHeight: 1.5 }}>
        <h1 style={{ fontSize: 28 }}>Flatdesk hit a problem</h1>
        <p>Nothing you had already saved is lost. Try again in a moment.</p>
        <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}>
          Try again
        </button>
        {error.digest && <p style={{ fontSize: 12, color: "#666" }}>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
