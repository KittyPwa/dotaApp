import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiPost,
  clearStoredAdminPassword,
  getSessionColorblindModeOverride,
  getSessionDarkModeOverride,
  getSessionPatchScopeOverride,
  getLocalAutoRefreshPlayerIdsOverride,
  getLocalPrimaryPlayerIdOverride,
  LOCAL_PLAYER_PREFERENCES_EVENT,
  setLocalAutoRefreshPlayerIdsOverride,
  setLocalPrimaryPlayerIdOverride,
  setSessionColorblindModeOverride,
  setSessionDarkModeOverride,
  setSessionPatchScopeOverride,
  storeAdminPassword
} from "../api/client";
import { Card } from "../components/Card";
import { CommunityGraphView } from "../components/CommunityGraphView";
import { Page } from "../components/Page";
import { ErrorState, LoadingState } from "../components/State";
import { useCommunity, useSaveSettings, useSettings } from "../hooks/useQueries";

type SettingsTab = "players" | "leagues" | "data" | "providers" | "accessibility" | "diagnostics" | "community";

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
  const queryClient = useQueryClient();
  const query = useSettings();
  const save = useSaveSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("players");
  const [openDotaApiKey, setOpenDotaApiKey] = useState("");
  const [stratzApiKey, setStratzApiKey] = useState("");
  const [steamApiKey, setSteamApiKey] = useState("");
  const [primaryPlayerId, setPrimaryPlayerId] = useState("");
  const [trackedLeagues, setTrackedLeagues] = useState<Array<{ leagueId: number; slug: string; name: string }>>([]);
  const [leagueInput, setLeagueInput] = useState("");
  const [limitToRecentPatches, setLimitToRecentPatches] = useState(true);
  const [recentPatchCount, setRecentPatchCount] = useState("2");
  const [colorblindMode, setColorblindMode] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [stratzPerSecondCap, setStratzPerSecondCap] = useState("20");
  const [stratzPerMinuteCap, setStratzPerMinuteCap] = useState("250");
  const [stratzPerHourCap, setStratzPerHourCap] = useState("2000");
  const [stratzDailyRequestCap, setStratzDailyRequestCap] = useState("10000");
  const [stratzTestPlayerId, setStratzTestPlayerId] = useState("148440404");
  const [backendDiag, setBackendDiag] = useState<string | null>(null);
  const [browserDiag, setBrowserDiag] = useState<string | null>(null);
  const [schemaDiag, setSchemaDiag] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState<null | "backend" | "browser" | "steam">(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [adminUnlockError, setAdminUnlockError] = useState<string | null>(null);
  const [adminUnlockPending, setAdminUnlockPending] = useState(false);

  useEffect(() => {
    const syncLocalPlayerPreferences = () => {
      const localPrimaryPlayerId = getLocalPrimaryPlayerIdOverride();
      setPrimaryPlayerId(localPrimaryPlayerId ? String(localPrimaryPlayerId) : "");
    };

    window.addEventListener(LOCAL_PLAYER_PREFERENCES_EVENT, syncLocalPlayerPreferences);
    return () => {
      window.removeEventListener(LOCAL_PLAYER_PREFERENCES_EVENT, syncLocalPlayerPreferences);
    };
  }, []);

  useEffect(() => {
    if (query.data) {
      const sessionPatchOverride = getSessionPatchScopeOverride();
      const sessionColorblindOverride = getSessionColorblindModeOverride();
      const sessionDarkModeOverride = getSessionDarkModeOverride();
      const localPrimaryPlayerId = getLocalPrimaryPlayerIdOverride();
      const localAutoRefreshPlayerIds = getLocalAutoRefreshPlayerIdsOverride();
      setOpenDotaApiKey(query.data.openDotaApiKey ?? "");
      setStratzApiKey(query.data.stratzApiKey ?? "");
      setSteamApiKey(query.data.steamApiKey ?? "");
      setPrimaryPlayerId(String(localPrimaryPlayerId ?? query.data.primaryPlayerId ?? ""));
      setTrackedLeagues(query.data.savedLeagues);
      setLimitToRecentPatches(sessionPatchOverride.limitToRecentPatches ?? query.data.limitToRecentPatches);
      setRecentPatchCount(String(sessionPatchOverride.recentPatchCount ?? query.data.recentPatchCount));
      setColorblindMode(sessionColorblindOverride ?? query.data.colorblindMode);
      setDarkMode(sessionDarkModeOverride ?? query.data.darkMode);
      setStratzPerSecondCap(String(query.data.stratzPerSecondCap));
      setStratzPerMinuteCap(String(query.data.stratzPerMinuteCap));
      setStratzPerHourCap(String(query.data.stratzPerHourCap));
      setStratzDailyRequestCap(String(query.data.stratzDailyRequestCap));
      setStratzTestPlayerId(
        String(localPrimaryPlayerId ?? query.data.primaryPlayerId ?? localAutoRefreshPlayerIds[0] ?? 148440404)
      );
    }
  }, [query.data]);

  const adminProtectionEnabled = query.data?.adminPasswordConfigured ?? false;
  const adminUnlocked = query.data?.adminUnlocked ?? false;
  const communityQuery = useCommunity(adminUnlocked);
  const canManagePersistentSettings = !adminProtectionEnabled || adminUnlocked;
  const canManageSessionPreferences = true;
  const sessionOnlyTab = activeTab === "data" || activeTab === "accessibility";
  const browserPlayerTab = activeTab === "players";
  const canSubmitCurrentTab = canManagePersistentSettings || sessionOnlyTab || browserPlayerTab;

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "players", label: "Players" },
    { id: "leagues", label: "Leagues" },
    { id: "data", label: "Data scope" },
    { id: "accessibility", label: "Accessibility" }
  ];
  if (!adminProtectionEnabled || adminUnlocked) {
    tabs.push({ id: "providers", label: "Providers" }, { id: "diagnostics", label: "Diagnostics" }, { id: "community", label: "Community" });
  }

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? "leagues");
    }
  }, [activeTab, tabs]);

  return (
    <Page title="Settings">
      {query.isLoading ? <LoadingState label="Loading settings..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {!adminProtectionEnabled ? (
        <Card title="Admin password">
          <div className="stack">
            <p className="muted-inline">
              Set an admin password once. It will be stored locally as a salted hash in SQLite and will protect settings and admin actions.
            </p>
            <label>
              New password
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="At least 10 characters"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={adminPasswordConfirm}
                onChange={(event) => setAdminPasswordConfirm(event.target.value)}
                placeholder="Repeat the password"
              />
            </label>
            <button
              type="button"
              disabled={adminUnlockPending || adminPassword.trim().length < 10 || adminPassword !== adminPasswordConfirm}
              onClick={async () => {
                setAdminUnlockPending(true);
                setAdminUnlockError(null);
                try {
                  await apiPost("/api/admin/setup", { password: adminPassword.trim() });
                  storeAdminPassword(adminPassword.trim());
                  setAdminPasswordConfirm("");
                  await query.refetch();
                } catch (error) {
                  clearStoredAdminPassword();
                  setAdminUnlockError(error instanceof Error ? error.message : "Password setup failed.");
                } finally {
                  setAdminUnlockPending(false);
                }
              }}
            >
              {adminUnlockPending ? "Saving..." : "Set admin password"}
            </button>
            {adminPassword && adminPasswordConfirm && adminPassword !== adminPasswordConfirm ? (
              <p className="form-error">Passwords do not match.</p>
            ) : null}
            {adminUnlockError ? <p className="form-error">{adminUnlockError}</p> : null}
          </div>
        </Card>
      ) : null}
      {adminProtectionEnabled ? (
        <Card title="Admin access">
          <div className="stack">
            {adminUnlocked ? (
              <>
                <p className="muted-inline">Admin controls are unlocked for this browser session.</p>
                <button
                  type="button"
                  onClick={async () => {
                    clearStoredAdminPassword();
                    setAdminPassword("");
                    setAdminUnlockError(null);
                    await query.refetch();
                  }}
                >
                  Lock admin controls
                </button>
              </>
            ) : (
              <>
                <label>
                  Password
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    placeholder="Admin password"
                  />
                </label>
                <button
                  type="button"
                  disabled={adminUnlockPending || !adminPassword.trim()}
                  onClick={async () => {
                    setAdminUnlockPending(true);
                    setAdminUnlockError(null);
                    try {
                      await apiPost("/api/admin/unlock", { password: adminPassword.trim() });
                      storeAdminPassword(adminPassword.trim());
                      await query.refetch();
                    } catch (error) {
                      clearStoredAdminPassword();
                      setAdminUnlockError(error instanceof Error ? error.message : "Unlock failed.");
                    } finally {
                      setAdminUnlockPending(false);
                    }
                  }}
                >
                  {adminUnlockPending ? "Unlocking..." : "Unlock admin controls"}
                </button>
                {adminUnlockError ? <p className="form-error">{adminUnlockError}</p> : null}
              </>
            )}
          </div>
        </Card>
      ) : null}
      <Card title="Settings">
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
            if (!canSubmitCurrentTab) return;
            const parsedPrimaryPlayerId = primaryPlayerId.trim() ? Number(primaryPlayerId.trim()) : null;
            const parsedRecentPatchCount = Math.max(0, Number(recentPatchCount.trim()) || 0);
            const parsedStratzPerSecondCap = Math.min(1000, Math.max(1, Number(stratzPerSecondCap.trim()) || 20));
            const parsedStratzPerMinuteCap = Math.min(10000, Math.max(1, Number(stratzPerMinuteCap.trim()) || 250));
            const parsedStratzPerHourCap = Math.min(100000, Math.max(1, Number(stratzPerHourCap.trim()) || 2000));
            const parsedStratzDailyRequestCap = Math.min(100000, Math.max(1, Number(stratzDailyRequestCap.trim()) || 10000));
            if (activeTab === "players") {
              const nextPrimaryPlayerId =
                Number.isInteger(parsedPrimaryPlayerId) && (parsedPrimaryPlayerId ?? 0) > 0 ? parsedPrimaryPlayerId : null;
              setLocalPrimaryPlayerIdOverride(nextPrimaryPlayerId);
              setLocalAutoRefreshPlayerIdsOverride(getLocalAutoRefreshPlayerIdsOverride());
              void queryClient.invalidateQueries({ queryKey: ["settings"] });
              void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              void queryClient.invalidateQueries({ queryKey: ["player"] });
              void queryClient.invalidateQueries({ queryKey: ["player-compare"] });
              return;
            }
            if (!canManagePersistentSettings && sessionOnlyTab) {
              setSessionPatchScopeOverride({
                limitToRecentPatches,
                recentPatchCount: parsedRecentPatchCount
              });
              setSessionColorblindModeOverride(colorblindMode);
              setSessionDarkModeOverride(darkMode);
              void queryClient.invalidateQueries({ queryKey: ["settings"] });
              void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              void queryClient.invalidateQueries({ queryKey: ["player"] });
              void queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
              void queryClient.invalidateQueries({ queryKey: ["hero"] });
              void queryClient.invalidateQueries({ queryKey: ["player-compare"] });
              return;
            }
            save.mutate({
              openDotaApiKey: openDotaApiKey.trim() || null,
              stratzApiKey: stratzApiKey.trim() || null,
              steamApiKey: steamApiKey.trim() || null,
              primaryPlayerId:
                Number.isInteger(parsedPrimaryPlayerId) && (parsedPrimaryPlayerId ?? 0) > 0 ? parsedPrimaryPlayerId : null,
              favoritePlayerIds: query.data?.favoritePlayerIds ?? [],
              savedLeagues: trackedLeagues,
              limitToRecentPatches,
              recentPatchCount: parsedRecentPatchCount,
              autoRefreshPlayerIds: query.data?.autoRefreshPlayerIds ?? [],
              colorblindMode,
              darkMode,
              stratzPerSecondCap: parsedStratzPerSecondCap,
              stratzPerMinuteCap: parsedStratzPerMinuteCap,
              stratzPerHourCap: parsedStratzPerHourCap,
              stratzDailyRequestCap: parsedStratzDailyRequestCap,
              appMode: query.data?.appMode ?? "personal",
              adminUnlocked: query.data?.adminUnlocked ?? false,
              adminPasswordConfigured: query.data?.adminPasswordConfigured ?? false
            });
          }}
        >
          {activeTab === "players" ? (
            <div className="stack">
              <div className="league-chip">
                <div>
                  <strong>Current player</strong>
                  <span className="muted-inline">
                    {primaryPlayerId ? `Steam ID ${primaryPlayerId}` : "No player selected in this browser yet."}
                  </span>
                </div>
                {primaryPlayerId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalPrimaryPlayerIdOverride(null);
                      void query.refetch();
                      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                      void queryClient.invalidateQueries({ queryKey: ["player"] });
                      void queryClient.invalidateQueries({ queryKey: ["player-compare"] });
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <p className="muted-inline">
                Set your player directly from a player page. Favorites are then loaded from the local database for that player.
              </p>
              <p className="muted-inline">
                Favorite players in current view: {query.data?.favoritePlayerIds.length ?? 0}
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
                    disabled={!canManagePersistentSettings}
                    value={leagueInput}
                    onChange={(event) => setLeagueInput(event.target.value)}
                    placeholder="18602-french-only-league"
                  />
                  <button
                    type="button"
                    disabled={!canManagePersistentSettings}
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
                          disabled={!canManagePersistentSettings}
                          hidden={adminProtectionEnabled && !adminUnlocked}
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
                  disabled={!canManageSessionPreferences}
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
                    disabled={!canManageSessionPreferences}
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
              <Card title="OpenDota API">
                <label>
                  OpenDota API key
                  <input disabled={!canManagePersistentSettings} value={openDotaApiKey} onChange={(event) => setOpenDotaApiKey(event.target.value)} placeholder="Optional" />
                </label>
                <p className="muted-inline">Used for public player/match/hero data. Optional for local MVP usage.</p>
              </Card>
              <Card title="STRATZ">
                <div className="stack compact">
                  <label>
                    STRATZ API key
                    <input
                      disabled={!canManagePersistentSettings}
                      value={stratzApiKey}
                      onChange={(event) => setStratzApiKey(event.target.value)}
                      placeholder="Required for STRATZ enrichment"
                    />
                  </label>
                  <div className="two-column">
                    <label>
                      Per second cap
                      <input disabled={!canManagePersistentSettings} type="number" min={1} max={1000} step={1} value={stratzPerSecondCap} onChange={(event) => setStratzPerSecondCap(event.target.value)} />
                    </label>
                    <label>
                      Per minute cap
                      <input disabled={!canManagePersistentSettings} type="number" min={1} max={10000} step={1} value={stratzPerMinuteCap} onChange={(event) => setStratzPerMinuteCap(event.target.value)} />
                    </label>
                    <label>
                      Per hour cap
                      <input disabled={!canManagePersistentSettings} type="number" min={1} max={100000} step={1} value={stratzPerHourCap} onChange={(event) => setStratzPerHourCap(event.target.value)} />
                    </label>
                    <label>
                      Per day cap
                      <input disabled={!canManagePersistentSettings} type="number" min={1} max={100000} step={1} value={stratzDailyRequestCap} onChange={(event) => setStratzDailyRequestCap(event.target.value)} />
                    </label>
                  </div>
                  <p className="muted-inline">
                    These caps are enforced locally before any STRATZ request is sent.
                  </p>
                </div>
              </Card>
              <Card title="Steam Web API">
                <label>
                  Steam Web API key
                  <input
                    disabled={!canManagePersistentSettings}
                    value={steamApiKey}
                    onChange={(event) => setSteamApiKey(event.target.value)}
                    placeholder="Used for Valve Dota match history and league sync"
                  />
                </label>
                <p className="muted-inline">Used for Valve league match listing and Steam-backed Dota endpoints.</p>
              </Card>
            </div>
          ) : null}

          {activeTab === "accessibility" ? (
            <div className="stack">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  disabled={!canManageSessionPreferences}
                  checked={colorblindMode}
                  onChange={(event) => setColorblindMode(event.target.checked)}
                />
                <span>Colorblind mode</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  disabled={!canManageSessionPreferences}
                  checked={darkMode}
                  onChange={(event) => setDarkMode(event.target.checked)}
                />
                <span>Dark mode</span>
              </label>
              <p className="muted-inline">
                Adjusts win/loss, team, and timeline colors to a palette that is easier to distinguish without red-green dependence.
              </p>
              <p className="muted-inline">
                Switches the interface to a darker palette. In locked mode, this applies only to the current browser session.
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
                  disabled={diagRunning !== null || !canManagePersistentSettings}
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
                  disabled={diagRunning !== null || !canManagePersistentSettings}
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
                  disabled={diagRunning !== null || !stratzApiKey.trim() || !canManagePersistentSettings}
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
                  disabled={diagRunning !== null || !stratzApiKey.trim() || !canManagePersistentSettings}
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

          {activeTab === "community" ? (
            <div className="stack">
              {communityQuery.isLoading ? <LoadingState label="Loading community links..." /> : null}
              {communityQuery.error ? <ErrorState error={communityQuery.error as Error} /> : null}
              {communityQuery.data ? (
                communityQuery.data.nodes.length === 0 ? (
                  <Card title="Community">
                    <p className="muted-inline">No favorite relationships stored yet.</p>
                  </Card>
                ) : (
                  <CommunityGraphView graph={communityQuery.data} />
                )
              ) : null}
            </div>
          ) : null}

          <div className="action-group">
            <button type="submit" disabled={save.isPending || !canSubmitCurrentTab}>
              {save.isPending
                ? "Saving..."
                : activeTab === "players"
                  ? "Save for this browser"
                  : !canManagePersistentSettings && sessionOnlyTab
                    ? "Apply for this session"
                    : "Save settings"}
            </button>
            {save.isError ? <p className="form-error">{(save.error as Error).message}</p> : null}
            {save.isSuccess ? <p className="form-success">Settings saved locally.</p> : null}
          </div>
        </form>
      </Card>
    </Page>
  );
}
