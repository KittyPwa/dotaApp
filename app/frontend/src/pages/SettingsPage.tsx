import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Page } from "../components/Page";
import { ErrorState, LoadingState } from "../components/State";
import { useSaveSettings, useSettings } from "../hooks/useQueries";

export function SettingsPage() {
  const query = useSettings();
  const save = useSaveSettings();
  const [openDotaApiKey, setOpenDotaApiKey] = useState("");
  const [stratzApiKey, setStratzApiKey] = useState("");
  const [primaryPlayerId, setPrimaryPlayerId] = useState("");
  const [favoritePlayerIds, setFavoritePlayerIds] = useState("");

  useEffect(() => {
    if (query.data) {
      setOpenDotaApiKey(query.data.openDotaApiKey ?? "");
      setStratzApiKey(query.data.stratzApiKey ?? "");
      setPrimaryPlayerId(query.data.primaryPlayerId ? String(query.data.primaryPlayerId) : "");
      setFavoritePlayerIds(query.data.favoritePlayerIds.join(", "));
    }
  }, [query.data]);

  return (
    <Page
      title="Settings"
      subtitle="API keys and player preferences are stored locally in your SQLite database on this machine."
    >
      {query.isLoading ? <LoadingState label="Loading settings..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      <Card title="Local preferences">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const parsedPrimaryPlayerId = primaryPlayerId.trim() ? Number(primaryPlayerId.trim()) : null;
            const parsedFavoritePlayerIds = favoritePlayerIds
              .split(",")
              .map((entry) => Number(entry.trim()))
              .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index);

            save.mutate({
              openDotaApiKey: openDotaApiKey.trim() || null,
              stratzApiKey: stratzApiKey.trim() || null,
              primaryPlayerId:
                Number.isInteger(parsedPrimaryPlayerId) && (parsedPrimaryPlayerId ?? 0) > 0 ? parsedPrimaryPlayerId : null,
              favoritePlayerIds: parsedFavoritePlayerIds
            });
          }}
        >
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
          <label>
            OpenDota API key
            <input value={openDotaApiKey} onChange={(event) => setOpenDotaApiKey(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            STRATZ API key
            <input
              value={stratzApiKey}
              onChange={(event) => setStratzApiKey(event.target.value)}
              placeholder="Required for STRATZ queries"
            />
          </label>
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save settings"}
          </button>
          {save.isError ? <p className="form-error">{(save.error as Error).message}</p> : null}
          {save.isSuccess ? <p className="form-success">Settings saved locally.</p> : null}
        </form>
      </Card>
    </Page>
  );
}
