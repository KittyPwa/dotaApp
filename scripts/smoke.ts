import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const port = process.env.SMOKE_PORT ?? "3345";
const baseUrl = `http://127.0.0.1:${port}`;
const smokeDatabasePath = resolve(tmpdir(), "dota-local-analytics", `smoke-${Date.now()}.sqlite`);
mkdirSync(dirname(smokeDatabasePath), { recursive: true });

async function getJson(path: string, headers?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
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

async function getStatus(path: string, headers?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  return { status: response.status, body: text };
}

async function postJson(path: string, body: unknown, headers?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function deleteJson(path: string, headers?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForHealth(child: ReturnType<typeof spawn>) {
  let childExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
  });

  const deadline = Date.now() + 20_000;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    if (childExit) {
      throw new Error(`Backend exited before smoke checks started: ${JSON.stringify(childExit)}`);
    }

    try {
      return (await getJson("/api/health")) as { ok: boolean };
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(`Backend did not become ready for smoke checks: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  const child = spawn(process.execPath, ["app/backend/dist/server.js"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPEN_BROWSER: "false",
      BACKEND_PORT: port,
      DATABASE_PATH: smokeDatabasePath
    }
  });

  try {
    const health = await waitForHealth(child);
    const dashboard = (await getJson("/api/dashboard")) as { totalStoredMatches: number };
    const heroes = (await getJson("/api/heroes/stats")) as Array<{ heroId: number }>;
    const enrichmentRoute = await getStatus("/api/provider-enrichment");
    if (enrichmentRoute.status === 404) {
      throw new Error("Provider enrichment route is missing.");
    }
    if (![403, 200].includes(enrichmentRoute.status)) {
      throw new Error(`/api/provider-enrichment returned unexpected status ${enrichmentRoute.status}: ${enrichmentRoute.body}`);
    }

    let testedMatchId: number | null = null;
    if (heroes.length) {
      const hero = await getJson(`/api/heroes/${heroes[0].heroId}`);
      const heroMatches = (hero as { recentMatches: Array<{ matchId: number }> }).recentMatches;

      if (heroMatches.length) {
        testedMatchId = heroMatches[0].matchId;
        await getJson(`/api/matches/${testedMatchId}`);
      }
    }

    const draftOwnerHeaders = { "x-draft-owner-key": "smoketestdraftownerkey" };
    const draftId = `smoke-${Date.now()}`;
    await postJson(
      "/api/draft-plans",
      {
        id: draftId,
        leagueId: 1,
        name: "Smoke draft",
        firstTeamId: null,
        secondTeamId: null,
        updatedAt: Date.now(),
        slots: [{ id: `${draftId}-0`, side: "first", kind: "ban", label: "B1", heroIds: [heroes[0]?.heroId ?? 1] }]
      },
      draftOwnerHeaders
    );
    const draftPlans = (await getJson("/api/draft-plans?leagueId=1", draftOwnerHeaders)) as Array<{ id: string }>;
    if (!draftPlans.some((draft) => draft.id === draftId)) {
      throw new Error("Draft plan smoke create was not readable.");
    }
    await deleteJson(`/api/draft-plans/${draftId}`, draftOwnerHeaders);

    if (!health.ok) {
      throw new Error("Health check returned not ok.");
    }
    if (typeof dashboard.totalStoredMatches !== "number") {
      throw new Error("Dashboard smoke check did not return a match count.");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          dashboardMatches: dashboard.totalStoredMatches,
          heroId: heroes[0]?.heroId ?? null,
          testedMatchId
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
