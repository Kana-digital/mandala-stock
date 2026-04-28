'use client';

import type { Snapshot } from '@/domain/types';

interface Props {
  snapshots: Snapshot[];
  width?: number;
  height?: number;
}

/** 銘柄カード用の超ミニチャート */
export default function Sparkline({ snapshots, width = 60, height = 22 }: Props) {
  if (snapshots.length < 2) return null;
  const data = snapshots.slice(-14);
  const min = Math.min(...data.map((s) => s.totalScore));
  const max = Math.max(...data.map((s) => s.totalScore));
  const range = Math.max(1, max - min);
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / range) * height;
  const pts = data.map((s, i) => `${x(i)},${y(s.totalScore)}`).join(' ');
  const last = data[data.length - 1].totalScore;
  const first = data[0].totalScore;
  const up = last >= first;

  return (
    <svg width={width} height={height} className="opacity-90">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? '#10B981' : '#DC2626'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(data.length - 1)} cy={y(last)} r={1.8} fill={up ? '#34D399' : '#EF4444'} />
    </svg>
  );
}
