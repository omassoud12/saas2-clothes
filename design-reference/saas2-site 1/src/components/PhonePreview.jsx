const products = [
  { name: 'Linen shirt', price: '$25', badge: '8 in stock', low: false, color: '#DCD3C9' },
  { name: 'Midi dress', price: '$42', badge: 'Low · 2 left', low: true, color: '#E6C4BF' },
  { name: 'Slim jeans', price: '$35', badge: '12 in stock', low: false, color: '#A9B6C8' },
];

// A small drawing of the app's Sell screen, used in the hero.
export default function PhonePreview() {
  return (
    <figure className="phone" role="img" aria-label="Preview of the SaaS2 sell screen on a phone">
      <div className="phone__screen">
        <div className="phone__top">
          <span className="phone__title">Sell</span>
          <span className="phone__meta">Today $184</span>
        </div>
        <div className="phone__list">
          {products.map((p) => (
            <div className="phone__row" key={p.name}>
              <span className="phone__thumb" style={{ background: p.color }} />
              <div className="phone__info">
                <div className="phone__line">
                  <span>{p.name}</span>
                  <span>{p.price}</span>
                </div>
                <span className={p.low ? 'badge badge--low' : 'badge'}>{p.badge}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="phone__cart">
          <span className="phone__cart-label">View cart · 2 items</span>
          <span className="phone__cart-total">
            <strong>$67</strong>
            <span>≈ 5,996,500 LBP</span>
          </span>
        </div>
      </div>
    </figure>
  );
}
