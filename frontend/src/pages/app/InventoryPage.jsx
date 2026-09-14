import { ModulePlaceholder } from './ModulePlaceholder.jsx'

export function InventoryPage() {
  return (
    <ModulePlaceholder
      eyebrow="Stock control"
      title="Inventory"
      description="Monitor sellable variants and their inventory history."
      emptyMessage="Stock levels and movement history will appear once inventory workflows are connected."
    />
  )
}
