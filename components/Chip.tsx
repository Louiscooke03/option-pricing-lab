import { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  className?: string;
}

export default function Chip({ children, className = "" }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted ${className}`}
    >
      {children}
    </span>
  );
}
