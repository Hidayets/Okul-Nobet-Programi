import { ScheduleIssue } from '../lib/scheduleScan';

export default function ScheduleWarnings({ issues }: { issues: ScheduleIssue[] }) {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, 12);
  return (
    <div className="app-card print:hidden">
      <div className="app-card-header">
        <h3 className="font-bold text-[#1a4a8a] text-sm">Çizelge kontrolü</h3>
        <p className="text-xs text-blue-500 mt-0.5">Kırmızı kesin sorun, turuncu dengesizlik.</p>
      </div>
      <ul className="p-4 space-y-1.5 text-sm">
        {shown.map((issue) => (
          <li key={issue.text} className={issue.level === 'red' ? 'text-rose-800' : 'text-amber-800'}>
            {issue.text}
          </li>
        ))}
        {issues.length > shown.length && (
          <li className="text-slate-500">ve {issues.length - shown.length} kayıt daha</li>
        )}
      </ul>
    </div>
  );
}
