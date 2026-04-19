import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/Card";
import { Page } from "../components/Page";

export function HomePage() {
  const navigate = useNavigate();
  const [playerId, setPlayerId] = useState("");
  const [matchId, setMatchId] = useState("");

  const submitPlayer = (event: FormEvent) => {
    event.preventDefault();
    if (!playerId.trim()) return;
    navigate(`/players/${playerId.trim()}`);
  };

  const submitMatch = (event: FormEvent) => {
    event.preventDefault();
    if (!matchId.trim()) return;
    navigate(`/matches/${matchId.trim()}`);
  };

  return (
    <Page
      title="Home"
      subtitle="Fetch public Dota 2 data on demand, cache it locally, and inspect analytics from your own dataset."
    >
      <div className="home-grid">
        <Card title="Player lookup">
          <form className="stack" onSubmit={submitPlayer}>
            <label>
              Player ID
              <input value={playerId} onChange={(event) => setPlayerId(event.target.value)} placeholder="e.g. 86745912" />
            </label>
            <button type="submit">Open player</button>
          </form>
        </Card>

        <Card title="Match lookup">
          <form className="stack" onSubmit={submitMatch}>
            <label>
              Match ID
              <input value={matchId} onChange={(event) => setMatchId(event.target.value)} placeholder="e.g. 7654321987" />
            </label>
            <button type="submit">Open match</button>
          </form>
        </Card>

        <Card title="Explore local analytics">
          <div className="stack">
            <p>Browse hero-level stats computed only from matches you have fetched and stored locally.</p>
            <button type="button" onClick={() => navigate("/heroes")}>
              Hero stats
            </button>
            <button type="button" onClick={() => navigate("/dashboard")}>
              Dashboard
            </button>
            <button type="button" onClick={() => navigate("/settings")}>
              Settings
            </button>
          </div>
        </Card>
      </div>
    </Page>
  );
}
