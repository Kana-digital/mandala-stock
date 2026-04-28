'use client';

import type { Snapshot } from '@/domain/types';

interface Props {
  snapshots: Snapshot[];
  width?: number;
  height?: number;
}

/**
 * 軽量 SVG ラインチャート（直近のスナップショット推移）。
 * recharts を入れずに済むようインラインで実装。
 */
export default function SnapshotChart({ snapshots, width = 320, height = 120 }: Props) {
  if (snapshots.length === 0) {
    return <div className="text-center text-xs text-slate-500 py-8">スナップショット未保存</div>;
  }

  const data = snapshots.slice(-30); // 直近30日
  const min = 0, max = 100;
  const padX = 6, padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const x = (i: number) => padX + (i / Math.max(1, data.length - 1)) * innerW;
  const y = (v: number) => padY + innerH - ((v - min) / (max - min)) * innerH;
  const points = data.map((s, i) => `${x(i)},${y(s.totalScore)}`).join(' ');

  // 直近値
  const latest = data[data.length - 1].totalScore;
  const earliest = data[0].totalScore;
  const delta = latest - earliest;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1 px-1">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-serif">推移</span>
        <span className="text-xs text-slate-400">{data.length}日分</span>
        {delta !== 0 && (
          <span className={`text-[10px] ml-auto ${delta > 0 ? 'text-jade-light' : 'text-cinnabar-light'}`}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}
          </span>
        )}
      </div>
      <svg width={width} height={height} className="bg-ink-950 rounded-xl ring-1 ring-gold/20">
        {/* 80/60 のしきい値ライン */}
        <line x1={padX} x2={width - padX} y1={y(80)} y2={y(80)} stroke="rgba(212,175,55,0.25)" strokeDasharray="2 3" />
        <line x1={padX} x2={width - padX} y1={y(60)} y2={y(60)} stroke="rgba(148,163,184,0.2)" strokeDasharray="2 3" />
        <polyline
          points={points}
          fill="none"
          stroke="url(#gradLine)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 最新点ハイライト */}
        <circle cx={x(data.length - 1)} cy={y(latest)} r={4} fill="#D4AF37" />
        <defs>
          <linearGradient id="gradLine" x1="0" x2="1">
            <stop offset="0" stopColor="#10B981" />
            <stop offset="1" stopColor="#D4AF37" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
