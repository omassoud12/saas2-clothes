import { Button, Card, PageHeader } from '../../components/ui/index.jsx'
import { useI18n } from '../../i18n/I18nContext.js'

export function ExchangesPage({ navigate }) {
  const { t } = useI18n()
  return (
    <section className="business-page">
      <PageHeader eyebrow={t('Customer service')} title={t('Exchanges')} description={t('Create an exchange from the original completed sale.')} />
      <Card className="lifecycle-route-card">
        <span className="eyebrow">{t('Sale-linked workflow')}</span>
        <h2>{t('Find the original sale')}</h2>
        <p>{t('Open Sales history, choose the completed sale, then select Exchange. The return and replacement sale are completed together.')}</p>
        <div><Button onClick={() => navigate('/app/sales')}>{t('Open Sales history')}</Button></div>
      </Card>
    </section>
  )
}
