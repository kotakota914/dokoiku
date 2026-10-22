/**
 * v0.3：S-06/S-07 行きたい場所リスト → S-09 経路作成（おまかせ）→ S-11 経路案の比較（並び替え・保存）
 * → S-12 保存済みプラン（ナビを開始）→ 削除。
 * memory モード・外部 API なし（公共交通は概算＝目安）で動く前提。
 */
import type { Page } from "@playwright/test";
import { SEED_USERS, SPOTS, devLogin, expect, expectToast, test } from "./helpers";

const LIST_NAME = "E2E 金沢";

/** 前回の実行で残った同名リストを消す（同じサーバーで繰り返し実行できるように） */
async function deleteListsNamed(page: Page, name: string): Promise<void> {
  const res = await page.request.get("/api/v1/lists");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { lists?: { id: string; name: string }[] };
  const lists = body.lists ?? [];
  for (const list of lists) {
    if (list.name === name) {
      const del = await page.request.delete(`/api/v1/lists/${list.id}`);
      expect(del.ok()).toBeTruthy();
    }
  }
}

test.describe("リストと経路作成", () => {
  test("リストに 3 件追加 → おまかせで経路案 → 比較・並び替え → 保存 → ナビを開始 → 削除", async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 36.578, longitude: 136.6478 });
    await devLogin(page, SEED_USERS.userB.id);
    await deleteListsNamed(page, LIST_NAME);

    // 1) 兼六園：新しいリストを作って追加
    await page.goto(`/spots/${SPOTS.kenrokuen.id}`);
    await page.getByRole("button", { name: "行きたい場所リストに追加" }).click();
    const picker = page.getByRole("dialog", { name: "リストに追加" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "新しいリストを作る" }).click();
    await picker.getByLabel("リスト名").fill(LIST_NAME);
    await picker.getByRole("button", { name: "作成して追加" }).click();
    await expectToast(page, `${LIST_NAME}に追加しました`);
    await expect(picker).toBeHidden();

    // 2) ひがし茶屋街・金沢城公園：既存リストへ追加
    for (const spot of [SPOTS.higashiChaya, SPOTS.kanazawaCastle]) {
      await page.goto(`/spots/${spot.id}`);
      await page.getByRole("button", { name: "行きたい場所リストに追加" }).click();
      const dialog = page.getByRole("dialog", { name: "リストに追加" });
      await dialog.getByRole("list", { name: "リスト一覧" }).getByRole("button", { name: LIST_NAME }).click();
      await expectToast(page, `${LIST_NAME}に追加しました`);
      await expect(dialog).toBeHidden();
    }

    // 3) リスト一覧 → 詳細（3 件）
    await page.goto("/lists");
    await expect(page.getByRole("heading", { name: "行きたい場所リスト" })).toBeVisible();
    await page
      .getByRole("link", { name: new RegExp(LIST_NAME) })
      .first()
      .click();
    await expect(page).toHaveURL(/\/lists\/[0-9a-f-]+$/);
    const listId = /\/lists\/([0-9a-f-]+)$/.exec(page.url())![1];
    await expect(page.getByRole("heading", { name: LIST_NAME })).toBeVisible();
    const items = page.getByRole("list", { name: "リスト内のスポット" }).getByRole("listitem");
    await expect(items).toHaveCount(3);
    for (const spot of [SPOTS.kenrokuen, SPOTS.higashiChaya, SPOTS.kanazawaCastle]) {
      await expect(items.filter({ hasText: spot.name })).toHaveCount(1);
    }

    // 「必ず行きたい」トグル
    const castleRow = items.filter({ hasText: SPOTS.kanazawaCastle.name });
    const star = castleRow.getByRole("button", { name: "必ず行きたい" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(castleRow.getByText("必ず行きたい", { exact: true })).toBeVisible();

    // 4) S-09 経路作成（条件入力）
    await page.getByRole("link", { name: "経路を作成" }).click();
    await expect(page).toHaveURL(new RegExp(`/lists/${listId}/plan$`));
    await expect(page.getByRole("heading", { name: "経路作成" })).toBeVisible();
    await expect(page.getByText("3 / 8か所")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: new RegExp(SPOTS.kanazawaCastle.name) })).toBeChecked();

    // 出発地：スポット名で検索 → 金沢駅 鼓門（拠点が未設定のリスト）
    await page.getByRole("radio", { name: "スポット名で検索" }).first().click();
    const originInput = page.getByRole("textbox", { name: "出発地を検索" });
    await originInput.fill("金沢駅");
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await expect(page.getByText("外部の場所検索は利用できません", { exact: false })).toBeVisible();
    await page
      .getByRole("list", { name: "検索結果" })
      .getByRole("button", { name: /金沢駅 鼓門/ })
      .click();
    await expect(page.getByText("金沢駅 鼓門").first()).toBeVisible();

    // 移動手段は公共交通＋徒歩が初期値。memory モード（キー未設定）は概算で計算する
    await expect(page.getByRole("radio", { name: "公共交通＋徒歩" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("公共交通の移動時間は目安（概算）で計算します")).toBeVisible();

    // 作り方：おまかせ（初期値）
    await expect(page.getByRole("radio", { name: /おまかせ/ })).toHaveAttribute("aria-checked", "true");

    const computed = page.waitForResponse(
      (res) => res.url().includes("/api/v1/plans/compute") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "経路案を作成" }).click();
    const computedRes = await computed;
    expect(computedRes.status(), await computedRes.text()).toBe(200);

    // 5) S-11 経路案の比較（未保存）
    await expect(page).toHaveURL(new RegExp(`/lists/${listId}/plan/result$`));
    // 画面の見出し（h1）と、案を並べた区画の見出し（h2）は別の文言
    await expect(page.getByRole("heading", { level: 1, name: "経路案の比較" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "経路案の比較" })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "経路案を選ぶ" })).toBeVisible();
    await expect(page.getByRole("list", { name: "経路案" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^表示中/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("回れる場所").first()).toBeVisible();
    // 選んだ案の概要に「目安」のバッジ（各案の注意書き「公共交通の移動時間は目安です」とは別）
    await expect(page.getByText("移動時間は目安です", { exact: true })).toBeVisible();
    await expect(page.getByText("金沢駅 鼓門").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "タイムライン" })).toBeVisible();
    const visits = page.getByRole("list", { name: "訪問順" });
    await expect(visits).toBeVisible();
    await expect(visits.getByText(/到着 \d{2}:\d{2}〜出発 \d{2}:\d{2}/).first()).toBeVisible();
    await expect(visits.getByText(/滞在 /).first()).toBeVisible();
    await expect(page.getByText(/移動 .*分（目安）/).first()).toBeVisible();
    // 保存前の案には「ナビを開始」を置かない（ADR-0016）
    await expect(page.getByText("ナビを開始")).toHaveCount(0);

    // 上下ボタンで並び替えると再計算される（外部 API は呼ばない）
    const orderBefore = await visits
      .getByRole("button", { name: /を下へ$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!.replace(/を下へ$/, "")));
    expect(orderBefore.length).toBeGreaterThanOrEqual(2);
    const recomputed = page.waitForResponse(
      (res) => res.url().includes("/api/v1/plans/recompute") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: `${orderBefore[0]}を下へ` }).click();
    const recomputedRes = await recomputed;
    expect(recomputedRes.status(), await recomputedRes.text()).toBe(200);
    await expect(page.getByText("時刻を再計算しています")).toBeHidden();
    const orderAfter = await visits
      .getByRole("button", { name: /を下へ$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!.replace(/を下へ$/, "")));
    expect(orderAfter.slice(0, 2)).toEqual([orderBefore[1], orderBefore[0]]);

    // 6) この案を保存 → S-12 /plans/<id>
    const saved = page.waitForResponse(
      (res) => /\/api\/v1\/plans$/.test(res.url()) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "この案を保存" }).click();
    const savedRes = await saved;
    expect(savedRes.status(), await savedRes.text()).toBe(201);
    await expectToast(page, "プランを保存しました");
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "保存済みプラン" })).toBeVisible();
    await expect(page.getByRole("list", { name: "訪問順" })).toBeVisible();
    // 保存済みプランには各区間に「ナビを開始」（Google マップ、新しいタブ）
    const navs = page.getByRole("link", { name: /へのナビをGoogleマップで開く$/ });
    await expect(navs.first()).toBeVisible();
    expect(await navs.count()).toBeGreaterThanOrEqual(2);
    await expect(navs.first()).toHaveAttribute(
      "href",
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=.+&destination=.+&travelmode=transit$/,
    );
    await expect(navs.first()).toHaveAttribute("target", "_blank");
    await expect(navs.first()).toHaveAccessibleName(/^金沢駅 鼓門から.+へのナビをGoogleマップで開く$/);

    // 7) リスト詳細に保存済みプランが出る → 削除
    await page.goto(`/lists/${listId}`);
    const plans = page.getByRole("list", { name: "保存済みプラン" }).getByRole("listitem");
    await expect(plans).toHaveCount(1);
    await expect(plans.first()).toContainText("3か所");
    await plans
      .first()
      .getByRole("button", { name: /のプランを削除$/ })
      .click();
    const confirm = page.getByRole("dialog", { name: "プランを削除しますか" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "削除", exact: true }).click();
    await expectToast(page, "プランを削除しました");
    await expect(page.getByText("保存したプランはまだありません。")).toBeVisible();
  });
});
