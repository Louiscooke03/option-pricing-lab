interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

export default function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  className = "",
}: SliderProps) {
  return (
    <label className={`flex flex-col gap-2 ${className}`}>
      <span className="flex items-baseline justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-mono text-sm text-foreground">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border accent-accent"
      />
    </label>
  );
}
