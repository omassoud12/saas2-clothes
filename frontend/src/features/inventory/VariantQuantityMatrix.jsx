import { useEffect, useRef, useState } from 'react'
import { ColorSwatch } from '../products/ColorSwatch.jsx'
import { groupVariantsByColor, compareSizes } from '../products/product-options.js'

export function VariantQuantityMatrix({ variants, quantities, onChange, disabled = false }) {
  const scroller = useRef(null)
  const [scrollable, setScrollable] = useState(false)
  const sizes = [...new Set(variants.map((variant) => variant.size || 'No size'))].sort((a, b) => compareSizes({ size: a }, { size: b }))
  useEffect(() => {
    const node = scroller.current
    if (!node) return undefined
    const update = () => setScrollable(node.scrollWidth > node.clientWidth + 1)
    const observer = new ResizeObserver(update)
    observer.observe(node)
    observer.observe(node.firstElementChild)
    update()
    return () => observer.disconnect()
  }, [variants])
  return <div className="receipt-matrix-wrap">
    <div className="receipt-matrix-heading"><strong>Receiving now</strong><span>Current stock appears below each field.</span></div>
    {scrollable && <p className="receipt-scroll-hint">Swipe or scroll this table to see more sizes.</p>}
    <div ref={scroller} className="receipt-matrix" role="region" aria-label="Receiving quantities; scroll sideways for more sizes" tabIndex={0}>
      <table><thead><tr><th scope="col">Color / size</th>{sizes.map((size) => <th scope="col" key={size}>{size}</th>)}</tr></thead>
        <tbody>{groupVariantsByColor(variants).map(([color, options]) => <tr key={color}><th scope="row"><ColorSwatch name={color} />{color}</th>{sizes.map((size) => {
          const variant = options.find((option) => (option.size || 'No size') === size)
          if (!variant) return <td key={size}>—</td>
          const key = variant.id ?? variant.sku
          return <td key={size}><input aria-label={`Receiving now: ${color} / ${size}`} inputMode="numeric" pattern="[0-9]*" maxLength={7} disabled={disabled || variant.isActive === false} value={quantities[key] ?? ''} placeholder="0" onChange={(event) => onChange(key, event.target.value)} /><small>Current: {variant.currentStock ?? 0}</small></td>
        })}</tr>)}</tbody></table>
    </div><p className="receipt-matrix-note">Blank or zero adds nothing. These values are added to current stock.</p>
  </div>
}
