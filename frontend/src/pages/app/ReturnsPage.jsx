import { Button, Card, PageHeader } from '../../components/ui/index.jsx'

export function ReturnsPage({ navigate }) {
  return (
    <section className="business-page">
      <PageHeader eyebrow="Customer service" title="Returns" description="Process returns from the original completed sale." />
      <Card className="lifecycle-route-card">
        <span className="eyebrow">Sale-linked workflow</span>
        <h2>Find the original sale</h2>
        <p>Open Sales history, choose the completed sale, then select Return. The sale detail shows the remaining returnable quantity and existing returns.</p>
        <div><Button onClick={() => navigate('/app/sales')}>Open Sales history</Button></div>
      </Card>
    </section>
  )
}
