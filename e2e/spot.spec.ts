/**
 * S-02 スポット詳細、S-03 検索、S-15 見つからない。
 */
import { SPOTS, expect, test } from "./helpers";

test.describe("スポット詳細", () => {
  test("名前・投稿数・24 本の棒グラフ・投稿カード・Google マップのリンクが出る", async ({ page }) => {
    const spot = SPOTS.kenrokuen;
    const res = await page.goto(`/spots/${spot.id}`);
    expect(res?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: spot.name })).toBeVisible();
    await expect(page.getByText(spot.name, { exact: true }).first()).toBeVisible();

    // 投稿数（dl の「投稿数」）
    const stats = page.locator("dl").first();
    await expect(stats).toContainText("投稿数");
    await expect(stats.locator("dd").first()).toHaveText(/\d+/);

    // 24 本の棒グラフ
    await expect(page.getByTestId("hour-histogram")).toBeVisible();
    expect(await page.getByTestId("hour-bar").count()).toBe(24);
    await expect(page.getByText(/最も多い時間帯：\d+時台/)).toBeVisible();

    // 投稿カード
    await expect(page.getByRole("heading", { name: "投稿一覧" })).toBeVisible();
    const cards = page.getByRole("article", { name: /の投稿$/ });
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    // Google マップで開く
    const gmap = page.getByRole("link", { name: "Googleマップで開く" });
    await expect(gmap).toBeVisible();
    await expect(gmap).toHaveAttribute("href", /google\.com\/maps/);
    await expect(gmap).toHaveAttribute("target", "_blank");
  });

  test("未ログインで いいね を押すとログイン画面へ（戻り先付き）", async ({ page }) => {
    const spot = SPOTS.kenrokuen;
    await page.goto(`/spots/${spot.id}`);
    const like = page.getByRole("button", { name: /いいねする/ }).first();
    await expect(like).toBeVisible();
    await like.click();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/spots/${spot.id}`)}`));
    await expect(page.getByRole("heading", { name: "ログイン", exact: true })).toBeVisible();
  });

  test("未ログインで「行きたい場所リストに追加」を押すとログイン画面へ", async ({ page }) => {
    const spot = SPOTS.kanazawaCastle;
    await page.goto(`/spots/${spot.id}`);
    await page.getByRole("button", { name: "行きたい場所リストに追加" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("検索：金沢城 で 金沢城公園 が出る", async ({ page }) => {
    const res = await page.goto("/search?q=%E9%87%91%E6%B2%A2%E5%9F%8E");
    expect(res?.status()).toBe(200);
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "金沢城公園", exact: true }) })
      .first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/投稿 \d+ 件/);
    const result = card.getByRole("link", { name: "詳細を見る" });
    await expect(result).toHaveAttribute("href", new RegExp(`/spots/${SPOTS.kanazawaCastle.id}`));
    await result.click();
    await expect(page).toHaveURL(new RegExp(`/spots/${SPOTS.kanazawaCastle.id}`));
    await expect(page.getByRole("heading", { name: "金沢城公園" })).toBeVisible();
  });

  test("存在しない ID は見つからない表示", async ({ page }) => {
    // ルートの loading.tsx によりシェルを先に流すため HTTP ステータスは 200 になる（表示内容で確認する）
    await page.goto("/spots/b0000000-0000-4000-8000-0000000000ff");
    await expect(page.getByText("このスポットは見つかりませんでした")).toBeVisible();
    await expect(page.getByRole("link", { name: "地図に戻る" })).toHaveAttribute("href", "/");
  });
});
