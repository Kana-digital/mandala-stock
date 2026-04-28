'use client';

import Link from 'next/link';
import { ArrowLeft, BookOpen, Sparkles, Wand2, Camera, Settings as SettingsIcon, Download, Trophy, Compass, Info } from 'lucide-react';

export default function HelpPage() {
  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-md mx-auto flex items-center px-4 py-3">
          <Link href="/settings" className="flex items-center gap-1 text-slate-300 hover:text-gold p-1">
            <ArrowLeft size={20} />
            <span className="text-sm">戻る</span>
          </Link>
          <h1 className="flex-1 text-center font-serif text-gold flex items-center justify-center gap-1">
            <BookOpen size={16} /> 使い方
          </h1>
          <span className="w-10" />
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 py-6 space-y-4 pb-12">
        {/* イントロ */}
        <section className="bg-gradient-to-br from-gold/10 to-jade/10 ring-1 ring-gold/30 rounded-2xl p-4">
          <h2 className="font-serif text-gold text-lg flex items-center gap-2">
            <Sparkles size={18} /> マンダラ株分析へようこそ
          </h2>
          <p className="text-xs text-slate-300 mt-2 leading-relaxed">
            8つの観点（軸）から銘柄を分析し、入れ子のマンダラチャートで「健全性」を一目で把握できます。
            各セルにスコア（0〜100）を入力／自動取得し、加重平均で総合スコアを算出します。
          </p>
        </section>

        {/* 8軸 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 flex items-center gap-2">
            <Compass size={16} /> 8軸とは
          </h2>
          <ol className="space-y-1.5 text-xs text-slate-300 list-none pl-0">
            <li>① <span className="text-gold">業績</span> — 売上/EPS/利益率の伸び</li>
            <li>② <span className="text-gold">財務</span> — 自己資本/負債/CF の健全性</li>
            <li>③ <span className="text-gold">バリュエーション</span> — PER/PBR/PEG など</li>
            <li>④ <span className="text-gold">テクニカル&チャート</span> — トレンド/カップウィズハンドル等のパターン</li>
            <li>⑤ <span className="text-gold">業界・テーマ</span> — 業界成長率/競争環境</li>
            <li>⑥ <span className="text-gold">マクロ</span> — 金利/為替/指数</li>
            <li>⑦ <span className="text-gold">投資家注目度</span> — 大量保有報告/ニュース/Trends</li>
            <li>⑧ <span className="text-gold">四季報定性</span> — 会社の特色/材料</li>
          </ol>
        </section>

        {/* マンダラ操作 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2">マンダラの操作</h2>
          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              <span className="text-jade-light">▸ 中心セル</span>＝ 自動計算（加重平均スコア）。タップ不可。
            </li>
            <li>
              <span className="text-jade-light">▸ 周囲セル</span>（軸）＝ タップでサブマンダラ（第2階層）に展開。
            </li>
            <li>
              <span className="text-jade-light">▸ サブマンダラ</span>＝ 各セルをタップでスコア・メモを入力。
            </li>
          </ul>
        </section>

        {/* 自動入力 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 flex items-center gap-2">
            <Wand2 size={16} /> 自動入力（API）
          </h2>
          <p className="text-xs text-slate-300 mb-2">
            サブマンダラ画面の「API から自動入力」ボタンで、対応している軸はサーバー経由で値を取得できます。
          </p>
          <table className="w-full text-[11px] text-slate-300">
            <thead>
              <tr className="text-gold/80 border-b border-ink-800">
                <th className="text-left py-1">軸</th>
                <th className="text-left py-1">データソース</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="py-1">業績</td><td>J-Quants</td></tr>
              <tr><td className="py-1">テクニカル</td><td>J-Quants 日足</td></tr>
              <tr><td className="py-1">マクロ</td><td>FRED / BOJ / e-Stat</td></tr>
              <tr><td className="py-1">注目度</td><td>EDINET / NewsAPI / Google Trends</td></tr>
            </tbody>
          </table>
          <p className="text-[10px] text-slate-500 mt-2">
            ※ 環境変数で API キーが未設定の軸はモック値で動作します。
          </p>
        </section>

        {/* スナップショット */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 flex items-center gap-2">
            <Camera size={16} /> スナップショットと推移
          </h2>
          <p className="text-xs text-slate-300">
            銘柄詳細の「今日のスコアを保存」で日次スナップショットを記録します。
            アプリ起動時にも当日分が無ければ自動保存します。蓄積されると：
          </p>
          <ul className="space-y-1 text-xs text-slate-300 mt-2 ml-4 list-disc">
            <li>銘柄一覧カードに <span className="text-jade-light">スパークライン</span> 表示</li>
            <li>詳細画面に <span className="text-jade-light">推移チャート</span> 表示</li>
            <li>後述のバックテストで実株価との相関を分析</li>
          </ul>
        </section>

        {/* 設定 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 flex items-center gap-2">
            <SettingsIcon size={16} /> 重み・しきい値
          </h2>
          <p className="text-xs text-slate-300">
            「設定」画面で各軸の重み（0〜5）を調整できます。重要視したい軸を高めにすると、
            総合スコアの加重平均がその軸寄りになります。
          </p>
          <p className="text-xs text-slate-300 mt-2">
            買い／中立のしきい値も変更できます。既定では <span className="text-gold">買い ≥ 80</span>、
            <span className="text-jade-light"> 中立 ≥ 60</span>、それ未満は見送りです。
          </p>
        </section>

        {/* 徽章 */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 flex items-center gap-2">
            <Trophy size={16} /> 徽章（バッジ）
          </h2>
          <p className="text-xs text-slate-300">
            スコアや完了率に応じて自動で徽章が付与されます。例：
          </p>
          <ul className="space-y-1 text-xs text-slate-300 mt-2 ml-4 list-disc">
            <li>🥇 総合80以上 → 「金牌」</li>
            <li>🌸 全72セル入力 → 「満開マンダラ」</li>
            <li>🚀 30日内に総合+10以上 → 「上昇龍」</li>
          </ul>
        </section>

        {/* バックアップ */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 flex items-center gap-2">
            <Download size={16} /> バックアップ
          </h2>
          <p className="text-xs text-slate-300">
            データはこの端末のブラウザ内（IndexedDB）に保存されます。
            設定画面の「JSONエクスポート」で月1回程度の保管を推奨します。
            機種変や別ブラウザで使う際はインポートで復元できます。
          </p>
        </section>

        {/* 注意 */}
        <section className="bg-cinnabar/10 ring-1 ring-cinnabar/30 rounded-2xl p-4">
          <h2 className="font-bold text-cinnabar-light mb-2 flex items-center gap-2">
            <Info size={16} /> ご注意
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            本アプリのスコアは投資判断の補助情報です。最終的な売買の判断はご自身の責任で行ってください。
            データソースは無償 API を中心に採用しているため、提供停止や仕様変更により値が取得できない場合があります。
          </p>
        </section>

        <div className="text-center pt-2">
          <Link
            href="/"
            className="inline-block px-6 py-2 rounded-full bg-gradient-to-r from-gold to-gold-dark text-ink-950 text-sm font-bold"
          >
            銘柄一覧へ
          </Link>
        </div>
      </div>
    </main>
  );
}
