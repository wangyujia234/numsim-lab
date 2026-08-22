import { linspace } from "../math.js";
import { thomas } from "./_numeric.js";

function sortedPairs(x, y) {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = idx.map((i) => x[i]);
  const ys = idx.map((i) => y[i]);
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - xs[i - 1]) < 1e-14) {
      throw new Error(`采样点 x 存在重复（约 ${xs[i]}），无法插值`);
    }
  }
  return { x: xs, y: ys };
}

export function lagrange(xs, ys, query) {
  const { x, y } = sortedPairs(xs, ys);
  const n = x.length;
  return query.map((xq) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      let li = 1;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        li *= (xq - x[j]) / (x[i] - x[j]);
      }
      s += y[i] * li;
    }
    return s;
  });
}

export function newtonDividedDiff(xs, ys, query) {
  const { x, y } = sortedPairs(xs, ys);
  const n = x.length;
  const coef = y.slice();
  for (let j = 1; j < n; j++) {
    for (let i = n - 1; i >= j; i--) {
      coef[i] = (coef[i] - coef[i - 1]) / (x[i] - x[i - j]);
    }
  }
  return query.map((xq) => {
    let s = coef[n - 1];
    for (let i = n - 2; i >= 0; i--) s = s * (xq - x[i]) + coef[i];
    return s;
  });
}

/** 自然三次样条（Thomas 三对角） */
export function cubicSpline(xs, ys, query) {
  const { x, y } = sortedPairs(xs, ys);
  const n = x.length;
  if (n < 3) return lagrange(x, y, query);

  const h = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) h[i] = x[i + 1] - x[i];

  // 求二阶矩 m：自然边界 m0=mn=0；内部三对角
  // h_{i-1} m_{i-1} + 2(h_{i-1}+h_i) m_i + h_i m_{i+1} = 6(Δy_i/h_i - Δy_{i-1}/h_{i-1})
  const m = new Array(n).fill(0);
  if (n === 3) {
    // 仅一个未知 m1
    const rhs = 6 * ((y[2] - y[1]) / h[1] - (y[1] - y[0]) / h[0]);
    const diag = 2 * (h[0] + h[1]);
    m[1] = rhs / diag;
  } else {
    const N = n - 2; // unknowns m1..m_{n-2}
    const a = new Array(N).fill(0);
    const b = new Array(N).fill(0);
    const c = new Array(N).fill(0);
    const d = new Array(N).fill(0);
    for (let i = 1; i <= n - 2; i++) {
      const k = i - 1;
      a[k] = h[i - 1];
      b[k] = 2 * (h[i - 1] + h[i]);
      c[k] = h[i];
      d[k] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
    }
    // 首行无下对角、末行无上对角（已由 a[0]/c[N-1] 自然边界吸收为 0 贡献）
    a[0] = 0;
    c[N - 1] = 0;
    const interior = thomas(a, b, c, d);
    for (let i = 0; i < N; i++) m[i + 1] = interior[i];
  }

  function evalAt(xq) {
    let k = 0;
    if (xq <= x[0]) k = 0;
    else if (xq >= x[n - 1]) k = n - 2;
    else {
      // 二分定位区间
      let lo = 0;
      let hi = n - 2;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (xq < x[mid]) hi = mid - 1;
        else if (xq > x[mid + 1]) lo = mid + 1;
        else {
          k = mid;
          break;
        }
      }
      if (lo > hi) k = Math.max(0, Math.min(n - 2, lo));
    }
    const hk = h[k];
    const t = xq - x[k];
    const ak = y[k];
    const ck = m[k] / 2;
    const dk = (m[k + 1] - m[k]) / (6 * hk);
    const bk = (y[k + 1] - y[k]) / hk - (hk * (2 * m[k] + m[k + 1])) / 6;
    return ak + bk * t + ck * t * t + dk * t * t * t;
  }

  return query.map(evalAt);
}

export function linearInterp(xs, ys, query) {
  const { x, y } = sortedPairs(xs, ys);
  return query.map((xq) => {
    if (xq <= x[0]) return y[0];
    if (xq >= x[x.length - 1]) return y[y.length - 1];
    let i = 0;
    while (i < x.length - 2 && x[i + 1] < xq) i++;
    const t = (xq - x[i]) / (x[i + 1] - x[i]);
    return y[i] * (1 - t) + y[i + 1] * t;
  });
}

export function runInterpolation({ x, y, query, method }) {
  const dense = linspace(Math.min(...x), Math.max(...x), 300);
  let yDense;
  let yQuery;
  switch (method) {
    case "lagrange":
      yDense = lagrange(x, y, dense);
      yQuery = lagrange(x, y, query);
      break;
    case "newton":
      yDense = newtonDividedDiff(x, y, dense);
      yQuery = newtonDividedDiff(x, y, query);
      break;
    case "linear":
      yDense = linearInterp(x, y, dense);
      yQuery = linearInterp(x, y, query);
      break;
    case "spline":
    default:
      yDense = cubicSpline(x, y, dense);
      yQuery = cubicSpline(x, y, query);
      break;
  }

  const note =
    method === "lagrange" && x.length >= 12
      ? "Lagrange 点数较多，可能出现 Runge 振荡；建议改用样条。"
      : method === "newton" && x.length >= 12
        ? "高次 Newton 插值可能数值不稳定；建议改用样条。"
        : "";

  return {
    denseX: dense,
    denseY: yDense,
    queryX: query,
    queryY: yQuery,
    sampleX: x,
    sampleY: y,
    ...(note ? { analyticalNote: note, rungeWarning: note } : {}),
  };
}
