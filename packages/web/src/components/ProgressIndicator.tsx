export function ProgressIndicator({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <span className="course-progress">
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${percent}%` }} />
      </span>
      {completed}/{total}
    </span>
  );
}
