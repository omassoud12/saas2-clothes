import { useEffect, useRef } from 'react';

// Hero background: a slowly moving satin surface drawn by a small WebGL shader,
// with a dashed stitch line running across it. No 3D library needed.
// Phones: the silk rises from the bottom and sits behind the text.
// Wide screens: it fills the right side.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uWide;
uniform float uPointer;

float heightAt(vec2 p) {
  vec2 q = p;
  q.x += 0.22 * sin(q.y * 1.6 + uTime * 0.21) + uPointer * 0.12;
  q.y += 0.15 * sin(q.x * 1.1 - uTime * 0.17);
  float h = 0.55 * sin(q.x * 2.6 + 0.8 * sin(q.y * 1.2 - uTime * 0.25) + uTime * 0.18);
  h += 0.28 * sin(q.x * 5.3 + q.y * 1.4 - uTime * 0.31);
  h += 0.11 * sin(q.x * 10.7 - q.y * 2.1 + uTime * 0.42);
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.2;
  float ang = -0.55;
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;

  float e = 0.004;
  float h = heightAt(p);
  float hx = heightAt(p + vec2(e, 0.0)) - h;
  float hy = heightAt(p + vec2(0.0, e)) - h;
  vec3 n = normalize(vec3(-hx / e * 0.5, -hy / e * 0.5, 1.0));

  vec3 L = normalize(vec3(-0.5, 0.7, 0.6));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 40.0);
  float sheen = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);
  float fold = smoothstep(-0.9, 0.9, h);

  vec3 deep = vec3(0.42, 0.23, 0.27);
  vec3 mid = vec3(0.86, 0.70, 0.68);
  vec3 lite = vec3(0.99, 0.92, 0.90);
  vec3 col = mix(deep, mid, smoothstep(0.12, 0.72, diff));
  col = mix(col, lite, smoothstep(0.72, 1.0, diff) * 0.8);
  col += spec * 0.32 + sheen * vec3(0.22, 0.15, 0.15);
  col *= 0.86 + 0.14 * fold;

  // Fine woven grain.
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.022;

  // Where the silk shows: rising from the bottom on phones, the right side on wide screens.
  float edge = h * 0.04;
  float a = uWide < 0.5
    ? smoothstep(0.7 + edge, 0.24 + edge, uv.y)
    : smoothstep(0.36 + edge, 0.62 + edge, uv.x);

  gl_FragColor = vec4(col * a, a);
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export default function HeroSilk() {
  const ref = useRef(null);

  useEffect(() => {
    const mount = ref.current;
    if (!mount) return undefined;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return undefined; // No WebGL: the hero keeps its soft background.

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return undefined;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return undefined;
    gl.useProgram(prog);
    mount.appendChild(canvas);

    // One triangle that covers the screen.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uWide = gl.getUniformLocation(prog, 'uWide');
    const uPointer = gl.getUniformLocation(prog, 'uPointer');

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uWide, w >= 900 ? 1 : 0);
    }

    let pointer = 0;
    let pointerTarget = 0;
    const onPointer = (e) => { pointerTarget = e.clientX / window.innerWidth - 0.5; };

    function draw(t) {
      pointer += (pointerTarget - pointer) * 0.03;
      gl.uniform1f(uTime, t);
      gl.uniform1f(uPointer, pointer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let frame = 0;
    let visible = true;
    function tick() {
      frame = requestAnimationFrame(tick);
      if (visible) draw((performance.now() - start) / 1000 + 6);
    }

    resize();
    const ro = new ResizeObserver(() => { resize(); if (reduceMotion) draw(8); });
    ro.observe(mount);
    let io = null;
    if (reduceMotion) {
      draw(8);
    } else {
      window.addEventListener('pointermove', onPointer, { passive: true });
      io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
      io.observe(mount);
      tick();
    }

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      if (io) io.disconnect();
      window.removeEventListener('pointermove', onPointer);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div className="hero3d__canvas" ref={ref} aria-hidden="true" />;
}
