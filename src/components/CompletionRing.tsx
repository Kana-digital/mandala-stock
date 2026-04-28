'use client';

export default function CompletionRing({ filled, total, size = 48 }: { filled: number; total: number; size?: number }) {
  const pct = total === 0 ? 0 : filled / total;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGrad)"
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D4AF37" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gold tabular-nums">
        {filled}/{total}
      </div>
    </div>
  );
}
