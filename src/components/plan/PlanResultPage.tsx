"use client";

/**
 * S-09（未保存）：sessionStorage に置かれた計算結果を読んで PlanResultView を表示する。
 * 結果が無ければ条件入力（S-08）へ戻す。
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LoadingState } from "@/components/ui";
import type { PlanResult } from "@/lib/domain/types";
import { parsePlanSession, readPlanSessionRaw, savePlanSession } from "./planSession";
import { PlanResultView } from "./PlanResultView";

export interface PlanResultPageProps {
  listId: string;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** サーバー・ハイドレーション中は undefined（読み込み中）、ブラウザでは保存済みの JSON 文字列か null */
function getServerSnapshot(): string | null | undefined {
  return undefined;
}

export function PlanResultPage({ listId }: PlanResultPageProps) {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, () => readPlanSessionRaw(listId), getServerSnapshot);
  const session = useMemo(() => (raw === undefined ? undefined : parsePlanSession(raw)), [raw]);

  useEffect(() => {
    if (session === null) router.replace(`/lists/${encodeURIComponent(listId)}/plan`);
  }, [session, listId, router]);

  if (!session) return <LoadingState className="flex-1" message="プランを読み込んでいます" />;

  const handleResultChange = (result: PlanResult) => {
    savePlanSession(listId, { ...session, result });
  };

  return (
    <PlanResultView
      params={session.params}
      result={session.result}
      spots={session.spots}
      listId={listId}
      onResultChange={handleResultChange}
    />
  );
}
