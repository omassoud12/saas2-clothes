// "…and {n} more items" with { n: 3 } -> "…and 3 more items". Unknown placeholders are left as written.
export function interpolate(text, params) {
  if (!params) return text
  return String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match))
}

// The translate function used when none is supplied: English as written, placeholders filled in.
export const plainTranslate = (text, params) => interpolate(text, params)
