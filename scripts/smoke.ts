import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";

const port = process.env.SMOKE_PORT ?? "3345";
const baseUrl = `http://127.0.0.1:${port}`;

async function getJson(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body;
}

async function main() {
  const child = spawn(process.execPath, ["app/backend/dist/server.js"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPEN_BROWSER: "false",
      BACKEND_PORT: port
    }
  });

  try {
    await delay(4000);

    const health = (await getJson("/api/health")) as { ok: boolean };
    const heroes = (await getJson("/api/heroes/stats")) as Array<{ heroId: number }>;

    if (!heroes.length) {
      throw new Error("No heroes available in local dataset for smoke test.");
    }

    const hero = await getJson(`/api/heroes/${heroes[0].heroId}`);
    const heroMatches = (hero as { recentMatches: Array<{ matchId: number }> }).recentMatches;

    if (heroMatches.length) {
      await getJson(`/api/matches/${heroMatches[0].matchId}`);
    }

    if (!health.ok) {
      throw new Error("Health check returned not ok.");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          heroId: heroes[0].heroId,
          testedMatchId: heroMatches[0]?.matchId ?? null
        },
        null,
        2
      )
    );
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
