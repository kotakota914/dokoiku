import { Badge, cn } from "@/components/ui";

export interface HourHistogramProps {
  /** 24 要素。各時間帯（日本時間）の投稿数 */
  histogram: readonly number[];
  className?: string;
}

/** 3 時間おきに目盛りラベルを出す */
const LABEL_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

/** 24 要素に正規化する（足りなければ 0 埋め、多ければ切り捨て） */
export function normalizeHistogram(histogram: readonly number[]): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    const v = histogram[h];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  });
}

/** 最も投稿が多い時間帯（同数なら早い方）。投稿が無ければ null */
export function peakHour(histogram: readonly number[]): number | null {
  const values = normalizeHistogram(histogram);
  let best = -1;
  let bestValue = 0;
  values.forEach((v, h) => {
    if (v > bestValue) {
      bestValue = v;
      best = h;
    }
  });
  return best >= 0 ? best : null;
}

/**
 * F-3-1：投稿が多い時間帯の 24 時間棒グラフ。純粋な div で描き、最大値を 100% として高さを決める。
 * 色はトークンのみ（最も多い時間帯は bg-primary、それ以外は bg-primary-soft に枠線）。
 */
export function HourHistogram({ histogram, className }: HourHistogramProps) {
  const values = normalizeHistogram(histogram);
  const max = Math.max(0, ...values);
  const peak = peakHour(values);
  const total = values.reduce((a, b) => a + b, 0);
  const summary =
    peak === null
      ? "投稿時間帯の情報はまだありません"
      : `投稿が最も多い時間帯は${peak}時台です（${values[peak]}件）`;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {peak === null ? (
          <Badge icon="clock" tone="muted">
            情報なし
          </Badge>
        ) : (
          <Badge icon="clock" tone="primary">
            最も多い時間帯：{peak}時台
          </Badge>
        )}
        <span className="text-base text-text-muted">投稿 {total} 件の時刻の分布</span>
      </div>
      <div role="img" aria-label={summary} className="flex flex-col gap-1">
        <div className="flex h-28 items-end gap-0.5 sm:gap-1" data-testid="hour-histogram">
          {values.map((v, h) => {
            const pct = max > 0 ? Math.round((v / max) * 100) : 0;
            return (
              <div key={h} className="flex h-full flex-1 items-end" title={`${h}時台：${v}件`}>
                <div
                  data-testid="hour-bar"
                  data-hour={h}
                  style={{ height: `${pct}%` }}
                  className={cn(
                    "w-full rounded-t-sm border border-border transition-[height]",
                    pct === 0
                      ? "border-transparent bg-transparent"
                      : h === peak
                        ? "bg-primary"
                        : "bg-primary-soft",
                  )}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-0.5 sm:gap-1" aria-hidden="true">
          {values.map((_, h) => (
            <div key={h} className="flex-1 text-center text-xs leading-4 text-text-muted">
              {LABEL_HOURS.includes(h) ? h : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
