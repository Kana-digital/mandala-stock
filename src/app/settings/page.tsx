'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Upload, Save, RotateCcw, HelpCircle, FileSpreadsheet } from 'lucide-react';
import { exportAll, importAll, getSettings, saveSettings, exportSnapshotsCSV } from '@/storage/db';
import type { Settings, AxisId } from '@/domain/types';

const AXES: { id: AxisId; label: string }[] = [
  { id: 'earnings',   label: '① 業績' },
  { id: 'finance',    label: '② 財務' },
  { id: 'valuation',  label: '③ バリュエーション' },
  { id: 'technical',  label: '④ テクニカル&チャート' },
  { id: 'industry',   label: '⑤ 業界・テーマ' },
  { id: 'macro',      label: '⑥ マクロ' },
  { id: 'attention',  label: '⑦ 投資家注目度' },
  { id: 'shikiho',    label: '⑧ 四季報定性' },
];

const DEFAULT_WEIGHTS: [number, number, number, number, number, number, number, number] = [1, 1, 1, 1, 1, 1, 1, 1];

export default function SettingsPage() {
  const [msg, setMsg] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const onExport = async () => {
    const json = await exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mandala-stock-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('エクスポートしました');
  };

  const onExportCSV = async () => {
    const csv = await exportSnapshotsCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mandala-snapshots-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('スナップショットCSVをエクスポートしました');
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const r = await importAll(text);
      setMsg(`${r.count}銘柄をインポートしました`);
    } catch (err) {
      setMsg('インポート失敗：' + (err as Error).message);
    }
  };

  const updateWeight = (i: number, v: number) => {
    if (!settings) return;
    const next = [...settings.defaultWeights] as Settings['defaultWeights'];
    next[i] = Math.max(0, Math.min(5, v));
    setSettings({ ...settings, defaultWeights: next });
  };

  const updateThreshold = (key: 'buy' | 'hold', v: number) => {
    if (!settings) return;
    setSettings({
      ...settings,
      thresholds: { ...settings.thresholds, [key]: Math.max(0, Math.min(100, v)) },
    });
  };

  const onSave = async () => {
    if (!settings) return;
    await saveSettings(settings);
    setMsg('保存しました');
  };

  const onReset = () => {
    if (!settings) return;
    setSettings({ ...settings, defaultWeights: DEFAULT_WEIGHTS, thresholds: { buy: 80, hold: 60 } });
    setMsg('既定値に戻しました（保存ボタンで反映）');
  };

  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-md mx-auto flex items-center px-4 py-3">
          <Link href="/" className="flex items-center gap-1 text-slate-300 hover:text-gold p-1">
            <ArrowLeft size={20} />
            <span className="text-sm">戻る</span>
          </Link>
          <h1 className="flex-1 text-center font-serif text-gold">設定</h1>
          <Link href="/help" className="text-slate-300 hover:text-gold p-1">
            <HelpCircle size={20} />
          </Link>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* 重み調整 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-3">8軸の重み</h2>
          <p className="text-xs text-slate-400 mb-3">
            重要視したい軸を高めに（0〜5）。総合スコアの加重平均に反映されます。
          </p>
          {settings && (
            <div className="space-y-2">
              {AXES.map((a, i) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 flex-1 truncate">{a.label}</span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={settings.defaultWeights[i]}
                    onChange={(e) => updateWeight(i, Number(e.target.value))}
                    className="w-32 accent-gold"
                  />
                  <span className="font-mono text-xs text-gold w-8 text-right">
                    {settings.defaultWeights[i].toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* しきい値 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2">スコアしきい値</h2>
          {settings && (
            <div className="space-y-2 mt-2">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gold w-20">買い ≥</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.thresholds.buy}
                  onChange={(e) => updateThreshold('buy', Number(e.target.value))}
                  className="flex-1 bg-ink-800 ring-1 ring-ink-700 rounded-lg px-3 py-1.5 text-white tabular-nums"
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-jade-light w-20">中立 ≥</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.thresholds.hold}
                  onChange={(e) => updateThreshold('hold', Number(e.target.value))}
                  className="flex-1 bg-ink-800 ring-1 ring-ink-700 rounded-lg px-3 py-1.5 text-white tabular-nums"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                既定: 買い 80 / 中立 60 / 見送り 60未満
              </p>
            </div>
          )}
        </section>

        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-ink-800 ring-1 ring-ink-700 text-slate-300"
          >
            <RotateCcw size={16} /> 既定に戻す
          </button>
          <button
            onClick={onSave}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-jade to-gold text-ink-950 font-bold"
          >
            <Save size={16} /> 保存
          </button>
        </div>

        {/* バックアップ */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-3">バックアップ</h2>
          <p className="text-xs text-slate-400 mb-3">
            データはこの端末のブラウザ内（IndexedDB）に保存されています。月1回程度、JSONとしてエクスポートしておくことを推奨します。
          </p>
          <div className="space-y-2">
            <button onClick={onExport}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-ink-950 font-bold">
              <Download size={18} /> JSONエクスポート
            </button>
            <label className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-ink-800 ring-1 ring-ink-700 text-slate-200 font-medium cursor-pointer">
              <Upload size={18} /> JSONインポート
              <input type="file" accept="application/json" onChange={onImport} className="hidden" />
            </label>
            <button onClick={onExportCSV}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-ink-800 ring-1 ring-jade/40 text-jade-light font-medium">
              <FileSpreadsheet size={18} /> スナップショットをCSV出力
            </button>
            <p className="text-[10px] text-slate-500 mt-1">
              CSVは日次の総合・軸スコアを行ごとに出力。Excel/Sheetsで分析できます。
            </p>
          </div>
        </section>

        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2">バージョン</h2>
          <p className="text-xs text-slate-400">マンダラ株分析 Phase 3+</p>
        </section>

        {msg && (
          <div className="text-center text-jade-light text-sm py-2">{msg}</div>
        )}

        <p className="text-[10px] text-slate-600 text-center pt-4">
          投資判断スコアはあくまで補助です。最終判断はご自身の責任で行ってください。
        </p>
      </div>
    </main>
  );
}
