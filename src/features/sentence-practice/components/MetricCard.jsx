export default function MetricCard({ label, value, tooltip, tone = "neutral" }) {
  return (
    <div className={`stat stat-${tone}`} role="note" aria-label={`${label}: ${value}. ${tooltip}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-caption">{tooltip}</span>
    </div>
  );
}
