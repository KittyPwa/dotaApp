export function formatDate(value: number | null | undefined) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds && seconds !== 0) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const remainder = mins % 60;
  return hrs > 0 ? `${hrs}h ${remainder}m` : `${mins}m`;
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unknown";
  return new Intl.NumberFormat().format(value);
}
