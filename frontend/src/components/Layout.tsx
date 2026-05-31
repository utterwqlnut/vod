import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="logo">
          Open<span>VOD</span>
        </Link>
        <p className="tagline">Adaptive streaming from your catalog</p>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
