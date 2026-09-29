const presetColors = Object.freeze({
  black: '#222222', white: '#ffffff', gray: '#808080', charcoal: '#42464b',
  navy: '#233552', blue: '#3264a8', 'light blue': '#a6cbe5', red: '#b93b3b',
  burgundy: '#762f42', green: '#37704b', olive: '#72784b', khaki: '#b4a779',
  beige: '#d6c5a4', cream: '#f3e8cf', brown: '#795840', camel: '#bc9160',
  pink: '#dea6b8', purple: '#7e5a99', lavender: '#b8a0cf', yellow: '#e7c64b',
  orange: '#d78b3d', teal: '#397c7c', turquoise: '#65b9b4', gold: '#bc993f',
  silver: '#b8bdc3',
})

export function ColorSwatch({ name }) {
  const key = String(name ?? '').trim().toLowerCase()
  const color = Object.hasOwn(presetColors, key) ? presetColors[key] : null
  return <span aria-hidden="true" className={`product-color-swatch ${color ? '' : 'is-custom'}`} style={color ? { backgroundColor: color } : undefined} />
}
