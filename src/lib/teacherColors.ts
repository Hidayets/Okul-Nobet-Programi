const TEACHER_CHIP_CLASSES = [
  'teacher-chip-blue',
  'teacher-chip-green',
  'teacher-chip-amber',
  'teacher-chip-pink',
  'teacher-chip-purple',
  'teacher-chip-cyan',
  'teacher-chip-orange',
  'teacher-chip-teal',
] as const;

const TEACHER_BAR_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ec4899',
  '#8b5cf6', '#06b6d4', '#f97316', '#14b8a6',
];

export function buildTeacherColorMap(teacherIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  teacherIds.forEach((id, i) => {
    map[id] = TEACHER_CHIP_CLASSES[i % TEACHER_CHIP_CLASSES.length];
  });
  return map;
}

export function getTeacherBarColor(teacherId: string, colorMap: Record<string, string>): string {
  const cls = colorMap[teacherId] || 'teacher-chip-blue';
  const idx = TEACHER_CHIP_CLASSES.indexOf(cls as typeof TEACHER_CHIP_CLASSES[number]);
  return TEACHER_BAR_COLORS[idx >= 0 ? idx : 0];
}

export function getTeacherSubject(teacher: { schedule?: Record<number, Record<number, string>> }): string {
  if (!teacher.schedule) return 'Öğretmen';
  const classes = new Set<string>();
  for (const day of Object.values(teacher.schedule)) {
    for (const cls of Object.values(day)) {
      if (cls && String(cls).trim()) classes.add(String(cls).trim());
    }
  }
  if (classes.size === 0) return 'Öğretmen';
  const first = Array.from(classes)[0];
  return first.length > 20 ? `${first.slice(0, 18)}…` : first;
}
