import { useEffect, useRef } from 'react';

// A needle sews a long seam across the silk (with a loop flourish), pulling a live thread behind it.
// At the end of the seam a receipt prints out, then a "Stock updated" card appears.
// Every 5 seconds a new seam starts from a different place on the silk.
// With reduced motion, the finished scene is shown without animation.

const LOOP = 5;
// Every seam ends at the top of the receipt (300, 128).
const SEAMS = [
  // From the top left, waves to the right, a loop, back across, then up to the receipt.
  'M -30 40 C 40 -5, 90 85, 150 50 S 250 10, 300 45 C 345 70, 360 20, 330 15 C 300 10, 305 70, 350 75 C 390 85, 330 150, 230 135 S 60 110, 40 170 S 110 250, 180 215 C 230 190, 260 120, 300 128',
  // From the bottom left, climbing in curls.
  'M -30 300 C 40 320, 80 230, 60 190 C 40 150, 110 120, 150 160 C 185 195, 200 90, 160 70 C 120 50, 150 20, 210 30 S 290 90, 300 128',
  // From the top right, sweeping left, down, and back.
  'M 430 20 C 360 40, 300 0, 240 30 S 120 60, 90 40 C 60 20, 30 60, 60 90 C 90 120, 50 150, 90 170 S 200 200, 230 160 C 250 135, 280 110, 300 128',
  // From the right edge, a spiral in the middle, then up and over.
  'M 430 250 C 360 260, 340 200, 280 220 S 180 280, 150 240 C 120 200, 170 180, 175 205 C 180 230, 130 230, 120 200 C 105 150, 60 120, 80 80 S 200 40, 250 70 C 280 90, 290 110, 300 128',
];
const SEAM = SEAMS[0];
const RECEIPT_TOP = 132;
const RECEIPT_H = 150;
const TAIL = 46;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const span = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

export default function HeroStitch() {
  const seamRef = useRef(null);
  const maskRef = useRef(null);
  const needleRef = useRef(null);
  const tailRef = useRef(null);
  const shadowRef = useRef(null);
  const clipRef = useRef(null);
  const sceneRef = useRef(null);
  const receiptRef = useRef(null);
  const stockRef = useRef(null);

  useEffect(() => {
    const seam = seamRef.current;
    if (!seam) return undefined;
    const mask = maskRef.current;
    const paths = [seam, mask, tailRef.current, shadowRef.current];
    let length = 0;
    let current = -1;

    function applySeam(index) {
      if (index === current) return;
      current = index;
      paths.forEach((el) => el.setAttribute('d', SEAMS[index]));
      length = seam.getTotalLength();
      mask.setAttribute('stroke-dasharray', String(length));
    }

    function render(t, cycle = 0) {
      applySeam(cycle % SEAMS.length);
      const sew = ease(span(t, 0.15, 2.6));
      mask.setAttribute('stroke-dashoffset', String(length * (1 - sew)));

      // Needle rides the seam, dipping in and out of the fabric.
      const at = Math.max(0.5, length * sew);
      const p = seam.getPointAtLength(at);
      const q = seam.getPointAtLength(Math.max(0, at - 1));
      const angle = (Math.atan2(p.y - q.y, p.x - q.x) * 180) / Math.PI;
      const sewing = sew > 0 && sew < 1;
      const dip = sewing ? Math.sin(t * 30) * 1.6 : 0;
      const pull = easeOut(span(t, 2.6, 3.1)) * 34; // the needle flicks forward as it leaves
      const fadeNeedle = Math.min(span(t, 0.05, 0.2), 1 - span(t, 2.8, 3.1));
      const needle = needleRef.current;
      needle.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${angle}) translate(${pull} ${dip}) scale(1.3)`);
      needle.setAttribute('opacity', String(fadeNeedle));

      // Live thread: a solid strand along the last stretch behind the needle.
      const tail = tailRef.current;
      const shown = Math.min(TAIL, at);
      tail.setAttribute('stroke-dasharray', `${shown} ${length * 2}`);
      tail.setAttribute('stroke-dashoffset', String(-(at - shown)));
      tail.setAttribute('opacity', String(fadeNeedle));

      // Receipt prints downward from the end of the seam.
      const print = easeOut(span(t, 2.6, 3.4));
      clipRef.current.setAttribute('height', String(print > 0 ? RECEIPT_H * print + 2 : 0));
      receiptRef.current.setAttribute('transform', `rotate(${Math.sin(t * 1.4) * 1.2} 300 ${RECEIPT_TOP})`);

      // Stock card, then everything fades before the loop restarts.
      stockRef.current.classList.toggle('is-on', t > 3.35 && t < 4.6);
      sceneRef.current.setAttribute('opacity', String(1 - span(t, 4.55, 4.95)));
    }

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      render(3.9);
      return undefined;
    }

    const start = performance.now();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const elapsed = (performance.now() - start) / 1000;
      render(elapsed % LOOP, Math.floor(elapsed / LOOP));
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="stitch" aria-hidden="true">
      <svg className="stitch__svg" viewBox="0 0 400 340" preserveAspectRatio="xMidYMin meet">
        <defs>
          <mask id="s2-sew-mask" maskUnits="userSpaceOnUse" x="-40" y="0" width="480" height="340">
            <path ref={maskRef} d={SEAM} fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
          </mask>
          <clipPath id="s2-print-clip">
            <rect ref={clipRef} x="200" y={RECEIPT_TOP - 2} width="200" height="0" />
          </clipPath>
          <linearGradient id="s2-steel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#c9c2c0" />
            <stop offset="1" stopColor="#8d8482" />
          </linearGradient>
          <filter id="s2-soft" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#46202a" floodOpacity="0.35" />
          </filter>
        </defs>

        <g ref={sceneRef}>
          {/* Stitches: a soft shadow line, then the thread. */}
          <g mask="url(#s2-sew-mask)">
            <path ref={shadowRef} d={SEAM} fill="none" stroke="#3b1f26" strokeOpacity="0.25" strokeWidth="2.6" strokeDasharray="9 7" strokeLinecap="round" transform="translate(0 1.5)" />
            <path ref={seamRef} d={SEAM} fill="none" stroke="#fff7f4" strokeWidth="2.2" strokeDasharray="9 7" strokeLinecap="round" />
          </g>

          {/* Receipt hanging from the end of the seam. */}
          <g ref={receiptRef}>
            <g clipPath="url(#s2-print-clip)" filter="url(#s2-soft)">
              <path
                d={`M 226 ${RECEIPT_TOP} H 374 V ${RECEIPT_TOP + RECEIPT_H - 8} l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -8 8 l -8 -8 l -4 4 Z`}
                fill="#fffbfa"
              />
              <g fontFamily="'Instrument Sans', system-ui, sans-serif" fill="#2a2626">
                <text x="240" y={RECEIPT_TOP + 26} fontSize="13" fontWeight="700">SaaS2</text>
                <text x="360" y={RECEIPT_TOP + 26} fontSize="12" textAnchor="end" fill="#6e6461">#1024</text>
                <line x1="240" x2="360" y1={RECEIPT_TOP + 38} y2={RECEIPT_TOP + 38} stroke="#d9c4be" strokeDasharray="3 3" />
                <text x="240" y={RECEIPT_TOP + 58} fontSize="12">Linen shirt · M</text>
                <text x="360" y={RECEIPT_TOP + 58} fontSize="12" textAnchor="end">$25</text>
                <text x="240" y={RECEIPT_TOP + 78} fontSize="12">Midi dress · S</text>
                <text x="360" y={RECEIPT_TOP + 78} fontSize="12" textAnchor="end">$42</text>
                <line x1="240" x2="360" y1={RECEIPT_TOP + 92} y2={RECEIPT_TOP + 92} stroke="#d9c4be" strokeDasharray="3 3" />
                <text x="240" y={RECEIPT_TOP + 112} fontSize="13" fontWeight="700">Total</text>
                <text x="360" y={RECEIPT_TOP + 112} fontSize="13" fontWeight="700" textAnchor="end">$67</text>
                <text x="360" y={RECEIPT_TOP + 130} fontSize="12" textAnchor="end" fill="#6e6461">≈ 5,996,500 LBP</text>
              </g>
            </g>
          </g>

          {/* Live thread behind the needle. */}
          <path ref={tailRef} d={SEAM} fill="none" stroke="#fff7f4" strokeWidth="1.5" strokeLinecap="round" opacity="0" />

          {/* Needle with a short thread tail through its eye. */}
          <g ref={needleRef} opacity="0">
            <path d="M -30 -1.8 L 9 -1.3 L 17 0 L 9 1.3 L -30 1.8 Z" fill="url(#s2-steel)" stroke="#6f6664" strokeWidth="0.4" />
            <ellipse cx="-24" cy="0" rx="3.4" ry="0.9" fill="#4a2a31" />
            <path d="M -24 0 C -34 6, -40 -4, -52 3" fill="none" stroke="#fff7f4" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        </g>
      </svg>

      <div ref={stockRef} className="glass glass--stock">
        <span className="glass__label">Stock updated</span>
        <span className="glass__value">Linen shirt · M · 7 left</span>
        <span className="glass__sizes"><span>S</span><span className="is-on">M</span><span>L</span><span>XL</span></span>
      </div>
    </div>
  );
}
