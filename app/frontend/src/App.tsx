import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { HeroDetailPage } from "./pages/HeroDetailPage";
import { HeroStatsPage } from "./pages/HeroStatsPage";
import { LeagueDetailPage } from "./pages/LeagueDetailPage";
import { LeaguesPage } from "./pages/LeaguesPage";
import { HomePage } from "./pages/HomePage";
import { MatchPage } from "./pages/MatchPage";
import { PlayerComparePage } from "./pages/PlayerComparePage";
import { PlayerPage } from "./pages/PlayerPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useSettings } from "./hooks/useQueries";

export function App() {
  const settings = useSettings();

  useEffect(() => {
    const enabled = settings.data?.colorblindMode ?? false;
    document.documentElement.dataset.colorblind = enabled ? "true" : "false";
  }, [settings.data?.colorblindMode]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Local-first Dota 2</p>
          <h1>Dota Analytics</h1>
        </div>
        <nav className="nav">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/home">Home</NavLink>
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
          <Route path="/players/:playerId" element={<PlayerPage />} />
          <Route path="/compare" element={<PlayerComparePage />} />
          <Route path="/matches/:matchId" element={<MatchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
