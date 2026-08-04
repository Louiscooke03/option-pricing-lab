"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/svi", label: "SVI" },
  { href: "/arbitrage", label: "Arbitrage" },
  { href: "/surface", label: "Surface" },
  { href: "/how-it-works", label: "How it works" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1 overflow-x-auto px-6 py-3 sm:px-8">
        {LINKS.map(({ href, label }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
