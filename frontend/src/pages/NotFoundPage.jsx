import { Card, PageHeader } from '../components/ui/index.jsx'
import { ROUTES } from '../app/routes.js'
import { useI18n } from '../i18n/I18nContext.js'

export function NotFoundPage({ homePath = ROUTES.home }) {
  const { t } = useI18n()
  return (
    <section className={homePath === ROUTES.home ? 'foundation-page' : 'business-page'}>
      <Card className="foundation-fallback">
        <PageHeader eyebrow="404" title={t('Page not found')} description={t('This address does not match an available page.')} />
        <a className="ui-button ui-button--primary auth-link-button" href={homePath}>
          {homePath === ROUTES.home ? t('Go to home') : t('Go to dashboard')}
        </a>
      </Card>
    </section>
  )
}
