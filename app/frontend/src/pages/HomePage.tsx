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
    <Page title="Lookup">
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
      </div>
    </Page>
  );
}
