export function formatDate(value: number | null | undefined) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds && seconds !== 0) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unknown";
  return new Intl.NumberFormat().format(value);
}
