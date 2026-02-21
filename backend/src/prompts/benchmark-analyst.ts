/**
 * Benchmark Analyst prompt — triggered by inbound HCS requests.
 * Collects AI benchmark data from Hedera topics (blackjack, crop) and instructs
 * the model to summarize which AI performs best per test, with grades.
 */

export const BENCHMARK_ANALYST_SYSTEM = `You are a Benchmark Analyst for an AI testing platform. Your role is to evaluate which AI models perform best across different benchmark tests using real, on-chain data.

## Use Case
We run AI models against each other on various benchmarks (Blackjack, Crop Trading, etc.) to learn which is best based on real outcomes. All results are stored on Hedera Consensus Service (HCS) topics — immutable, verifiable data.

## Data Sources (Hedera Topics)
The data below is fetched from our HCS topics. Each message has:
- \`domain\`: "blackjack" | "blackjack_vs" | "crop_decision"
- \`ts\`: submission timestamp
- Model IDs identify which AI produced each result

### Test Types
1. **Blackjack (single)** — One AI plays alone: outcome (win/loss/push), PnL per hand, cards, decisions.
2. **Blackjack VS** — Two AIs at same table: modelIdA vs modelIdB, pnlA vs pnlB, outcomes, bets.
3. **Crop Decision** — Two AIs trading corn futures: modelAId vs modelBId, snapshotA vs snapshotB with cash, bushels, value, cost basis, trades (buy/sell/hold), portfolio P&L over time.

## Your Task
For each benchmark test present in the data:

1. **Summarize** — Which model(s) perform best? Use concrete metrics:
   - Blackjack: total PnL (cents), win/loss/push counts, ROI
   - Crop: portfolio value vs start, realized P&L, bushel positions
2. **Grade** — Assign each model a grade (A/B/C/D/F or 1–5 stars) with a one-line justification.
3. **Overall** — If multiple tests exist, recommend which model is best overall and why.

When data is sparse or a model hasn't been tested yet, state that clearly. Use only the provided chain data — do not invent results.`;

/** Build the data context block injected before the user's question. */
export function buildDataContext(messages: Array<{ message: string; consensus_timestamp?: string; sequence_number?: number }>): string {
  if (messages.length === 0) {
    return "## Chain Data\nNo messages found on the topic yet. No benchmark results to analyze.";
  }

  const byDomain: Record<string, unknown[]> = { blackjack: [], blackjack_vs: [], crop_decision: [] };
  for (const { message } of messages) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const domain = String(parsed.domain ?? "");
      if (domain in byDomain) {
        byDomain[domain as keyof typeof byDomain].push(parsed);
      }
    } catch {
      /* skip */
    }
  }

  const lines: string[] = ["## Chain Data (from Hedera HCS topic)", ""];
  for (const [domain, items] of Object.entries(byDomain)) {
    if (items.length === 0) continue;
    lines.push(`### ${domain} (${items.length} messages)`);
    // Truncate if huge; keep last N for context window
    const toShow = items.length > 200 ? items.slice(-200) : items;
    lines.push("```json");
    lines.push(JSON.stringify(toShow, null, 0));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

/** Full prompt construction: system + data context + user question. */
export function buildBenchmarkAnalystPrompt(
  userQuestion: string,
  dataContext: string
): { system: string; user: string } {
  return {
    system: BENCHMARK_ANALYST_SYSTEM,
    user: `${dataContext}\n\n---\n\n**User question:** ${userQuestion}`,
  };
}

/** Trigger phrases that indicate a benchmark analysis request. */
const ANALYST_TRIGGERS = /(summarize|which ai|grade|best (model|ai)|how are|benchmark|performance|compare models|who is winning)/i;

/**
 * Extract question for analyst from inbound message. Returns null if not an analyst request.
 * Accepts: plain text question, JSON { "question": "..." }, { "ask": "..." }
 */
export function parseAnalystQuestion(contents: string): string | null {
  const trimmed = contents.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const q = (parsed.question ?? parsed.ask ?? parsed.q) as string | undefined;
    if (typeof q === "string" && q.length > 0) return q;
    if (parsed.type === "benchmark_analyst" && typeof parsed.question === "string") return parsed.question;
  } catch {
    /* not JSON */
  }
  if (ANALYST_TRIGGERS.test(trimmed) || trimmed.includes("?")) return trimmed;
  return null;
}

/**
 * Fetch HCS data, build prompt, call LLM. Used when inbound request triggers analysis.
 * @param userQuestion — from inbound message (e.g. "Which AI is performing best?")
 * @returns analysis text or error message
 */
export async function invokeBenchmarkAnalyst(userQuestion: string): Promise<string> {
  const { fetchTopicMessages } = await import("../hedera/mirror.js");
  const { chatCompletion } = await import("../ai/openai.js");

  const messages = await fetchTopicMessages({ order: "asc", maxMessages: 5000 });
  const dataContext = buildDataContext(messages);
  const { system, user } = buildBenchmarkAnalystPrompt(userQuestion || "Summarize which AI models perform best across all benchmarks and grade each.", dataContext);

  try {
    return await chatCompletion(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { model: "gpt-4o-mini", maxTokens: 2000 }
    );
  } catch (e) {
    console.warn("[Benchmark Analyst] LLM error:", e);
    return `Analysis failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
