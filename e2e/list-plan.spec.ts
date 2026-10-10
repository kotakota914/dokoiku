/**
 * S-06/S-07 行きたい場所リスト → S-08 経路作成 → S-09 経路プラン（並び替え・保存・削除）。
 */
import type { Page } from "@playwright/test";
import { SEED_USERS, SPOTS, devLogin, expect, expectToast, test } from "./helpers";

const LIST_NAME = "E2E 京都";

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
  test("リストに 3 件追加 → 経路を作成 → 並び替え → 保存 → 削除", async ({ page, context }) => {
    test.setTimeout(150_000);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 34.9858, longitude: 135.7588 });
    await devLogin(page, SEED_USERS.userB.id);
    await deleteListsNamed(page, LIST_NAME);

    // 1) 伏見稲荷大社：新しいリストを作って追加
    await page.goto(`/spots/${SPOTS.fushimiInari.id}`);
    await page.getByRole("button", { name: "行きたい場所リストに追加" }).click();
    const picker = page.getByRole("dialog", { name: "リストに追加" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "新しいリストを作る" }).click();
    await picker.getByLabel("リスト名").fill(LIST_NAME);
    await picker.getByRole("button", { name: "作成して追加" }).click();
    await expectToast(page, `${LIST_NAME}に追加しました`);
    await expect(picker).toBeHidden();

    // 2) 金閣寺・清水寺：既存リストへ追加
    for (const spot of [SPOTS.kinkakuji, SPOTS.kiyomizu]) {
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
    for (const spot of [SPOTS.fushimiInari, SPOTS.kinkakuji, SPOTS.kiyomizu]) {
      await expect(items.filter({ hasText: spot.name })).toHaveCount(1);
    }

    // 「必ず行きたい」トグル
    const kiyomizuRow = items.filter({ hasText: SPOTS.kiyomizu.name });
    const star = kiyomizuRow.getByRole("button", { name: "必ず行きたい" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(kiyomizuRow.getByText("必ず行きたい", { exact: true })).toBeVisible();

    // 4) 経路作成フォーム
    await page.getByRole("link", { name: "経路を作成" }).click();
    await expect(page).toHaveURL(new RegExp(`/lists/${listId}/plan$`));
    await expect(page.getByRole("heading", { name: "経路作成" })).toBeVisible();
    await expect(page.getByText("3 / 10か所")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: new RegExp(SPOTS.kiyomizu.name) })).toBeChecked();

    // 出発地：スポット名で検索 → 京都駅ビル
    await page.getByRole("radio", { name: "スポット名で検索" }).click();
    const originInput = page.getByRole("textbox", { name: "出発地を検索" });
    await originInput.fill("京都駅");
    await page.getByRole("button", { name: "検索" }).click();
    await expect(page.getByText("外部の場所検索は利用できません", { exact: false })).toBeVisible();
    await page
      .getByRole("list", { name: "検索結果" })
      .getByRole("button", { name: /京都駅ビル/ })
      .click();
    await expect(page.getByText("京都駅ビル").first()).toBeVisible();

    // 移動手段：車
    await page.getByRole("radio", { name: "車" }).click();
    await expect(page.getByRole("radio", { name: "車" })).toHaveAttribute("aria-checked", "true");

    const computed = page.waitForResponse(
      (res) => res.url().includes("/api/v1/plans/compute") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "経路を作成" }).click();
    const computedRes = await computed;
    expect(computedRes.status(), await computedRes.text()).toBe(200);

    // 5) 結果（未保存）
    await expect(page).toHaveURL(new RegExp(`/lists/${listId}/plan/result$`));
    await expect(page.getByRole("heading", { name: "経路プラン" })).toBeVisible();
    await expect(page.getByText("移動時間は概算です")).toBeVisible();
    await expect(page.getByText("車", { exact: true })).toBeVisible();
    await expect(page.getByText("京都駅ビル").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "タイムライン" })).toBeVisible();
    const visits = page.getByRole("list", { name: "訪問順" });
    await expect(visits).toBeVisible();
    await expect(visits.getByText(/到着 \d{2}:\d{2}〜出発 \d{2}:\d{2}/).first()).toBeVisible();
    await expect(visits.getByText(/滞在 /).first()).toBeVisible();
    await expect(page.getByText(/合計移動時間/)).toBeVisible();
    await expect(page.getByText(/移動 .*分/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Googleマップで経路を開く" }).first()).toHaveAttribute(
      "href",
      /google\.com\/maps/,
    );

    // 上下ボタンで並び替えると再計算される
    const orderBefore = await visits
      .getByRole("button", { name: /を下へ$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!.replace(/を下へ$/, "")));
    expect(orderBefore.length).toBe(3);
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
    expect(orderAfter).toEqual([orderBefore[1], orderBefore[0], orderBefore[2]]);

    // 6) 保存 → /plans/<id>
    const saved = page.waitForResponse(
      (res) => /\/api\/v1\/plans$/.test(res.url()) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expectToast(page, "プランを保存しました");
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "保存済みプラン" })).toBeVisible();
    await expect(page.getByRole("list", { name: "訪問順" })).toBeVisible();

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
