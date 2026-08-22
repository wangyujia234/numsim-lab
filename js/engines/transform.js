/**
 * 积分变换：FFT、数值傅里叶变换、数值拉普拉斯变换
 */

import { compileExpr, linspace } from "../math.js";

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** 原地 Cooley–Tukey FFT，re/im 长度为 2 的幂 */
export function fftInPlace(re, im) {
  const n = re.length;
  if (n !== im.length) throw new Error("FFT 实部虚部长度不一致");
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error("FFT 长度须为 2 的幂");

  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
}

export function fft(signal) {
  const n0 = signal.length;
  const n = nextPow2(n0);
  const re = new Array(n).fill(0);
  const im = new Array(n).fill(0);
  for (let i = 0; i < n0; i++) re[i] = signal[i];
  fftInPlace(re, im);
  return { re, im, n, n0 };
}

function simpsonComplex(fRe, fIm, a, b, n) {
  if (n % 2 === 1) n += 1;
  const h = (b - a) / n;
  let sRe = fRe(a) + fRe(b);
  let sIm = fIm(a) + fIm(b);
  let cRe = 0;
  let cIm = 0;
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    const w = i % 2 === 0 ? 2 : 4;
    const vRe = w * fRe(x);
    const vIm = w * fIm(x);
    const tRe = sRe + vRe;
    if (Math.abs(sRe) >= Math.abs(vRe)) cRe += (sRe - tRe) + vRe;
    else cRe += (vRe - tRe) + sRe;
    sRe = tRe;
    const tIm = sIm + vIm;
    if (Math.abs(sIm) >= Math.abs(vIm)) cIm += (sIm - tIm) + vIm;
    else cIm += (vIm - tIm) + sIm;
    sIm = tIm;
  }
  return { re: (h / 3) * (sRe + cRe), im: (h / 3) * (sIm + cIm) };
}

/** 数值傅里叶 F(ω)=∫ f(t) e^{-jωt} dt */
export function numericalFourier(f, t0, tf, omegaGrid, nInt = 800) {
  const Fre = [];
  const Fim = [];
  const mag = [];
  const phase = [];
  for (const w of omegaGrid) {
    const fRe = (t) => f(t) * Math.cos(w * t);
    const fIm = (t) => -f(t) * Math.sin(w * t);
    const { re, im } = simpsonComplex(fRe, fIm, t0, tf, nInt);
    Fre.push(re);
    Fim.push(im);
    mag.push(Math.hypot(re, im));
    phase.push(Math.atan2(im, re));
  }
  return { Fre, Fim, mag, phase };
}

/** 数值拉普拉斯 F(s)=∫_0^{T} f(t) e^{-st} dt，s 可为实或复 */
export function numericalLaplace(f, T, sGrid, nInt = 800) {
  const Fre = [];
  const Fim = [];
  const mag = [];
  for (const s of sGrid) {
    const sigma = typeof s === "number" ? s : s.re;
    const omega = typeof s === "number" ? 0 : s.im;
    const fRe = (t) => f(t) * Math.exp(-sigma * t) * Math.cos(omega * t);
    const fIm = (t) => -f(t) * Math.exp(-sigma * t) * Math.sin(omega * t);
    const { re, im } = simpsonComplex(fRe, fIm, 0, T, nInt);
    Fre.push(re);
    Fim.push(im);
    mag.push(Math.hypot(re, im));
  }
  return { Fre, Fim, mag };
}

function peakFreq(freq, mag) {
  let best = 0;
  for (let i = 1; i < mag.length; i++) {
    if (mag[i] > mag[best]) best = i;
  }
  return { fPeak: freq[best], magPeak: mag[best], index: best };
}

export function runTransform(params) {
  const { method, expr, t0, tf, n, fMax, sigma } = params;
  const f = compileExpr(expr, ["t"]);
  const duration = Math.abs(tf - t0);
  if (duration <= 0) throw new Error("时间区间无效");

  if (method === "fft") {
    const N = nextPow2(Math.max(16, Math.floor(n) || 256));
    const dt = duration / N;
    const fs = 1 / dt;
    const t = linspace(t0, t0 + (N - 1) * dt, N);
    const signal = t.map((ti) => f(ti));
    const { re, im } = fft(signal);
    // 单边频谱（正频率）
    const half = N / 2;
    const freq = [];
    const mag = [];
    const phase = [];
    for (let k = 0; k <= half; k++) {
      freq.push((k * fs) / N);
      const m = Math.hypot(re[k], im[k]) / N;
      // DC 与 Nyquist 不乘 2，其余单边 ×2
      const scale = k === 0 || k === half ? 1 : 2;
      mag.push(m * scale);
      phase.push(Math.atan2(im[k], re[k]));
    }
    const pk = peakFreq(freq, mag);
    return {
      method: "fft",
      t,
      signal,
      freq,
      mag,
      phase,
      fs,
      N,
      dt,
      ...pk,
      title: `FFT 幅度谱（fs=${fs.toFixed(3)} Hz, N=${N}）`,
    };
  }

  if (method === "fourier") {
    const wMax = 2 * Math.PI * (fMax || 5);
    const omega = linspace(-wMax, wMax, Math.max(80, Math.floor(n) || 200));
    const { Fre, Fim, mag, phase } = numericalFourier(f, t0, tf, omega, 1000);
    const t = linspace(t0, tf, 400);
    const signal = t.map((ti) => f(ti));
    const freq = omega.map((w) => w / (2 * Math.PI));
    const pk = peakFreq(freq, mag);
    return {
      method: "fourier",
      t,
      signal,
      omega,
      freq,
      Fre,
      Fim,
      mag,
      phase,
      ...pk,
      title: "数值傅里叶变换 |F(f)|",
    };
  }

  // Laplace：沿 s=σ+jω 扫频，或实轴 σ
  const T = Math.max(tf, 1e-6);
  const sig = Number.isFinite(sigma) ? sigma : 0.5;
  const wMax = 2 * Math.PI * (fMax || 5);
  const omega = linspace(0, wMax, Math.max(80, Math.floor(n) || 200));
  const sGrid = omega.map((w) => ({ re: sig, im: w }));
  const { Fre, Fim, mag } = numericalLaplace(f, T, sGrid, 1200);
  const t = linspace(0, T, 400);
  const signal = t.map((ti) => f(ti));
  const freq = omega.map((w) => w / (2 * Math.PI));
  const pk = peakFreq(freq, mag);

  // 实轴采样若干点作表
  const sigmaAxis = linspace(0.1, Math.max(sig * 3, 3), 12);
  const realLap = numericalLaplace(
    f,
    T,
    sigmaAxis.map((s) => s),
    800
  );

  return {
    method: "laplace",
    t,
    signal,
    sigma: sig,
    omega,
    freq,
    Fre,
    Fim,
    mag,
    sigmaAxis,
    Fsigma: realLap.Fre,
    ...pk,
    title: `拉普拉斯 |F(σ+jω)|，σ=${sig}`,
  };
}
