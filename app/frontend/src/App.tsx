import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  getLocalLanguageOverride,
  getSessionColorblindModeOverride,
  getSessionDarkModeOverride,
  LOCAL_LANGUAGE_EVENT,
  SESSION_PREFERENCES_EVENT
} from "./api/client";
import { DashboardPage } from "./pages/DashboardPage";
import { DraftsPage } from "./pages/DraftsPage";
import { HeroDetailPage } from "./pages/HeroDetailPage";
import { HeroStatsPage } from "./pages/HeroStatsPage";
import { LeagueDetailPage } from "./pages/LeagueDetailPage";
import { LeagueTeamPage } from "./pages/LeagueTeamPage";
import { LeaguesPage } from "./pages/LeaguesPage";
import { HomePage } from "./pages/HomePage";
import { MatchPage } from "./pages/MatchPage";
import { PlayerComparePage } from "./pages/PlayerComparePage";
import { PlayerPage } from "./pages/PlayerPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useSettings } from "./hooks/useQueries";
import { I18nProvider, useTranslation } from "./lib/i18n";

export function App() {
  const [language, setLanguage] = useState(() => getLocalLanguageOverride());
  return (
    <I18nProvider language={language}>
      <AppContent onLanguageChange={setLanguage} />
    </I18nProvider>
  );
}

function AppContent({ onLanguageChange }: { onLanguageChange: (language: ReturnType<typeof getLocalLanguageOverride>) => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [sessionColorblindOverride, setSessionColorblindOverride] = useState<boolean | null>(() =>
    getSessionColorblindModeOverride()
  );
  const [sessionDarkModeOverride, setSessionDarkModeOverride] = useState<boolean | null>(() =>
    getSessionDarkModeOverride()
  );

  useEffect(() => {
    const syncLocalLanguage = () => {
      onLanguageChange(getLocalLanguageOverride());
    };
    window.addEventListener(LOCAL_LANGUAGE_EVENT, syncLocalLanguage);
    return () => {
      window.removeEventListener(LOCAL_LANGUAGE_EVENT, syncLocalLanguage);
    };
  }, [onLanguageChange]);

  useEffect(() => {
    const syncSessionPreferences = () => {
      setSessionColorblindOverride(getSessionColorblindModeOverride());
      setSessionDarkModeOverride(getSessionDarkModeOverride());
    };
    window.addEventListener(SESSION_PREFERENCES_EVENT, syncSessionPreferences);
    return () => {
      window.removeEventListener(SESSION_PREFERENCES_EVENT, syncSessionPreferences);
    };
  }, []);

  useEffect(() => {
    const enabled = sessionColorblindOverride ?? settings.data?.colorblindMode ?? false;
    document.documentElement.dataset.colorblind = enabled ? "true" : "false";
  }, [sessionColorblindOverride, settings.data?.colorblindMode]);

  useEffect(() => {
    const enabled = sessionDarkModeOverride ?? settings.data?.darkMode ?? false;
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, [sessionDarkModeOverride, settings.data?.darkMode]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>{t("app.name")}</h1>
        </div>
        <nav className="nav">
          <NavLink to="/">{t("nav.dashboard")}</NavLink>
          <NavLink to="/home">{t("nav.lookup")}</NavLink>
          <NavLink to="/compare">{t("nav.compare")}</NavLink>
          <NavLink to="/drafts">{t("nav.drafts")}</NavLink>
          <NavLink to="/heroes">{t("nav.heroes")}</NavLink>
          <NavLink to="/leagues">{t("nav.leagues")}</NavLink>
          {settings.data?.savedLeagues.map((league) => (
            <NavLink key={league.leagueId} to={`/leagues/${league.leagueId}`} className="nav-subitem">
              {league.name}
            </NavLink>
          ))}
          <NavLink to="/settings">{t("nav.settings")}</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/heroes" element={<HeroStatsPage />} />
          <Route path="/heroes/:heroId" element={<HeroDetailPage />} />
          <Route path="/leagues" element={<LeaguesPage />} />
          <Route path="/leagues/:leagueId" element={<LeagueDetailPage />} />
          <Route path="/leagues/:leagueId/teams/:teamId" element={<LeagueTeamPage />} />
          <Route path="/players/:playerId" element={<PlayerPage />} />
          <Route path="/compare" element={<PlayerComparePage />} />
          <Route path="/matches/:matchId" element={<MatchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
