/**
 * GET /api/dev/files/<path>
 * memory モード専用の画像配信（Supabase Storage の公開 URL の代わり）。
 * - <dataDir>/uploads/<path> があればそのまま返す。
 * - "seed/<spotId>/<n>.svg" は初期データ用のプレースホルダー SVG を生成して返す。
 */
import { CATEGORY_LABELS, type Category } from "@/lib/domain/constants";
import { getDataBackend } from "@/lib/config";
import { ApiError } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { getMemoryRepository, seedSpotInfo } from "@/lib/repo/memory";

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
};

const CACHE_CONTROL = "public, max-age=86400, immutable";

/** カテゴリごとの淡い背景色（グラデーションの両端） */
const CATEGORY_COLORS: Record<Category, [string, string]> = {
  nature: ["#e3f6e8", "#b9e4c6"],
  gourmet: ["#fff0e1", "#fcd2b0"],
  history: ["#f3ebdc", "#dfcbaa"],
  photogenic: ["#ece6fb", "#cdc1f2"],
  other: ["#e9eff5", "#c9d6e4"],
};

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch,
  );
}

/** スポット名を中央に置いたプレースホルダー画像 */
function placeholderSvg(name: string, category: Category, thumb: boolean): string {
  const w = thumb ? 400 : 1600;
  const h = thumb ? 300 : 1200;
  const [c1, c2] = CATEGORY_COLORS[category];
  const fontSize = thumb ? 28 : 88;
  const subSize = thumb ? 16 : 44;
  const sampleSize = thumb ? 12 : 36;
  const pad = thumb ? 10 : 36;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(name)}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
    `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#3b3b3b">${escapeXml(name)}</text>`,
    `<text x="${w / 2}" y="${h / 2 + fontSize}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${subSize}" fill="#6b6b6b">${escapeXml(CATEGORY_LABELS[category])}</text>`,
    `<text x="${w - pad}" y="${h - pad}" text-anchor="end" font-family="sans-serif" font-size="${sampleSize}" fill="#8a8a8a">SAMPLE</text>`,
    `</svg>`,
  ].join("");
}

export const GET = route<{ path: string[] }>(async (_req, { params }) => {
  if (getDataBackend() !== "memory") throw ApiError.notFound();
  const { path: segments } = await params;
  if (!segments?.length || segments.some((s) => !s || s === ".." || s === "." || s.includes("\\"))) {
    throw ApiError.notFound("ファイルが見つかりませんでした");
  }
  const filePath = segments.map((s) => decodeURIComponent(s)).join("/");
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw ApiError.notFound("ファイルが見つかりませんでした");

  const repo = getMemoryRepository();

  if (segments[0] === "seed" && segments.length === 3 && ext === "svg") {
    const spotId = segments[1];
    const detail = await repo.spots.getById(spotId);
    const info = detail ? { name: detail.name, category: detail.category } : seedSpotInfo(spotId);
    const thumb = segments[2].replace(/\.svg$/, "").endsWith("_t");
    const svg = placeholderSvg(info?.name ?? "スポット", info?.category ?? "other", thumb);
    return new Response(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CACHE_CONTROL },
    });
  }

  const data = await repo.readUploadFile(filePath);
  if (!data) throw ApiError.notFound("ファイルが見つかりませんでした");
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": CACHE_CONTROL,
    },
  });
});
