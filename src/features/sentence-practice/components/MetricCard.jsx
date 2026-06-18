export default function MetricCard({ label, value, tooltip, tone = "neutral" }) {
  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--tooltip-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--tooltip-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      className={`metric metric-${tone}`}
      tabIndex={0}
      role="note"
      aria-label={`${label}: ${value}. ${tooltip}`}
      onMouseMove={handleMouseMove}
    >
      <div className="tooltip">{tooltip}</div>
      <div className="metric-top">
        <div className="metric-label">{label}</div>
        <span className="metric-spark" aria-hidden="true" />
      </div>
      <div className="metric-value">{value}</div>
    </div>
  );
}
