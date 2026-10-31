import { useEffect, useState } from 'react'
import { Button, Card, ErrorState, Input, LoadingState, PageHeader } from '../../components/ui/index.jsx'
import { loadSettings, parseRateInput, saveExchangeRate } from '../../features/settings/settings-flow.js'
import { usdCentsToLbp } from '../../lib/currency.js'
import { formatMoneyCompact } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'
import { useI18n } from '../../i18n/I18nContext.js'

// Store settings for the owner: the dollar-to-pound rate the till uses.
export function SettingsPage({ profile }) {
  const { t } = useI18n()
  const [state, setState] = useState({ kind: 'loading', baseCurrency: 'USD', rate: null, message: '' })
  const [draft, setDraft] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const owner = profile?.user?.role === 'OWNER'

  useEffect(() => {
    let active = true
    void loadSettings({ supabase }).then((result) => {
      if (!active) return
      if (result.requiresLogin) { window.location.replace('/login'); return }
      if (!result.ok) { setState({ kind: 'error', baseCurrency: 'USD', rate: null, message: result.message }); return }
      setState({ kind: 'ready', baseCurrency: result.baseCurrency, rate: result.lbpPerUsd, message: '' })
      setDraft(result.lbpPerUsd ?? '')
    })
    return () => { active = false }
  }, [attempt])

  async function save(event) {
    event.preventDefault()
    const parsed = parseRateInput(draft)
    if (!parsed.ok) { setFeedback({ kind: 'error', message: parsed.message }); return }
    setSaving(true); setFeedback(null)
    const result = await saveExchangeRate({ supabase, lbpPerUsd: parsed.value })
    setSaving(false)
    if (result.requiresLogin) { window.location.replace('/login'); return }
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    setState((current) => ({ ...current, rate: result.lbpPerUsd }))
    setDraft(result.lbpPerUsd ?? '')
    setFeedback({ kind: 'success', message: result.lbpPerUsd ? t('Exchange rate saved. New sales will show the total in pounds.') : t('Exchange rate cleared. Sales will show dollars only.') })
  }

  if (!owner) return <section className="business-page"><ErrorState title={t('Owner access required')} description={t('Store settings can be changed only by the store owner.')} /></section>

  const example = state.rate ? usdCentsToLbp(1000, state.rate) : null
  return <section className="business-page settings-page">
    <PageHeader eyebrow={t('Store')} title={t('Settings')} description={t('Settings that apply to the whole store.')} />
    {state.kind === 'loading' && <LoadingState label={t('Loading settings')} />}
    {state.kind === 'error' && <ErrorState title={t('Settings unavailable')} description={t(state.message)}
      action={<Button onClick={() => { setState({ kind: 'loading', baseCurrency: 'USD', rate: null, message: '' }); setAttempt((value) => value + 1) }}>{t('Try again')}</Button>} />}
    {state.kind === 'ready' && <Card>
      <h2>{t('Exchange rate')}</h2>
      {state.baseCurrency !== 'USD'
        ? <p>{t('The exchange rate is used only by stores that sell in US dollars.')}</p>
        : <form className="settings-rate-form" onSubmit={save}>
          <p>{t('How many Lebanese pounds is one US dollar worth today? The till uses it to show every total in pounds and to work out the change.')}</p>
          <Input id="settings-rate" label={t('Lebanese pounds for 1 USD')} inputMode="decimal" autoComplete="off" placeholder="89500"
            hint={t('Leave it empty to show dollars only.')} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
          {example !== null && <p className="settings-rate-example">{t('Example: {formatMoneyCompact} =', { formatMoneyCompact: formatMoneyCompact('10.00', 'USD') })} {formatMoneyCompact(String(example), 'LBP', 0)}</p>}
          {feedback && <p className={feedback.kind === 'error' ? 'error-message' : 'success-message'} role={feedback.kind === 'error' ? 'alert' : 'status'}>{t(feedback.message)}</p>}
          <div className="settings-actions"><Button type="submit" tone="primary" disabled={saving} aria-busy={saving}>{saving ? t('Saving...') : t('Save exchange rate')}</Button></div>
        </form>}
    </Card>}
  </section>
}
