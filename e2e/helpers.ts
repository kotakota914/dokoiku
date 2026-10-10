/**
 * E2E 共通の補助。memory モード（seed データ）で動く前提。
 * - 地図スタイル（OpenFreeMap）はネットワークに出ずに最小スタイルへ差し替える
 *   （タイルが読めなくても写真ピンなどの DOM マーカーは描画される）
 * - 開発用ログイン（/api/dev/login）
 * - 最小 PNG の生成（Node の zlib のみ）
 * - ブラウザのコンソールエラー・React 警告の収集
 */
import { test as base, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

export const SEED_USERS = {
  userA: { id: "a0000000-0000-4000-8000-000000000001", displayName: "開発ユーザーA" },
  userB: { id: "a0000000-0000-4000-8000-000000000002", displayName: "開発ユーザーB" },
  admin: { id: "a0000000-0000-4000-8000-000000000003", displayName: "管理者ユーザー" },
} as const;

/** seed のスポット ID（src/lib/repo/memory/seed.ts の並び順。n は 16 進） */
export function seedSpotId(n: number): string {
  return `b0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const SPOTS = {
  kiyomizu: { id: seedSpotId(1), name: "清水寺", lat: 34.9949, lng: 135.785 },
  fushimiInari: { id: seedSpotId(2), name: "伏見稲荷大社", lat: 34.9671, lng: 135.7727 },
  kinkakuji: { id: seedSpotId(3), name: "金閣寺", lat: 35.0394, lng: 135.7292 },
  kyotoStation: { id: seedSpotId(38), name: "京都駅ビル", lat: 34.9858, lng: 135.7588 },
} as const;

/** タイルもフォントも参照しない最小の MapLibre スタイル */
const MINIMAL_STYLE = {
  version: 8,
  name: "e2e-blank",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#e9ecef" } }],
};

/** 外部の地図サーバーへ出ない。スタイルは最小のものを返し、それ以外（タイル等）は失敗させる */
export async function stubMapNetwork(page: Page): Promise<void> {
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/styles/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MINIMAL_STYLE),
      });
      return;
    }
    await route.abort("failed");
  });
}

/** 開発用ログイン。Cookie はブラウザコンテキストと共有される */
export async function devLogin(page: Page, userId: string = SEED_USERS.userA.id): Promise<void> {
  const res = await page.request.post("/api/dev/login", { data: { userId } });
  expect(res.ok(), `dev login failed: ${res.status()}`).toBeTruthy();
}

export async function devLogout(page: Page): Promise<void> {
  const res = await page.request.post("/api/dev/logout");
  expect(res.ok()).toBeTruthy();
}

/** CRC32（PNG チャンク用） */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 単色（RGB）の最小 PNG を作る。外部ライブラリ不要 */
export function makePng(
  width: number,
  height: number,
  rgb: [number, number, number] = [80, 160, 220],
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0; // filter: none
  for (let x = 0; x < width; x += 1) {
    // 単色だと一部のエンコーダで極端に小さくなるので、少しグラデーションを付ける
    row[1 + x * 3] = (rgb[0] + x) & 0xff;
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 無視してよいコンソール出力（ネットワーク遮断による失敗など） */
const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /tiles\.openfreemap\.org/i,
  /favicon/i,
  /WebGL/i,
  /GPU stall/i,
  /AbortError/i,
  /Download the React DevTools/i,
];

export interface ConsoleProblems {
  messages: string[];
}

/** コンソールの error と React の警告（Warning: / Hydration）を集める */
export function collectConsoleProblems(page: Page): ConsoleProblems {
  const problems: ConsoleProblems = { messages: [] };
  page.on("console", (msg) => {
    const text = msg.text();
    const isProblem =
      msg.type() === "error" || /Warning: /.test(text) || /hydrat/i.test(text) || /Error/.test(text);
    if (!isProblem) return;
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    problems.messages.push(`[${msg.type()}] ${text}`);
  });
  page.on("pageerror", (err) => {
    problems.messages.push(`[pageerror] ${err.message}`);
  });
  return problems;
}

/**
 * 共通フィクスチャ付きの test：
 * - 地図の外部ネットワークを遮断
 * - コンソールのエラーと React 警告を集めて、テスト終了時に空であることを確認する
 */
export const test = base.extend<{ consoleProblems: ConsoleProblems }>({
  consoleProblems: [
    async ({ page }, use) => {
      await stubMapNetwork(page);
      const problems = collectConsoleProblems(page);
      await use(problems);
      expect(problems.messages, "ブラウザのコンソールにエラー・警告が出ています").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** トースト（role=status）に文言が出るのを待つ */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** 写真ピン（button[aria-label="<名前>（投稿N件）..."]） */
export function pinLocator(page: Page, name?: string) {
  return name
    ? page.locator(`[data-testid="spot-map"] button.dk-pin[aria-label^="${name}（"]`)
    : page.locator('[data-testid="spot-map"] button.dk-pin');
}
