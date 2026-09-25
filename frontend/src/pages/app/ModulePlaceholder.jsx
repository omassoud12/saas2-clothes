import { EmptyState, PageHeader } from '../../components/ui/index.jsx'

export function ModulePlaceholder({ eyebrow, title, description, emptyMessage }) {
  return (
    <section className="business-page">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState title={`${title} workspace`} description={emptyMessage} />
    </section>
  )
}
