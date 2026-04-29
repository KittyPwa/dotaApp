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
import {
  useCommunity,
  useEnqueueProviderEnrichment,
  useProcessProviderEnrichment,
  useProviderEnrichment,
  useSaveSettings,
  useSettings,
  type ProviderEnrichmentProcessResponse,
  type ProviderEnrichmentEnqueueResponse
} from "../hooks/useQueries";

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
  const [openDotaPerSecondCap, setOpenDotaPerSecondCap] = useState("5");
  const [openDotaPerMinuteCap, setOpenDotaPerMinuteCap] = useState("60");
  const [openDotaPerHourCap, setOpenDotaPerHourCap] = useState("1000");
  const [openDotaDailyRequestCap, setOpenDotaDailyRequestCap] = useState("5000");
  const [steamPerSecondCap, setSteamPerSecondCap] = useState("2");
  const [steamPerMinuteCap, setSteamPerMinuteCap] = useState("60");
  const [steamPerHourCap, setSteamPerHourCap] = useState("1000");
  const [steamDailyRequestCap, setSteamDailyRequestCap] = useState("5000");
  const [providerEnrichmentDailyRequestCap, setProviderEnrichmentDailyRequestCap] = useState("1000");
  const [providerEnrichmentMaxAttempts, setProviderEnrichmentMaxAttempts] = useState("3");
  const [stratzTestPlayerId, setStratzTestPlayerId] = useState("148440404");
  const [backendDiag, setBackendDiag] = useState<string | null>(null);
  const [browserDiag, setBrowserDiag] = useState<string | null>(null);
  const [schemaDiag, setSchemaDiag] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState<null | "backend" | "browser" | "steam">(null);
  const [enrichmentCandidateLimit, setEnrichmentCandidateLimit] = useState("200");
  const [enrichmentProcessLimit, setEnrichmentProcessLimit] = useState("5");
  const [providerWorkerEnabled, setProviderWorkerEnabled] = useState(false);
  const [providerWorkerIntervalMinutes, setProviderWorkerIntervalMinutes] = useState("30");
  const [providerWorkerScanLimit, setProviderWorkerScanLimit] = useState("200");
  const [providerWorkerJobsPerRun, setProviderWorkerJobsPerRun] = useState("5");
  const [enrichmentResult, setEnrichmentResult] = useState<string | null>(null);
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
      setOpenDotaPerSecondCap(String(query.data.openDotaPerSecondCap));
      setOpenDotaPerMinuteCap(String(query.data.openDotaPerMinuteCap));
      setOpenDotaPerHourCap(String(query.data.openDotaPerHourCap));
      setOpenDotaDailyRequestCap(String(query.data.openDotaDailyRequestCap));
      setSteamPerSecondCap(String(query.data.steamPerSecondCap));
      setSteamPerMinuteCap(String(query.data.steamPerMinuteCap));
      setSteamPerHourCap(String(query.data.steamPerHourCap));
      setSteamDailyRequestCap(String(query.data.steamDailyRequestCap));
      setProviderEnrichmentDailyRequestCap(String(query.data.providerEnrichmentDailyRequestCap));
      setProviderEnrichmentMaxAttempts(String(query.data.providerEnrichmentMaxAttempts));
      setProviderWorkerEnabled(query.data.providerEnrichmentWorkerEnabled);
      setProviderWorkerIntervalMinutes(String(query.data.providerEnrichmentWorkerIntervalMinutes));
      setProviderWorkerScanLimit(String(query.data.providerEnrichmentWorkerScanLimit));
      setProviderWorkerJobsPerRun(String(query.data.providerEnrichmentWorkerJobsPerRun));
      setStratzTestPlayerId(
        String(localPrimaryPlayerId ?? query.data.primaryPlayerId ?? localAutoRefreshPlayerIds[0] ?? 148440404)
      );
    }
  }, [query.data]);

  const adminProtectionEnabled = query.data?.adminPasswordConfigured ?? false;
  const adminUnlocked = query.data?.adminUnlocked ?? false;
  const communityQuery = useCommunity(adminUnlocked);
  const providerEnrichment = useProviderEnrichment(adminUnlocked);
  const enqueueProviderEnrichment = useEnqueueProviderEnrichment();
  const processProviderEnrichment = useProcessProviderEnrichment();
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
            const parsedOpenDotaPerSecondCap = Math.min(1000, Math.max(1, Number(openDotaPerSecondCap.trim()) || 5));
            const parsedOpenDotaPerMinuteCap = Math.min(10000, Math.max(1, Number(openDotaPerMinuteCap.trim()) || 60));
            const parsedOpenDotaPerHourCap = Math.min(100000, Math.max(1, Number(openDotaPerHourCap.trim()) || 1000));
            const parsedOpenDotaDailyRequestCap = Math.min(100000, Math.max(1, Number(openDotaDailyRequestCap.trim()) || 5000));
            const parsedSteamPerSecondCap = Math.min(1000, Math.max(1, Number(steamPerSecondCap.trim()) || 2));
            const parsedSteamPerMinuteCap = Math.min(10000, Math.max(1, Number(steamPerMinuteCap.trim()) || 60));
            const parsedSteamPerHourCap = Math.min(100000, Math.max(1, Number(steamPerHourCap.trim()) || 1000));
            const parsedSteamDailyRequestCap = Math.min(100000, Math.max(1, Number(steamDailyRequestCap.trim()) || 5000));
            const parsedProviderEnrichmentDailyRequestCap = Math.min(
              100000,
              Math.max(1, Number(providerEnrichmentDailyRequestCap.trim()) || 1000)
            );
            const parsedProviderEnrichmentMaxAttempts = Math.min(20, Math.max(1, Number(providerEnrichmentMaxAttempts.trim()) || 3));
            const parsedProviderWorkerIntervalMinutes = Math.min(
              1440,
              Math.max(1, Number(providerWorkerIntervalMinutes.trim()) || 30)
            );
            const parsedProviderWorkerScanLimit = Math.min(1000, Math.max(1, Number(providerWorkerScanLimit.trim()) || 200));
            const parsedProviderWorkerJobsPerRun = Math.min(25, Math.max(1, Number(providerWorkerJobsPerRun.trim()) || 5));
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
              openDotaPerSecondCap: parsedOpenDotaPerSecondCap,
              openDotaPerMinuteCap: parsedOpenDotaPerMinuteCap,
              openDotaPerHourCap: parsedOpenDotaPerHourCap,
              openDotaDailyRequestCap: parsedOpenDotaDailyRequestCap,
              steamPerSecondCap: parsedSteamPerSecondCap,
              steamPerMinuteCap: parsedSteamPerMinuteCap,
              steamPerHourCap: parsedSteamPerHourCap,
              steamDailyRequestCap: parsedSteamDailyRequestCap,
              providerEnrichmentDailyRequestCap: parsedProviderEnrichmentDailyRequestCap,
              providerEnrichmentMaxAttempts: parsedProviderEnrichmentMaxAttempts,
              providerEnrichmentWorkerEnabled: providerWorkerEnabled,
              providerEnrichmentWorkerIntervalMinutes: parsedProviderWorkerIntervalMinutes,
              providerEnrichmentWorkerScanLimit: parsedProviderWorkerScanLimit,
              providerEnrichmentWorkerJobsPerRun: parsedProviderWorkerJobsPerRun,
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
                <div className="two-column">
                  <label>
                    Per second cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={1000} step={1} value={openDotaPerSecondCap} onChange={(event) => setOpenDotaPerSecondCap(event.target.value)} />
                  </label>
                  <label>
                    Per minute cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={10000} step={1} value={openDotaPerMinuteCap} onChange={(event) => setOpenDotaPerMinuteCap(event.target.value)} />
                  </label>
                  <label>
                    Per hour cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={100000} step={1} value={openDotaPerHourCap} onChange={(event) => setOpenDotaPerHourCap(event.target.value)} />
                  </label>
                  <label>
                    Per day cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={100000} step={1} value={openDotaDailyRequestCap} onChange={(event) => setOpenDotaDailyRequestCap(event.target.value)} />
                  </label>
                </div>
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
                <div className="two-column">
                  <label>
                    Per second cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={1000} step={1} value={steamPerSecondCap} onChange={(event) => setSteamPerSecondCap(event.target.value)} />
                  </label>
                  <label>
                    Per minute cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={10000} step={1} value={steamPerMinuteCap} onChange={(event) => setSteamPerMinuteCap(event.target.value)} />
                  </label>
                  <label>
                    Per hour cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={100000} step={1} value={steamPerHourCap} onChange={(event) => setSteamPerHourCap(event.target.value)} />
                  </label>
                  <label>
                    Per day cap
                    <input disabled={!canManagePersistentSettings} type="number" min={1} max={100000} step={1} value={steamDailyRequestCap} onChange={(event) => setSteamDailyRequestCap(event.target.value)} />
                  </label>
                </div>
                <p className="muted-inline">Used for Valve league match listing and Steam-backed Dota endpoints.</p>
              </Card>
              <Card title="Provider enrichment queue">
                <div className="stack compact">
                  <p className="muted-inline">
                    Queue basic matches for STRATZ telemetry enrichment and, when useful, OpenDota parse requests. The worker is conservative and
                    processes small batches on a schedule you control.
                  </p>
                  <div className="two-column">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        disabled={!canManagePersistentSettings}
                        checked={providerWorkerEnabled}
                        onChange={(event) => setProviderWorkerEnabled(event.target.checked)}
                      />
                      <span>Run enrichment worker automatically</span>
                    </label>
                    <label>
                      Wake every minutes
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        step={1}
                        disabled={!canManagePersistentSettings}
                        value={providerWorkerIntervalMinutes}
                        onChange={(event) => setProviderWorkerIntervalMinutes(event.target.value)}
                      />
                    </label>
                    <label>
                      Worker matches to scan
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        step={1}
                        disabled={!canManagePersistentSettings}
                        value={providerWorkerScanLimit}
                        onChange={(event) => setProviderWorkerScanLimit(event.target.value)}
                      />
                    </label>
                    <label>
                      Worker jobs per run
                      <input
                        type="number"
                        min={1}
                        max={25}
                        step={1}
                        disabled={!canManagePersistentSettings}
                        value={providerWorkerJobsPerRun}
                        onChange={(event) => setProviderWorkerJobsPerRun(event.target.value)}
                      />
                    </label>
                    <label>
                      Enrichment daily budget
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        step={1}
                        disabled={!canManagePersistentSettings}
                        value={providerEnrichmentDailyRequestCap}
                        onChange={(event) => setProviderEnrichmentDailyRequestCap(event.target.value)}
                      />
                    </label>
                    <label>
                      Max attempts per provider job
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        disabled={!canManagePersistentSettings}
                        value={providerEnrichmentMaxAttempts}
                        onChange={(event) => setProviderEnrichmentMaxAttempts(event.target.value)}
                      />
                    </label>
                  </div>
                  {providerEnrichment.isLoading ? <LoadingState label="Loading provider queue..." /> : null}
                  {providerEnrichment.error ? <ErrorState error={providerEnrichment.error as Error} /> : null}
                  {providerEnrichment.data ? (
                    <>
                      <div className="metric-grid compact">
                        <div className="metric-card">
                          <span>Worker</span>
                          <strong>
                            {providerEnrichment.data.worker.running
                              ? "Running"
                              : providerEnrichment.data.worker.enabled
                                ? "Enabled"
                                : "Off"}
                          </strong>
                        </div>
                        <div className="metric-card">
                          <span>Due now</span>
                          <strong>{providerEnrichment.data.dueCount}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Next attempt</span>
                          <strong>
                            {providerEnrichment.data.nextAttemptAt
                              ? new Date(providerEnrichment.data.nextAttemptAt).toLocaleString()
                              : "None"}
                          </strong>
                        </div>
                        <div className="metric-card">
                          <span>Last worker run</span>
                          <strong>
                            {providerEnrichment.data.worker.lastFinishedAt
                              ? new Date(providerEnrichment.data.worker.lastFinishedAt).toLocaleString()
                              : "Never"}
                          </strong>
                        </div>
                        <div className="metric-card">
                          <span>Next worker run</span>
                          <strong>
                            {providerEnrichment.data.worker.nextRunAt
                              ? new Date(providerEnrichment.data.worker.nextRunAt).toLocaleString()
                              : "None"}
                          </strong>
                        </div>
                        <div className="metric-card">
                          <span>Last processed</span>
                          <strong>{providerEnrichment.data.worker.lastProcessedCount}</strong>
                        </div>
                      </div>
                      {providerEnrichment.data.worker.lastQueued ? (
                        <p className="muted-inline">
                          Last worker scan: {providerEnrichment.data.worker.lastQueued.scannedMatches} matches,{" "}
                          {providerEnrichment.data.worker.lastQueued.stratzQueued} STRATZ jobs,{" "}
                          {providerEnrichment.data.worker.lastQueued.openDotaParseQueued} OpenDota parse jobs.
                        </p>
                      ) : null}
                      {providerEnrichment.data.worker.lastError ? (
                        <p className="form-error">{providerEnrichment.data.worker.lastError}</p>
                      ) : null}
                      <div className="provider-queue-counts">
                        {providerEnrichment.data.counts.length ? (
                          providerEnrichment.data.counts.map((entry) => (
                            <span key={`${entry.provider}-${entry.status}`} className="queue-count-pill">
                              {entry.provider} · {entry.status}: <strong>{entry.count}</strong>
                            </span>
                          ))
                        ) : (
                          <span className="muted-inline">No provider queue entries yet.</span>
                        )}
                      </div>
                      <div className="provider-enriched-list">
                        <h3>Provider request usage</h3>
                        <div className="responsive-table compact">
                          <table>
                            <thead>
                              <tr>
                                <th>Provider</th>
                                <th>Second</th>
                                <th>Minute</th>
                                <th>Hour</th>
                                <th>Day</th>
                              </tr>
                            </thead>
                            <tbody>
                              {providerEnrichment.data.providerUsage.map((entry) => (
                                <tr key={entry.provider}>
                                  <td>{entry.provider}</td>
                                  <td>{entry.usage.second} / {entry.limits.perSecond}</td>
                                  <td>{entry.usage.minute} / {entry.limits.perMinute}</td>
                                  <td>{entry.usage.hour} / {entry.limits.perHour}</td>
                                  <td>{entry.usage.day} / {entry.limits.perDay}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="provider-enriched-list">
                        <h3>Recently enriched matches</h3>
                        {providerEnrichment.data.enrichedMatches.length ? (
                          <div className="responsive-table compact">
                            <table>
                              <thead>
                                <tr>
                                  <th>Match</th>
                                  <th>Provider</th>
                                  <th>Enriched</th>
                                  <th>Started</th>
                                </tr>
                              </thead>
                              <tbody>
                                {providerEnrichment.data.enrichedMatches.map((match) => (
                                  <tr key={`${match.provider}-${match.matchId}`}>
                                    <td>
                                      <a href={`/matches/${match.matchId}`}>{match.matchId}</a>
                                    </td>
                                    <td>{match.provider}</td>
                                    <td>{match.enrichedAt ? new Date(match.enrichedAt).toLocaleString() : "Unknown"}</td>
                                    <td>{match.startTime ? new Date(match.startTime).toLocaleString() : "Unknown"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <span className="muted-inline">No fully enriched matches yet.</span>
                        )}
                      </div>
                      <div className="provider-enriched-list">
                        <h3>Recent provider attempts</h3>
                        {providerEnrichment.data.recentAttempts.length ? (
                          <div className="responsive-table compact">
                            <table>
                              <thead>
                                <tr>
                                  <th>Match</th>
                                  <th>Provider</th>
                                  <th>Status</th>
                                  <th>Parsed</th>
                                  <th>Attempts</th>
                                  <th>Attempted</th>
                                  <th>Next</th>
                                  <th>Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {providerEnrichment.data.recentAttempts.map((attempt) => (
                                  <tr key={`${attempt.provider}-${attempt.matchId}`}>
                                    <td>
                                      <a href={`/matches/${attempt.matchId}`}>{attempt.matchId}</a>
                                    </td>
                                    <td>{attempt.provider}</td>
                                    <td>{attempt.status}</td>
                                    <td>
                                      {attempt.parsedData.label}
                                      <span className="muted-inline">
                                        {" "}
                                        ({attempt.parsedData.timelines ? "timelines" : "no timelines"},{" "}
                                        {attempt.parsedData.itemTimings ? "items" : "no items"},{" "}
                                        {attempt.parsedData.vision ? "vision" : "no vision"})
                                      </span>
                                    </td>
                                    <td>{attempt.attempts}</td>
                                    <td>{attempt.attemptedAt ? new Date(attempt.attemptedAt).toLocaleString() : "Unknown"}</td>
                                    <td>{attempt.nextAttemptAt ? new Date(attempt.nextAttemptAt).toLocaleString() : "None"}</td>
                                    <td>{attempt.lastError ?? "No provider error recorded."}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <span className="muted-inline">No provider attempts have run yet.</span>
                        )}
                      </div>
                    </>
                  ) : null}
                  <div className="two-column">
                    <label>
                      Matches to scan
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        step={1}
                        disabled={!canManagePersistentSettings || enqueueProviderEnrichment.isPending}
                        value={enrichmentCandidateLimit}
                        onChange={(event) => setEnrichmentCandidateLimit(event.target.value)}
                      />
                    </label>
                    <label>
                      Jobs to process
                      <input
                        type="number"
                        min={1}
                        max={25}
                        step={1}
                        disabled={!canManagePersistentSettings || processProviderEnrichment.isPending}
                        value={enrichmentProcessLimit}
                        onChange={(event) => setEnrichmentProcessLimit(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="action-group">
                    <button
                      type="button"
                      disabled={!canManagePersistentSettings || enqueueProviderEnrichment.isPending}
                      onClick={() => {
                        const limit = Math.min(1000, Math.max(1, Number(enrichmentCandidateLimit) || 200));
                        setEnrichmentResult(null);
                        enqueueProviderEnrichment.mutate(limit, {
                          onSuccess: (result: ProviderEnrichmentEnqueueResponse) => {
                            setEnrichmentResult(
                              `Scanned ${result.scannedMatches} matches. Queued ${result.stratzQueued} STRATZ and ${result.openDotaParseQueued} OpenDota parse jobs.`
                            );
                          },
                          onError: (error) => setEnrichmentResult(error instanceof Error ? error.message : "Failed to enqueue provider jobs.")
                        });
                      }}
                    >
                      {enqueueProviderEnrichment.isPending ? "Enqueueing..." : "Enqueue missing telemetry"}
                    </button>
                    <button
                      type="button"
                      disabled={!canManagePersistentSettings || processProviderEnrichment.isPending}
                      onClick={() => {
                        const limit = Math.min(25, Math.max(1, Number(enrichmentProcessLimit) || 5));
                        setEnrichmentResult(null);
                        processProviderEnrichment.mutate(limit, {
                          onSuccess: (result: ProviderEnrichmentProcessResponse) => {
                            setEnrichmentResult(`Processed ${result.processed.length} jobs.`);
                          },
                          onError: (error) => setEnrichmentResult(error instanceof Error ? error.message : "Failed to process provider jobs.")
                        });
                      }}
                    >
                      {processProviderEnrichment.isPending ? "Processing..." : "Process queue now"}
                    </button>
                  </div>
                  {enrichmentResult ? <p className="form-success">{enrichmentResult}</p> : null}
                </div>
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
