/**
 * S-01 マップ（トップ）。地図の表示、URL ハッシュ、写真ピン、シート／パネル、カテゴリ絞り込み、ヒートマップ。
 */
import { SPOTS, expect, pinLocator, test } from "./helpers";

const MAP = '[data-testid="spot-map"]';

test.describe("ホーム（地図）", () => {
  test("地図のコンテナが表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(MAP)).toBeVisible();
    await expect(page.getByRole("link", { name: "スポットを検索" })).toBeVisible();
    // 日本全体（ズーム 5）なのでヒートマップ。ピンは無い
    await expect(page.locator(MAP).locator(".maplibregl-canvas")).toBeVisible();
    expect(await pinLocator(page).count()).toBe(0);
  });

  test("ハッシュの位置で開くと写真ピンが出て、タップで要約と詳細へ遷移できる", async ({ page }) => {
    const spot = SPOTS.fushimiInari;
    await page.goto(`/#14/${spot.lat}/${spot.lng}`);
    const pin = pinLocator(page, spot.name);
    await expect(pin).toBeVisible();
    await expect(pin).toHaveAttribute("aria-label", /伏見稲荷大社（投稿\d+件）/);

    await pin.click();
    // スマホはボトムシート（dialog の名前がスポット名）、PC は左パネル（見出しにスポット名）。
    // どちらも中身は SpotPeekCard（region の名前がスポット名）
    const sheet = page
      .getByRole("dialog", { name: spot.name })
      .or(page.getByRole("complementary", { name: "表示範囲のスポット" }));
    await expect(sheet).toBeVisible();
    const card = sheet.getByRole("region", { name: spot.name });
    await expect(card).toBeVisible();
    const detail = card.getByRole("link", { name: "詳細を見る" });
    await expect(detail).toBeVisible();
    await expect(card.getByText(/投稿 \d+件/)).toBeVisible();

    await detail.click();
    await expect(page).toHaveURL(new RegExp(`/spots/${spot.id}$`));
    await expect(page.getByRole("heading", { name: spot.name })).toBeVisible();
  });

  test("詳細の「戻る」で地図に戻ると、URL ハッシュ（地図の位置）が保たれる（ADR-0017）", async ({ page }) => {
    const spot = SPOTS.fushimiInari;
    await page.goto(`/#14/${spot.lat}/${spot.lng}`);
    const pin = pinLocator(page, spot.name);
    await expect(pin).toBeVisible();
    await pin.click();
    const sheet = page
      .getByRole("dialog", { name: spot.name })
      .or(page.getByRole("complementary", { name: "表示範囲のスポット" }));
    await sheet.getByRole("region", { name: spot.name }).getByRole("link", { name: "詳細を見る" }).click();
    await expect(page).toHaveURL(new RegExp(`/spots/${spot.id}$`));

    await page.getByRole("button", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/#14\/34\.967/);
    await expect(page.locator(MAP)).toBeVisible();
    await expect(pinLocator(page, spot.name)).toBeVisible();
  });

  test("カテゴリで絞り込むとピンの数が変わる", async ({ page }) => {
    // 河原町周辺：グルメ・歴史・写真映え・その他が混在する
    await page.goto("/#14/35.0035/135.7705");
    const pins = pinLocator(page);
    await expect(pins.first()).toBeVisible();
    await expect.poll(() => pins.count()).toBeGreaterThan(3);
    const before = await pins.count();

    const filter = page.getByRole("group", { name: "カテゴリで絞り込み" });
    await filter.getByRole("button", { name: "グルメ" }).click();
    await expect(filter.getByRole("button", { name: "グルメ" })).toHaveAttribute("aria-pressed", "true");

    await expect.poll(() => pins.count()).toBeLessThan(before);
    await expect.poll(() => pins.count()).toBeGreaterThan(0);
    const categories = await pins.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.category));
    expect(new Set(categories)).toEqual(new Set(["gourmet"]));

    // 解除すると元の数に戻る
    await filter.getByRole("button", { name: "グルメ" }).click();
    await expect.poll(() => pins.count()).toBe(before);
  });

  test("ズーム 6 ではヒートマップになり写真ピンが無い", async ({ page }) => {
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/v1/spots?") && res.request().method() === "GET",
    );
    await page.goto("/#6/35.0/135.75");
    const res = await responsePromise;
    const body = (await res.json()) as { mode: string; points?: unknown[] };
    expect(body.mode).toBe("heatmap");
    expect(body.points?.length ?? 0).toBeGreaterThan(0);
    await expect(page.locator(MAP)).toBeVisible();
    // 取得後に DOM マーカーが増えないことを確認する
    await page.waitForTimeout(500);
    expect(await pinLocator(page).count()).toBe(0);
    expect(await page.locator(`${MAP} .dk-cluster__stack`).count()).toBe(0);
    await expect(page.locator(MAP)).not.toContainText("地図を読み込めませんでした");
  });
});
