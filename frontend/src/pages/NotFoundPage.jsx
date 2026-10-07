import { Card, PageHeader } from '../components/ui/index.jsx'
import { ROUTES } from '../app/routes.js'

export function NotFoundPage({ homePath = ROUTES.home }) {
  return (
    <section className={homePath === ROUTES.home ? 'foundation-page' : 'business-page'}>
      <Card className="foundation-fallback">
        <PageHeader eyebrow="404" title="Page not found" description="This address does not match an available page." />
        <a className="ui-button ui-button--primary auth-link-button" href={homePath}>
          {homePath === ROUTES.home ? 'Go to home' : 'Go to dashboard'}
        </a>
      </Card>
    </section>
  )
}
