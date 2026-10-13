/** Üst menü sekmeleri — her sekme kendi rengi */
export const TAB_STYLES: Record<
  string,
  { activeText: string; activeBorder: string; activeBg: string; hover: string }
> = {
  licenses: {
    activeText: 'text-purple-700',
    activeBorder: 'border-purple-600',
    activeBg: 'bg-purple-50/90',
    hover: 'hover:text-purple-600 hover:border-purple-300',
  },
  teachers: {
    activeText: 'text-blue-700',
    activeBorder: 'border-blue-600',
    activeBg: 'bg-blue-50/90',
    hover: 'hover:text-blue-600 hover:border-blue-300',
  },
  schedules: {
    activeText: 'text-teal-700',
    activeBorder: 'border-teal-600',
    activeBg: 'bg-teal-50/90',
    hover: 'hover:text-teal-600 hover:border-teal-300',
  },
  locations: {
    activeText: 'text-orange-700',
    activeBorder: 'border-orange-600',
    activeBg: 'bg-orange-50/90',
    hover: 'hover:text-orange-600 hover:border-orange-300',
  },
  generator: {
    activeText: 'text-fuchsia-700',
    activeBorder: 'border-fuchsia-600',
    activeBg: 'bg-fuchsia-50/90',
    hover: 'hover:text-fuchsia-600 hover:border-fuchsia-300',
  },
  schedule: {
    activeText: 'text-indigo-700',
    activeBorder: 'border-indigo-600',
    activeBg: 'bg-indigo-50/90',
    hover: 'hover:text-indigo-600 hover:border-indigo-300',
  },
  daily: {
    activeText: 'text-cyan-700',
    activeBorder: 'border-cyan-600',
    activeBg: 'bg-cyan-50/90',
    hover: 'hover:text-cyan-600 hover:border-cyan-300',
  },
  absenceTracking: {
    activeText: 'text-amber-700',
    activeBorder: 'border-amber-600',
    activeBg: 'bg-amber-50/90',
    hover: 'hover:text-amber-600 hover:border-amber-300',
  },
  settings: {
    activeText: 'text-slate-700',
    activeBorder: 'border-slate-600',
    activeBg: 'bg-slate-100/90',
    hover: 'hover:text-slate-600 hover:border-slate-400',
  },
};

export const DEFAULT_TAB_STYLE = TAB_STYLES.schedule;

/** Nöbet çizelgesi sütun başlıkları */
export const SCHEDULE_COLUMN_HEADERS = [
  { bg: 'bg-indigo-100', text: 'text-indigo-900', print: 'print:bg-transparent' },
  { bg: 'bg-violet-100', text: 'text-violet-900', print: 'print:bg-transparent' },
  { bg: 'bg-sky-100', text: 'text-sky-900', print: 'print:bg-transparent' },
  { bg: 'bg-emerald-100', text: 'text-emerald-900', print: 'print:bg-transparent' },
  { bg: 'bg-amber-100', text: 'text-amber-900', print: 'print:bg-transparent' },
  { bg: 'bg-rose-100', text: 'text-rose-900', print: 'print:bg-transparent' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-900', print: 'print:bg-transparent' },
  { bg: 'bg-cyan-100', text: 'text-cyan-900', print: 'print:bg-transparent' },
] as const;

export function getScheduleColumnHeader(index: number) {
  return SCHEDULE_COLUMN_HEADERS[index % SCHEDULE_COLUMN_HEADERS.length];
}

/** Hafta ayırıcı satırları */
export const WEEK_HEADER_STYLES = [
  'from-indigo-200/80 to-indigo-50 text-indigo-900 border-indigo-400',
  'from-violet-200/80 to-violet-50 text-violet-900 border-violet-400',
  'from-sky-200/80 to-sky-50 text-sky-900 border-sky-400',
  'from-emerald-200/80 to-emerald-50 text-emerald-900 border-emerald-400',
  'from-amber-200/80 to-amber-50 text-amber-900 border-amber-400',
  'from-rose-200/80 to-rose-50 text-rose-900 border-rose-400',
] as const;

export function getWeekHeaderStyle(weekNum: number) {
  return WEEK_HEADER_STYLES[weekNum % WEEK_HEADER_STYLES.length];
}
