import { createServerFn } from "@tanstack/react-start";

type BriefIn = {
  symbol: string;
  interval: string;
  bias: string;
  confidence: number;
  regime: string;
  price: number;
  stop: number;
  target: number;
  rsi: number;
  volRatio: number;
  reasons: string[];
};

function isBrief(input: unknown): input is BriefIn {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.symbol === "string" &&
    typeof o.interval === "string" &&
    typeof o.bias === "string" &&
    typeof o.confidence === "number" &&
    typeof o.regime === "string" &&
    typeof o.price === "number" &&
    typeof o.stop === "number" &&
    typeof o.target === "number" &&
    typeof o.rsi === "number" &&
    typeof o.volRatio === "number" &&
    Array.isArray(o.reasons)
  );
}

export const briefSetup = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!isBrief(input)) throw new Error("Bad brief request");
    return {
      ...input,
      reasons: input.reasons.filter((r): r is string => typeof r === "string").slice(0, 6),
    };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Grok is not available in this environment" };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.3,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "You write a short desk note for a paper-trading terminal. Use ONLY the facts in the user message. Do not invent prices, indicators, news, or a win rate. 70 to 110 words. Plain prose, no markdown, no bullets, no headers. Name the bias, why the factors agree or conflict, the invalidation, and one practical risk. Never promise profit.",
          },
          {
            role: "user",
            content: JSON.stringify(data),
          },
        ],
      }),
    });

    if (!res.ok) return { ok: false as const, error: `Grok could not answer (${res.status})` };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: "Grok returned an empty note" };
    return { ok: true as const, text };
  });
