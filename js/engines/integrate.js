import { compileExpr, linspace } from "../math.js";
import { richardsonError } from "./_numeric.js";

export function trapezoid(f, a, b, n) {
  const h = (b - a) / n;
  let s = 0.5 * (f(a) + f(b));
  let c = 0;
  for (let i = 1; i < n; i++) {
    const v = f(a + i * h);
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
    else c += (v - t) + s;
    s = t;
  }
  return (s + c) * h;
}

export function simpson(f, a, b, n) {
  if (n % 2 === 1) n += 1;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  let c = 0;
  for (let i = 1; i < n; i++) {
    const v = (i % 2 === 0 ? 2 : 4) * f(a + i * h);
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
    else c += (v - t) + s;
    s = t;
  }
  return (h / 3) * (s + c);
}

/** 单区间 Simpson（三点） */
function simpsonPanel(fa, fm, fb, h) {
  return (h / 6) * (fa + 4 * fm + fb);
}

/**
 * 自适应 Simpson：局部误差 |S - S_left - S_right| / 15
 * @returns {{ value: number, absErrEst: number, nEvals: number, errSource: string }}
 */
export function adaptiveSimpson(f, a, b, tol = 1e-8, maxDepth = 20) {
  let nEvals = 0;
  const evalF = (x) => {
    nEvals++;
    return f(x);
  };

  const fa0 = evalF(a);
  const fb0 = evalF(b);
  const fm0 = evalF((a + b) / 2);
  let absErrEst = 0;
  let absErrComp = 0;

  function rec(aa, bb, fa, fb, fm, whole, localTol, depth) {
    const m = (aa + bb) / 2;
    const h = bb - aa;
    const lm = (aa + m) / 2;
    const rm = (m + bb) / 2;
    const flm = evalF(lm);
    const frm = evalF(rm);
    const left = simpsonPanel(fa, flm, fm, h / 2);
    const right = simpsonPanel(fm, frm, fb, h / 2);
    const delta = left + right - whole;
    if (depth <= 0 || Math.abs(delta) <= 15 * localTol) {
      const ev = Math.abs(delta) / 15;
      const et = absErrEst + ev;
      if (Math.abs(absErrEst) >= Math.abs(ev)) absErrComp += (absErrEst - et) + ev;
      else absErrComp += (ev - et) + absErrEst;
      absErrEst = et;
      return left + right + delta / 15;
    }
    const halfTol = localTol / 2;
    return (
      rec(aa, m, fa, fm, flm, left, halfTol, depth - 1) +
      rec(m, bb, fm, fb, frm, right, halfTol, depth - 1)
    );
  }

  const h0 = b - a;
  const whole0 = simpsonPanel(fa0, fm0, fb0, h0);
  const value = rec(a, b, fa0, fb0, fm0, whole0, tol, maxDepth);
  return { value, absErrEst: absErrEst + absErrComp, nEvals, errSource: "adaptive" };
}

export function romberg(f, a, b, maxLevel = 8, tol = 1e-12) {
  const R = Array.from({ length: maxLevel }, () => new Array(maxLevel).fill(0));
  R[0][0] = trapezoid(f, a, b, 1);
  let lastK = 0;
  let lastJ = 0;
  let absErrEst = Infinity;

  for (let k = 1; k < maxLevel; k++) {
    R[k][0] = trapezoid(f, a, b, 2 ** k);
    for (let j = 1; j <= k; j++) {
      R[k][j] = R[k][j - 1] + (R[k][j - 1] - R[k - 1][j - 1]) / (4 ** j - 1);
    }
    lastK = k;
    lastJ = k;
    absErrEst = Math.abs(R[k][k] - R[k - 1][k - 1]);
    if (absErrEst < tol * (1 + Math.abs(R[k][k]))) break;
  }

  return {
    value: R[lastK][lastJ],
    table: R,
    level: lastK + 1,
    absErrEst,
    errSource: "richardson",
  };
}

export function runIntegration({ expr, a, b, n, method, tol }) {
  const f = compileExpr(expr, ["x"]);
  let value;
  let detail = {};
  let absErrEst = 0;
  let errSource = "richardson";
  let nEvals = null;

  switch (method) {
    case "trapezoid": {
      const n1 = Math.max(2, n);
      const n2 = n1 * 2;
      const c = trapezoid(f, a, b, n1);
      const fine = trapezoid(f, a, b, n2);
      value = fine;
      absErrEst = richardsonError(c, fine, 2);
      errSource = "richardson";
      nEvals = n2 + 1;
      break;
    }
    case "romberg": {
      detail = romberg(f, a, b, 8, tol ?? 1e-12);
      value = detail.value;
      absErrEst = detail.absErrEst;
      errSource = detail.errSource;
      break;
    }
    case "adaptive": {
      const ad = adaptiveSimpson(f, a, b, tol ?? 1e-8, 22);
      value = ad.value;
      absErrEst = ad.absErrEst;
      errSource = ad.errSource;
      nEvals = ad.nEvals;
      detail = { nEvals };
      break;
    }
    case "simpson":
    default: {
      let n1 = Math.max(2, n);
      if (n1 % 2 === 1) n1 += 1;
      const n2 = n1 * 2;
      const c = simpson(f, a, b, n1);
      const fine = simpson(f, a, b, n2);
      value = fine;
      absErrEst = richardsonError(c, fine, 4);
      errSource = "richardson";
      nEvals = n2 + 1;
      break;
    }
  }

  const xs = linspace(a, b, 400);
  const ys = xs.map((x) => f(x));

  return {
    value,
    xs,
    ys,
    a,
    b,
    absErrEst,
    errSource,
    nEvals,
    detail,
  };
}
