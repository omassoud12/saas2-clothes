import { Button, Card, PageHeader } from '../../components/ui/index.jsx'

// Placeholder until the full sales history (filters, details, returns) arrives in the next part of this batch.
export function HistoryPage({ navigate }) {
  return (
    <section className="business-page">
      <PageHeader eyebrow="Sales" title="Sales history" description="The full history with filters and receipts is coming next." />
      <Card className="lifecycle-route-card">
        <h2>Today's sales</h2>
        <p>Open Sell and tap the "Sales today" line at the top to see today's sales and receipt numbers.</p>
        <div><Button onClick={() => navigate('/app/sales')}>Open Sell</Button></div>
      </Card>
    </section>
  )
}
