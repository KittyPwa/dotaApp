import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { HeroDetailPage } from "./pages/HeroDetailPage";
import { HeroStatsPage } from "./pages/HeroStatsPage";
import { HomePage } from "./pages/HomePage";
import { MatchPage } from "./pages/MatchPage";
import { PlayerComparePage } from "./pages/PlayerComparePage";
import { PlayerPage } from "./pages/PlayerPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
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
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <p className="sidebar-note">
          Public Dota 2 data cached locally in SQLite. The UI only talks to your localhost backend.
        </p>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/heroes" element={<HeroStatsPage />} />
          <Route path="/heroes/:heroId" element={<HeroDetailPage />} />
          <Route path="/players/:playerId" element={<PlayerPage />} />
          <Route path="/compare" element={<PlayerComparePage />} />
          <Route path="/matches/:matchId" element={<MatchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
