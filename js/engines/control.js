/**
 * 自动化 / 控制系统工程仿真
 * - 二阶系统阶跃（ζ–ωn）/ 传递函数阶跃 / PID / Bode / 直流电机
 * - 根轨迹 / 数值 Z 变换 / 离散 TF 阶跃 / Jury 判稳 / 极点配置 / 传感器标定
 */

import { linspace, formatNum } from "../math.js";

function parseCoeffList(text, fallback) {
  const s = String(text ?? "").trim();
  if (!s) return fallback.slice();
  return s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

/** 多项式求值（最高次在前，与 MATLAB poly 一致） */
function polyvalHighFirst(p, s) {
  let v = 0;
  for (let i = 0; i < p.length; i++) v = v * s + p[i];
  return v;
}

function evalTF(num, den, sRe, sIm) {
  // G(s) at s = sRe + j sIm，num/den 最高次在前
  const nRe = polyvalComplex(num, sRe, sIm);
  const dRe = polyvalComplex(den, sRe, sIm);
  const d2 = dRe.re * dRe.re + dRe.im * dRe.im;
  if (d2 < 1e-30) return { re: NaN, im: NaN, mag: Infinity, phase: 0 };
  const re = (nRe.re * dRe.re + nRe.im * dRe.im) / d2;
  const im = (nRe.im * dRe.re - nRe.re * dRe.im) / d2;
  return {
    re,
    im,
    mag: Math.hypot(re, im),
    phase: (Math.atan2(im, re) * 180) / Math.PI,
  };
}

function polyvalComplex(p, sr, si) {
  // Horner for complex s
  let re = 0;
  let im = 0;
  for (let i = 0; i < p.length; i++) {
    const nr = re * sr - im * si + p[i];
    const ni = re * si + im * sr;
    re = nr;
    im = ni;
  }
  return { re, im };
}

function normalizeTF(num, den) {
  if (!den.length) throw new Error("分母不能为空");
  const lead = den[0];
  if (Math.abs(lead) < 1e-14) throw new Error("分母首项系数不能为 0");
  return {
    num: num.map((c) => c / lead),
    den: den.map((c) => c / lead),
  };
}

/** 可控标准型：ẍ 形式，状态维 = den 阶次 */
function tfToSS(num, den) {
  const { num: b, den: a } = normalizeTF(num, den);
  const n = a.length - 1;
  if (n < 1) throw new Error("系统阶次至少为 1");
  // 使分子次数 < 分母：若相等则提出直通项
  let feedthrough = 0;
  let bb = b.slice();
  while (bb.length < a.length) bb.unshift(0);
  if (bb.length > a.length) throw new Error("分子阶次不能高于分母");
  if (bb.length === a.length) {
    feedthrough = bb[0];
    bb = bb.map((v, i) => v - feedthrough * a[i]);
    bb = bb.slice(1);
  } else {
    while (bb.length < n) bb.unshift(0);
  }
  // A companion, B = [0..1], C from bb reversed relative to states
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n - 1; i++) A[i][i + 1] = 1;
  for (let j = 0; j < n; j++) A[n - 1][j] = -a[n - j];
  const B = new Array(n).fill(0);
  B[n - 1] = 1;
  // C: for controllable canonical, C = [β0..β_{n-1}] where β from polynomial
  // bb is length n, highest leftover first corresponding to s^{n-1}..s^0
  const C = bb.slice().reverse(); // state x1..xn with C such that
  // Actually standard controllable form:
  // den = s^n + a1 s^{n-1}+...+an
  // num = b1 s^{n-1}+...+bn
  // C = [bn - an*b0, ..., b1 - a1*b0] with b0=feedthrough already removed
  // Our bb after removing feedthrough: length n, coeffs of s^{n-1}..s^0
  const Cstd = new Array(n);
  for (let i = 0; i < n; i++) {
    Cstd[i] = bb[n - 1 - i];
  }
  return { A, B, C: Cstd, D: feedthrough, n };
}

function matVec(M, x) {
  return M.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

function addScaled(x, k, dx) {
  return x.map((v, i) => v + k * dx[i]);
}

function frobeniusA(A) {
  let s = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A[i].length; j++) s += A[i][j] * A[i][j];
  }
  return Math.sqrt(s);
}

function rk4SSOnce(A, B, C, D, uFn, t0, tf, steps, x0) {
  const n = A.length;
  const h = (tf - t0) / steps;
  let x = x0 ? x0.slice() : new Array(n).fill(0);
  const t = [t0];
  const y = [C.reduce((s, c, i) => s + c * x[i], 0) + D * uFn(t0)];
  const u = [uFn(t0)];
  for (let k = 0; k < steps; k++) {
    const ti = t[k];
    const f = (tt, xx) => {
      const Ax = matVec(A, xx);
      const uu = uFn(tt);
      return Ax.map((v, i) => v + B[i] * uu);
    };
    const k1 = f(ti, x);
    const k2 = f(ti + h / 2, addScaled(x, h / 2, k1));
    const k3 = f(ti + h / 2, addScaled(x, h / 2, k2));
    const k4 = f(ti + h, addScaled(x, h, k3));
    x = x.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    const tt = ti + h;
    t.push(tt);
    const uu = uFn(tt);
    u.push(uu);
    y.push(C.reduce((s, c, i) => s + c * x[i], 0) + D * uu);
  }
  return { t, y, u, h, steps };
}

/**
 * 状态空间 RK4：按 ||A||F 估算步数，并用双步 Richardson 自动加密至相对误差达标
 */
function rk4SS(A, B, C, D, uFn, t0, tf, steps, x0) {
  const T = Math.abs(tf - t0) || 1;
  const normA = frobeniusA(A);
  // 经验：每时间单位至少 ~20*||A|| 步，且不少于请求步数
  let nSteps = Math.max(
    Math.floor(steps) || 400,
    Math.ceil(20 * normA * T),
    400
  );
  nSteps = Math.min(nSteps, 20000);

  const rtol = 1e-6;
  const atol = 1e-9;
  let sol = rk4SSOnce(A, B, C, D, uFn, t0, tf, nSteps, x0);
  let errEst = Infinity;
  let errSource = "richardson";

  for (let refine = 0; refine < 4; refine++) {
    const fine = rk4SSOnce(A, B, C, D, uFn, t0, tf, nSteps * 2, x0);
    const yC = sol.y[sol.y.length - 1];
    const yF = fine.y[fine.y.length - 1];
    errEst = Math.abs(yF - yC) / 15; // RK4 阶≈4 → 2^4-1=15
    const sc = atol + rtol * Math.max(Math.abs(yC), Math.abs(yF), 1);
    sol = fine;
    nSteps *= 2;
    if (errEst <= sc || nSteps >= 20000) break;
  }

  return { ...sol, errEst, errSource, stepsUsed: sol.steps };
}

function secondOrderStep({ zeta, wn, K = 1, tf = null, n = 800 }) {
  const z = Number(zeta);
  const w = Number(wn);
  if (!(w > 0)) throw new Error("自然频率 ωn 须为正");
  const T = tf ?? Math.max(8 / Math.max(z * w, 0.05 * w), 10 / w);
  const t = linspace(0, T, n);
  const y = new Array(n);
  let regime;
  if (z > 1) {
    regime = "过阻尼";
    const d = w * Math.sqrt(z * z - 1);
    const s1 = -z * w + d;
    const s2 = -z * w - d;
    for (let i = 0; i < n; i++) {
      const ti = t[i];
      y[i] = K * (1 - (s1 * Math.exp(s2 * ti) - s2 * Math.exp(s1 * ti)) / (s1 - s2));
    }
  } else if (Math.abs(z - 1) < 1e-6 * Math.max(1, Math.abs(z))) {
    regime = "临界阻尼";
    for (let i = 0; i < n; i++) {
      const ti = t[i];
      y[i] = K * (1 - Math.exp(-w * ti) * (1 + w * ti));
    }
  } else if (z >= 0) {
    regime = "欠阻尼";
    const wd = w * Math.sqrt(1 - z * z);
    const sigma = z * w;
    for (let i = 0; i < n; i++) {
      const ti = t[i];
      y[i] =
        K *
        (1 -
          Math.exp(-sigma * ti) *
            (Math.cos(wd * ti) + (sigma / wd) * Math.sin(wd * ti)));
    }
  } else {
    regime = "负阻尼（发散）";
    const wd = w * Math.sqrt(1 - z * z);
    for (let i = 0; i < n; i++) {
      const ti = t[i];
      y[i] = K * (1 - Math.exp(-z * w * ti) * Math.cos(wd * ti));
    }
  }
  const yFinal = y[y.length - 1];
  const yMax = Math.max(...y);
  const overshoot = K > 0 ? Math.max(0, ((yMax - K) / K) * 100) : 0;
  // 2% 调节时间粗估
  let ts = T;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(y[i] - K) > 0.02 * Math.abs(K || 1)) {
      ts = t[Math.min(i + 1, n - 1)];
      break;
    }
  }
  return {
    method: "second_order",
    t,
    series: [
      { name: "阶跃响应 y(t)", x: t, y, ylabel: "y" },
      { name: "参考 r=K", x: [0, T], y: [K, K], ylabel: "y" },
    ],
    metrics: {
      regime,
      zeta: z,
      wn: w,
      overshoot_pct: overshoot,
      ts_2pct: ts,
      y_final: yFinal,
      Mp: yMax,
    },
    title: `二阶系统阶跃 · ${regime} (ζ=${formatNum(z, 3)}, ωn=${formatNum(w, 3)})`,
  };
}

function tfStep({ num, den, tf = 10, n = 1000, amp = 1 }) {
  const { A, B, C, D } = tfToSS(num, den);
  const uFn = (t) => (t >= 0 ? amp : 0);
  const sol = rk4SS(A, B, C, D, uFn, 0, tf, n, null);
  const yInf = sol.y[sol.y.length - 1];
  return {
    method: "tf_step",
    t: sol.t,
    series: [
      { name: "y(t)", x: sol.t, y: sol.y, ylabel: "y" },
      { name: "u(t)", x: sol.t, y: sol.u, ylabel: "u" },
    ],
    metrics: {
      order: A.length,
      y_final: yInf,
      num: num.join(","),
      den: den.join(","),
      steps: sol.stepsUsed || sol.steps,
      err_est: sol.errEst,
      err_source: sol.errSource,
    },
    errEst: sol.errEst,
    errSource: sol.errSource,
    title: "传递函数阶跃响应",
  };
}

function pidClosedLoop(p) {
  const {
    Kp = 1,
    Ki = 0.5,
    Kd = 0.05,
    plant = "first", // first | second
    tau = 1,
    zeta = 0.5,
    wn = 2,
    K = 1,
    tf = 12,
    n = 4000,
    r = 1,
  } = p;

  // 扩展状态：植物状态 + 积分误差
  // 一阶：τẏ + y = K u
  // 二阶：ÿ + 2ζωnẏ + ωn² y = K ωn² u
  // PID: u = Kp e + Ki ∫e + Kd ė, e = r - y
  // 用 RK4 在增广状态上积分；ė ≈ -ẏ（r 常数）

  // 按对象时间尺度加密步数
  const tauScale = plant === "second" ? 1 / Math.max(wn, 0.05) : Math.max(tau, 0.05);
  const steps = Math.min(20000, Math.max(n, Math.ceil((40 * tf) / tauScale)));
  const h = tf / steps;
  let y = 0;
  let dy = 0;
  let integ = 0;
  const tArr = [0];
  const yArr = [0];
  const uArr = [0];
  const eArr = [r];

  const deriv = (yy, dyy, ii, tt) => {
    const e = r - yy;
    // ė = -ẏ
    const de = -dyy;
    const u = Kp * e + Ki * ii + Kd * de;
    let ydot;
    let yddot = 0;
    if (plant === "second") {
      ydot = dyy;
      yddot = K * wn * wn * u - 2 * zeta * wn * dyy - wn * wn * yy;
    } else {
      ydot = (K * u - yy) / Math.max(tau, 1e-9);
      yddot = 0;
    }
    const integDot = e;
    return { ydot, yddot, integDot, u, e };
  };

  for (let k = 0; k < steps; k++) {
    const tt = tArr[k];
    // RK4 on [y, dy, integ]
    const s0 = { y, dy, integ };
    const k1 = deriv(s0.y, s0.dy, s0.integ, tt);
    const k2 = deriv(
      s0.y + (h / 2) * k1.ydot,
      plant === "second" ? s0.dy + (h / 2) * k1.yddot : 0,
      s0.integ + (h / 2) * k1.integDot,
      tt + h / 2
    );
    const k3 = deriv(
      s0.y + (h / 2) * k2.ydot,
      plant === "second" ? s0.dy + (h / 2) * k2.yddot : 0,
      s0.integ + (h / 2) * k2.integDot,
      tt + h / 2
    );
    const k4 = deriv(
      s0.y + h * k3.ydot,
      plant === "second" ? s0.dy + h * k3.yddot : 0,
      s0.integ + h * k3.integDot,
      tt + h
    );

    y += (h / 6) * (k1.ydot + 2 * k2.ydot + 2 * k3.ydot + k4.ydot);
    if (plant === "second") {
      dy += (h / 6) * (k1.yddot + 2 * k2.yddot + 2 * k3.yddot + k4.yddot);
    } else {
      dy = (K * k4.u - y) / Math.max(tau, 1e-9);
    }
    integ += (h / 6) * (k1.integDot + 2 * k2.integDot + 2 * k3.integDot + k4.integDot);

    const last = deriv(y, dy, integ, tt + h);
    tArr.push(tt + h);
    yArr.push(y);
    uArr.push(last.u);
    eArr.push(last.e);
  }

  const yFinal = yArr[yArr.length - 1];
  const yMax = Math.max(...yArr);
  const overshoot = r !== 0 ? Math.max(0, ((yMax - r) / Math.abs(r)) * 100) : 0;

  return {
    method: "pid",
    t: tArr,
    series: [
      { name: "输出 y(t)", x: tArr, y: yArr, ylabel: "y" },
      { name: "控制量 u(t)", x: tArr, y: uArr, ylabel: "u" },
      { name: "参考 r", x: [0, tf], y: [r, r], ylabel: "y" },
    ],
    metrics: {
      Kp,
      Ki,
      Kd,
      plant,
      overshoot_pct: overshoot,
      y_final: yFinal,
      e_final: eArr[eArr.length - 1],
    },
    title: `PID 闭环阶跃 · 对象=${plant === "second" ? "二阶" : "一阶"}`,
  };
}

function bodePlot({ num, den, fMin = 0.01, fMax = 100, n = 400 }) {
  const freqs = [];
  const magDb = [];
  const phaseDeg = [];
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);
  for (let i = 0; i < n; i++) {
    const f = 10 ** (logMin + ((logMax - logMin) * i) / (n - 1));
    const w = 2 * Math.PI * f;
    const g = evalTF(num, den, 0, w);
    freqs.push(f);
    magDb.push(20 * Math.log10(Math.max(g.mag, 1e-16)));
    phaseDeg.push(g.phase);
  }
  // 增益穿越 / 相位裕度粗估
  let wg = null;
  let pm = null;
  for (let i = 1; i < magDb.length; i++) {
    if (magDb[i - 1] >= 0 && magDb[i] < 0) {
      const t = magDb[i - 1] / (magDb[i - 1] - magDb[i]);
      const f0 = freqs[i - 1] * (1 - t) + freqs[i] * t;
      const ph = phaseDeg[i - 1] * (1 - t) + phaseDeg[i] * t;
      wg = f0;
      pm = 180 + ph;
      break;
    }
  }
  return {
    method: "bode",
    t: freqs,
    series: [
      { name: "|G| (dB)", x: freqs, y: magDb, ylabel: "dB", logx: true },
      { name: "∠G (deg)", x: freqs, y: phaseDeg, ylabel: "deg", logx: true },
    ],
    metrics: {
      gain_crossover_Hz: wg,
      phase_margin_deg: pm,
      num: num.join(","),
      den: den.join(","),
    },
    title: "Bode 图（幅频 / 相频）",
  };
}

/** 他励直流电机：电枢电压阶跃 → 转速 */
function dcMotorStep({ Ra = 1, La = 0.5, Kt = 0.01, Kb = 0.01, J = 0.01, B = 0.1, Va = 12, tf = 5, n = 1200 }) {
  // La dia/dt = Va - Ra ia - Kb ω
  // J dω/dt = Kt ia - B ω
  const h = tf / n;
  let ia = 0;
  let w = 0;
  const t = [0];
  const iaArr = [0];
  const wArr = [0];
  for (let k = 0; k < n; k++) {
    const f = (iia, ww) => {
      const dia = (Va - Ra * iia - Kb * ww) / Math.max(La, 1e-9);
      const dw = (Kt * iia - B * ww) / Math.max(J, 1e-9);
      return { dia, dw };
    };
    const k1 = f(ia, w);
    const k2 = f(ia + (h / 2) * k1.dia, w + (h / 2) * k1.dw);
    const k3 = f(ia + (h / 2) * k2.dia, w + (h / 2) * k2.dw);
    const k4 = f(ia + h * k3.dia, w + h * k3.dw);
    ia += (h / 6) * (k1.dia + 2 * k2.dia + 2 * k3.dia + k4.dia);
    w += (h / 6) * (k1.dw + 2 * k2.dw + 2 * k3.dw + k4.dw);
    t.push((k + 1) * h);
    iaArr.push(ia);
    wArr.push(w);
  }
  return {
    method: "dc_motor",
    t,
    series: [
      { name: "转速 ω (rad/s)", x: t, y: wArr, ylabel: "rad/s" },
      { name: "电枢电流 ia (A)", x: t, y: iaArr, ylabel: "A" },
    ],
    metrics: {
      Va,
      w_final: wArr[wArr.length - 1],
      ia_final: iaArr[iaArr.length - 1],
      Ra,
      La,
      J,
      Kt,
    },
    title: "直流电机电压阶跃 · 转速 / 电流",
  };
}

/** 多项式根：伴随矩阵 + 带位移 QR（适合低阶根轨迹） */
function polyRoots(coeffsHighFirst) {
  let p = coeffsHighFirst.map(Number).filter((_, i, arr) => true);
  while (p.length > 1 && Math.abs(p[0]) < 1e-14) p = p.slice(1);
  if (p.length < 2) return [];
  const scale = p[0];
  p = p.map((c) => c / scale);
  const n = p.length - 1;
  if (n === 1) return [{ re: -p[1], im: 0 }];
  if (n === 2) {
    const [a, b, c] = [1, p[1], p[2]];
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return [
        { re: (-b + s) / 2, im: 0 },
        { re: (-b - s) / 2, im: 0 },
      ];
    }
    const s = Math.sqrt(-disc);
    return [
      { re: -b / 2, im: s / 2 },
      { re: -b / 2, im: -s / 2 },
    ];
  }
  // companion matrix (Frobenius)
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n - 1; i++) A[i][i + 1] = 1;
  for (let j = 0; j < n; j++) A[n - 1][j] = -p[n - j];
  return eigQR(A, 200);
}

function eigQR(A0, maxIter = 200) {
  const n = A0.length;
  let A = A0.map((r) => r.slice());
  // to Hessenberg
  for (let k = 0; k < n - 2; k++) {
    for (let i = k + 2; i < n; i++) {
      const a = A[k + 1][k];
      const b = A[i][k];
      const r = Math.hypot(a, b);
      if (r < 1e-15) continue;
      const c = a / r;
      const s = b / r;
      for (let j = k; j < n; j++) {
        const t = c * A[k + 1][j] + s * A[i][j];
        A[i][j] = -s * A[k + 1][j] + c * A[i][j];
        A[k + 1][j] = t;
      }
      for (let j = 0; j < n; j++) {
        const t = c * A[j][k + 1] + s * A[j][i];
        A[j][i] = -s * A[j][k + 1] + c * A[j][i];
        A[j][k + 1] = t;
      }
    }
  }
  for (let it = 0; it < maxIter; it++) {
    // Wilkinson shift from trailing 2x2
    let mu = A[n - 1][n - 1];
    if (n >= 2) {
      const a = A[n - 2][n - 2];
      const b = A[n - 2][n - 1];
      const c = A[n - 1][n - 2];
      const d = A[n - 1][n - 1];
      const tr = a + d;
      const det = a * d - b * c;
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det));
      const l1 = (tr + disc) / 2;
      const l2 = (tr - disc) / 2;
      mu = Math.abs(l1 - d) < Math.abs(l2 - d) ? l1 : l2;
    }
    // shifted QR via Givens on Hessenberg
    const shift = mu;
    for (let i = 0; i < n; i++) A[i][i] -= shift;
    for (let i = 0; i < n - 1; i++) {
      const a = A[i][i];
      const b = A[i + 1][i];
      const r = Math.hypot(a, b);
      if (r < 1e-15) continue;
      const c = a / r;
      const s = b / r;
      for (let j = i; j < n; j++) {
        const t = c * A[i][j] + s * A[i + 1][j];
        A[i + 1][j] = -s * A[i][j] + c * A[i + 1][j];
        A[i][j] = t;
      }
      for (let j = 0; j <= Math.min(i + 2, n - 1); j++) {
        const t = c * A[j][i] + s * A[j][i + 1];
        A[j][i + 1] = -s * A[j][i] + c * A[j][i + 1];
        A[j][i] = t;
      }
    }
    for (let i = 0; i < n; i++) A[i][i] += shift;
  }
  const roots = [];
  for (let i = 0; i < n; ) {
    if (i === n - 1 || Math.abs(A[i + 1][i]) < 1e-8 * (Math.abs(A[i][i]) + Math.abs(A[i + 1][i + 1]) + 1)) {
      roots.push({ re: A[i][i], im: 0 });
      i += 1;
    } else {
      const a = A[i][i];
      const b = A[i][i + 1];
      const c = A[i + 1][i];
      const d = A[i + 1][i + 1];
      const tr = a + d;
      const det = a * d - b * c;
      const disc = tr * tr - 4 * det;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        roots.push({ re: (tr + s) / 2, im: 0 });
        roots.push({ re: (tr - s) / 2, im: 0 });
      } else {
        const s = Math.sqrt(-disc);
        roots.push({ re: tr / 2, im: s / 2 });
        roots.push({ re: tr / 2, im: -s / 2 });
      }
      i += 2;
    }
  }
  return roots;
}

function padPoly(a, len) {
  const out = a.slice();
  while (out.length < len) out.unshift(0);
  return out;
}

function addPoly(a, b) {
  const n = Math.max(a.length, b.length);
  const A = padPoly(a, n);
  const B = padPoly(b, n);
  return A.map((v, i) => v + B[i]);
}

function scalePoly(a, k) {
  return a.map((v) => v * k);
}

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

/** 根轨迹：1 + K G(s)=0，G=num/den */
function rootLocus({ num, den, kMin = 0, kMax = 50, nK = 200 }) {
  const { num: b, den: a } = normalizeTF(num, den);
  const bn = padPoly(b, a.length);
  const Ks = linspace(kMin, kMax, nK);
  const nP = a.length - 1;
  const branches = Array.from({ length: nP }, () => ({ re: [], im: [], K: [] }));
  const openPoles = polyRoots(a);
  let zeroPts = [];
  if (b.length >= 2) {
    try {
      zeroPts = polyRoots(b);
    } catch {
      zeroPts = [];
    }
  }

  for (const K of Ks) {
    const charP = addPoly(a, scalePoly(bn, K));
    let rts = [];
    try {
      rts = polyRoots(charP);
    } catch {
      continue;
    }
    rts.sort((p, q) => p.im - q.im || p.re - q.re);
    for (let i = 0; i < branches.length; i++) {
      const r = rts[i] || { re: NaN, im: NaN };
      branches[i].re.push(r.re);
      branches[i].im.push(r.im);
      branches[i].K.push(K);
    }
  }

  const series = branches.map((br, i) => ({
    name: `分支 ${i + 1}`,
    x: br.re,
    y: br.im,
    mode: "lines",
    ylabel: "Im",
    customdata: br.K,
  }));
  series.push({
    name: "开环极点",
    x: openPoles.map((p) => p.re),
    y: openPoles.map((p) => p.im),
    mode: "markers",
    markerSymbol: "x",
    ylabel: "Im",
  });
  if (zeroPts.length) {
    series.push({
      name: "开环零点",
      x: zeroPts.map((p) => p.re),
      y: zeroPts.map((p) => p.im),
      mode: "markers",
      markerSymbol: "circle-open",
      ylabel: "Im",
    });
  }

  return {
    method: "rlocus",
    t: Ks,
    series,
    metrics: {
      kMin,
      kMax,
      nPoles: openPoles.length,
      open_poles: openPoles
        .map((p) => `${p.re.toFixed(3)}${p.im >= 0 ? "+" : ""}${p.im.toFixed(3)}j`)
        .join("; "),
    },
    title: "根轨迹（随 K 变化的闭环极点）",
    plotKind: "rlocus",
  };
}

/** 数值 Z：对 f[n]=f(nT) 在单位圆上求 F(e^{jω}) */
function zTransformFreq({ seq, T = 0.1 }) {
  const N = seq.length;
  const nW = 256;
  const omega = linspace(0, Math.PI, nW); // rad/sample
  const mag = [];
  const phase = [];
  const freqHz = [];
  for (const w of omega) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      re += seq[n] * Math.cos(w * n);
      im -= seq[n] * Math.sin(w * n);
    }
    mag.push(Math.hypot(re, im));
    phase.push((Math.atan2(im, re) * 180) / Math.PI);
    freqHz.push(w / (2 * Math.PI * T)); // Hz if T in seconds
  }
  return {
    method: "z_transform",
    t: omega,
    series: [
      { name: "|F(e^{jω})|", x: omega, y: mag, ylabel: "|F|" },
      { name: "∠F (deg)", x: omega, y: phase, ylabel: "deg" },
    ],
    seq,
    seqT: Array.from({ length: N }, (_, i) => i * T),
    metrics: {
      T,
      N,
      f_peak_rad: omega[mag.indexOf(Math.max(...mag))],
      max_mag: Math.max(...mag),
    },
    title: `数值 Z 变换（单位圆）· T=${T}`,
    plotKind: "z_transform",
  };
}

function transpose(M) {
  return M[0].map((_, j) => M.map((row) => row[j]));
}

function polyMatEval(A, polyHighFirst) {
  // poly = a0 s^n + ... + an  -> a0 A^n + ... + an I
  const n = A.length;
  let Acc = eye(n);
  let out = zeros(n);
  // evaluate from high degree
  for (let k = 0; k < polyHighFirst.length; k++) {
    if (k > 0) Acc = matMul(Acc, A); // wait Horner better
  }
  // Horner: ((a0 A + a1)I A + a2)...
  out = scaleMat(eye(n), polyHighFirst[0]);
  for (let k = 1; k < polyHighFirst.length; k++) {
    out = matAdd(matMul(out, A), scaleMat(eye(n), polyHighFirst[k]));
  }
  return out;
}

function eye(n) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}
function zeros(n) {
  return Array.from({ length: n }, () => new Array(n).fill(0));
}
function scaleMat(M, s) {
  return M.map((row) => row.map((v) => v * s));
}
function matAdd(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}
function matMul(A, B) {
  const n = A.length;
  const m = B[0].length;
  const p = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      for (let j = 0; j < m; j++) C[i][j] += A[i][k] * B[k][j];
    }
  }
  return C;
}

function invertMatrix(A) {
  const n = A.length;
  const M = A.map((row, i) => row.concat(eye(n)[i]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    if (Math.abs(div) < 1e-12) throw new Error("矩阵奇异（可能不可控）");
    for (let j = 0; j < 2 * n; j++) M[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    if (Math.abs(div) < 1e-12) throw new Error("线性方程组奇异");
    for (let j = col; j <= n; j++) M[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

function parseMatrix(text, rows, cols) {
  const nums = String(text)
    .split(/[,，\s;；]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (nums.length !== rows * cols || nums.some((x) => !Number.isFinite(x))) {
    throw new Error(`矩阵需要 ${rows * cols} 个数字（按行展开）`);
  }
  const M = [];
  for (let i = 0; i < rows; i++) M.push(nums.slice(i * cols, (i + 1) * cols));
  return M;
}

function parsePoles(text) {
  // " -1,-2 " or "-1±2j" pairs simplified: comma-separated reals, or a±bj
  const s = String(text).replace(/\s+/g, "");
  const poles = [];
  const pairRe = /([+-]?\d*\.?\d+)([+-]\d*\.?\d+)j/gi;
  let m;
  const used = new Set();
  while ((m = pairRe.exec(s))) {
    const re = Number(m[1]);
    const im = Number(m[2]);
    poles.push(re + im * 0); // store real part only in first version for Ackermann real poly
    // For complex: use quadratic factors — convert to real companion by storing as complex
    poles.pop();
    poles.push({ re, im });
    poles.push({ re, im: -im });
    used.add(m[0]);
  }
  // remaining reals
  const rest = s
    .replace(pairRe, ",")
    .split(/[,，]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const x of rest) {
    if (/j/i.test(x)) continue;
    const v = Number(x);
    if (Number.isFinite(v)) poles.push(v);
  }
  return poles;
}

function desiredCharPolyFromPoles(poles) {
  let poly = [1];
  const used = new Array(poles.length).fill(false);
  for (let i = 0; i < poles.length; i++) {
    if (used[i]) continue;
    const p = poles[i];
    if (typeof p === "number") {
      poly = polyMul(poly, [1, -p]);
      used[i] = true;
    } else {
      // find conjugate
      let j = i + 1;
      for (; j < poles.length; j++) {
        if (!used[j] && typeof poles[j] !== "number" && Math.abs(poles[j].re - p.re) < 1e-9 && Math.abs(poles[j].im + p.im) < 1e-9) break;
      }
      if (j >= poles.length) throw new Error("复极点须共轭成对");
      used[i] = used[j] = true;
      // (s-p)(s-p̄) = s^2 - 2re s + (re^2+im^2)
      poly = polyMul(poly, [1, -2 * p.re, p.re * p.re + p.im * p.im]);
    }
  }
  return poly;
}

function polePlacement(params) {
  const n = Math.max(1, Math.floor(Number(params.order) || 2));
  const A = parseMatrix(params.A, n, n);
  const Bflat = parseCoeffList(params.B, n === 2 ? [0, 1] : [0, 0, 1]);
  if (Bflat.length !== n) throw new Error(`B 需要 ${n} 个元素`);
  const poles = parsePoles(params.poles || "-2,-3");
  if (poles.length !== n) throw new Error(`期望极点个数须为 ${n}（复极点算两个）`);

  const charP = desiredCharPolyFromPoles(poles);
  // Ackermann
  const ctrbCols = [];
  let v = Bflat.slice();
  for (let k = 0; k < n; k++) {
    ctrbCols.push(v.slice());
    v = matVec(A, v);
  }
  const Cc = Array.from({ length: n }, (_, i) => ctrbCols.map((col) => col[i]));
  const en = new Array(n).fill(0);
  en[n - 1] = 1;
  const CcT = transpose(Cc);
  const w = solveLinear(CcT, en);
  const alphaA = polyMatEval(A, charP);
  const K = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) K[j] += w[i] * alphaA[i][j];
  }

  // closed loop A-BK
  const BK = Bflat.map((bi) => K.map((kj) => bi * kj));
  const Acl = A.map((row, i) => row.map((aij, j) => aij - BK[i][j]));
  const clPoles = polyRoots(charPolyFromCompanionLike(Acl));

  // step response with C=[1,0,...], D=0, u = N r - Kx
  // N 取单位直流增益预补偿：N = 1 / (−C Acl^{-1} B)
  const C = new Array(n).fill(0);
  C[0] = 1;
  let Nbar = 1;
  try {
    const AinvB = solveLinear(Acl, Bflat);
    let dc = 0;
    for (let i = 0; i < n; i++) dc -= C[i] * AinvB[i];
    if (Math.abs(dc) > 1e-12) Nbar = 1 / dc;
  } catch {
    Nbar = 1;
  }
  const tf = Number(params.tf) || 8;
  const steps = Math.max(400, Math.floor(Number(params.n) || 1000));
  const sol = rk4SS(Acl, Bflat, C, 0, () => Nbar, 0, tf, steps, null);

  return {
    method: "pole_place",
    t: sol.t,
    series: [
      { name: "y(t) 闭环阶跃", x: sol.t, y: sol.y, ylabel: "y" },
      { name: "参考 r=1", x: [0, tf], y: [1, 1], ylabel: "y" },
    ],
    metrics: {
      K: K.map((v) => Number(v.toPrecision(4))).join(", "),
      Nbar: Number(Nbar.toPrecision(4)),
      closed_poles: clPoles.map((p) => `${p.re.toFixed(3)}${p.im >= 0 ? "+" : ""}${p.im.toFixed(3)}j`).join("; "),
      desired: String(params.poles),
      y_final: sol.y[sol.y.length - 1],
    },
    title: "状态反馈极点配置 · 闭环阶跃",
    plotKind: "time",
  };
}

function charPolyFromCompanionLike(A) {
  // characteristic poly via Faddeev–LeVerrier or eigenvalue through polyRoots of det(sI-A)
  // For n<=3 use direct; general: Leverrier
  const n = A.length;
  let I = eye(n);
  let M = eye(n);
  const coeffs = new Array(n + 1).fill(0);
  coeffs[0] = 1;
  for (let k = 1; k <= n; k++) {
    const AM = matMul(A, M);
    let ck = 0;
    for (let i = 0; i < n; i++) ck += AM[i][i];
    ck *= -1 / k;
    coeffs[k] = ck;
    M = matAdd(AM, scaleMat(I, ck));
  }
  return coeffs;
}

function sensorCalibrate({ xref, ymeas, degree = 1 }) {
  const x = parseCoeffList(xref, []);
  const y = parseCoeffList(ymeas, []);
  if (x.length !== y.length || x.length < 2) throw new Error("参考值与测量值数量须一致且≥2");
  const deg = Math.max(1, Math.min(Number(degree) || 1, x.length - 1, 5));
  // 中心化 x（减去均值）再建正规方程，显著改善高次拟合的条件数
  const mu = x.reduce((s, v) => s + v, 0) / x.length;
  const xc = x.map((xi) => xi - mu);
  const m = deg;
  const A = Array.from({ length: m + 1 }, () => new Array(m + 1).fill(0));
  const b = new Array(m + 1).fill(0);
  for (let i = 0; i < x.length; i++) {
    const row = [1];
    for (let p = 1; p <= m; p++) row[p] = row[p - 1] * xc[i];
    for (let r = 0; r <= m; r++) {
      b[r] += row[r] * y[i];
      for (let c = 0; c <= m; c++) A[r][c] += row[r] * row[c];
    }
  }
  const coefC = solveLinear(A, b); // 低次在前，(x-μ) 幂的系数
  // 用中心化基求值（避免展开回原坐标时的对消）
  const evalC = (xi) => {
    const z = xi - mu;
    let s = 0;
    for (let k = m; k >= 0; k--) s = s * z + coefC[k];
    return s;
  };
  const yhat = x.map(evalC);
  const mean = y.reduce((a, v) => a + v, 0) / y.length;
  let ssRes = 0;
  let ssTot = 0;
  let maxErr = 0;
  for (let i = 0; i < y.length; i++) {
    const e = y[i] - yhat[i];
    ssRes += e * e;
    ssTot += (y[i] - mean) ** 2;
    maxErr = Math.max(maxErr, Math.abs(e));
  }
  const r2 = ssTot < 1e-18 ? 1 : 1 - ssRes / ssTot;
  const xd = linspace(Math.min(...x), Math.max(...x), 100);
  const yd = xd.map(evalC);
  const eq =
    m === 1
      ? `y = ${evalC(mu).toPrecision(4)} + ${coefC[1].toPrecision(4)}·(x-${mu.toPrecision(6)})`
      : `y = ${Array.from({ length: m + 1 }, (_, k) => {
          const term = `${coefC[k].toPrecision(4)}·(x-${mu.toPrecision(6)})^${k}`;
          return term;
        })
          .reverse()
          .join(" + ")}`;

  return {
    method: "sensor_cal",
    t: xd,
    series: [
      { name: "标定曲线", x: xd, y: yd, ylabel: "测量" },
      { name: "标定数据", x, y, mode: "markers", ylabel: "测量" },
    ],
    metrics: {
      equation: eq,
      sensitivity: m >= 1 ? coefC[1] : coefC[0],
      offset: evalC(0),
      R2: r2,
      max_abs_error: maxErr,
      degree: m,
      N: x.length,
    },
    title: "传感器标定 · 最小二乘拟合",
    plotKind: "sensor",
  };
}

/** Jury 表判稳：特征多项式 a0 z^n + … + an（最高次在前） */
function juryStability(denRaw) {
  let a = denRaw.map(Number).filter(Number.isFinite);
  if (a.length < 2) throw new Error("特征多项式至少 1 阶");
  while (a.length > 2 && Math.abs(a[0]) < 1e-14) a = a.slice(1);
  const n = a.length - 1;
  const F1 = polyvalHighFirst(a, 1);
  const Fm1 = polyvalHighFirst(a, -1);
  const condF1 = F1 > 0;
  const condFm1 = ((-1) ** n) * Fm1 > 0;
  const condAn = Math.abs(a[n]) < Math.abs(a[0]);

  const table = [a.slice()];
  const rowChecks = [];
  let stable = condF1 && condFm1 && condAn;
  let failReason = "";
  if (!condF1) failReason = "F(1)≤0";
  else if (!condFm1) failReason = "(-1)^n F(-1)≤0";
  else if (!condAn) failReason = "|an|≥|a0|";

  // b_k = (α0·α_{k+1} − α_m·α_{m-1-k}) / α0 ，并要求每行 |α0| > |α_m|
  let row = a.slice();
  while (row.length > 2) {
    const m = row.length - 1;
    const r0 = row[0];
    const rm = row[m];
    const checkOk = Math.abs(r0) > Math.abs(rm);
    rowChecks.push({ absFirst: Math.abs(r0), absLast: Math.abs(rm), ok: checkOk });
    if (!checkOk) {
      stable = false;
      if (!failReason) {
        failReason = `Jury 行 |α0|=${Math.abs(r0).toFixed(4)} ≤ |αm|=${Math.abs(rm).toFixed(4)}`;
      }
    }
    if (Math.abs(r0) < 1e-14) {
      stable = false;
      if (!failReason) failReason = "Jury 表首元为 0";
      break;
    }
    const next = [];
    for (let k = 0; k < m; k++) {
      next.push((r0 * row[k + 1] - rm * row[m - 1 - k]) / r0);
    }
    table.push(next.slice());
    row = next;
  }

  return {
    method: "jury",
    t: [0, 1],
    series: [
      {
        name: "单位圆",
        x: Array.from({ length: 129 }, (_, i) => Math.cos((2 * Math.PI * i) / 128)),
        y: Array.from({ length: 129 }, (_, i) => Math.sin((2 * Math.PI * i) / 128)),
        mode: "lines",
        ylabel: "Im",
      },
    ],
    metrics: {
      poly: a.join(", "),
      F_at_1: F1,
      F_at_m1: Fm1,
      cond_F1: condF1,
      cond_Fm1: condFm1,
      cond_abs_an: condAn,
      jury_stable: stable,
      fail_reason: failReason || "无",
      row_checks: rowChecks.map((c, i) => `R${i}:${c.ok ? "OK" : "FAIL"}`).join("; ") || "n≤1",
    },
    title: `Jury 判稳 · ${stable ? "渐近稳定" : "不稳定 / 临界"}`,
    plotKind: "jury",
    table,
  };
}

/** 离散传递函数 H(z)=num/den 单位阶跃响应 + Jury 判稳 */
function zTfStep({ num, den, N = 80, amp = 1 }) {
  const b = num.map(Number).filter(Number.isFinite);
  const a = den.map(Number).filter(Number.isFinite);
  if (!a.length || Math.abs(a[0]) < 1e-14) throw new Error("分母首项系数不能为 0");
  while (b.length < a.length) b.unshift(0);
  if (b.length > a.length) throw new Error("分子阶次不能高于分母");
  const n = a.length - 1;
  const M = Math.max(20, Math.floor(Number(N) || 80));
  const y = new Array(M).fill(0);
  const u = new Array(M).fill(amp);
  const kArr = Array.from({ length: M }, (_, i) => i);
  for (let k = 0; k < M; k++) {
    let s = 0;
    for (let i = 0; i < b.length; i++) {
      const ui = k - i >= 0 ? u[k - i] : 0;
      s += b[i] * ui;
    }
    for (let j = 1; j < a.length; j++) {
      const yj = k - j >= 0 ? y[k - j] : 0;
      s -= a[j] * yj;
    }
    y[k] = s / a[0];
  }
  const jury = juryStability(a);
  return {
    method: "z_tf_step",
    t: kArr,
    series: [
      { name: "y[k]", x: kArr, y, ylabel: "y" },
      { name: "u[k]", x: kArr, y: u, ylabel: "u" },
    ],
    metrics: {
      order: n,
      N: M,
      y_final: y[y.length - 1],
      num: b.join(","),
      den: a.join(","),
      jury_stable: jury.metrics.jury_stable,
      jury_note: jury.metrics.fail_reason,
    },
    title: `离散 TF 阶跃 · Jury: ${jury.metrics.jury_stable ? "稳定" : "不稳定"}`,
    plotKind: "z_tf_step",
  };
}

export function runControl(params) {
  const method = params.method || "second_order";
  if (method === "second_order") {
    return secondOrderStep({
      zeta: Number(params.zeta),
      wn: Number(params.wn),
      K: Number(params.K) || 1,
      tf: Number(params.tf) || null,
      n: Math.max(200, Math.floor(Number(params.n) || 800)),
    });
  }
  if (method === "tf_step") {
    const num = parseCoeffList(params.num, [1]);
    const den = parseCoeffList(params.den, [1, 1]);
    return tfStep({
      num,
      den,
      tf: Number(params.tf) || 10,
      n: Math.max(200, Math.floor(Number(params.n) || 1000)),
      amp: Number(params.amp) || 1,
    });
  }
  if (method === "pid") {
    return pidClosedLoop({
      Kp: Number(params.Kp),
      Ki: Number(params.Ki),
      Kd: Number(params.Kd),
      plant: params.plant || "first",
      tau: Number(params.tau) || 1,
      zeta: Number(params.zeta) || 0.5,
      wn: Number(params.wn) || 2,
      K: Number(params.K) || 1,
      tf: Number(params.tf) || 12,
      n: Math.max(400, Math.floor(Number(params.n) || 2000)),
      r: Number(params.r) || 1,
    });
  }
  if (method === "bode") {
    const num = parseCoeffList(params.num, [1]);
    const den = parseCoeffList(params.den, [1, 1, 1]);
    return bodePlot({
      num,
      den,
      fMin: Number(params.fMin) || 0.01,
      fMax: Number(params.fMax) || 100,
      n: Math.max(100, Math.floor(Number(params.n) || 400)),
    });
  }
  if (method === "dc_motor") {
    return dcMotorStep({
      Ra: Number(params.Ra) || 1,
      La: Number(params.La) || 0.5,
      Kt: Number(params.Kt) || 0.01,
      Kb: Number(params.Kb) || 0.01,
      J: Number(params.J) || 0.01,
      B: Number(params.B) || 0.1,
      Va: Number(params.Va) || 12,
      tf: Number(params.tf) || 5,
      n: Math.max(400, Math.floor(Number(params.n) || 1200)),
    });
  }
  if (method === "rlocus") {
    return rootLocus({
      num: parseCoeffList(params.num, [1]),
      den: parseCoeffList(params.den, [1, 3, 2]),
      kMin: Number(params.kMin) || 0,
      kMax: Number(params.kMax) || 50,
      nK: Math.max(50, Math.floor(Number(params.nK) || 200)),
    });
  }
  if (method === "z_transform") {
    const T = Number(params.T) || 0.1;
    const N = Math.max(8, Math.floor(Number(params.zN) || 64));
    // sequence: from comma list or generate exp(-a n T)*sin
    let seq = parseCoeffList(params.seq, []);
    if (seq.length < 2) {
      const a = Number(params.zAlpha) || 0.3;
      const f0 = Number(params.zFreq) || 1.5;
      seq = Array.from({ length: N }, (_, n) => Math.exp(-a * n * T) * Math.sin(2 * Math.PI * f0 * n * T));
    }
    return zTransformFreq({ seq, T });
  }
  if (method === "z_tf_step") {
    return zTfStep({
      num: parseCoeffList(params.num, [0.2]),
      den: parseCoeffList(params.den, [1, -0.7]),
      N: Math.max(20, Math.floor(Number(params.zN) || 80)),
      amp: Number(params.amp) || 1,
    });
  }
  if (method === "jury") {
    return juryStability(parseCoeffList(params.den, [1, -1.5, 0.7]));
  }
  if (method === "pole_place") {
    return polePlacement(params);
  }
  if (method === "sensor_cal") {
    return sensorCalibrate({
      xref: params.xref || "0,1,2,3,4,5",
      ymeas: params.ymeas || "0.1,1.05,1.95,3.1,3.9,5.2",
      degree: Number(params.calDegree) || 1,
    });
  }
  throw new Error(`未知控制仿真类型: ${method}`);
}

export { parseCoeffList };
