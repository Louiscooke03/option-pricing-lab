import { ReactNode } from "react";

interface EquationBlockProps {
  children?: ReactNode;
  equation?: string;
  caption?: string;
  className?: string;
}

export default function EquationBlock({
  children,
  equation,
  caption,
  className = "",
}: EquationBlockProps) {
  return (
    <div className={`rounded-md border border-border bg-surface px-5 py-4 ${className}`}>
      <div className="overflow-x-auto font-mono text-sm text-foreground">
        {children ?? equation}
      </div>
      {caption && <p className="mt-3 font-mono text-xs text-muted">{caption}</p>}
    </div>
  );
}
