import { useEffect, useRef } from 'react';

// "How it works": one zipper runs down the middle of all the steps. While scrolling, the pull slides
// down and the fabric parts above it, revealing each card while it is still in the middle of the screen.
// Reduced motion: the fabric is shown fully open.

function AccountVisual() {
  return (
    <div className="sv">
      <div className="sv__row">
        <span className="sv__avatar">O</span>
        <span className="sv__text"><strong>Owner</strong><span>Full access</span></span>
        <span className="sv__pill">You</span>
      </div>
      <div className="sv__row">
        <span className="sv__avatar sv__avatar--soft">S</span>
        <span className="sv__text"><strong>Staff</strong><span>Sells, never sees costs</span></span>
      </div>
    </div>
  );
}

function ProductVisual() {
  return (
    <div className="sv">
      <div className="sv__row sv__row--top">
        <span className="sv__thumb" />
        <span className="sv__text"><strong>Linen shirt</strong><span>$25 a piece</span></span>
        <span className="sv__dots"><i style={{ background: '#f4f1ea' }} /><i style={{ background: '#7b93ad' }} /><i style={{ background: '#2a2626' }} /></span>
      </div>
      <div className="sv__sizes">
        <span>S<em>4</em></span><span className="is-on">M<em>12</em></span><span>L<em>6</em></span><span>XL<em>2</em></span>
      </div>
    </div>
  );
}

function SaleVisual() {
  return (
    <div className="sv">
      <div className="sv__row">
        <span className="sv__check" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
        </span>
        <span className="sv__text"><strong>Sale completed · $67</strong><span>≈ 5,996,500 LBP</span></span>
      </div>
      <div className="sv__bar"><span style={{ width: '72%' }} /></div>
      <div className="sv__meta"><span>Stock updated</span><span>Linen shirt · M · 11 left</span></div>
    </div>
  );
}

const STEPS = [
  { title: 'Get your account', text: 'We set up your shop. Add staff with their own login.', Visual: AccountVisual },
  { title: 'Add your products', text: 'Colors, sizes, price per piece and stock for each size.', Visual: ProductVisual },
  { title: 'Start selling', text: 'Every sale updates your stock and reports at once.', Visual: SaleVisual },
];

const OPEN_SOFTNESS = 110; // px above the pull over which the zipper eases open

function spread(d, half) {
  return d <= 0 ? 0 : (half + 40) * (1 - Math.exp(-d / OPEN_SOFTNESS));
}

// Fabric ripple along the opening: grows with how open the zipper is, moves with time.
let rippleTime = 0;
function ripple(side, y, d) {
  if (d <= 0) return 0;
  const amp = Math.min(7, d * 0.045);
  return amp * (Math.sin(y * 0.045 + rippleTime * 2.1 + side * 1.3) * 0.7 + Math.sin(y * 0.11 - rippleTime * 1.4) * 0.3);
}

function rowPath(side, pullY, width, height, extra = 0) {
  const half = width / 2;
  const pts = [];
  for (let y = 0; y < pullY; y += 6) {
    const d = pullY - y;
    pts.push(`${(half + side * (3.5 + spread(d, half) + extra + ripple(side, y, d) * (1 + extra * 0.02))).toFixed(1)} ${y}`);
  }
  pts.push(`${(half + side * (3.5 + extra)).toFixed(1)} ${pullY.toFixed(1)}`);
  pts.push(`${(half + side * (3.5 + extra)).toFixed(1)} ${height.toFixed(1)}`);
  return pts;
}

function halfPath(side, pullY, width, height) {
  const outer = side < 0 ? -60 : width + 60;
  const pts = rowPath(side, pullY, width, height, -4);
  return `M ${outer} 0 L ${pts.join(' L ')} L ${outer} ${height.toFixed(1)} Z`;
}

// Lines drawn along each edge of the opening, bottom to top: [className, offset from the teeth].
const EDGE_LINES = [
  ['zp-shadow', -6],
  ['zp-fold', 26],
  ['zp-fold-light', 36],
  ['zp-fold', 50],
  ['zp-tape', 6],
  ['zp-stitch', 12],
  ['zp-lip', 1.5],
  ['zp-teeth', 0],
  ['zp-shine', 0],
];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export default function StepStack() {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const pullRef = useRef(null);
  const tabRef = useRef(null);
  const hintRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return undefined;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const halves = [svg.querySelector('[data-half="-1"]'), svg.querySelector('[data-half="1"]')];
    const weaves = [svg.querySelector('[data-weave="-1"]'), svg.querySelector('[data-weave="1"]')];
    const lines = Array.from(svg.querySelectorAll('[data-edge]'));

    function draw(pullY) {
      const width = wrap.offsetWidth;
      const height = wrap.offsetHeight;
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      [-1, 1].forEach((side, k) => {
        const d = halfPath(side, pullY, width, height);
        halves[k].setAttribute('d', d);
        weaves[k].setAttribute('d', d);
      });
      lines.forEach((el) => {
        const side = Number(el.dataset.side);
        const extra = Number(el.dataset.edge);
        let pts = rowPath(side, pullY, width, height, extra);
        // Folds exist only where the fabric has opened.
        if (el.classList.contains('zp-fold') || el.classList.contains('zp-fold-light')) pts = pts.slice(0, -2);
        el.setAttribute('d', pts.length > 1 ? 'M ' + pts.join(' L ') : '');
      });
      pullRef.current.setAttribute('transform', `translate(${width / 2} ${Math.min(pullY, height - 30).toFixed(1)}) scale(1.5)`);
      pullRef.current.setAttribute('opacity', pullY > height ? String(clamp(1 - (pullY - height) / 80)) : '1');
      hintRef.current.setAttribute('x', String(width / 2));
      hintRef.current.setAttribute('opacity', String(clamp(1 - pullY / 140)));
    }

    if (reduceMotion) {
      rippleTime = 0;
      draw(wrap.offsetHeight * 4);
      return undefined;
    }

    // Runs every frame while the section is on screen: the fabric ripples,
    // and the pull tab swings with scroll speed, then settles like a real zipper pull.
    let lastPull = null;
    let angle = 0;
    let spin = 0;
    let frame = 0;
    let visible = true;
    const start = performance.now();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible) return;
      rippleTime = (performance.now() - start) / 1000;
      const box = wrap.getBoundingClientRect();
      // The pull rides low on the screen (85%) so each card is fully open by mid-screen.
      const pullY = Math.max(0, window.innerHeight * 0.85 - box.top);
      const velocity = lastPull === null ? 0 : pullY - lastPull;
      lastPull = pullY;
      const target = clamp(-velocity * 1.4, -28, 28);
      spin = (spin + (target - angle) * 0.18) * 0.78;
      angle += spin;
      tabRef.current.setAttribute('transform', `rotate(${angle.toFixed(2)} 0 6)`);
      draw(pullY);
    };
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    io.observe(wrap);
    tick();
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="zip-panel" ref={wrapRef}>
      <ol className="step-stack">
        {STEPS.map(({ title, text, Visual }, i) => (
          <li key={title} className="step-card">
            <div className="step-card__head">
              <span className="step-card__num">Step {i + 1}</span>
              <span className="step-card__of">of {STEPS.length}</span>
            </div>
            <h3 className="step-card__title">{title}</h3>
            <p className="step-card__text">{text}</p>
            <Visual />
          </li>
        ))}
      </ol>

      <svg className="zip-panel__cover" ref={svgRef} width="0" height="0" aria-hidden="true">
        <defs>
          <linearGradient id="s2-fabric-l" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ddbdb4" />
            <stop offset="0.8" stopColor="#efd8d1" />
            <stop offset="1" stopColor="#f5e3de" />
          </linearGradient>
          <linearGradient id="s2-fabric-r" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#ddbdb4" />
            <stop offset="0.8" stopColor="#efd8d1" />
            <stop offset="1" stopColor="#f5e3de" />
          </linearGradient>
          <pattern id="s2-weave" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M 0 0 H 5" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
            <path d="M 0 2.5 H 5" stroke="rgba(120,70,75,0.06)" strokeWidth="1" />
          </pattern>
          <filter id="s2-zip-blur" x="-50%" y="-5%" width="200%" height="110%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <linearGradient id="s2-zip-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#bfb3b0" />
            <stop offset="1" stopColor="#7d7270" />
          </linearGradient>
        </defs>

        {[-1, 1].map((side) => (
          <path key={'s' + side} data-side={side} data-edge={EDGE_LINES[0][1]} className="zp-shadow" filter="url(#s2-zip-blur)" />
        ))}
        <path data-half="-1" fill="url(#s2-fabric-l)" />
        <path data-half="1" fill="url(#s2-fabric-r)" />
        <path data-weave="-1" fill="url(#s2-weave)" />
        <path data-weave="1" fill="url(#s2-weave)" />
        {EDGE_LINES.slice(1).map(([cls, extra]) => [-1, 1].map((side) => (
          <path key={cls + side} data-side={side} data-edge={extra} className={cls} />
        )))}

        <text ref={hintRef} y="72" textAnchor="middle" fontSize="13" fontWeight="600" fill="#6e6461" fontFamily="'Instrument Sans', system-ui, sans-serif">Scroll to open</text>
        <g ref={pullRef}>
          <path d="M -9 -10 Q 0 -14 9 -10 L 7 8 Q 0 11 -7 8 Z" fill="url(#s2-zip-metal)" stroke="#6f6664" strokeWidth="0.8" />
          <g ref={tabRef}>
            <rect x="-5.5" y="6" width="11" height="26" rx="5.5" fill="#2a2626" />
            <rect x="-2.5" y="20" width="5" height="8" rx="2.5" fill="#fcf7f5" opacity="0.85" />
          </g>
          <circle cx="0" cy="6" r="2" fill="#6f6664" />
        </g>
      </svg>
    </div>
  );
}
