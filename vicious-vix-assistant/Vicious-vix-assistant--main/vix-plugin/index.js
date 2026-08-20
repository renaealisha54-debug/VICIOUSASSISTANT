import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Vix fallback: sends the user's message to Groq/LLaMA and returns the reply.
 * Requires internet. Use vixNavigate instead for offline navigation matching.
 */
export async function vixFill(userMessage) {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: userMessage }],
  });

  return completion.choices[0]?.message?.content ?? "";
}

// --- Offline navigation matching ---

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * vixNavigate: matches a loosely-phrased voice command to a known
 * navigation route, entirely offline (no network, no API key needed).
 *
 * routes: [{ name, keywords: string[], target }]
 *
 * Returns the target of the best-matching route, or null if nothing scores
 * high enough to be confident.
 */
export function vixNavigate(command, routes) {
  if (!command || !Array.isArray(routes) || routes.length === 0) return null;

  const normalized = command.toLowerCase().trim();
  const words = normalized.split(/\s+/);

  let best = null;
  let bestScore = 0;

  for (const route of routes) {
    let score = 0;

    for (const rawKeyword of route.keywords) {
      const keyword = rawKeyword.toLowerCase();

      if (normalized.includes(keyword)) {
        score += 1;
        continue;
      }

      for (const word of words) {
 score += similarity(word, keyword) * 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = route;
    }
  }

  return bestScore >= 0.5 ? best.target : null;
}
