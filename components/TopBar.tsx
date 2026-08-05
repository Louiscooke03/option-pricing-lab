export default function TopBar() {
  return (
    <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-background/90 px-6 font-mono text-xs backdrop-blur sm:px-8">
      <a
        href="https://louiscooke.com"
        className="text-muted transition-colors hover:text-foreground"
      >
        LC Studio
      </a>
      <span className="hidden text-foreground sm:inline">Option Pricing Lab</span>
      <a
        href="/dissertation.pdf"
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent transition-colors hover:text-accent-hover"
      >
        Dissertation (PDF)
      </a>
    </div>
  );
}
