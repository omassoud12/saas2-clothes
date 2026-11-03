// Store filter, shown once in the page header for every tab.
export default function StorePicker({ value, stores, onChange }) {
  return (
    <label className="storepick">
      <span className="visually-hidden">Store</span>
      <select value={value} onChange={(e) => onChange({ storeId: e.target.value })}>
        <option value="all">All stores</option>
        {(stores || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  );
}
