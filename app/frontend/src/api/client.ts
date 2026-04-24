const apiBase =
  import.meta.env.PROD ? "" : import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3344";

const ADMIN_PASSWORD_STORAGE_KEY = "dota-admin-password";
const SESSION_COLORBLIND_KEY = "dota-session-colorblind-mode";
const SESSION_DARK_MODE_KEY = "dota-session-dark-mode";
const SESSION_LIMIT_PATCHES_KEY = "dota-session-limit-patches";
const SESSION_PATCH_COUNT_KEY = "dota-session-patch-count";
const LOCAL_PRIMARY_PLAYER_ID_KEY = "dota-local-primary-player-id";
const LOCAL_FAVORITE_PLAYER_IDS_KEY = "dota-local-favorite-player-ids";
const LOCAL_AUTO_REFRESH_PLAYER_IDS_KEY = "dota-local-auto-refresh-player-ids";
export const SESSION_PREFERENCES_EVENT = "dota-session-preferences-changed";
export const LOCAL_PLAYER_PREFERENCES_EVENT = "dota-local-player-preferences-changed";

function notifySessionPreferencesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_PREFERENCES_EVENT));
}

function notifyLocalPlayerPreferencesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_PLAYER_PREFERENCES_EVENT));
}

export function getStoredAdminPassword() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
}

export function storeAdminPassword(password: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
}

export function clearStoredAdminPassword() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
}

function parseStoredPlayerIds(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry, index, list) => Number.isInteger(entry) && entry > 0 && list.indexOf(entry) === index);
}

export function getLocalPrimaryPlayerIdOverride() {
  if (typeof window === "undefined") return null;
  const rawValue = window.localStorage.getItem(LOCAL_PRIMARY_PLAYER_ID_KEY);
  const parsedValue = rawValue ? Number(rawValue) : null;
  return parsedValue !== null && Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

export function setLocalPrimaryPlayerIdOverride(value: number | null) {
  if (typeof window === "undefined") return;
  if (value === null) {
    window.localStorage.removeItem(LOCAL_PRIMARY_PLAYER_ID_KEY);
  } else {
    window.localStorage.setItem(LOCAL_PRIMARY_PLAYER_ID_KEY, String(value));
  }
  notifyLocalPlayerPreferencesChanged();
}

export function getLocalFavoritePlayerIdsOverride() {
  if (typeof window === "undefined") return [] as number[];
  return parseStoredPlayerIds(window.localStorage.getItem(LOCAL_FAVORITE_PLAYER_IDS_KEY));
}

export function setLocalFavoritePlayerIdsOverride(value: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    LOCAL_FAVORITE_PLAYER_IDS_KEY,
    value.filter((entry, index, list) => Number.isInteger(entry) && entry > 0 && list.indexOf(entry) === index).join(",")
  );
  notifyLocalPlayerPreferencesChanged();
}

export function getLocalAutoRefreshPlayerIdsOverride() {
  if (typeof window === "undefined") return [] as number[];
  return parseStoredPlayerIds(window.localStorage.getItem(LOCAL_AUTO_REFRESH_PLAYER_IDS_KEY));
}

export function setLocalAutoRefreshPlayerIdsOverride(value: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    LOCAL_AUTO_REFRESH_PLAYER_IDS_KEY,
    value.filter((entry, index, list) => Number.isInteger(entry) && entry > 0 && list.indexOf(entry) === index).join(",")
  );
  notifyLocalPlayerPreferencesChanged();
}

export function getSessionColorblindModeOverride() {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(SESSION_COLORBLIND_KEY);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function setSessionColorblindModeOverride(value: boolean | null) {
  if (typeof window === "undefined") return;
  if (value === null) {
    window.sessionStorage.removeItem(SESSION_COLORBLIND_KEY);
    notifySessionPreferencesChanged();
    return;
  }
  window.sessionStorage.setItem(SESSION_COLORBLIND_KEY, value ? "true" : "false");
  notifySessionPreferencesChanged();
}

export function getSessionDarkModeOverride() {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(SESSION_DARK_MODE_KEY);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function setSessionDarkModeOverride(value: boolean | null) {
  if (typeof window === "undefined") return;
  if (value === null) {
    window.sessionStorage.removeItem(SESSION_DARK_MODE_KEY);
    notifySessionPreferencesChanged();
    return;
  }
  window.sessionStorage.setItem(SESSION_DARK_MODE_KEY, value ? "true" : "false");
  notifySessionPreferencesChanged();
}

export function getSessionPatchScopeOverride() {
  if (typeof window === "undefined") return { limitToRecentPatches: null as boolean | null, recentPatchCount: null as number | null };
  const limitValue = window.sessionStorage.getItem(SESSION_LIMIT_PATCHES_KEY);
  const patchCountValue = window.sessionStorage.getItem(SESSION_PATCH_COUNT_KEY);
  const limitToRecentPatches = limitValue === "true" ? true : limitValue === "false" ? false : null;
  const parsedPatchCount = patchCountValue === null ? null : Number(patchCountValue);
  return {
    limitToRecentPatches,
    recentPatchCount: Number.isFinite(parsedPatchCount) ? parsedPatchCount : null
  };
}

export function setSessionPatchScopeOverride(value: { limitToRecentPatches: boolean; recentPatchCount: number } | null) {
  if (typeof window === "undefined") return;
  if (value === null) {
    window.sessionStorage.removeItem(SESSION_LIMIT_PATCHES_KEY);
    window.sessionStorage.removeItem(SESSION_PATCH_COUNT_KEY);
    notifySessionPreferencesChanged();
    return;
  }
  window.sessionStorage.setItem(SESSION_LIMIT_PATCHES_KEY, value.limitToRecentPatches ? "true" : "false");
  window.sessionStorage.setItem(SESSION_PATCH_COUNT_KEY, String(Math.max(0, value.recentPatchCount)));
  notifySessionPreferencesChanged();
}

function buildHeaders(headers?: HeadersInit) {
  const built = new Headers(headers);
  const adminPassword = getStoredAdminPassword();
  if (adminPassword) {
    built.set("x-admin-password", adminPassword);
  }
  const primaryPlayerId = getLocalPrimaryPlayerIdOverride();
  if (primaryPlayerId !== null) {
    built.set("x-user-primary-player-id", String(primaryPlayerId));
  }
  const favoritePlayerIds = getLocalFavoritePlayerIdsOverride();
  if (favoritePlayerIds.length > 0) {
    built.set("x-user-favorite-player-ids", favoritePlayerIds.join(","));
  }
  const autoRefreshPlayerIds = getLocalAutoRefreshPlayerIdsOverride();
  if (autoRefreshPlayerIds.length > 0) {
    built.set("x-user-auto-refresh-player-ids", autoRefreshPlayerIds.join(","));
  }
  const colorblindOverride = getSessionColorblindModeOverride();
  if (colorblindOverride !== null) {
    built.set("x-session-colorblind-mode", colorblindOverride ? "true" : "false");
  }
  const patchScopeOverride = getSessionPatchScopeOverride();
  if (patchScopeOverride.limitToRecentPatches !== null) {
    built.set("x-session-limit-patches", patchScopeOverride.limitToRecentPatches ? "true" : "false");
  }
  if (patchScopeOverride.recentPatchCount !== null) {
    built.set("x-session-patch-count", String(patchScopeOverride.recentPatchCount));
  }
  return built;
}

export async function apiGet<T>(path: string, init?: { headers?: HeadersInit }): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: buildHeaders(init?.headers)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, init?: { headers?: HeadersInit }): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json", ...(init?.headers ?? {}) }),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
