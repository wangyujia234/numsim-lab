/** 多项式最小二乘拟合、图像自动采样、坐标映射 */

import { cubicSpline } from "./interpolate.js";
import { linspace, formatNum } from "../math.js";

function expandCenteredToRaw(centerCoef, mu, scale) {
  const m = centerCoef.length - 1;
  const raw = new Array(m + 1).fill(0);
  for (let k = 0; k <= m; k++) {
    const ck = centerCoef[k] / Math.pow(scale, k);
    for (let j = 0; j <= k; j++) {
      const comb = binom(k, j);
      raw[j] += ck * comb * Math.pow(-mu, k - j);
    }
  }
  return raw;
}

function binom(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export function polyfit(x, y, degree) {
  const n = x.length;
  const m = Math.min(degree, n - 1);
  if (n < 2) throw new Error("至少需要 2 个点才能拟合");

  // 中心化 + 缩放：把 Vandermonde 的条件数压下来，再转回原坐标系。
  const mu = x.reduce((s, v) => s + v, 0) / n;
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(x[i] - mu));
  scale = scale > 0 ? scale : 1;

  const A = Array.from({ length: m + 1 }, () => new Array(m + 1).fill(0));
  const b = new Array(m + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const zi = (x[i] - mu) / scale;
    const yi = y[i];
    const row = new Array(m + 1);
    row[0] = 1;
    for (let p = 1; p <= m; p++) row[p] = row[p - 1] * zi;
    for (let r = 0; r <= m; r++) {
      b[r] += row[r] * yi;
      for (let c = 0; c <= m; c++) A[r][c] += row[r] * row[c];
    }
  }
  const centerCoef = solveSymmetric(A, b);
  return expandCenteredToRaw(centerCoef, mu, scale);
}

function solveSymmetric(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    if (Math.abs(div) < 1e-14) {
      throw new Error("拟合方程组近似奇异，请降低多项式次数或增加采样点");
    }
    for (let j = col; j <= n; j++) M[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

export function polyval(coef, x) {
  let s = 0;
  for (let i = coef.length - 1; i >= 0; i--) s = s * x + coef[i];
  return s;
}

export function formatPoly(coef, digits = 4) {
  const parts = [];
  for (let i = coef.length - 1; i >= 0; i--) {
    const a = coef[i];
    if (Math.abs(a) < 1e-12) continue;
    const abs = Math.abs(a);
    const num =
      abs >= 1e3 || (abs > 0 && abs < 1e-2)
        ? a.toExponential(digits - 1)
        : Number(a.toPrecision(digits)).toString();
    let term;
    if (i === 0) term = num;
    else if (i === 1) term = `${num}*x`;
    else term = `${num}*x^${i}`;
    parts.push({ term, neg: a < 0, raw: term.replace(/^-/, "") });
  }
  if (!parts.length) return "0";
  return parts
    .map((p, idx) => {
      if (idx === 0) return p.term.startsWith("-") ? p.term : p.term;
      return p.term.startsWith("-") ? ` - ${p.raw}` : ` + ${p.raw}`;
    })
    .join("")
    .replace(/^\+ /, "");
}

export function rSquared(x, y, coef) {
  let meanS = 0;
  let meanC = 0;
  for (const v of y) {
    const t = meanS + v;
    if (Math.abs(meanS) >= Math.abs(v)) meanC += (meanS - t) + v;
    else meanC += (v - t) + meanS;
    meanS = t;
  }
  const mean = (meanS + meanC) / y.length;
  let ssRes = 0;
  let ssResC = 0;
  let ssTot = 0;
  let ssTotC = 0;
  for (let i = 0; i < y.length; i++) {
    const er = y[i] - polyval(coef, x[i]);
    const ev = er * er;
    const etr = ssRes + ev;
    if (Math.abs(ssRes) >= Math.abs(ev)) ssResC += (ssRes - etr) + ev;
    else ssResC += (ev - etr) + ssRes;
    ssRes = etr;
    const tv = y[i] - mean;
    const tvt = tv * tv;
    const ttr = ssTot + tvt;
    if (Math.abs(ssTot) >= Math.abs(tvt)) ssTotC += (ssTot - ttr) + tvt;
    else ssTotC += (tvt - ttr) + ssTot;
    ssTot = ttr;
  }
  ssRes += ssResC;
  ssTot += ssTotC;
  return ssTot < 1e-18 ? 1 : 1 - ssRes / ssTot;
}

export function rmse(x, y, coef) {
  let s = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) {
    const e = y[i] - polyval(coef, x[i]);
    const v = e * e;
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
    else c += (v - t) + s;
    s = t;
  }
  return Math.sqrt((s + c) / x.length);
}

export function autoSampleCurve(imageData, opts = {}) {
  const { width, height, data } = imageData;
  const step = opts.step || Math.max(2, Math.floor(width / 80));
  const margin = opts.margin ?? 0.06;
  const x0 = Math.floor(width * margin);
  const x1 = Math.floor(width * (1 - margin));
  const y0 = Math.floor(height * margin);
  const y1 = Math.floor(height * (1 - margin));

  let bg = 0;
  let cnt = 0;
  for (let i = 0; i < data.length; i += 40 * 4) {
    bg += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    cnt++;
  }
  bg /= Math.max(cnt, 1);
  const darkCurve = bg > 140;

  const pts = [];
  for (let px = x0; px <= x1; px += step) {
    let bestY = -1;
    let bestScore = darkCurve ? Infinity : -Infinity;
    for (let py = y0; py <= y1; py++) {
      const i = (py * width + px) * 4;
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (darkCurve) {
        if (g < bestScore) {
          bestScore = g;
          bestY = py;
        }
      } else if (g > bestScore) {
        bestScore = g;
        bestY = py;
      }
    }
    const thresh = darkCurve ? bg - 25 : bg + 25;
    const ok = darkCurve ? bestScore < thresh : bestScore > thresh;
    if (ok && bestY >= 0) pts.push({ px, py: bestY });
  }
  return pts;
}

export function pixelToData(px, py, meta) {
  const { width, height, xmin, xmax, ymin, ymax } = meta;
  const m = meta.margin ?? 0.06;
  const left = width * m;
  const right = width * (1 - m);
  const top = height * m;
  const bottom = height * (1 - m);
  const x = xmin + ((px - left) / Math.max(right - left, 1e-9)) * (xmax - xmin);
  const y = ymax - ((py - top) / Math.max(bottom - top, 1e-9)) * (ymax - ymin);
  return { x, y };
}

function sortUnique(x, y) {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = [];
  const ys = [];
  for (const i of idx) {
    if (xs.length && Math.abs(x[i] - xs[xs.length - 1]) < 1e-12) continue;
    xs.push(x[i]);
    ys.push(y[i]);
  }
  return { xs, ys };
}

function fourierEval(coef, K, omega, x0, x) {
  const t = omega * (x - x0);
  let s = coef[0];
  for (let k = 1; k <= K; k++) s += coef[2 * k - 1] * Math.cos(k * t) + coef[2 * k] * Math.sin(k * t);
  return s;
}

/** 岭正则化的三角最小二乘：返回系数与该频率下的残差平方和 */
function fourierLstsq(xs, ys, K, omega) {
  const n = xs.length;
  const cols = 1 + 2 * K;
  const A = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const b = new Array(cols).fill(0);
  for (let i = 0; i < n; i++) {
    const t = omega * (xs[i] - xs[0]);
    const row = new Array(cols);
    row[0] = 1;
    for (let k = 1; k <= K; k++) {
      row[2 * k - 1] = Math.cos(k * t);
      row[2 * k] = Math.sin(k * t);
    }
    for (let r = 0; r < cols; r++) {
      b[r] += row[r] * ys[i];
      for (let c = 0; c <= r; c++) A[r][c] += row[r] * row[c];
    }
  }
  for (let r = 0; r < cols; r++) for (let c = 0; c < r; c++) A[r][c] = A[c][r];
  let tr = 0;
  for (let i = 0; i < cols; i++) tr += A[i][i];
  const lambda = 1e-9 * (tr / cols + 1);
  for (let i = 0; i < cols; i++) A[i][i] += lambda;
  const coef = solveSymmetric(A, b);
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i] - fourierEval(coef, K, omega, xs[0], xs[i]);
    sse += e * e;
  }
  return { coef, sse };
}

/** 在给定 K 下对基频 ω 做对数网格搜索 + 局部细化 */
function fourierSearchOmega(xs, ys, K) {
  const L = Math.max(xs[xs.length - 1] - xs[0], 1e-9);
  const wMin = (2 * Math.PI) / (3 * L);
  const wMax = (8 * Math.PI) / L;
  const NC = 96;
  const ratio = wMax / wMin;
  let bestK = null;
  for (let i = 0; i < NC; i++) {
    const w = wMin * Math.pow(ratio, i / (NC - 1));
    let r;
    try {
      r = fourierLstsq(xs, ys, K, w);
    } catch {
      continue;
    }
    // 频率按升序扫描：新频率须显著更优（SSE 降 2%+）才替换，避免高频过拟合
    if (!bestK || r.sse < bestK.sse * 0.98) bestK = { ...r, K, omega: w };
  }
  if (!bestK) throw new Error("傅里叶频率搜索失败，请检查采样点");
  const step = Math.pow(ratio, 1 / (NC - 1));
  let best = bestK;
  for (let i = 0; i < 24; i++) {
    const w = bestK.omega * (1 / step + ((step - 1 / step) * i) / 23);
    try {
      const r = fourierLstsq(xs, ys, K, w);
      if (r.sse < best.sse) best = { ...r, K, omega: w };
    } catch {
      continue;
    }
  }
  return best;
}

/** BIC 自动选谐波数：用户设置值作为上限 */
function pickFourier(xs, ys, Kmax) {
  const n = xs.length;
  let best = null;
  for (let K = Kmax; K >= 1; K--) {
    const r = fourierSearchOmega(xs, ys, K);
    const bic = n * Math.log(Math.max(r.sse, 1e-300) / n) + (1 + 2 * K) * Math.log(n);
    if (!best || bic < best.bic - 1e-9) best = { ...r, bic };
  }
  return best;
}

function formatFourier(coef, K, omega) {
  const parts = [`${Number(coef[0].toPrecision(4))}`];
  for (let k = 1; k <= K; k++) {
    const a = coef[2 * k - 1];
    const b = coef[2 * k];
    if (Math.abs(a) > 1e-10) parts.push(`${a >= 0 ? "+" : "-"} ${Math.abs(Number(a.toPrecision(4)))}·cos(${k}ωx)`);
    if (Math.abs(b) > 1e-10) parts.push(`${b >= 0 ? "+" : "-"} ${Math.abs(Number(b.toPrecision(4)))}·sin(${k}ωx)`);
  }
  const T = (2 * Math.PI) / omega;
  return `y ≈ ${parts.join(" ")}  (基频 ω≈${formatNum(omega, 4)} rad/x，周期 T≈${formatNum(T, 4)}，K=${K})`;
}

export function runImageFit({ x, y, degree, method, nHarmonic }) {
  const { xs, ys } = sortUnique(x, y);
  if (xs.length < 2) throw new Error("采样点不足，请先在图像上取点或自动采样");

  const xmin = xs[0];
  const xmax = xs[xs.length - 1];
  const denseX = linspace(xmin, xmax, 300);
  let denseY;
  let coef = null;
  let equation;
  let deg = Math.max(1, Math.min(Number(degree) || 3, xs.length - 1, 8));
  let r2;
  let err;
  let omegaUsed = null;

  if (method === "fourier") {
    // 用户的输入 = 谐波数上限；用 BIC 在 [1, Kmax] 内自动选阶并搜索基频 ω
    const Kmax = Math.max(1, Math.min(Number(nHarmonic) || Number(degree) || 5, 8, Math.floor((xs.length - 1) / 2)));
    const { coef: fc, K: Kused, omega } = pickFourier(xs, ys, Kmax);
    const x0 = xs[0];
    coef = fc;
    omegaUsed = omega;
    denseY = denseX.map((xi) => fourierEval(fc, Kused, omega, x0, xi));
    equation = formatFourier(fc, Kused, omega);
    let s = 0, c = 0;
    for (let i = 0; i < xs.length; i++) {
      const e = ys[i] - fourierEval(fc, Kused, omega, x0, xs[i]);
      const v = e * e;
      const t = s + v;
      if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v; else c += (v - t) + s;
      s = t;
    }
    err = Math.sqrt((s + c) / xs.length);
    let meanS = 0, meanC = 0;
    for (const v of ys) { const t2 = meanS + v; if (Math.abs(meanS) >= Math.abs(v)) meanC += (meanS - t2) + v; else meanC += (v - t2) + meanS; meanS = t2; }
    const mean = (meanS + meanC) / ys.length;
    let ssRes = s + c, ssTot = 0, ssTotC = 0;
    for (let i = 0; i < ys.length; i++) { const tv = ys[i] - mean; const tvt = tv * tv; const ttr = ssTot + tvt; if (Math.abs(ssTot) >= Math.abs(tvt)) ssTotC += (ssTot - ttr) + tvt; else ssTotC += (tvt - ttr) + ssTot; ssTot = ttr; }
    ssTot += ssTotC;
    r2 = ssTot < 1e-18 ? 1 : 1 - (s + c) / ssTot;
  } else if (method === "spline" && xs.length >= 3) {
    denseY = cubicSpline(xs, ys, denseX);
    coef = polyfit(xs, ys, Math.min(deg, 5));
    equation = `样条拟合（多项式近似） y ≈ ${formatPoly(coef)}`;
    r2 = rSquared(xs, ys, coef);
    err = rmse(xs, ys, coef);
  } else {
    coef = polyfit(xs, ys, deg);
    equation = `y = ${formatPoly(coef)}`;
    denseY = denseX.map((xi) => polyval(coef, xi));
    r2 = rSquared(xs, ys, coef);
    err = rmse(xs, ys, coef);
  }

  const yRange = Math.max(...ys) - Math.min(...ys);
  let fitNote = "";
  if (method === "fourier" && omegaUsed != null) {
    const omega = omegaUsed;
    const Lspan = xmax - xmin;
    const wMin = (2 * Math.PI) / (3 * Math.max(Lspan, 1e-9));
    const wMax = (8 * Math.PI) / Math.max(Lspan, 1e-9);
    if (err > 0.12 * Math.max(yRange, 1e-12)) {
      fitNote =
        "截断傅里叶级数假设曲线在采样区间上近似周期。若曲线非周期、存在断裂/陡峭段，或谐波数不足，残差会偏大（吉布斯现象）：可尝试增大「谐波阶数」，或改用多项式/样条拟合。";
    } else if (omega <= wMin * 1.02) {
      fitNote = "基频取到搜索下界：曲线在采样区间内可能不足一个完整周期，周期拟合结果仅供参考。";
    } else if (omega >= wMax * 0.98) {
      fitNote = "基频达到搜索上界：曲线可能含高频成分或采样噪声，结果需谨慎解读。";
    }
  }

  return {
    sampleX: xs,
    sampleY: ys,
    denseX,
    denseY,
    coef,
    equation,
    degree: deg,
    method: method === "fourier" ? "fourier" : method === "spline" ? "spline" : "poly",
    nHarmonic: method === "fourier" ? (coef ? (coef.length - 1) / 2 : undefined) : undefined,
    omega: method === "fourier" ? omegaUsed : undefined,
    period: method === "fourier" && omegaUsed != null ? (2 * Math.PI) / omegaUsed : undefined,
    r2,
    rmse: err,
    ...(fitNote ? { fitNote } : {}),
  };
}
