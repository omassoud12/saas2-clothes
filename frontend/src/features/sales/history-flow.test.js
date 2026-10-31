import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { dateInputValue, historyQuery, parseDateInput, saleBadges, saleTimeText, startOfWeek } from './history-flow.js'

// Wednesday 2026-10-14, 15:30 local time.
const now = new Date(2026, 9, 14, 15, 30)
const at = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).toISOString()

describe('history filters', () => {
  test('Today starts at local midnight and has no end', () => {
    assert.deepEqual(historyQuery({ range: 'today', now }), { ok: true, query: { from: at(2026, 10, 14) } })
  })

  test('Yesterday is the whole previous local day', () => {
    assert.deepEqual(historyQuery({ range: 'yesterday', now }), { ok: true, query: { from: at(2026, 10, 13), to: at(2026, 10, 13, 23, 59, 59, 999) } })
  })

  test('This week starts on Monday', () => {
    assert.deepEqual(historyQuery({ range: 'week', now }), { ok: true, query: { from: at(2026, 10, 12) } })
    assert.equal(startOfWeek(new Date(2026, 9, 18, 10)).getDate(), 12, 'Sunday belongs to the week that started on Monday')
    assert.equal(startOfWeek(new Date(2026, 9, 12, 0, 1)).getDate(), 12)
  })

  test('Custom covers both chosen days completely', () => {
    assert.deepEqual(historyQuery({ range: 'custom', customFrom: '2026-10-01', customTo: '2026-10-03', now }),
      { ok: true, query: { from: at(2026, 10, 1), to: at(2026, 10, 3, 23, 59, 59, 999) } })
    assert.equal(historyQuery({ range: 'custom', customFrom: '2026-10-05', customTo: '2026-10-05', now }).ok, true)
  })

  test('Custom rejects missing, impossible and reversed dates with a clear message', () => {
    for (const [customFrom, customTo] of [['', '2026-10-03'], ['2026-10-01', ''], ['2026-02-30', '2026-03-01'], ['x', 'y']]) {
      const result = historyQuery({ range: 'custom', customFrom, customTo, now })
      assert.equal(result.ok, false); assert.match(result.message, /start date and an end date/u)
    }
    assert.match(historyQuery({ range: 'custom', customFrom: '2026-10-05', customTo: '2026-10-01', now }).message, /must not be after/u)
  })

  test('status becomes the matching server filter', () => {
    assert.equal('status' in historyQuery({ range: 'today', now }).query, false)
    assert.equal(historyQuery({ range: 'today', status: 'completed', now }).query.status, 'COMPLETED')
    assert.equal(historyQuery({ range: 'today', status: 'voided', now }).query.status, 'VOIDED')
    const returned = historyQuery({ range: 'today', status: 'returned', now }).query
    assert.equal(returned.returned, true); assert.equal('status' in returned, false)
  })

  test('unknown period or status is refused', () => {
    assert.equal(historyQuery({ range: 'forever', now }).ok, false)
    assert.equal(historyQuery({ range: 'today', status: 'refunded', now }).ok, false)
  })

  test('date inputs round-trip real calendar days only', () => {
    assert.equal(dateInputValue(new Date(2026, 0, 5)), '2026-01-05')
    assert.equal(parseDateInput('2026-10-14').getDate(), 14)
    for (const bad of ['2026-13-01', '2026-02-29', '2026-1-1', '', null, undefined]) assert.equal(parseDateInput(bad), null)
  })
})

describe('history rows', () => {
  test('badges show voided and returned sales', () => {
    assert.deepEqual(saleBadges({ status: 'COMPLETED', hasReturns: false }), [])
    assert.deepEqual(saleBadges({ status: 'VOIDED', hasReturns: false }).map((badge) => badge.text), ['Voided'])
    assert.deepEqual(saleBadges({ status: 'COMPLETED', hasReturns: true }).map((badge) => badge.text), ['Returned'])
  })

  test('time text shows the day only when asked, and tolerates a bad date', () => {
    const iso = new Date(2026, 9, 14, 9, 5).toISOString()
    assert.match(saleTimeText(iso, { locale: 'en-GB' }), /^09:05$/u)
    assert.match(saleTimeText(iso, { withDay: true, locale: 'en-GB' }), /14 Oct · 09:05$/u)
    assert.equal(saleTimeText('nope'), '')
  })
})
