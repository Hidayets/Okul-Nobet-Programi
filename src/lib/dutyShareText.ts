export interface DutyShareLine {
  when: string;
  place: string;
  time?: string;
  note?: string;
}

export function formatDutyWhatsAppText(teacherName: string, lines: DutyShareLine[]): string {
  if (lines.length === 0) return `${teacherName} için kayıtlı nöbet yok.`;
  const body = lines
    .map((line) => `• ${line.when}${line.time ? ` ${line.time}` : ''} — ${line.place}${line.note ? ` (${line.note})` : ''}`)
    .join('\n');
  return `${teacherName} nöbet listesi\n${body}`;
}
