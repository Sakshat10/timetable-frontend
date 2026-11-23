"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#666" }}>The application could not load. Please try again.</p>
          <button type="button" onClick={reset} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
