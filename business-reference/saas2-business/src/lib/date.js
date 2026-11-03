// Business days are calendar days in the shop's timezone (default Asia/Beirut), never UTC days.

export const SHOP_TZ = 'Asia/Beirut';

/** Today's date in the shop's timezone as "YYYY-MM-DD". */
export function todayInShop(tz = SHOP_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Add days to a "YYYY-MM-DD" string (calendar math, no timezone drift). */
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** "Mon 2 Nov" */
export function formatDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "14:32" in the shop's timezone. */
export function formatTime(iso, tz = SHOP_TZ) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}

/** Current month in the shop's timezone, "YYYY-MM". */
export function thisMonthInShop(tz = SHOP_TZ) {
  return todayInShop(tz).slice(0, 7);
}

/** Add months to "YYYY-MM". */
export function addMonths(ym, months) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  return dt.toISOString().slice(0, 7);
}

/** "November 2026" */
export function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Number of days in "YYYY-MM". */
export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Monday-based weekday index (0 = Mon) of the 1st of "YYYY-MM". */
export function firstWeekday(ym) {
  const [y, m] = ym.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing "YYYY-MM-DD" (weeks run Monday to Sunday). */
export function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7;
  return addDays(ymd, -back);
}

/** "2–8 Nov" or "28 Oct – 3 Nov" */
export function formatWeekRange(monday) {
  const end = addDays(monday, 6);
  const fmt = (ymd, withMonth) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', withMonth ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  };
  const sameMonth = monday.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${fmt(monday, false)}–${fmt(end, true)}` : `${fmt(monday, true)} – ${fmt(end, true)}`;
}

/** "Jan" for "YYYY-MM" */
export function formatMonthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
