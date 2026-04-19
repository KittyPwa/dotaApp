export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="state">{label}</div>;
}

export function ErrorState({ error }: { error: Error }) {
  return <div className="state error">{error.message}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="state empty">{label}</div>;
}
