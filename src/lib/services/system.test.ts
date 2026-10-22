import { describe, expect, it } from "vitest";
import { createMemoryRepository } from "@/lib/repo/memory";
import { getStatus } from "./system";

const NOW = new Date("2026-10-10T03:00:00Z");
const BASE = { nominatimEnabled: true, externalApiMock: false, backend: "memory" as const };

describe("getStatus（F-8-5）", () => {
  it("停止中の機能と capabilities（routing / transit / ai）を返す", async () => {
    const repo = createMemoryRepository(true, { persist: false });
    const off = await getStatus(repo, NOW, BASE);
    expect(off.suspended).toEqual([]);
    expect(off.capabilities).toEqual({
      externalSearch: true,
      routing: false,
      transit: false,
      ai: false,
      googleLogin: false,
      backend: "memory",
    });
    await repo.apiUsage.increment("ors", "route_planning", "2026-10-10", 500, 400);
    await repo.apiUsage.setSuspended("ors", "route_planning", "2026-10-10", "2026-10-10T12:00:00.000+09:00");
    const on = await getStatus(repo, NOW, {
      ...BASE,
      orsApiKey: "o",
      googleRoutesApiKey: "g",
      geminiApiKey: "m",
    });
    expect(on.capabilities).toMatchObject({ routing: false, transit: true, ai: true });
    expect(on.suspended.map((s) => s.feature)).toEqual(["route_planning"]);
  });
});
