/**
 * 11.2 の 5：決まった訪問順について、開始時刻から順に到着・滞在・出発を計算する。
 * - 昼食休憩：11:30〜13:30 の間で最初に空いた時点（出発地・スポット到着時・スポット出発時）に 60 分入れる。
 *   窓の中に空きが無い（1 つの滞在が窓を跨ぐ）ときは昼食を入れず lunchSkipped=true にする（窓の外には入れない）。
 * - 時刻の指定（preferences.timeWindows）：到着が from〜to の外なら feasible=false。
 * - 営業時間（openingHours があるときだけ）：到着が営業時間外なら feasible=false。
 * - 終了時刻超過（到着地があれば到着地への到着、なければ最後の出発）なら feasible=false。
 *
 * 全探索（最大 8! 通り）で呼ぶため、滞在時間・おすすめ時間帯・時刻の指定は prepareSpots() で先に求め、
 * simulate() は数値だけを扱う。PlanItem の文字列（HH:MM）は選ばれた順だけ materialize() で作る。
 */
import { PLAN_DEFAULTS, type TravelMode } from "@/lib/domain/constants";
import type { PlanItem, PlanLeg, PlanPreferences, SkipReason } from "@/lib/domain/types";
import { spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes, jstWeekday, minutesToHHMM } from "@/lib/utils/time";
import { bestHoursOf, bestTimeDeviation, isInBestTime, timeWindowDeviation } from "./bestHours";
import { computeStayMinutes } from "./stay";
import type { PlannerSpot, TravelLeg, TravelMatrix } from "./types";

export interface ScheduleOptions {
  startMin: number;
  endMin: number;
  originKey: string;
  destinationKey: string | null;
  lunchBreak: boolean;
  /** YYYY-MM-DD */
  date: string;
  /** プランの移動手段（区間に mode が無いときの既定値） */
  mode: TravelMode;
  /** spotId → 分。指定したスポットは計算値の代わりにこの値を使う */
  stayOverrides?: Record<string, number>;
  matrix: TravelMatrix;
  /** 滞在時間（pace / interests）と時刻の指定（timeWindows）に使う。省略時は初期値 */
  preferences?: Pick<PlanPreferences, "pace" | "interests" | "timeWindows">;
}

/** 全探索の前に 1 回だけ求めておく、スポットごとの固定値 */
export interface PreparedSpot {
  spot: PlannerSpot;
  key: string;
  stayMin: number;
  bestHours: Set<number> | null;
  /** AIと相談の時刻の指定（到着が from〜to）。あればおすすめ時間帯より優先する */
  window: { fromMin: number; toMin: number } | null;
}

/** 到着・出発（0:00 からの分）など、1 つの訪問順の数値だけの計算結果 */
export interface Simulation {
  feasible: boolean;
  /** feasible=false の理由（最初に見つかったもの） */
  infeasibleReason?: SkipReason;
  /** infeasibleReason が no_route / opening_hours / time_limit（時刻の指定）のとき、そのスポット */
  infeasibleSpotId?: string;
  arrive: number[];
  depart: number[];
  /** legs[i] はスポット i への区間（直前の地点から）。legs[n] は到着地への区間（無ければ null） */
  legs: (TravelLeg | null)[];
  /** 昼食の位置：出発地で最初 / スポット index の到着直後 / スポット index の出発直後 */
  lunch: { kind: "start" | "before" | "after"; index: number; arrive: number } | null;
  /** 到着地があればそこへの到着時刻、なければ最後の出発時刻 */
  endMin: number;
  totalTravelMin: number;
  /** 歩く距離（m）。徒歩の区間と、公共交通の区間に含まれる徒歩（取得できた場合） */
  walkM: number;
  /** おすすめ時間帯（または時刻の指定）からのずれ（分）の合計 */
  offBestMinutes: number;
  /** おすすめの時間帯（または時刻の指定）に着いた数 */
  bestTimeHits: number;
  /** 直線距離の概算の区間があるか */
  estimated: boolean;
  /** 公共交通で取れず徒歩にした区間があるか */
  walkFallback: boolean;
  /** 昼食休憩を希望したが、11:30〜13:30 の間に空きが無く入れられなかった */
  lunchSkipped: boolean;
}

export interface ScheduleResult extends Omit<Simulation, "arrive" | "depart" | "legs" | "lunch"> {
  items: PlanItem[];
}

/** 秒を分に切り上げる（移動時間を過小に見積もらない） */
export function travelMinutes(durationSec: number): number {
  return Math.ceil(Math.max(0, durationSec) / 60);
}

const ZERO_LEG: TravelLeg = { durationSec: 0, distanceM: 0, estimated: false, walkM: 0 };

/** 行列から区間を引く。同じ地点なら 0 の区間、無ければ null（経路なし） */
export function legOf(matrix: TravelMatrix, fromKey: string, toKey: string): TravelLeg | null {
  if (fromKey === toKey) return ZERO_LEG;
  return matrix.get(`${fromKey}|${toKey}`) ?? null;
}

/** 行列から区間の移動分を引く。同じ地点なら 0、無ければ null（経路なし） */
export function legMinutes(matrix: TravelMatrix, fromKey: string, toKey: string): number | null {
  const leg = legOf(matrix, fromKey, toKey);
  return leg ? travelMinutes(leg.durationSec) : null;
}

export function legMode(leg: TravelLeg, planMode: TravelMode): TravelMode {
  return leg.mode ?? planMode;
}

/** 区間の徒歩距離（m）。徒歩の区間は distanceM、それ以外は取得できた値（無ければ null） */
export function legWalkM(leg: TravelLeg, planMode: TravelMode): number | null {
  if (leg.walkM !== undefined) return leg.walkM;
  return legMode(leg, planMode) === "walking" ? leg.distanceM : null;
}

export function toPlanLeg(leg: TravelLeg, planMode: TravelMode): PlanLeg {
  return {
    mode: legMode(leg, planMode),
    travelMin: travelMinutes(leg.durationSec),
    estimated: leg.estimated === true,
    walkM: legWalkM(leg, planMode),
  };
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

/**
 * 昼食休憩を希望したのに窓（11:30〜13:30）に空きが無く入れられなかったか。
 * 画面（PlanResultView）でも同じ判定を使う（PlanResult には項目を増やさない）。
 * - 昼食の項目があれば false
 * - 窓の終わりより後に始まる日、または最後の出発が窓の開始より前（昼食の前に終わる日）なら false
 */
export function isLunchSkipped(lunchBreak: boolean, startMin: number, items: readonly PlanItem[]): boolean {
  if (!lunchBreak) return false;
  if (items.some((i) => i.type === "lunch")) return false;
  const lunchStart = hhmmToMinutes(PLAN_DEFAULTS.lunchWindowStart);
  const lunchEnd = hhmmToMinutes(PLAN_DEFAULTS.lunchWindowEnd);
  if (startMin > lunchEnd) return false;
  const last = items[items.length - 1];
  const lastDepart = last ? hhmmToMinutes(last.depart) : startMin;
  return lastDepart > lunchStart;
}

/** 滞在時間・おすすめ時間帯・時刻の指定をスポットごとに求める（全探索の前に 1 回） */
export function prepareSpots(spots: readonly PlannerSpot[], opts: ScheduleOptions): PreparedSpot[] {
  const pace = opts.preferences?.pace ?? "normal";
  const interests = opts.preferences?.interests ?? [];
  const windows = new Map<string, { fromMin: number; toMin: number }>();
  for (const w of opts.preferences?.timeWindows ?? []) {
    windows.set(w.spotId, { fromMin: hhmmToMinutes(w.from), toMin: hhmmToMinutes(w.to) });
  }
  return spots.map((spot) => ({
    spot,
    key: spotKey(spot.id),
    stayMin: opts.stayOverrides?.[spot.id] ?? computeStayMinutes(spot, interests, pace),
    bestHours: bestHoursOf(spot),
    window: windows.get(spot.id) ?? null,
  }));
}

export function simulate(order: readonly PreparedSpot[], opts: ScheduleOptions): Simulation {
  const lunchStart = hhmmToMinutes(PLAN_DEFAULTS.lunchWindowStart);
  const lunchEnd = hhmmToMinutes(PLAN_DEFAULTS.lunchWindowEnd);
  const lunchMin = PLAN_DEFAULTS.lunchMinutes;
  const n = order.length;

  const arrive = new Array<number>(n).fill(0);
  const depart = new Array<number>(n).fill(0);
  const legs = new Array<TravelLeg | null>(n + 1).fill(null);
  let lunch: Simulation["lunch"] = null;
  let t = opts.startMin;
  let prevKey = opts.originKey;
  let totalTravelMin = 0;
  let walkM = 0;
  let offBestMinutes = 0;
  let bestTimeHits = 0;
  let estimated = false;
  let walkFallback = false;
  let feasible = true;
  let infeasibleReason: SkipReason | undefined;
  let infeasibleSpotId: string | undefined;
  // 窓の終わりを過ぎてから始まる日には昼食を入れない
  let lunchPending = opts.lunchBreak && opts.startMin <= lunchEnd;
  let lastDepart = opts.startMin;

  const markInfeasible = (reason: SkipReason, spotId?: string) => {
    if (feasible) {
      feasible = false;
      infeasibleReason = reason;
      infeasibleSpotId = spotId;
    }
  };
  const addLeg = (leg: TravelLeg) => {
    totalTravelMin += travelMinutes(leg.durationSec);
    walkM += legWalkM(leg, opts.mode) ?? 0;
    if (leg.estimated) estimated = true;
    if (opts.mode === "transit" && legMode(leg, opts.mode) === "walking") walkFallback = true;
  };

  // 出発地で既に窓に入っていれば最初に昼食
  if (lunchPending && t >= lunchStart) {
    lunch = { kind: "start", index: -1, arrive: t };
    t += lunchMin;
    lunchPending = false;
  }

  for (let i = 0; i < n; i += 1) {
    const p = order[i];
    const leg = legOf(opts.matrix, prevKey, p.key);
    if (!leg) {
      markInfeasible("no_route", p.spot.id);
      break;
    }
    legs[i] = leg;
    addLeg(leg);
    let at = t + travelMinutes(leg.durationSec);

    // 窓の開始時に移動中で、窓の中に到着するなら到着後すぐに昼食
    if (lunchPending && at >= lunchStart && at <= lunchEnd) {
      lunch = { kind: "before", index: i, arrive: at };
      at += lunchMin;
      lunchPending = false;
    }

    if (!isOpenAt(p.spot, opts.date, at)) markInfeasible("opening_hours", p.spot.id);
    if (at > opts.endMin) markInfeasible("time_limit", p.spot.id);

    let deviation: number;
    let hit: boolean;
    if (p.window) {
      deviation = timeWindowDeviation(at, p.window);
      hit = deviation === 0;
      if (!hit) markInfeasible("time_limit", p.spot.id);
    } else {
      deviation = bestTimeDeviation(at, p.bestHours);
      hit = isInBestTime(at, p.bestHours);
    }
    offBestMinutes += deviation;
    if (hit) bestTimeHits += 1;

    arrive[i] = at;
    depart[i] = at + p.stayMin;
    t = depart[i];
    lastDepart = t;
    prevKey = p.key;

    // 出発時刻が窓の中なら、その直後に昼食。窓の前に到着して窓の終わりを過ぎるまで滞在した（空きが無い）
    // ときは、窓を過ぎてから入れずに lunchSkipped にする
    if (lunchPending && t >= lunchStart && t <= lunchEnd) {
      lunch = { kind: "after", index: i, arrive: t };
      t += lunchMin;
      lunchPending = false;
    }
  }

  let endMin = t;
  if (feasible || infeasibleReason !== "no_route") {
    if (opts.destinationKey) {
      const leg = legOf(opts.matrix, prevKey, opts.destinationKey);
      if (!leg) {
        markInfeasible("no_route");
      } else {
        legs[n] = leg;
        addLeg(leg);
        endMin = t + travelMinutes(leg.durationSec);
      }
    }
  }
  if (endMin > opts.endMin) markInfeasible("time_limit");

  const lunchSkipped =
    opts.lunchBreak && lunch === null && opts.startMin <= lunchEnd && n > 0 && lastDepart > lunchStart;

  return {
    feasible,
    infeasibleReason,
    infeasibleSpotId,
    arrive,
    depart,
    legs,
    lunch,
    endMin,
    totalTravelMin,
    walkM,
    offBestMinutes,
    bestTimeHits,
    estimated,
    walkFallback,
    lunchSkipped,
  };
}

/** simulate の結果から PlanItem の列を作る（next / travelMinToNext を埋める） */
export function materialize(
  order: readonly PreparedSpot[],
  sim: Simulation,
  opts: ScheduleOptions,
): PlanItem[] {
  const items: PlanItem[] = [];
  const n = order.length;
  const lunchMin = PLAN_DEFAULTS.lunchMinutes;
  const zero = toPlanLeg(ZERO_LEG, opts.mode);
  const legAfter = (i: number): PlanLeg | null => {
    // スポット i の次の区間：次のスポットへの区間、最後なら到着地への区間
    const leg = sim.legs[i + 1];
    return leg ? toPlanLeg(leg, opts.mode) : null;
  };
  const pushLunch = (at: number, next: PlanLeg | null) => {
    items.push({
      type: "lunch",
      arrive: minutesToHHMM(at),
      stayMin: lunchMin,
      depart: minutesToHHMM(at + lunchMin),
      travelMinToNext: next?.travelMin ?? null,
      next,
    });
  };

  if (sim.lunch?.kind === "start") {
    const first = sim.legs[0];
    pushLunch(sim.lunch.arrive, first ? toPlanLeg(first, opts.mode) : null);
  }
  for (let i = 0; i < n; i += 1) {
    if (sim.legs[i] === null) break;
    const p = order[i];
    if (sim.lunch?.kind === "before" && sim.lunch.index === i) pushLunch(sim.lunch.arrive, zero);
    const after = sim.lunch?.kind === "after" && sim.lunch.index === i;
    const next = after ? zero : legAfter(i);
    items.push({
      type: "spot",
      spotId: p.spot.id,
      arrive: minutesToHHMM(sim.arrive[i]),
      stayMin: p.stayMin,
      depart: minutesToHHMM(sim.depart[i]),
      travelMinToNext: next?.travelMin ?? null,
      next,
      inBestTime: p.window
        ? timeWindowDeviation(sim.arrive[i], p.window) === 0
        : isInBestTime(sim.arrive[i], p.bestHours),
    });
    if (after && sim.lunch) pushLunch(sim.lunch.arrive, legAfter(i));
  }
  return items;
}

/** 決まった順の時刻計算（準備 → 計算 → PlanItem 化）。再計算（F-5-10）と単体テストで使う */
export function buildSchedule(order: readonly PlannerSpot[], opts: ScheduleOptions): ScheduleResult {
  const prepared = prepareSpots(order, opts);
  const sim = simulate(prepared, opts);
  const items = materialize(prepared, sim, opts);
  return {
    items,
    feasible: sim.feasible,
    infeasibleReason: sim.infeasibleReason,
    infeasibleSpotId: sim.infeasibleSpotId,
    endMin: sim.endMin,
    totalTravelMin: sim.totalTravelMin,
    walkM: sim.walkM,
    offBestMinutes: sim.offBestMinutes,
    bestTimeHits: sim.bestTimeHits,
    estimated: sim.estimated,
    walkFallback: sim.walkFallback,
    lunchSkipped: sim.lunchSkipped,
  };
}
