// "Made for shops that sell in sizes and colors": business types shown as garments on hangers
// along a clothing rail. They sway gently; tapping one gives it a bigger swing.
// Phones: two rails of three. Wide screens: one long rail.

const WOOD = '#c9a587'
const METAL = '#2a2626'

function Hanger() {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 50 13 C 43 13, 43 3, 50 3 C 56 3, 57 9, 53 11" stroke={METAL} strokeWidth="2" />
      <path d="M 50 13 L 50 20" stroke={METAL} strokeWidth="2" />
      <path d="M 14 34 L 50 20 L 86 34" stroke={WOOD} strokeWidth="3.4" />
    </g>
  )
}

const GARMENTS = {
  dress: (
    <path d="M 38 26 Q 50 33 62 26 L 70 31 L 64 52 L 80 118 Q 50 125 20 118 L 36 52 L 30 31 Z" fill="#9a4e5c" />
  ),
  tee: (
    <path d="M 37 30 Q 50 38 63 30 L 79 40 L 73 53 L 65 49 L 65 92 L 35 92 L 35 49 L 27 53 L 21 40 Z" fill="#e7c9c1" />
  ),
  sneaker: (
    <g>
      <path d="M 40 31 L 44 72 M 60 31 L 56 72" stroke="#efdcd7" strokeWidth="2" fill="none" />
      <path d="M 22 98 Q 24 76 42 73 L 56 73 Q 60 86 80 90 Q 93 92 90 103 L 22 103 Z" fill={METAL} />
      <rect x="20" y="102" width="72" height="7" rx="3.5" fill="#fffbfa" stroke="#d9c6b8" />
      <path d="M 45 79 L 54 83 M 43 85 L 55 89" stroke="#efdcd7" strokeWidth="1.6" />
    </g>
  ),
  hoodie: (
    <g>
      <path d="M 34 30 L 66 30 L 84 42 L 90 100 L 78 102 L 70 57 L 70 108 L 30 108 L 30 57 L 22 102 L 10 100 L 16 42 Z" fill="#d9c6b8" />
      <path d="M 38 30 Q 50 16 62 30 Q 50 41 38 30 Z" fill="#c8b2a3" />
      <path d="M 50 36 L 50 108" stroke="#a8907f" strokeWidth="1.4" strokeDasharray="2 2" />
      <path d="M 36 82 H 64" stroke="#c8b2a3" strokeWidth="6" strokeLinecap="round" />
    </g>
  ),
  abaya: (
    <path d="M 38 26 Q 50 33 62 26 L 78 34 L 92 96 L 80 98 L 72 64 L 75 122 L 25 122 L 28 64 L 20 98 L 8 96 L 22 34 Z" fill="#6b5a57" />
  ),
  bag: (
    <g>
      <path d="M 37 31 Q 50 78 63 31" stroke="#a46f53" strokeWidth="3" fill="none" />
      <rect x="25" y="62" width="50" height="44" rx="9" fill="#c48a6a" />
      <path d="M 25 74 Q 50 86 75 74" stroke="#a46f53" strokeWidth="2" fill="none" />
      <circle cx="50" cy="80" r="3" fill="#efdcd7" />
    </g>
  ),
}

const ITEMS = [
  { label: 'Boutiques', garment: 'dress' },
  { label: "Kids' wear", garment: 'tee' },
  { label: 'Shoe stores', garment: 'sneaker' },
  { label: 'Sportswear', garment: 'hoodie' },
  { label: 'Modest fashion', garment: 'abaya' },
  { label: 'Accessories & bags', garment: 'bag' },
]

function swing(e) {
  const el = e.currentTarget
  el.classList.remove('is-swinging')
  void el.offsetWidth // restart the animation
  el.classList.add('is-swinging')
}

export function RackShowcase() {
  const rows = [ITEMS.slice(0, 3), ITEMS.slice(3)]
  return (
    <div className="rack">
      {rows.map((row, r) => (
        <div className="rack__row" key={r}>
          <div className="rack__rail" aria-hidden="true" />
          <ul className="rack__items">
            {row.map((item, i) => (
              <li
                key={item.label}
                className="hang"
                style={{ '--d': `${-(r * 3 + i) * 0.7}s` }}
                onPointerDown={swing}
                onAnimationEnd={(e) => { if (e.animationName === 'hang-swing') e.currentTarget.classList.remove('is-swinging') }}
              >
                <svg className="hang__art" viewBox="0 0 100 126" aria-hidden="true">
                  <Hanger />
                  {GARMENTS[item.garment]}
                </svg>
                <span className="hang__label">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
