import { ColorSwatch } from './ColorSwatch.jsx'
import { clothingSizes, compareSizes } from './product-options.js'
import { useDirtyState, confirmDiscardChanges } from '../../app/dirty-state.js'
import { useEffect, useRef, useState } from 'react'
import { createProduct, createVariant, createProductSetup, uploadProductImage, validateImage } from './product-flow.js'
import { createProductSetupWorkflow } from './product-setup-flow.js'
import { buildReceivingSetup } from '../inventory/stock-receipt-flow.js'
import { supabase } from '../../lib/supabase.js'
import './products.css'

const sizes = clothingSizes
const colorChoices = ['Black', 'White', 'Gray', 'Charcoal', 'Navy', 'Blue', 'Light blue', 'Red', 'Burgundy', 'Green', 'Olive', 'Khaki', 'Beige', 'Cream', 'Brown', 'Camel', 'Pink', 'Purple', 'Lavender', 'Yellow', 'Orange', 'Teal', 'Turquoise', 'Gold', 'Silver', 'Multicolor']
const newColor = (name) => ({ id: crypto.randomUUID(), color: name, customSize: '', options: [] })
const newSize = (size) => ({ sku: `ITEM-${crypto.randomUUID()}`, barcode: '', size, selected: true })

export function ProductCreateForm({ role, currency, categories, categoriesLoading, onCancel, onSaved, onBusy, onDefine, initialDraft, initialImageFile }) {
  const [draft, setDraft] = useState(() => initialDraft ?? ({ name: '', categoryId: '', sellingPrice: '', colors: [] }))
  const [customColor, setCustomColor] = useState('')
  const [imageFile, setImageFile] = useState(initialImageFile ?? null)
  const [imagePreview, setImagePreview] = useState(() => initialImageFile ? URL.createObjectURL(initialImageFile) : null)
  const imageInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const form = useRef(null)
  const [workflow] = useState(() => createProductSetupWorkflow({
    role,
    createSetup: (draft) => createProductSetup({ supabase, draft, role }),
    uploadImage: (productId, file) => uploadProductImage({ supabase, productId, file }),
    createProduct: (draft) => createProduct({ supabase, draft, role }),
    createVariant: (productId, draft) => createVariant({ supabase, productId, draft, role }),
  }))
  useEffect(() => { form.current?.querySelector('input')?.focus() }, [])
  const markClean = useDirtyState(Boolean(draft.name.trim() || draft.categoryId || draft.sellingPrice || draft.colors.length || imageFile || customColor.trim()))

  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview) }, [imagePreview])
  function chooseImage(file) {
    if (file) {
      const valid = validateImage(file)
      if (!valid.ok) { setFeedback(valid); if (imageInput.current) imageInput.current.value = ''; return }
    }
    setImageFile(file)
    setImagePreview(file ? URL.createObjectURL(file) : null)
    setFeedback(null)
    if (!file && imageInput.current) imageInput.current.value = ''
  }

  function addColor(value) {
    const name = value.trim()
    if (!name) return
    setDraft((current) => current.colors.some((color) => color.color.toLowerCase() === name.toLowerCase()) ? current : { ...current, colors: [...current.colors, newColor(name)] })
    setCustomColor('')
  }
  function changeColor(id, change) {
    setDraft((current) => ({ ...current, colors: current.colors.map((color) => color.id === id ? change(color) : color) }))
  }
  function toggleSize(id, size) {
    changeColor(id, (color) => ({ ...color, options: color.options.some((option) => option.size === size)
      ? color.options.map((option) => option.size === size ? { ...option, selected: !option.selected } : option)
      : [...color.options, newSize(size)] }))
  }
  function changeOption(id, size, field, value) {
    changeColor(id, (color) => ({ ...color, options: color.options.map((option) => option.size === size ? { ...option, [field]: value } : option) }))
  }
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); onBusy(true); setFeedback(null)
    try {
      if (!draft.colors.length) { setFeedback({ message: 'Choose at least one color.' }); return }
      if (draft.colors.some((color) => !color.options.some((option) => option.selected))) {
        setFeedback({ message: 'Choose at least one size for each color.' }); return
      }
      const options = draft.colors.flatMap((color) => color.options.filter((option) => option.selected).map((option) => ({ ...option, color: color.color, ...(role === 'OWNER' ? { sellingPrice: draft.sellingPrice, ...(!onDefine ? { openingStock: true } : {}) } : {}) })))
      if (onDefine) {
        const definition = { name: draft.name, categoryId: draft.categoryId, options: [...options].sort(compareSizes) }
        const valid = buildReceivingSetup(definition, role)
        if (!valid.ok) { setFeedback(valid); return }
        markClean(); onDefine(definition, imageFile); return
      }
      const result = await workflow.submit({ name: draft.name, categoryId: draft.categoryId, options: [...options].sort(compareSizes) }, imageFile)
      if (result.skipped) return
      if (result.requiresLogin) { window.location.replace('/login'); return }
      if (result.requiresAccountReview) { window.location.replace('/pending-approval'); return }
      if (result.ok) { markClean(); onSaved(result.productId) }
      else setFeedback(result)
    } finally { setBusy(false); onBusy(false) }
  }
  const locked = busy || workflow.started
  const suffix = currency ? ` (${currency})` : ''
  const feedbackSection = feedback ? /color|size|sku|barcode|option/i.test(feedback.message) ? 'variants' : /price/i.test(feedback.message) ? 'price' : /name|category/i.test(feedback.message) ? 'details' : null : null
  const errorMessage = feedback && <p id="product-create-error" role="alert" className="product-feedback error-message">{feedback.message}</p>
  return <section className="product-panel product-create-panel" aria-label="Add product">
    <div className="product-create-title"><h2>New product</h2></div>
    <form ref={form} className="product-form product-create-form" aria-describedby={feedback ? 'product-create-error' : undefined} onSubmit={submit}>
      <fieldset disabled={locked} className="product-create-fields product-info-fields" aria-describedby={feedbackSection === 'details' ? 'product-create-error' : undefined}><legend>Product details</legend>
        <div className="product-form-grid"><div><label htmlFor="new-product-name">Product name</label><input id="new-product-name" required maxLength={150} placeholder="e.g. Cotton T-shirt" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div><label htmlFor="new-product-category">Category</label><select id="new-product-category" required value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></div>
      </fieldset>
      {feedbackSection === 'details' && errorMessage}
      {categoriesLoading && <p role="status">Loading categories...</p>}
      {!categoriesLoading && categories.length === 0 && <p>Add a category first in <a href="/app/categories">Categories</a>.</p>}
      <fieldset disabled={locked} className="product-create-fields product-color-fields" aria-describedby={feedbackSection === 'variants' ? 'product-create-error' : 'entry-color-help'}><legend>Variants</legend>
        <label htmlFor="product-color-list">Color</label><select id="product-color-list" value="" onChange={(event) => addColor(event.target.value)}><option value="">Choose a color...</option>{colorChoices.map((name) => <option key={name} value={name} disabled={draft.colors.some((color) => color.color.toLowerCase() === name.toLowerCase())}>{name}</option>)}</select>
        <details className="product-optional product-custom-color-action"><summary>+ Add Custom Color</summary><div className="product-custom-size"><label htmlFor="product-custom-color" className="sr-only">Custom color name</label><input id="product-custom-color" maxLength={100} placeholder="e.g. Dusty rose" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /><button type="button" className="secondary-action" disabled={!customColor.trim()} onClick={() => addColor(customColor)}>Add color</button></div></details>
        <p id="entry-color-help" className="product-muted entry-color-help">{draft.colors.length ? 'Choose sizes for each color below.' : 'Select a color to configure its sizes.'}</p>
      </fieldset>
      <div className="product-color-options">{draft.colors.map((color, index) => <fieldset key={color.id} disabled={locked} className="product-create-option"><legend className="sr-only">{color.color}</legend>
        <div className="product-color-heading"><strong><ColorSwatch name={color.color} />{color.color} sizes</strong><button type="button" className="text-button" onClick={() => setDraft({ ...draft, colors: draft.colors.filter((item) => item.id !== color.id) })}>Remove {color.color}</button></div>
        <div className="product-size-picker" role="group" aria-label={`Sizes for ${color.color || `color ${index + 1}`}`}><div className="product-size-buttons">{[...sizes, ...color.options.map((option) => option.size).filter((size) => !sizes.includes(size))].map((size) => <button key={size} type="button" className="secondary-action" aria-pressed={color.options.some((option) => option.size === size && option.selected)} onClick={() => toggleSize(color.id, size)}>{size}</button>)}</div></div>
        <details className="product-optional"><summary>Custom size</summary><div className="product-custom-size"><label htmlFor={`custom-${color.id}`} className="sr-only">Other size</label><input id={`custom-${color.id}`} maxLength={100} placeholder="e.g. 38" value={color.customSize} onChange={(event) => changeColor(color.id, (current) => ({ ...current, customSize: event.target.value }))} /><button type="button" className="secondary-action" disabled={!color.customSize.trim()} onClick={() => { const size = color.customSize.trim().toUpperCase(); changeColor(color.id, (current) => ({ ...current, customSize: '', options: current.options.some((option) => option.size === size) ? current.options.map((option) => option.size === size ? { ...option, selected: true } : option) : [...current.options, newSize(size)] })) }}>Add size</button></div></details>
        <details className="product-optional product-size-codes"><summary>Codes & barcodes</summary><div className="product-size-rows">{color.options.filter((option) => option.selected).map((option) => <div className="product-size-row" key={option.size}>
          <div className="product-size-row-fields"><strong>{option.size}</strong></div>
          <details className="product-optional"><summary>Code & barcode for {option.size}</summary><div className="product-form-grid">{[['sku', 'Product code (auto-filled)'], ['barcode', 'Barcode']].map(([field, label]) => <div key={field}><label htmlFor={`${color.id}-${option.size}-${field}`}>{label}</label><input id={`${color.id}-${option.size}-${field}`} maxLength={100} value={option[field]} onChange={(event) => changeOption(color.id, option.size, field, event.target.value)} /></div>)}</div></details>
        </div>)}</div></details>
      </fieldset>)}</div>
      {feedbackSection === 'variants' && errorMessage}
      <p className="product-muted product-form-note">{onDefine ? role === 'OWNER' ? 'Start with zero stock, or add received quantities in the next step.' : 'Save with zero stock. An owner can set prices and receive stock.' : role === 'OWNER' ? '1 piece per selected size. Set purchase cost later in Inventory.' : 'An owner can add stock in Inventory.'}</p>
      {role === 'OWNER' && <fieldset disabled={locked} className="product-create-fields product-price-fields" aria-describedby={feedbackSection === 'price' ? 'product-create-error' : undefined}><legend>Selling price</legend><div className="product-form-grid">
        <div><label htmlFor="new-product-price">Price for all sizes{suffix}</label><input id="new-product-price" inputMode="decimal" maxLength={24} placeholder="15.00" value={draft.sellingPrice} onChange={(event) => setDraft({ ...draft, sellingPrice: event.target.value })} /></div>
      </div></fieldset>}
      {feedbackSection === 'price' && errorMessage}
      <details className="product-optional product-photo-fields"><summary>Product photo (optional)</summary><fieldset disabled={locked} className="product-create-fields">
        <label htmlFor="new-product-photo">Choose a photo</label><input ref={imageInput} id="new-product-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage(event.target.files?.[0] || null)} aria-describedby="new-product-photo-help" />
        <p id="new-product-photo-help" className="product-muted">JPEG, PNG or WebP, up to 10 MB. Uploaded when you save the product.</p>
        {imagePreview && <div className="product-image-preview"><img src={imagePreview} alt="Selected product photo preview" /><button type="button" className="secondary-action" onClick={() => chooseImage(null)}>Remove photo</button></div>}
      </fieldset></details>
      {feedback && !feedbackSection && errorMessage}
      {workflow.started && feedback && <p>Saved steps are kept. {feedback.review ? 'Open the catalog to check what was saved.' : 'Retry continues from the unfinished step with the same details.'}</p>}
      <div className="product-actions product-create-footer"><button type="button" className="secondary-action" disabled={busy || (feedback?.uncertain && !feedback?.review)} onClick={() => { if (confirmDiscardChanges()) { markClean(); if (workflow.productId) onSaved(workflow.productId, true); else onCancel() } }}>{workflow.started ? 'View catalog / saved product' : 'Cancel'}</button>
        <button type="submit" disabled={busy || feedback?.review || categories.length === 0}>{busy ? 'Saving product...' : onDefine ? <>Continue <span aria-hidden="true">→</span></> : workflow.started ? 'Retry remaining steps' : 'Save product'}</button></div>
    </form>
  </section>
}
