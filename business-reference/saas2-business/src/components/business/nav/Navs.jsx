import PeriodNav from './PeriodNav.jsx';
import { addDays, addMonths, formatDay, formatMonth, formatWeekRange, mondayOf, thisMonthInShop, todayInShop } from '../../../lib/date.js';

export function DayNav({ filters, onChange }) {
  const today = todayInShop();
  const isToday = filters.date === today;
  return (
    <PeriodNav
      unit="day"
      label={isToday ? 'Today' : formatDay(filters.date)}
      sub={isToday ? formatDay(filters.date) : null}
      onPrev={() => onChange({ date: addDays(filters.date, -1) })}
      onNext={() => onChange({ date: addDays(filters.date, 1) })}
      nextDisabled={isToday}
      picker={{ type: 'date', value: filters.date, max: today, onPick: (v) => onChange({ date: v }) }}
    />
  );
}

export function WeekNav({ filters, onChange }) {
  const current = mondayOf(todayInShop());
  const isCurrent = filters.week === current;
  return (
    <PeriodNav
      unit="week"
      label={isCurrent ? 'This week' : formatWeekRange(filters.week)}
      sub={isCurrent ? formatWeekRange(filters.week) : null}
      onPrev={() => onChange({ week: addDays(filters.week, -7) })}
      onNext={() => onChange({ week: addDays(filters.week, 7) })}
      nextDisabled={isCurrent}
      picker={{ type: 'date', value: filters.week, max: todayInShop(), onPick: (v) => onChange({ week: mondayOf(v) }) }}
    />
  );
}

export function MonthNav({ filters, onChange }) {
  const current = thisMonthInShop();
  const isCurrent = filters.month === current;
  return (
    <PeriodNav
      unit="month"
      label={formatMonth(filters.month)}
      sub={isCurrent ? 'This month' : null}
      onPrev={() => onChange({ month: addMonths(filters.month, -1) })}
      onNext={() => onChange({ month: addMonths(filters.month, 1) })}
      nextDisabled={isCurrent}
      picker={{ type: 'month', value: filters.month, max: current, onPick: (v) => onChange({ month: v }) }}
    />
  );
}

export function YearNav({ filters, onChange }) {
  const current = todayInShop().slice(0, 4);
  const isCurrent = filters.year === current;
  const go = (k) => onChange({ year: String(Number(filters.year) + k) });
  return (
    <PeriodNav
      unit="year"
      label={filters.year}
      sub={isCurrent ? 'This year' : null}
      onPrev={() => go(-1)}
      onNext={() => go(1)}
      nextDisabled={isCurrent}
    />
  );
}
