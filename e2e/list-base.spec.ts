/**
 * v0.3 S-07 リスト詳細の拠点・距離・並べ替え・合計滞在時間 → S-08 比較（F-4-8〜F-4-11）。
 * memory モード（seed）。リストと追加は API で用意し、画面の操作だけを確かめる。
 */
import type { Page } from "@playwright/test";
import { SEED_USERS, SPOTS, devLogin, expect, expectToast, test } from "./helpers";

const LIST_NAME = "E2E 拠点";

async function deleteListsNamed(page: Page, name: string): Promise<void> {
  const res = await page.request.get("/api/v1/lists");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { lists?: { id: string; name: string }[] };
  for (const list of body.lists ?? []) {
    if (list.name === name) expect((await page.request.delete(`/api/v1/lists/${list.id}`)).ok()).toBeTruthy();
  }
}

/** 兼六園 → ひがし茶屋街 → 金沢城公園 の順に追加したリストを作る */
async function createList(page: Page): Promise<string> {
  const created = await page.request.post("/api/v1/lists", { data: { name: LIST_NAME } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  for (const spot of [SPOTS.kenrokuen, SPOTS.higashiChaya, SPOTS.kanazawaCastle]) {
    const res = await page.request.post(`/api/v1/lists/${id}/items`, { data: { spotId: spot.id } });
    expect(res.status()).toBe(201);
  }
  return id;
}

function spotRows(page: Page) {
  return page.getByRole("list", { name: "リスト内のスポット" }).getByRole("listitem");
}

test.describe("リストの拠点・並べ替え・比較", () => {
  test("拠点を設定 → 距離と距離順 → 比較 → 拠点を解除", async ({ page }) => {
    test.setTimeout(90_000);
    await devLogin(page, SEED_USERS.userB.id);
    await deleteListsNamed(page, LIST_NAME);
    const listId = await createList(page);

    await page.goto(`/lists/${listId}`);
    await expect(page.getByRole("heading", { name: LIST_NAME })).toBeVisible();
    await expect(spotRows(page)).toHaveCount(3);

    // 未設定：案内のみ、距離は出ない、距離順は選べない。
    // 読み込み直後はストリーミング中の非表示の複製（<div hidden id="S:0">）が一瞬残ることがあるため、
    // 文字や testid で探すときは表示中の要素だけに絞る
    await expect(
      page.getByText("拠点を設定すると距離が表示されます").filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByTestId("item-distance")).toHaveCount(0);
    // <select> は <label> の中にあるため、toBeDisabled() は option ではなくラベルの select を判定してしまう。
    // option 自体の disabled を確かめる
    await expect(page.getByRole("option", { name: /距離順/ })).toHaveJSProperty("disabled", true);

    // 合計滞在時間の目安
    await expect(page.getByTestId("list-total-stay").filter({ visible: true })).toContainText(
      /合計 約.+＋移動/,
    );

    // 拠点を設定：スポット名で検索 → 金沢駅 鼓門（PATCH 以外の外部 API は呼ばない）
    await page.getByRole("button", { name: "拠点を設定" }).click();
    const dialog = page.getByRole("dialog", { name: "拠点を設定" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "スポット名で検索" }).click();
    await dialog.getByRole("textbox", { name: "拠点を検索" }).fill("金沢駅");
    await dialog.getByRole("button", { name: "検索" }).click();
    await dialog
      .getByRole("list", { name: "検索結果" })
      .getByRole("button", { name: /金沢駅 鼓門/ })
      .click();
    const patched = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/lists/${listId}`) && res.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "設定", exact: true }).click();
    expect((await patched).status()).toBe(200);
    await expectToast(page, "拠点を設定しました");
    await expect(page.getByTestId("list-base-label")).toHaveText(/金沢駅 鼓門/);

    // 各スポットに距離
    await expect(page.getByTestId("item-distance")).toHaveCount(3);
    await expect(page.getByTestId("item-distance").first()).toContainText(/金沢駅 鼓門から 約[\d.]+(km|m)/);

    // 距離順：金沢城公園（約1.6km）→ ひがし茶屋街（約1.8km）→ 兼六園（約2.2km）
    await page.getByRole("combobox", { name: "並べ替え" }).selectOption("distance");
    await expect(spotRows(page).nth(0)).toContainText(SPOTS.kanazawaCastle.name);
    await expect(spotRows(page).nth(2)).toContainText(SPOTS.kenrokuen.name);

    // 再読み込みしても拠点が残る（GET /lists/{id} が baseLabel / baseLocation を返す）
    await page.reload();
    await expect(page.getByTestId("list-base-label").filter({ visible: true })).toHaveText(/金沢駅 鼓門/);

    // 比較：1 件では押せず、2 件で比較画面へ
    await page.getByRole("button", { name: "比較する" }).click();
    const region = page.getByRole("region", { name: "比較の選択" });
    await expect(region.getByText("2〜3件選んでください")).toBeVisible();
    await page.getByRole("checkbox", { name: `${SPOTS.kenrokuen.name}を比較に選ぶ` }).check();
    await expect(region.getByRole("button", { name: "比較" })).toBeDisabled();
    await page.getByRole("checkbox", { name: `${SPOTS.higashiChaya.name}を比較に選ぶ` }).check();
    await region.getByRole("link", { name: "比較" }).click();
    await expect(page).toHaveURL(new RegExp(`/lists/${listId}/compare\\?spots=`));
    const table = page.getByRole("table", { name: "スポットの比較" });
    await expect(table).toBeVisible();
    await expect(table.getByText(SPOTS.kenrokuen.name)).toBeVisible();
    await expect(table.getByText(SPOTS.higashiChaya.name)).toBeVisible();
    await expect(table.getByRole("row", { name: /金沢駅 鼓門からの距離/ })).toContainText(/約[\d.]+km/);

    // 戻る
    await page.getByRole("link", { name: "リストへ戻る" }).click();
    await expect(page).toHaveURL(new RegExp(`/lists/${listId}$`));

    // 拠点を解除
    await page.getByRole("button", { name: "解除" }).click();
    const confirm = page.getByRole("dialog", { name: "拠点を解除しますか" });
    await confirm.getByRole("button", { name: "解除", exact: true }).click();
    await expectToast(page, "拠点を解除しました");
    await expect(page.getByTestId("item-distance")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "拠点を設定" })).toBeVisible();
  });

  test("比較画面：件数が足りないときと他人のリスト", async ({ page }) => {
    await devLogin(page, SEED_USERS.userB.id);
    await deleteListsNamed(page, LIST_NAME);
    const listId = await createList(page);

    await page.goto(`/lists/${listId}/compare?spots=${SPOTS.kenrokuen.id}`);
    await expect(page.getByText("2〜3件選んでください").filter({ visible: true })).toBeVisible();

    // 他人のリスト：API は 403（本人確認）。画面は「ページが見つかりません」で、リストの中身を出さない。
    // ルートの loading.tsx によりページはストリーミングで返るため、HTTP ステータスは 200 のまま
    // noindex 付きの not-found 画面になる（Next.js 16 の仕様：ストリーミング開始後の notFound()）
    await devLogin(page, SEED_USERS.userA.id);
    expect((await page.request.get(`/api/v1/lists/${listId}`)).status()).toBe(403);
    await page.goto(`/lists/${listId}/compare?spots=${SPOTS.kenrokuen.id},${SPOTS.higashiChaya.id}`);
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await expect(page.getByRole("table", { name: "スポットの比較" })).toHaveCount(0);
    await expect(page.getByText(LIST_NAME)).toHaveCount(0);
  });
});
