/**
 * What a Vibe request costs, worked out from the usage each Messages API
 * response reports, at Anthropic's list prices. It is an estimate for the
 * daily budget, not the bill: the Anthropic Console has that. The prices are
 * written out here, so a change to Anthropic's price list needs an edit.
 */
import type { VibeModel } from "../../config";

/** US dollars per million tokens. */
export interface TokenPrices {
  input: number;
  output: number;
  /** Writing to the 5-minute prompt cache. */
  cacheWrite5m: number;
  /** Writing to the 1-hour prompt cache. */
  cacheWrite1h: number;
  /** Reading from the prompt cache. */
  cacheRead: number;
}

interface ModelPricing {
  standard: TokenPrices;
  /** Dearer prices for a prompt over `threshold` tokens, where the model has them. */
  long?: { threshold: number; prices: TokenPrices };
}

/** Anthropic's list prices, checked against platform.claude.com on 2026-10-08. */
export const PRICES: Record<VibeModel, ModelPricing> = {
  "claude-haiku-5-5": {
    standard: { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 },
    long: {
      threshold: 100_000,
      prices: { input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 },
    },
  },
  // Cache reads on Sonnet 5.5 cost 0.05 times the input price, not 0.1.
  "claude-sonnet-5-5": {
    standard: { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  },
};

/** The fields of a response's `usage` the cost depends on. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

/** A token count from the API, read as 0 when absent or not a count. */
function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The cost in US dollars of one response's usage. */
export function costOf(model: VibeModel, usage: TokenUsage): number {
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const written = count(usage.cache_creation_input_tokens);
  // The split by lifetime, when given; otherwise every write is a 5-minute one,
  // the only kind Vibe asks for.
  const written1h = Math.min(count(usage.cache_creation?.ephemeral_1h_input_tokens), written);
  const written5m = written - written1h;
  const pricing = PRICES[model];
  const prompt = input + written + cacheRead;
  const prices =
    pricing.long && prompt > pricing.long.threshold ? pricing.long.prices : pricing.standard;
  return (
    (input * prices.input +
      output * prices.output +
      written5m * prices.cacheWrite5m +
      written1h * prices.cacheWrite1h +
      cacheRead * prices.cacheRead) /
    1_000_000
  );
}

/**
 * Dollars as shown in Settings and the panel: "$0.04", or "<$0.01" for a
 * spend too small to show in cents, which a few Haiku turns are.
 */
export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.005) return "<$0.01";
  return `$${Math.max(0, amount).toFixed(2)}`;
}
