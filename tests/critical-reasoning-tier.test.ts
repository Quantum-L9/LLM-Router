import { describe, expect, it } from "vitest";
import { getDowngradedModel, resolveRoute } from "../src/index.js";
import { getFallbackChain, resolveGeneralConfig } from "../src/matrices/general-matrix.js";
import { MODEL_RATES_PER_1M } from "../src/pricing.js";
import { GeneralModel, Provider, TaskComplexity, TaskType } from "../src/types.js";

// Ids OpenRouter no longer lists (`openai/o1`) or has scheduled to expire
// (`openai/o3`, `openai/o3-pro`: expiration_date 2026-12-11).
const RETIRED_O_SERIES = ["openai/o1", "openai/o3", "openai/o3-pro"];

const canonical = [...new Set<string>(Object.values(GeneralModel))] as GeneralModel[];

describe("CRITICAL reasoning tier", () => {
  for (const type of [TaskType.STRATEGIC_REASONING, TaskType.CODE_GENERATION]) {
    it(`routes ${type} at CRITICAL to the live o-series successor`, () => {
      const route = resolveRoute({
        type,
        complexity: TaskComplexity.CRITICAL,
        requiresSearch: false,
      });
      expect(route.provider).toBe(Provider.OPENROUTER);
      expect(route.model).toBe(GeneralModel.GEMINI_ARGON);
      expect(route.model).toBe("google/gemini-4-argon");

      const config = resolveGeneralConfig({ type, complexity: TaskComplexity.CRITICAL });
      expect(config.model).toBe(GeneralModel.GEMINI_ARGON);
      expect(config.maxTokens).toBe(4096);
      // 4096 * 2.5 / 1000 * ($10 / 1000) per 1K output tokens.
      expect(config.estimatedCostPerCall).toBeCloseTo(0.1024, 5);
    });
  }

  it("prices the successor from the live OpenRouter listing", () => {
    expect(MODEL_RATES_PER_1M[GeneralModel.GEMINI_ARGON]).toEqual({ input: 2, output: 10 });
  });

  it("keeps the deprecated O1 / O3 members as aliases of the successor", () => {
    expect(GeneralModel.O1).toBe(GeneralModel.GEMINI_ARGON);
    expect(GeneralModel.O3).toBe(GeneralModel.GEMINI_ARGON);
  });

  it("downgrades the successor to CLAUDE_SONNET below the critical tier", () => {
    expect(getDowngradedModel(GeneralModel.GEMINI_ARGON, Provider.OPENROUTER, "strategic")).toBe(
      GeneralModel.CLAUDE_SONNET,
    );
    expect(getDowngradedModel(GeneralModel.GEMINI_ARGON, Provider.OPENROUTER, "critical")).toBe(
      GeneralModel.GEMINI_ARGON,
    );
  });

  it("no route, fallback or downgrade reaches a retired or expiring o-series id", () => {
    for (const retired of RETIRED_O_SERIES) expect(canonical).not.toContain(retired);
    const visionTypes: TaskType[] = [
      TaskType.VISUAL_QA,
      TaskType.SCREENSHOT_ANALYSIS,
      TaskType.LAYOUT_VALIDATION,
    ];
    for (const type of Object.values(TaskType).filter((type) => !visionTypes.includes(type)))
      for (const complexity of Object.values(TaskComplexity)) {
        const route = resolveRoute({ type, complexity, requiresSearch: false });
        expect(RETIRED_O_SERIES).not.toContain(route.model);
      }
    for (const model of canonical) {
      for (const fallback of getFallbackChain(model))
        expect(RETIRED_O_SERIES).not.toContain(fallback);
      for (const tier of ["fast", "strategic", "critical"] as const)
        expect(RETIRED_O_SERIES).not.toContain(
          getDowngradedModel(model, Provider.OPENROUTER, tier),
        );
    }
  });
});

describe("fallback chains", () => {
  it("never contain their own primary", () => {
    for (const model of canonical) expect(getFallbackChain(model)).not.toContain(model);
  });

  it("never repeat a model within one chain", () => {
    for (const model of canonical) {
      const chain = getFallbackChain(model);
      expect(new Set(chain).size).toBe(chain.length);
    }
  });
});
