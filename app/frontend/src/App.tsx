import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  getSessionColorblindModeOverride,
  getSessionDarkModeOverride,
  SESSION_PREFERENCES_EVENT
} from "./api/client";
import { DashboardPage } from "./pages/DashboardPage";
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

export function App() {
  const settings = useSettings();
  const [sessionColorblindOverride, setSessionColorblindOverride] = useState<boolean | null>(() =>
    getSessionColorblindModeOverride()
  );
  const [sessionDarkModeOverride, setSessionDarkModeOverride] = useState<boolean | null>(() =>
    getSessionDarkModeOverride()
  );

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
          <h1>Dota Analytics</h1>
        </div>
        <nav className="nav">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/home">Lookup</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/heroes">Heroes</NavLink>
          <NavLink to="/leagues">Leagues</NavLink>
          {settings.data?.savedLeagues.map((league) => (
            <NavLink key={league.leagueId} to={`/leagues/${league.leagueId}`} className="nav-subitem">
              {league.name}
            </NavLink>
          ))}
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
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
