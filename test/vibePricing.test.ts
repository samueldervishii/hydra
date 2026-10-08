import { describe, expect, it } from "vitest";

import { costOf, formatUsd, PRICES } from "../src/integrations/vibe/pricing";

const MILLION = 1_000_000;

describe("Vibe pricing", () => {
  it("prices each kind of token at the model's list price", () => {
    // Haiku's standard prices hold up to a 100,000-token prompt.
    expect(costOf("claude-haiku-5-5", { input_tokens: 100_000 })).toBeCloseTo(0.01);
    expect(costOf("claude-haiku-5-5", { output_tokens: MILLION })).toBeCloseTo(0.5);
    expect(costOf("claude-sonnet-5-5", { input_tokens: MILLION })).toBeCloseTo(2);
    expect(costOf("claude-sonnet-5-5", { output_tokens: MILLION })).toBeCloseTo(10);
  });

  it("prices cache writes at 1.25 times input and reads at each model's discount", () => {
    expect(costOf("claude-haiku-5-5", { cache_creation_input_tokens: 100_000 })).toBeCloseTo(0.0125);
    expect(costOf("claude-haiku-5-5", { cache_read_input_tokens: 100_000 })).toBeCloseTo(0.001);
    expect(costOf("claude-sonnet-5-5", { cache_creation_input_tokens: MILLION })).toBeCloseTo(2.5);
    // Sonnet 5.5 reads at 0.05 times input, not the usual 0.1.
    expect(costOf("claude-sonnet-5-5", { cache_read_input_tokens: MILLION })).toBeCloseTo(0.1);
    // One-hour writes cost twice the input price, where the split is reported.
    expect(
      costOf("claude-sonnet-5-5", {
        cache_creation_input_tokens: MILLION,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: MILLION },
      }),
    ).toBeCloseTo(4);
  });

  it("adds a whole response up", () => {
    const usage = {
      input_tokens: 2_000,
      output_tokens: 500,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 10_000,
    };
    expect(costOf("claude-sonnet-5-5", usage)).toBeCloseTo(
      (2_000 * 2 + 500 * 10 + 1_000 * 2.5 + 10_000 * 0.1) / MILLION,
    );
  });

  it("charges Haiku's higher prices for a prompt over 100,000 tokens, counting cached tokens", () => {
    const long = PRICES["claude-haiku-5-5"].long!.prices;
    expect(costOf("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 1_000 })).toBeCloseTo(
      (100_000 * 0.1 + 1_000 * 0.5) / MILLION,
    );
    expect(
      costOf("claude-haiku-5-5", { input_tokens: 1_000, cache_read_input_tokens: 100_000, output_tokens: 1_000 }),
    ).toBeCloseTo((1_000 * long.input + 100_000 * long.cacheRead + 1_000 * long.output) / MILLION);
  });

  it("reads missing, null or nonsense counts as none", () => {
    expect(costOf("claude-haiku-5-5", {})).toBe(0);
    expect(
      costOf("claude-sonnet-5-5", {
        input_tokens: null,
        output_tokens: -5,
        cache_read_input_tokens: Number.NaN,
        cache_creation_input_tokens: Infinity,
      }),
    ).toBe(0);
  });

  it("formats dollars for Settings and the panel", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.005)).toBe("$0.01");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(2)).toBe("$2.00");
    expect(formatUsd(-1)).toBe("$0.00");
  });
});
