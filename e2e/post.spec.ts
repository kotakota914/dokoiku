/**
 * S-04 投稿作成（写真 → 場所 → 内容 → 確認）、S-13 自分の投稿、S-05 投稿編集。
 * 写真は Node の zlib で作った最小 PNG を使い、ブラウザ側で WebP（または JPEG）へ変換する。
 */
import { SEED_USERS, SPOTS, devLogin, expect, expectToast, makePng, test } from "./helpers";

// 同じサーバーで繰り返し実行しても前回の投稿と区別できるよう、実行ごとに識別子を付ける
const RUN_ID = Date.now().toString(36);
const COMMENT = `E2E テスト投稿 ${RUN_ID}`;
const EDITED_COMMENT = `E2E テスト投稿 ${RUN_ID}（編集済み）`;

test.describe("投稿", () => {
  test("写真を選んで既存スポットに投稿し、マイページから編集できる", async ({ page }) => {
    test.setTimeout(120_000);
    await devLogin(page, SEED_USERS.userA.id);
    await page.goto("/posts/new");
    await expect(page.getByRole("heading", { name: "投稿する" })).toBeVisible();
    await expect(page.getByText("ステップ 1/4")).toBeVisible();

    // ステップ 1：写真
    await page.locator('input[type="file"]').setInputFiles({
      name: "e2e-photo.png",
      mimeType: "image/png",
      buffer: makePng(64, 48),
    });
    const preview = page.getByRole("img", { name: "1枚目：e2e-photo.png" });
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect(page.getByRole("list", { name: "選択した写真" }).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "次へ" }).click();

    // ステップ 2：場所（スポット名で検索 → 既存スポット）
    await expect(page.getByText("ステップ 2/4")).toBeVisible();
    await page.getByRole("tab", { name: "スポット名で検索" }).click();
    const panel = page.getByRole("tabpanel");
    await panel.getByLabel("スポット名").fill("金沢城");
    await panel.getByRole("button", { name: "検索" }).click();
    const results = panel.getByRole("list", { name: "検索結果" });
    await expect(results).toBeVisible();
    const candidate = results.getByRole("button").filter({ hasText: SPOTS.kanazawaCastle.name }).first();
    await expect(candidate).toContainText("登録済み");
    await candidate.click();
    await expect(candidate).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("選択中の場所")).toBeVisible();
    await page.getByRole("button", { name: "次へ" }).click();

    // ステップ 3：内容
    await expect(page.getByText("ステップ 3/4")).toBeVisible();
    await page.getByRole("radio", { name: "歴史・文化" }).click();
    await page.getByLabel("コメント").fill(COMMENT);
    await page.getByRole("radio", { name: "〜1時間" }).click();
    await expect(page.getByRole("radio", { name: "〜1時間" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "次へ" }).click();

    // ステップ 4：確認 → 投稿
    await expect(page.getByText("ステップ 4/4")).toBeVisible();
    await expect(page.getByText(COMMENT, { exact: true })).toBeVisible();
    await expect(page.getByText(SPOTS.kanazawaCastle.name, { exact: true }).first()).toBeVisible();
    const created = page.waitForResponse(
      (res) => res.url().includes("/api/v1/posts") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "投稿する" }).click();
    const createdRes = await created;
    expect(createdRes.status(), await createdRes.text()).toBe(201);

    await expect(page).toHaveURL(new RegExp(`/spots/${SPOTS.kanazawaCastle.id}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: SPOTS.kanazawaCastle.name })).toBeVisible();
    const myPost = page.getByRole("article", { name: `${SEED_USERS.userA.displayName}の投稿` }).filter({
      hasText: COMMENT,
    });
    await expect(myPost.first()).toBeVisible();
    await expect(myPost.first().getByRole("link", { name: "編集" })).toBeVisible();

    // マイページに自分の投稿が出る
    await page.goto("/me");
    const mine = page.getByRole("article").filter({ hasText: COMMENT }).first();
    await expect(mine).toBeVisible();
    await expect(mine).toContainText(SPOTS.kanazawaCastle.name);

    // 編集ページでコメントを変更して保存
    await mine.getByRole("link", { name: "編集" }).click();
    await expect(page).toHaveURL(/\/posts\/[0-9a-f-]+\/edit$/);
    await expect(page.getByRole("heading", { name: "投稿を編集" })).toBeVisible();
    const comment = page.getByLabel("コメント");
    await expect(comment).toHaveValue(COMMENT);
    await comment.fill(EDITED_COMMENT);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expectToast(page, "投稿を更新しました");
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("article").filter({ hasText: EDITED_COMMENT }).first()).toBeVisible();
  });

  test("未ログインで /posts/new を開くとログインへ", async ({ page }) => {
    await page.goto("/posts/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fposts%2Fnew/);
  });
});
