import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { Page } from "../components/Page";
import { ErrorState, LoadingState } from "../components/State";
import { useSaveSettings, useSettings } from "../hooks/useQueries";

type SettingsTab = "players" | "leagues" | "data" | "providers" | "accessibility" | "diagnostics";

function titleCaseSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseSavedLeagueLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [idPart, ...slugParts] = line.split("-");
      const leagueId = Number(idPart);
      const slug = slugParts.join("-").trim();
      const name = slug ? titleCaseSlug(slug) : `League ${leagueId}`;
      return { leagueId, slug: slug || String(leagueId), name };
    })
    .filter(
      (league, index, list) =>
        Number.isInteger(league.leagueId) &&
        league.leagueId > 0 &&
        list.findIndex((entry) => entry.leagueId === league.leagueId) === index
    );
}

function parseSavedLeagueLine(value: string) {
  return parseSavedLeagueLines(value)[0] ?? null;
}

export function SettingsPage() {
  const query = useSettings();
  const save = useSaveSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("players");
  const [openDotaApiKey, setOpenDotaApiKey] = useState("");
  const [stratzApiKey, setStratzApiKey] = useState("");
  const [steamApiKey, setSteamApiKey] = useState("");
  const [primaryPlayerId, setPrimaryPlayerId] = useState("");
  const [favoritePlayerIds, setFavoritePlayerIds] = useState("");
  const [trackedLeagues, setTrackedLeagues] = useState<Array<{ leagueId: number; slug: string; name: string }>>([]);
  const [leagueInput, setLeagueInput] = useState("");
  const [limitToRecentPatches, setLimitToRecentPatches] = useState(true);
  const [recentPatchCount, setRecentPatchCount] = useState("2");
  const [colorblindMode, setColorblindMode] = useState(false);
  const [stratzDailyRequestCap, setStratzDailyRequestCap] = useState("10000");
  const [stratzTestPlayerId, setStratzTestPlayerId] = useState("148440404");
  const [backendDiag, setBackendDiag] = useState<string | null>(null);
  const [browserDiag, setBrowserDiag] = useState<string | null>(null);
  const [schemaDiag, setSchemaDiag] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState<null | "backend" | "browser" | "steam">(null);

  useEffect(() => {
    if (query.data) {
      setOpenDotaApiKey(query.data.openDotaApiKey ?? "");
      setStratzApiKey(query.data.stratzApiKey ?? "");
      setSteamApiKey(query.data.steamApiKey ?? "");
      setPrimaryPlayerId(query.data.primaryPlayerId ? String(query.data.primaryPlayerId) : "");
      setFavoritePlayerIds(query.data.favoritePlayerIds.join(", "));
      setTrackedLeagues(query.data.savedLeagues);
      setLimitToRecentPatches(query.data.limitToRecentPatches);
      setRecentPatchCount(String(query.data.recentPatchCount));
      setColorblindMode(query.data.colorblindMode);
      setStratzDailyRequestCap(String(query.data.stratzDailyRequestCap));
      setStratzTestPlayerId(query.data.primaryPlayerId ? String(query.data.primaryPlayerId) : "148440404");
    }
  }, [query.data]);

  const parsedFavoritePlayerIds = useMemo(
    () =>
      favoritePlayerIds
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index),
    [favoritePlayerIds]
  );

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "players", label: "Players" },
    { id: "leagues", label: "Leagues" },
    { id: "data", label: "Data scope" },
    { id: "providers", label: "Providers" },
    { id: "accessibility", label: "Accessibility" },
    { id: "diagnostics", label: "Diagnostics" }
  ];

  return (
    <Page
      title="Settings"
      subtitle="Everything here is stored locally in your SQLite database and only affects this machine."
    >
      {query.isLoading ? <LoadingState label="Loading settings..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      <Card title="Configuration">
        <div className="settings-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const parsedPrimaryPlayerId = primaryPlayerId.trim() ? Number(primaryPlayerId.trim()) : null;
            const parsedRecentPatchCount = Math.max(0, Number(recentPatchCount.trim()) || 0);
            const parsedStratzDailyRequestCap = Math.min(100000, Math.max(1, Number(stratzDailyRequestCap.trim()) || 10000));
            save.mutate({
              openDotaApiKey: openDotaApiKey.trim() || null,
              stratzApiKey: stratzApiKey.trim() || null,
              steamApiKey: steamApiKey.trim() || null,
              primaryPlayerId:
                Number.isInteger(parsedPrimaryPlayerId) && (parsedPrimaryPlayerId ?? 0) > 0 ? parsedPrimaryPlayerId : null,
              favoritePlayerIds: parsedFavoritePlayerIds,
              savedLeagues: trackedLeagues,
              limitToRecentPatches,
              recentPatchCount: parsedRecentPatchCount,
              autoRefreshPlayerIds: query.data?.autoRefreshPlayerIds ?? [],
              colorblindMode,
              stratzDailyRequestCap: parsedStratzDailyRequestCap
            });
          }}
        >
          {activeTab === "players" ? (
            <div className="stack">
              <label>
                Your player ID
                <input
                  value={primaryPlayerId}
                  onChange={(event) => setPrimaryPlayerId(event.target.value)}
                  placeholder="Example: 148440404"
                />
              </label>
              <label>
                Favorite player IDs
                <input
                  value={favoritePlayerIds}
                  onChange={(event) => setFavoritePlayerIds(event.target.value)}
                  placeholder="Comma-separated IDs"
                />
              </label>
              <p className="muted-inline">
                Favorites drive the dashboard and compare quick-picks. Current valid favorites: {parsedFavoritePlayerIds.length}.
              </p>
            </div>
          ) : null}

          {activeTab === "leagues" ? (
            <div className="stack">
              <div className="league-settings-panel">
                <div className="stack compact">
                  <span className="eyebrow">Tracked leagues</span>
                  <strong>Add tournaments you want to analyze locally</strong>
                  <p className="muted-inline">
                    Paste a league ID with an optional readable slug. Example: `18602-french-only-league`.
                  </p>
                </div>
                <div className="league-add-row">
                  <input
                    value={leagueInput}
                    onChange={(event) => setLeagueInput(event.target.value)}
                    placeholder="18602-french-only-league"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const parsed = parseSavedLeagueLine(leagueInput);
                      if (!parsed) return;
                      setTrackedLeagues((current) =>
                        [...current.filter((league) => league.leagueId !== parsed.leagueId), parsed].sort(
                          (left, right) => left.name.localeCompare(right.name)
                        )
                      );
                      setLeagueInput("");
                    }}
                  >
                    Add league
                  </button>
                </div>
                <div className="league-chip-list">
                  {trackedLeagues.length === 0 ? (
                    <p className="muted-inline">No tracked leagues yet.</p>
                  ) : (
                    trackedLeagues.map((league) => (
                      <div key={league.leagueId} className="league-chip">
                        <div>
                          <strong>{league.name}</strong>
                          <span className="muted-inline">#{league.leagueId}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTrackedLeagues((current) => current.filter((entry) => entry.leagueId !== league.leagueId))}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <p className="muted-inline">
                Tracked leagues appear in the sidebar. Open a league and use `Sync league matches` to populate local analytics.
              </p>
              <p className="muted-inline">Tracked leagues: {trackedLeagues.length}</p>
            </div>
          ) : null}

          {activeTab === "data" ? (
            <div className="stack">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={limitToRecentPatches}
                  onChange={(event) => setLimitToRecentPatches(event.target.checked)}
                />
                <span>Limit match views and analytics to recent patches by default</span>
              </label>
              {limitToRecentPatches ? (
                <label>
                  Previous patches to include
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={recentPatchCount}
                    onChange={(event) => setRecentPatchCount(event.target.value)}
                    placeholder="2"
                  />
                  <span className="muted-inline">
                    `0` means current patch only. `2` means current patch plus the previous two.
                  </span>
                </label>
              ) : (
                <p className="muted-inline">All locally stored matches are included when the patch filter is disabled.</p>
              )}
            </div>
          ) : null}

          {activeTab === "providers" ? (
            <div className="stack">
              <label>
                OpenDota API key
                <input value={openDotaApiKey} onChange={(event) => setOpenDotaApiKey(event.target.value)} placeholder="Optional" />
              </label>
              <label>
                STRATZ API key
                <input
                  value={stratzApiKey}
                  onChange={(event) => setStratzApiKey(event.target.value)}
                  placeholder="Required for STRATZ enrichment"
                />
              </label>
              <label>
                Steam Web API key
                <input
                  value={steamApiKey}
                  onChange={(event) => setSteamApiKey(event.target.value)}
                  placeholder="Used for Valve Dota match history and league sync"
                />
              </label>
              <label>
                STRATZ daily request cap
                <input
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={stratzDailyRequestCap}
                  onChange={(event) => setStratzDailyRequestCap(event.target.value)}
                />
                <span className="muted-inline">
                  Hard caps enforced locally: `20/s`, `250/min`, `2000/h`, and this daily limit.
                </span>
              </label>
              <p className="muted-inline">
                STRATZ is used to enrich telemetry when OpenDota is missing timelines, purchases, or ward event data.
              </p>
            </div>
          ) : null}

          {activeTab === "accessibility" ? (
            <div className="stack">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={colorblindMode}
                  onChange={(event) => setColorblindMode(event.target.checked)}
                />
                <span>Colorblind mode</span>
              </label>
              <p className="muted-inline">
                Adjusts win/loss, team, and timeline colors to a palette that is easier to distinguish without red-green dependence.
              </p>
            </div>
          ) : null}

          {activeTab === "diagnostics" ? (
            <div className="stack">
              <p className="muted-inline">
                Use these tests to confirm that the API key works from both the backend and the browser path.
              </p>
              <label>
                Test player ID
                <input
                  value={stratzTestPlayerId}
                  onChange={(event) => setStratzTestPlayerId(event.target.value)}
                  placeholder="Example: 148440404"
                />
              </label>
              <div className="action-group">
                <button
                  type="button"
                  disabled={diagRunning !== null}
                  onClick={async () => {
                    setDiagRunning("steam");
                    setBackendDiag(null);
                    try {
                      const response = await fetch("/api/providers/steam/league-test/18602");
                      const text = await response.text();
                      setBackendDiag(`Steam league 18602 HTTP ${response.status}: ${text.slice(0, 1000)}`);
                    } catch (error) {
                      setBackendDiag(error instanceof Error ? error.message : "Steam Web API league test failed.");
                    } finally {
                      setDiagRunning(null);
                    }
                  }}
                >
                  {diagRunning === "steam" ? "Testing Steam..." : "Test Steam league 18602"}
                </button>
                <button
                  type="button"
                  disabled={diagRunning !== null}
                  onClick={async () => {
                    const playerId = Number(stratzTestPlayerId.trim());
                    if (!Number.isInteger(playerId) || playerId <= 0) {
                      setBackendDiag("Choose a valid positive player ID first.");
                      return;
                    }

                    setDiagRunning("backend");
                    setBackendDiag(null);
                    try {
                      const response = await fetch(`/api/providers/stratz/test/${playerId}`);
                      const text = await response.text();
                      setBackendDiag(`HTTP ${response.status}: ${text}`);
                    } catch (error) {
                      setBackendDiag(error instanceof Error ? error.message : "Backend STRATZ test failed.");
                    } finally {
                      setDiagRunning(null);
                    }
                  }}
                >
                  {diagRunning === "backend" ? "Testing backend..." : "Test STRATZ through backend"}
                </button>
                <button
                  type="button"
                  disabled={diagRunning !== null || !stratzApiKey.trim()}
                  onClick={async () => {
                    const playerId = Number(stratzTestPlayerId.trim());
                    if (!Number.isInteger(playerId) || playerId <= 0) {
                      setBrowserDiag("Choose a valid positive player ID first.");
                      return;
                    }

                    setDiagRunning("browser");
                    setBrowserDiag(null);
                    try {
                      const response = await fetch("https://api.stratz.com/graphql", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Accept: "application/json",
                          Authorization: `Bearer ${stratzApiKey.trim()}`
                        },
                        body: JSON.stringify({
                          query: "query PlayerBasic($playerId: Long!) { player(steamAccountId: $playerId) { steamAccountId } }",
                          variables: { playerId }
                        })
                      });

                      const text = await response.text();
                      setBrowserDiag(`HTTP ${response.status}: ${text.slice(0, 500)}`);
                    } catch (error) {
                      setBrowserDiag(error instanceof Error ? error.message : "Browser STRATZ test failed.");
                    } finally {
                      setDiagRunning(null);
                    }
                  }}
                >
                  {diagRunning === "browser" ? "Testing browser..." : "Test STRATZ directly from browser"}
                </button>
                <button
                  type="button"
                  disabled={diagRunning !== null || !stratzApiKey.trim()}
                  onClick={async () => {
                    setDiagRunning("browser");
                    setSchemaDiag(null);
                    try {
                      const response = await fetch("https://api.stratz.com/graphql", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Accept: "application/json",
                          Authorization: `Bearer ${stratzApiKey.trim()}`
                        },
                        body: JSON.stringify({
                          query:
                            "query StratzSchemaProbe { __schema { queryType { fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } } } }"
                        })
                      });

                      const text = await response.text();
                      setSchemaDiag(`HTTP ${response.status}: ${text.slice(0, 2000)}`);
                    } catch (error) {
                      setSchemaDiag(error instanceof Error ? error.message : "Browser STRATZ schema probe failed.");
                    } finally {
                      setDiagRunning(null);
                    }
                  }}
                >
                  Probe STRATZ schema from browser
                </button>
              </div>
              {backendDiag ? <pre className="state">{backendDiag}</pre> : null}
              {browserDiag ? <pre className="state">{browserDiag}</pre> : null}
              {schemaDiag ? <pre className="state">{schemaDiag}</pre> : null}
            </div>
          ) : null}

          <div className="action-group">
            <button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save settings"}
            </button>
            {save.isError ? <p className="form-error">{(save.error as Error).message}</p> : null}
            {save.isSuccess ? <p className="form-success">Settings saved locally.</p> : null}
          </div>
        </form>
      </Card>
    </Page>
  );
}
