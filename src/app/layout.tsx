import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Conveyer Isabell",
  description: "Local pipeline platform for faceless AI YouTube videos.",
};

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "New run" },
  { href: "/runs", label: "Run history" },
  { href: "/library", label: "Drive library" },
  { href: "/prompts", label: "Prompts" },
  { href: "/settings", label: "Keys & Settings" },
  { href: "/settings/advanced", label: "Advanced settings" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <aside
            style={{
              width: 240,
              flexShrink: 0,
              height: "100vh",
              position: "sticky",
              top: 0,
              background: "var(--bg-deep)",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              padding: "20px 14px",
            }}
          >
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 22px" }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "linear-gradient(135deg, var(--accent), #b083ff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 15,
                  color: "#fff",
                  boxShadow: "var(--shadow-sm)",
                  flexShrink: 0,
                }}
              >
                C
              </div>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: "-0.02em" }}>
                  Conveyer Isabell
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>AI video pipeline</div>
              </div>
            </div>

            {/* Nav */}
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="nav-link">
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Footer */}
            <div style={{ marginTop: "auto", paddingTop: 14 }}>
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 12,
                  fontSize: 11,
                  color: "var(--fg-faint)",
                  padding: "12px 10px 2px",
                }}
              >
                v0.1 · runs locally
              </div>
            </div>
          </aside>

          <main style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: 1080, padding: "32px 36px 80px" }}>
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
