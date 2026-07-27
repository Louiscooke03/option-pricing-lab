interface SectionNumberProps {
  current: number;
  total: number;
  className?: string;
}

export default function SectionNumber({ current, total, className = "" }: SectionNumberProps) {
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <span className={`font-mono text-xs tracking-widest text-muted ${className}`}>
      {pad(current)} / {pad(total)}
    </span>
  );
}
