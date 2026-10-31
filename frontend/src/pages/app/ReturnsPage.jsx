import { Button, Card, PageHeader } from '../../components/ui/index.jsx'
import { useI18n } from '../../i18n/I18nContext.js'

export function ReturnsPage({ navigate }) {
  const { t } = useI18n()
  return (
    <section className="business-page">
      <PageHeader eyebrow={t('Customer service')} title={t('Returns')} description={t('Process returns from the original completed sale.')} />
      <Card className="lifecycle-route-card">
        <span className="eyebrow">{t('Sale-linked workflow')}</span>
        <h2>{t('Find the original sale')}</h2>
        <p>{t('Open Sales history, choose the completed sale, then select Return. The sale detail shows the remaining returnable quantity and existing returns.')}</p>
        <div><Button onClick={() => navigate('/app/sales')}>{t('Open Sales history')}</Button></div>
      </Card>
    </section>
  )
}
