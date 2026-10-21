import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("boots and resolves the @/ tsconfig alias", async () => {
    const { detectSequences } = await import("@/lib/sequence-detector");
    expect(typeof detectSequences).toBe("function");
  });

  it("provides DOM globals from happy-dom", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
  });
});
