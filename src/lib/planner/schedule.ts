/**
 * 11.5：決まった訪問順について、開始時刻から順に到着・滞在・出発を計算する。
 * - 昼食休憩：11:30〜13:30 の間で最初に空いた時点に 60 分入れる。
 * - 営業時間（openingHours があるときだけ）：到着が営業時間外なら feasible=false。
 * - 終了時刻超過（到着地があれば到着地への到着、なければ最後の出発）なら feasible=false。
 */
import { PLAN_DEFAULTS, type Interest, type Pace } from "@/lib/domain/constants";
import type { PlanItem, SkipReason } from "@/lib/domain/types";
import { spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes, jstWeekday, minutesToHHMM } from "@/lib/utils/time";
import { bestHoursOf, isInBestTime } from "./bestHours";
import { computeStayMinutes } from "./stay";
import type { PlannerSpot, TravelMatrix } from "./types";

export interface ScheduleOptions {
  startMin: number;
  endMin: number;
  originKey: string;
  destinationKey: string | null;
  lunchBreak: boolean;
  /** YYYY-MM-DD */
  date: string;
  /** spotId → 分。指定したスポットは計算値の代わりにこの値を使う */
  stayOverrides?: Record<string, number>;
  matrix: TravelMatrix;
  /** 滞在時間の計算に使う（stayOverrides に無いスポット）。省略時は [] / normal */
  interests?: readonly Interest[];
  pace?: Pace;
}

export interface ScheduleResult {
  items: PlanItem[];
  /** 到着地があればそこへの到着時刻、なければ最後の出発時刻（0:00 からの分） */
  endMin: number;
  totalTravelMin: number;
  feasible: boolean;
  /** おすすめ時間帯があるスポットのうち、外れた時間に到着したものの滞在分の合計 */
  offBestMinutes: number;
  /** feasible=false の理由（最初に見つかったもの） */
  infeasibleReason?: SkipReason;
  /** infeasibleReason が no_route / opening_hours のとき、そのスポット */
  infeasibleSpotId?: string;
}

/** 秒を分に切り上げる（移動時間を過小に見積もらない） */
export function travelMinutes(durationSec: number): number {
  return Math.ceil(Math.max(0, durationSec) / 60);
}

/** 行列から区間の移動分を引く。同じ地点なら 0、無ければ null（経路なし） */
export function legMinutes(matrix: TravelMatrix, fromKey: string, toKey: string): number | null {
  if (fromKey === toKey) return 0;
  const leg = matrix.get(`${fromKey}|${toKey}`);
  return leg ? travelMinutes(leg.durationSec) : null;
}

/**
 * 営業時間の判定。openingHours が null、またはその曜日が未設定なら判定しない（true）。
 * 曜日の値が null なら定休日（false）。それ以外は open <= 到着 < close。
 */
export function isOpenAt(spot: Pick<PlannerSpot, "openingHours">, date: string, arriveMin: number): boolean {
  if (!spot.openingHours) return true;
  const wd = String(jstWeekday(date)) as keyof NonNullable<PlannerSpot["openingHours"]>;
  const entry = spot.openingHours[wd];
  if (entry === undefined) return true;
  if (entry === null) return false;
  const open = hhmmToMinutes(entry.open);
  const close = hhmmToMinutes(entry.close);
  const t = arriveMin % 1440;
  return t >= open && t < close;
}

export function buildSchedule(order: readonly PlannerSpot[], opts: ScheduleOptions): ScheduleResult {
  const lunchStart = hhmmToMinutes(PLAN_DEFAULTS.lunchWindowStart);
  const lunchEnd = hhmmToMinutes(PLAN_DEFAULTS.lunchWindowEnd);
  const lunchMin = PLAN_DEFAULTS.lunchMinutes;
  const interests = opts.interests ?? [];
  const pace = opts.pace ?? "normal";

  const items: PlanItem[] = [];
  let t = opts.startMin;
  let prevKey = opts.originKey;
  let totalTravelMin = 0;
  let offBestMinutes = 0;
  let feasible = true;
  let infeasibleReason: SkipReason | undefined;
  let infeasibleSpotId: string | undefined;
  // 窓の終わりを過ぎてから始まる日には昼食を入れない
  let lunchPending = opts.lunchBreak && opts.startMin <= lunchEnd;

  const markInfeasible = (reason: SkipReason, spotId?: string) => {
    if (feasible) {
      feasible = false;
      infeasibleReason = reason;
      infeasibleSpotId = spotId;
    }
  };

  /** 直前の項目の travelMinToNext を埋める */
  const setTravelToNext = (min: number) => {
    const last = items[items.length - 1];
    if (last) last.travelMinToNext = min;
  };

  const pushLunch = (arrive: number) => {
    items.push({ type: "lunch", arrive: minutesToHHMM(arrive), stayMin: lunchMin, depart: minutesToHHMM(arrive + lunchMin), travelMinToNext: null });
    lunchPending = false;
    return arrive + lunchMin;
  };

  // 出発地で既に窓に入っていれば最初に昼食
  if (lunchPending && t >= lunchStart) {
    t = pushLunch(t);
  }

  for (const spot of order) {
    const key = spotKey(spot.id);
    const travel = legMinutes(opts.matrix, prevKey, key);
    if (travel === null) {
      markInfeasible("no_route", spot.id);
      break;
    }
    setTravelToNext(travel);
    totalTravelMin += travel;
    let arrive = t + travel;

    // 窓の開始時に移動中で、窓の中に到着するなら到着後すぐに昼食
    if (lunchPending && arrive >= lunchStart && arrive <= lunchEnd) {
      arrive = pushLunch(arrive);
      setTravelToNext(0);
    }

    if (!isOpenAt(spot, opts.date, arrive)) {
      markInfeasible("opening_hours", spot.id);
    }
    if (arrive > opts.endMin) {
      markInfeasible("time_limit", spot.id);
    }

    const stayMin = opts.stayOverrides?.[spot.id] ?? computeStayMinutes(spot, interests, pace);
    const bestHours = bestHoursOf(spot);
    const inBestTime = isInBestTime(arrive, bestHours);
    if (bestHours && !inBestTime) offBestMinutes += stayMin;

    const depart = arrive + stayMin;
    items.push({
      type: "spot",
      spotId: spot.id,
      arrive: minutesToHHMM(arrive),
      stayMin,
      depart: minutesToHHMM(depart),
      travelMinToNext: null,
      inBestTime,
    });
    t = depart;
    prevKey = key;

    // 出発時刻が窓の開始以降なら、その直後に昼食（窓を過ぎていても最初の出発直後に入れる）
    if (lunchPending && t >= lunchStart) {
      setTravelToNext(0);
      t = pushLunch(t);
    }
  }

  let endMin = t;
  if (feasible || infeasibleReason !== "no_route") {
    if (opts.destinationKey) {
      const travel = legMinutes(opts.matrix, prevKey, opts.destinationKey);
      if (travel === null) {
        markInfeasible("no_route");
      } else {
        setTravelToNext(travel);
        totalTravelMin += travel;
        endMin = t + travel;
      }
    }
  }
  if (endMin > opts.endMin) markInfeasible("time_limit");

  return { items, endMin, totalTravelMin, feasible, offBestMinutes, infeasibleReason, infeasibleSpotId };
}
