"use client";

/**
 * S-10 AIと相談（F-5-5、ADR-0023）。
 * - チャット：POST /plans/chat（会話・対象スポット・共通の条件）。返答は絵文字を除いて表示する
 * - 読み取った条件（conditions）を一覧表示し、ユーザーが修正してから「この条件で経路案を作成」
 * - unclear のときは「選択式で作る」（S-09 の「重視するものを選ぶ」）へ切り替えられる
 * - 会話は最大 10 往復。会話は保存しない（sessionStorage にも残さない。リロードで消える）
 */
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorMessage,
  LoadingState,
  PageHeader,
  SuspendedNotice,
  Textarea,
  cn,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import { FEATURES, FEATURE_LABELS, LIMITS, type Feature } from "@/lib/domain/constants";
import type {
  PlanChatMessage,
  PlanChatResponse,
  PlanComputeResponse,
  PlanParams,
  PlanPreferences,
  WishlistDetail,
} from "@/lib/domain/types";
import { planComputeSchema } from "@/lib/validation/schemas";
import { ConditionsEditor, type ConditionSpot } from "./ConditionsEditor";
import { selectableItems } from "./planFormLogic";
import { PlanIcon } from "./PlanIcon";
import {
  DEFAULT_PREFERENCES,
  getServerSnapshot,
  parsePlanDraft,
  readPlanDraftRaw,
  savePlanDraft,
  savePlanSession,
  subscribeStorage,
  type PlanDraft,
} from "./planSession";
import { stripEmoji } from "./stripEmoji";

export const CHAT_UNCLEAR_MESSAGE = "うまく読み取れませんでした。もう少し具体的に教えてください";
export const CHAT_LIMIT_MESSAGE = `会話は${LIMITS.chatMaxTurns}往復までです`;
const MESSAGE_MAX = 1000;

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

function suspendedFeatureOf(err: ApiClientError): Feature | null {
  const f = (err.details as { feature?: unknown } | undefined)?.feature;
  return typeof f === "string" && (FEATURES as readonly string[]).includes(f) ? (f as Feature) : null;
}

/** AI の条件のうち、対象スポットに無い ID を落とす（画面に出す前の念のための確認） */
export function sanitizeConditions(c: PlanPreferences, spotIds: readonly string[]): PlanPreferences {
  const ok = new Set(spotIds);
  return {
    ...DEFAULT_PREFERENCES,
    ...c,
    timeWindows: (c.timeWindows ?? []).filter((w) => ok.has(w.spotId)),
    orderHints: (c.orderHints ?? []).filter(
      (h) => ok.has(h.spotId) && (h.relativeTo === undefined || ok.has(h.relativeTo)),
    ),
    exclude: (c.exclude ?? []).filter((id) => ok.has(id)),
  };
}

export interface PlanChatPageProps {
  list: WishlistDetail;
}

/** S-09 の下書き（対象スポット・共通の条件）を読んでからチャットを出す */
export function PlanChatPage({ list }: PlanChatPageProps) {
  const raw = useSyncExternalStore(subscribeStorage, () => readPlanDraftRaw(list.id), getServerSnapshot);
  const draft = useMemo(() => (raw === undefined ? undefined : parsePlanDraft(raw)), [raw]);
  const formHref = `/lists/${encodeURIComponent(list.id)}/plan`;
  if (draft === undefined) return <LoadingState className="flex-1" message="読み込んでいます" />;
  if (draft === null || draft.spotIds.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="AIと相談" backHref={formHref} />
        <EmptyState
          icon="route"
          title="経路作成の条件が見つかりません"
          description="対象スポットと共通の条件を入力してから、AIと相談してください。"
          action={
            <ButtonLink href={formHref} leftIcon="route">
              経路作成へ
            </ButtonLink>
          }
        />
      </div>
    );
  }
  return <PlanChat list={list} draft={draft} />;
}

type ChatError = { kind: "suspended"; feature: Feature } | { kind: "error"; message: string; retry: string };

export interface PlanChatProps {
  list: WishlistDetail;
  draft: PlanDraft;
}

export function PlanChat({ list, draft }: PlanChatProps) {
  const router = useRouter();
  const { status, loading: statusLoading, isSuspended } = useSystemStatus();
  const [messages, setMessages] = useState<PlanChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [conditions, setConditions] = useState<PlanPreferences | null>(null);
  const [unclear, setUnclear] = useState(false);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const inputId = useId();
  const logRef = useRef<HTMLOListElement>(null);

  const listPath = `/lists/${encodeURIComponent(list.id)}/plan`;
  const spots: ConditionSpot[] = useMemo(() => {
    const wanted = new Set(draft.spotIds);
    return selectableItems(list.items)
      .filter((i) => wanted.has(i.spotId))
      .map((i) => ({ id: i.spotId, name: i.spot.name }));
  }, [list.items, draft.spotIds]);
  const spotIds = useMemo(() => spots.map((s) => s.id), [spots]);

  const aiUnavailable =
    isSuspended("ai_chat") ||
    (!statusLoading && status.capabilities.ai === false) ||
    chatError?.kind === "suspended";
  const userTurns = messages.filter((m) => m.role === "user").length;
  const limitReached = userTurns >= LIMITS.chatMaxTurns;
  const inputDisabled = sending || computing || limitReached || aiUnavailable;
  const trimmed = input.trim();

  function goLogin() {
    router.push(loginUrl(currentPath()));
  }

  function scrollToEnd() {
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
    });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending || limitReached) return;
    const prev = messages;
    const next: PlanChatMessage[] = [...prev, { role: "user", content }];
    setMessages(next);
    setInput("");
    setChatError(null);
    setSending(true);
    scrollToEnd();
    try {
      const res = await api.post<PlanChatResponse>("/plans/chat", {
        listId: list.id,
        spotIds,
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        mode: draft.mode,
        messages: next,
        conditions: conditions ?? undefined,
      });
      const reply = stripEmoji(res.reply ?? "") || CHAT_UNCLEAR_MESSAGE;
      setMessages([...next, { role: "assistant", content: reply.slice(0, MESSAGE_MAX) }]);
      setConditions(sanitizeConditions(res.conditions ?? conditions ?? DEFAULT_PREFERENCES, spotIds));
      setUnclear(res.unclear === true);
      scrollToEnd();
    } catch (err) {
      // 送れなかった発言は取り消して入力欄に戻す
      setMessages(prev);
      setInput(content);
      if (err instanceof ApiClientError && err.isUnauthorized) {
        goLogin();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        setChatError({ kind: "suspended", feature: suspendedFeatureOf(err) ?? "ai_chat" });
        return;
      }
      setChatError({ kind: "error", message: errorMessage(err, "AIとの通信に失敗しました"), retry: content });
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter で送信、Shift+Enter で改行。変換中（IME）の Enter は送らない
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!inputDisabled) void send(input);
  }

  /** 「選択式で作る」：S-09 の「重視するものを選ぶ」へ（読み取ったペースなどは引き継ぐ） */
  function switchToPreferences() {
    const base = conditions ?? draft.preferences;
    savePlanDraft(list.id, {
      ...draft,
      method: "preferences",
      preferences: {
        ...DEFAULT_PREFERENCES,
        pace: base.pace,
        interests: base.interests,
        priority: base.priority,
      },
    });
    router.push(listPath);
  }

  async function createPlan() {
    if (!conditions || computing) return;
    setComputeError(null);
    if (!draft.origin) {
      setComputeError("出発地が設定されていません。条件の入力に戻って出発地を選んでください");
      return;
    }
    if (spotIds.every((id) => conditions.exclude.includes(id))) {
      setComputeError("すべての場所が除外されています。除外のチェックを外してください");
      return;
    }
    const parsed = planComputeSchema.safeParse({
      listId: list.id,
      spotIds,
      origin: draft.origin,
      destination: draft.destination,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      mode: draft.mode,
      lunchBreak: draft.lunchBreak,
      method: "chat",
      preferences: conditions,
    });
    if (!parsed.success) {
      setComputeError(parsed.error.issues[0]?.message ?? "条件が正しくありません");
      return;
    }
    const params: PlanParams = parsed.data;
    savePlanDraft(list.id, { ...draft, method: "chat", preferences: conditions });
    setComputing(true);
    try {
      const response = await api.post<PlanComputeResponse>("/plans/compute", params);
      const wanted = new Set(spotIds);
      const spotSummaries = selectableItems(list.items)
        .filter((i) => wanted.has(i.spotId))
        .map((i) => i.spot);
      const ok = savePlanSession(list.id, {
        params,
        response,
        spots: spotSummaries,
        selectedId: response.candidates[0]?.id ?? null,
      });
      if (!ok) {
        setComputeError("この端末では結果を表示できません。ブラウザの設定を確認してください");
        return;
      }
      router.push(`${listPath}/result`);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        goLogin();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        const feature = suspendedFeatureOf(err);
        setComputeError(
          feature ? `現在、${FEATURE_LABELS[feature]}は利用できません` : "現在、経路作成を利用できません",
        );
        return;
      }
      setComputeError(errorMessage(err, "経路案の作成に失敗しました"));
    } finally {
      setComputing(false);
    }
  }

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="AIと相談" backHref={listPath} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4">
        {aiUnavailable ? (
          <div className="flex flex-col gap-2">
            <SuspendedNotice
              feature={chatError?.kind === "suspended" ? chatError.feature : "ai_chat"}
              detail="「重視するものを選ぶ」で条件を選んで経路案を作れます。"
            />
            <Button variant="secondary" onClick={switchToPreferences} className="self-start">
              <PlanIcon name="list-checks" size={20} />
              選択式で作る
            </Button>
          </div>
        ) : null}

        <p className="text-base text-text-muted">
          行きたい時間帯や順番、歩く量などの希望を自由に書いてください。AIが条件に変え、経路は計算で作ります。
          会話は保存されません。AIにはスポット名・共通の条件・会話の内容だけを送ります。
        </p>

        {/* 会話 */}
        <section aria-labelledby="plan-chat-heading" className="flex flex-col gap-3">
          <h2 id="plan-chat-heading" className="sr-only">
            会話
          </h2>
          {messages.length === 0 ? (
            <Card tone="muted" className="flex items-start gap-2">
              <PlanIcon name="message-circle" size={20} className="mt-0.5 text-text-muted" />
              <p className="text-base text-text">
                例：「夕日は金沢港で見たい」「午前は混む前に兼六園に行きたい」「歩くのは少なめがいい」
              </p>
            </Card>
          ) : (
            <ol
              ref={logRef}
              aria-label="会話"
              aria-live="polite"
              className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto"
            >
              {messages.map((m, i) => (
                <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-base",
                      m.role === "user"
                        ? "bg-primary text-on-primary"
                        : "border border-border bg-surface-muted text-text",
                    )}
                  >
                    <span className="sr-only">{m.role === "user" ? "あなた：" : "AI："}</span>
                    {m.content}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {sending ? (
            <p role="status" className="text-base text-text-muted">
              AIが考えています
            </p>
          ) : null}

          {unclear && lastIsAssistant ? (
            <Card tone="muted" className="flex flex-col gap-2">
              <p className="text-base text-text">
                うまく読み取れないときは、選択肢から条件を選んで作れます。
              </p>
              <Button variant="secondary" onClick={switchToPreferences} className="self-start">
                <PlanIcon name="list-checks" size={20} />
                選択式で作る
              </Button>
            </Card>
          ) : null}

          {chatError?.kind === "error" ? (
            <ErrorMessage
              message={chatError.message}
              onRetry={() => void send(chatError.retry)}
              retrying={sending}
            />
          ) : null}

          {limitReached ? (
            <p role="status" className="text-base text-text-muted">
              {CHAT_LIMIT_MESSAGE}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-base font-medium text-text">
              希望を入力
            </label>
            <Textarea
              id={inputId}
              value={input}
              maxLength={MESSAGE_MAX}
              rows={3}
              disabled={inputDisabled}
              placeholder="例：午前はゆっくりめで、夕方は金沢港に行きたい"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button
              onClick={() => void send(input)}
              disabled={inputDisabled || trimmed.length === 0}
              loading={sending}
              className="self-end"
            >
              {sending ? null : <PlanIcon name="send" size={20} />}
              送信
            </Button>
          </div>
        </section>

        {/* 読み取った条件 */}
        <section aria-labelledby="plan-conditions-heading" className="flex flex-col gap-3">
          <h2 id="plan-conditions-heading" className="text-lg font-semibold text-text">
            読み取った条件
          </h2>
          {conditions ? (
            <>
              <p className="text-base text-text-muted">内容を確認し、必要なら修正してください。</p>
              <ConditionsEditor
                value={conditions}
                onChange={setConditions}
                spots={spots}
                disabled={computing}
              />
            </>
          ) : (
            <p className="text-base text-text-muted">AIに希望を送ると、ここに条件が表示されます。</p>
          )}
          {computeError ? <ErrorMessage message={computeError} /> : null}
          <Button
            size="lg"
            leftIcon="route"
            fullWidth
            loading={computing}
            disabled={!conditions || sending}
            onClick={() => void createPlan()}
          >
            この条件で経路案を作成
          </Button>
          {computing ? (
            <p className="text-center text-base text-text-muted" role="status">
              経路案を計算しています。少しお待ちください
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
