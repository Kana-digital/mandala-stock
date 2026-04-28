'use client';

import type { Stock, AxisId } from '@/domain/types';
import { axisLabel } from '@/domain/seed';

interface Props {
  stock: Stock;
  size?: number;
}

const ORDER: AxisId[] = ['earnings', 'finance', 'valuation', 'technical', 'industry', 'macro', 'attention', 'shikiho'];

/** SVG レーダーチャート (8軸 / 0-100) — 依存ライブラリ無し */
export default function RadarChart({ stock, size = 240 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.4;

  // 軸ごとのスコア（無入力は 0）
  const scores = ORDER.map((axis) => {
    const m = stock.subs[axis];
    const v = m?.cells[4]?.score;
    return typeof v === 'number' ? v : 0;
  });

  // 各頂点座標を計算（時計回り、上を 0°）
  const point = (i: number, value: number) => {
    const angle = (i / ORDER.length) * Math.PI * 2 - Math.PI / 2;
    const len = (value / 100) * r;
    return [cx + Math.cos(angle) * len, cy + Math.sin(angle) * len] as const;
  };
  const labelPoint = (i: number) => {
    const angle = (i / ORDER.length) * Math.PI * 2 - Math.PI / 2;
    const len = r + 14;
    return [cx + Math.cos(angle) * len, cy + Math.sin(angle) * len] as const;
  };

  const polygon = scores.map((v, i) => point(i, v).join(',')).join(' ');
  const gridLevels = [25, 50, 75, 100];

  return (
    <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-serif text-center">
        八方位プロファイル
      </div>
      <svg width={size} height={size} className="mx-auto block">
        {/* グリッド (同心多角形) */}
        {gridLevels.map((lv) => {
          const pts = ORDER.map((_, i) => point(i, lv).join(',')).join(' ');
          return (
            <polygon
              key={lv}
              points={pts}
              fill="none"
              stroke="rgba(212,175,55,0.12)"
              strokeWidth={1}
            />
          );
        })}
        {/* 軸線 */}
        {ORDER.map((_, i) => {
          const [x, y] = point(i, 100);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(212,175,55,0.15)"
              strokeWidth={1}
            />
          );
        })}
        {/* スコア多角形 */}
        <polygon
          points={polygon}
          fill="rgba(16,185,129,0.25)"
          stroke="#10B981"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* 各頂点 */}
        {scores.map((v, i) => {
          const [x, y] = point(i, v);
          return <circle key={i} cx={x} cy={y} r={3} fill="#D4AF37" />;
        })}
        {/* ラベル */}
        {ORDER.map((axis, i) => {
          const [x, y] = labelPoint(i);
          const label = axisLabel(axis).replace(/^[①-⑧]\s*/, '');
          return (
            <text
              key={axis}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fill="rgb(148,163,184)"
              fontFamily="sans-serif"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
