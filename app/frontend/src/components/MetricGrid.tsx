export function MetricGrid({
  items
}: {
  items: Array<{ label: string; value: string | number; hint?: string }>;
}) {
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <article key={item.label} className="metric">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.hint ? <small>{item.hint}</small> : null}
        </article>
      ))}
    </div>
  );
}
