/**
 * S-01 マップ（トップ）。地図の表示、URL ハッシュ、写真ピン、シート／パネル、カテゴリ絞り込み、ヒートマップ。
 * v0.3：初期表示は DEFAULT_VIEW（金沢市中心部、ズーム13）、取得は区画単位（GET /spots/tiles）、
 * リスト表示の切替（F-1-9）。
 */
import type { Page, Request } from "@playwright/test";
import { SEED_USERS, SPOTS, devLogin, expect, pinLocator, test } from "./helpers";

/** 区画 API（GET /api/v1/spots/tiles/{z}/{x}/{y}）のリクエストを記録する */
function recordTileRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req: Request) => {
    if (req.method() === "GET" && req.url().includes("/api/v1/spots/tiles/"))
      urls.push(new URL(req.url()).pathname);
  });
  return urls;
}

const MAP = '[data-testid="spot-map"]';

test.describe("ホーム（地図）", () => {
  test("位置情報が無いときは金沢市中心部（ズーム13）で開き、写真の束が出る（v0.3 Q4-B）", async ({
    page,
  }) => {
    const tiles = recordTileRequests(page);
    await page.goto("/");
    await expect(page.locator(MAP)).toBeVisible();
    await expect(page.getByRole("link", { name: "スポットを検索" })).toBeVisible();
    await expect(page.locator(MAP).locator(".maplibregl-canvas")).toBeVisible();
    // ズーム 13 は写真の束（ピンは無い）。取得はズーム段階 11 の区画
    await expect(page.locator(`${MAP} button.dk-cluster`).first()).toBeVisible();
    expect(await pinLocator(page).count()).toBe(0);
    expect(tiles.some((u) => u.startsWith("/api/v1/spots/tiles/11/"))).toBe(true);
    // 未ログインではリスト表示の切替を出さない
    await expect(page.getByRole("button", { name: "リストを地図に表示" })).toHaveCount(0);
  });

  test("区画 API は max-age=60 で、同じ範囲に戻っても取得済みの区画は再取得しない（F-1-2）", async ({
    page,
  }) => {
    const tiles = recordTileRequests(page);
    const spot = SPOTS.kenrokuen;
    const res = page.waitForResponse((r) => r.url().includes("/api/v1/spots/tiles/14/"));
    await page.goto(`/#14/${spot.lat}/${spot.lng}`);
    const first = await res;
    expect(first.headers()["cache-control"]).toBe("public, max-age=60");
    await expect(pinLocator(page, spot.name)).toBeVisible();
    await page.waitForTimeout(800);
    const before = [...tiles];
    // 遠くへ移動してから戻る（MapLibre の hash オプションが hashchange に追従する）
    await page.evaluate(() => {
      window.location.hash = "#14/35.6812/139.7671";
    });
    await page.waitForTimeout(800);
    await page.evaluate(
      ([lat, lng]) => {
        window.location.hash = `#14/${lat}/${lng}`;
      },
      [spot.lat, spot.lng],
    );
    await expect(pinLocator(page, spot.name)).toBeVisible();
    await page.waitForTimeout(800);
    const afterReturn = tiles.slice(before.length).filter((u) => before.includes(u));
    expect(afterReturn).toEqual([]);
    // 同じ区画を二度取りに行っていない
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  test("ハッシュの位置で開くと写真ピンが出て、タップで要約と詳細へ遷移できる", async ({ page }) => {
    const spot = SPOTS.kenrokuen;
    await page.goto(`/#14/${spot.lat}/${spot.lng}`);
    const pin = pinLocator(page, spot.name);
    await expect(pin).toBeVisible();
    await expect(pin).toHaveAttribute("aria-label", /兼六園（投稿\d+件）/);

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
    const spot = SPOTS.kenrokuen;
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
    await expect(page).toHaveURL(/\/#14\/36\.56/);
    await expect(page.locator(MAP)).toBeVisible();
    await expect(pinLocator(page, spot.name)).toBeVisible();
  });

  test("カテゴリで絞り込むとピンの数が変わる", async ({ page }) => {
    // 香林坊・片町周辺：グルメ・歴史・写真映え・自然・その他が混在する
    await page.goto("/#14/36.561/136.6545");
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
    // ズーム 8 以下はズーム段階 8 の区画（ヒートマップ用の点）
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/spots/tiles/8/") &&
        res.request().method() === "GET" &&
        res.status() === 200,
    );
    await page.goto("/#6/36.56/136.65");
    const res = await responsePromise;
    const body = (await res.json()) as { mode: string; points?: unknown[] };
    expect(body.mode).toBe("heatmap");
    expect(Array.isArray(body.points)).toBe(true);
    await expect(page.locator(MAP)).toBeVisible();
    // 取得後に DOM マーカーが増えないことを確認する
    await page.waitForTimeout(500);
    expect(await pinLocator(page).count()).toBe(0);
    expect(await page.locator(`${MAP} .dk-cluster__stack`).count()).toBe(0);
    await expect(page.locator(MAP)).not.toContainText("地図を読み込めませんでした");
  });

  test("ログイン中はリストを選ぶとスポットを強調し、拠点を表示。解除で戻る（F-1-9）", async ({ page }) => {
    test.setTimeout(60_000);
    await devLogin(page, SEED_USERS.userB.id);
    const name = "E2E 地図で表示";
    const lists = (await (await page.request.get("/api/v1/lists")).json()) as {
      lists: { id: string; name: string }[];
    };
    for (const l of lists.lists) if (l.name === name) await page.request.delete(`/api/v1/lists/${l.id}`);
    const created = await page.request.post("/api/v1/lists", { data: { name } });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (const spot of [SPOTS.kenrokuen, SPOTS.kanazawaCastle]) {
      expect(
        (await page.request.post(`/api/v1/lists/${id}/items`, { data: { spotId: spot.id } })).status(),
      ).toBe(201);
    }
    const patched = await page.request.patch(`/api/v1/lists/${id}`, {
      data: {
        base: {
          label: "金沢駅",
          location: { lat: SPOTS.kanazawaStation.lat, lng: SPOTS.kanazawaStation.lng },
        },
      },
    });
    expect(patched.ok()).toBeTruthy();

    await page.goto(`/#15/${SPOTS.kenrokuen.lat}/${SPOTS.kenrokuen.lng}`);
    await expect(pinLocator(page, SPOTS.kenrokuen.name)).toBeVisible();
    await page.getByRole("button", { name: "リストを地図に表示" }).click();
    const dialog = page.getByRole("dialog", { name: "地図に表示するリスト" });
    await dialog.getByRole("button", { name: new RegExp(name) }).click();
    await expect(dialog).toBeHidden();

    const status = page.getByRole("status", { name: "表示中のリスト" });
    await expect(status).toContainText(`「${name}」を表示中（2か所）`);
    await expect(status).toContainText("拠点：金沢駅");
    await expect(page.locator(`${MAP} .dk-base`)).toHaveAttribute("aria-label", "拠点：金沢駅");
    // 地図はリストの範囲に合わせて動く。強調されたピン（または束）がある
    await expect(page.locator(`${MAP} [data-highlighted="true"]`).first()).toBeVisible();

    await status.getByRole("button", { name: "リストの表示を解除" }).click();
    await expect(status).toBeHidden();
    await expect(page.locator(`${MAP} .dk-base`)).toHaveCount(0);
    await expect(page.locator(`${MAP} [data-highlighted="true"]`)).toHaveCount(0);
    await page.request.delete(`/api/v1/lists/${id}`);
  });
});
