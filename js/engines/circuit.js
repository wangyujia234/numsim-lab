import { linspace } from "../math.js";
import { rmseVec, maxAbsVec } from "./_numeric.js";

/** 串联 RLC 对阶跃电压的电流/电容电压（闭式 + RK4 验真） */
function seriesRLCStep({ R, L, C, V, tEnd = null, n = 800 }) {
  const alpha = R / (2 * L);
  const w0 = 1 / Math.sqrt(L * C);
  const tf = tEnd ?? Math.max(8 / Math.max(alpha, 1e-6), 10 * 2 * Math.PI / Math.max(w0, 1e-6));
  const t = linspace(0, tf, n);
  let regime;
  let i = new Array(n);
  let vc = new Array(n);

  const critTol = 1e-6 * Math.max(w0, alpha, 1e-12);

  if (alpha > w0 + critTol) {
    regime = "过阻尼";
    const d = Math.sqrt(alpha * alpha - w0 * w0);
    const s1 = -alpha + d;
    const s2 = -alpha - d;
    const A1 = V / (L * (s1 - s2));
    const A2 = -A1;
    for (let k = 0; k < n; k++) {
      const tk = t[k];
      i[k] = A1 * Math.exp(s1 * tk) + A2 * Math.exp(s2 * tk);
      // vc = (1/C) ∫ i，vc(0)=0；expm1 避免小 t 时 exp(s·t)-1 的对消
      vc[k] =
        (1 / C) *
        (A1 / s1 * Math.expm1(s1 * tk) + A2 / s2 * Math.expm1(s2 * tk));
    }
  } else if (Math.abs(alpha - w0) <= critTol) {
    regime = "临界阻尼";
    const vcScale = V / (L * C * alpha * alpha);
    for (let k = 0; k < n; k++) {
      const tk = t[k];
      i[k] = (V / L) * tk * Math.exp(-alpha * tk);
      // ∫_0^t τ e^{-ατ} dτ = (1 - e^{-αt}(αt+1))/α²
      // 1 - e^{-x}(1+x) = (e^x - 1 - x)·e^{-x}，用 expm1 避免小 x 对消
      const x = alpha * tk;
      const integ = (Math.expm1(x) - x) * Math.exp(-x);
      vc[k] = vcScale * integ;
    }
  } else {
    regime = "欠阻尼";
    const wd = Math.sqrt(Math.max(w0 * w0 - alpha * alpha, 0));
    const amp = V / (L * wd);
    const denom = w0 * w0;
    for (let k = 0; k < n; k++) {
      const tk = t[k];
      i[k] = amp * Math.exp(-alpha * tk) * Math.sin(wd * tk);
      // ∫ e^{-ατ} sin(wd τ) dτ，α²+wd² = w0²
      // = [ wd(1 - e^{-αt}cos(wd t)) - α e^{-αt} sin(wd t) ] / w0²
      // 其中 1 - e^{-αt}cos(wd t) = -expm1(-αt) + 2 e^{-αt} sin²(wd t/2)（小 t 稳定）
      const et = Math.exp(-alpha * tk);
      const oneMinus = -Math.expm1(-alpha * tk) + 2 * et * Math.sin((wd * tk) / 2) ** 2;
      const integ = (wd * oneMinus - alpha * et * Math.sin(wd * tk)) / denom;
      vc[k] = (amp / C) * integ;
    }
  }

  // RK4 数值验真：状态 [i, vc]，L i'=V-R i-vc，C vc'=i
  const iNum = new Array(n);
  const vcNum = new Array(n);
  iNum[0] = 0;
  vcNum[0] = 0;
  for (let k = 1; k < n; k++) {
    const dt = t[k] - t[k - 1];
    let ii = iNum[k - 1];
    let vv = vcNum[k - 1];
    const f = (curI, curV) => ({
      di: (V - R * curI - curV) / L,
      dv: curI / C,
    });
    const k1 = f(ii, vv);
    const k2 = f(ii + 0.5 * dt * k1.di, vv + 0.5 * dt * k1.dv);
    const k3 = f(ii + 0.5 * dt * k2.di, vv + 0.5 * dt * k2.dv);
    const k4 = f(ii + dt * k3.di, vv + dt * k3.dv);
    ii += (dt / 6) * (k1.di + 2 * k2.di + 2 * k3.di + k4.di);
    vv += (dt / 6) * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv);
    iNum[k] = ii;
    vcNum[k] = vv;
  }

  const rmseI = rmseVec(i, iNum);
  const rmseVc = rmseVec(vc, vcNum);
  const maxAbsI = maxAbsVec(i, iNum);
  const maxAbsVc = maxAbsVec(vc, vcNum);

  return {
    t,
    series: [
      { name: "电流 i(t)", x: t, y: i, ylabel: "A" },
      { name: "电容电压 vc(t)", x: t, y: vc, ylabel: "V" },
    ],
    metrics: {
      alpha,
      w0,
      regime,
      Ipeak: Math.max(...i.map(Math.abs)),
      tf,
      rmse_i_vs_rk4: rmseI,
      rmse_vc_vs_rk4: rmseVc,
      max_abs_i_vs_rk4: maxAbsI,
      max_abs_vc_vs_rk4: maxAbsVc,
    },
    rmseExact: rmseI,
    maxAbsExact: maxAbsI,
    errSource: "exact",
    analyticalNote: `vc 闭式解；与 RK4 验真 RMSE(i)≈${rmseI.toExponential(2)}，RMSE(vc)≈${rmseVc.toExponential(2)}`,
  };
}

function parallelRCDischarge({ R, C, V, n = 600 }) {
  const tau = R * C;
  const tf = 6 * tau;
  const t = linspace(0, tf, n);
  const v = t.map((tk) => V * Math.exp(-tk / tau));
  const i = t.map((tk) => (V / R) * Math.exp(-tk / tau));
  return {
    t,
    series: [
      { name: "电压 v(t)", x: t, y: v, ylabel: "V" },
      { name: "电流 i(t)", x: t, y: i, ylabel: "A" },
    ],
    metrics: { tau, tf, V0: V },
    analyticalNote: "并联 RC 放电为解析指数解",
    errSource: "exact",
  };
}

function seriesRLStep({ R, L, V, n = 600 }) {
  const tau = L / R;
  const tf = 6 * tau;
  const t = linspace(0, tf, n);
  const Iss = V / R;
  const i = t.map((tk) => Iss * (1 - Math.exp(-tk / tau)));
  return {
    t,
    series: [{ name: "电流 i(t)", x: t, y: i, ylabel: "A" }],
    metrics: { tau, Iss, tf },
    analyticalNote: "串联 RL 阶跃为解析指数解",
    errSource: "exact",
  };
}

function seriesRLCFreq({ R, L, C, n = 500 }) {
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const f = linspace(f0 / 20, f0 * 8, n);
  const mag = [];
  const phase = [];
  for (const fk of f) {
    const w = 2 * Math.PI * fk;
    const Zr = R;
    const Zim = w * L - 1 / (w * C);
    const Zmag = Math.hypot(Zr, Zim);
    mag.push(1 / Zmag);
    phase.push(Math.atan2(-Zim, Zr));
  }
  const phaseDeg = phase.map((p) => (p * 180) / Math.PI);
  return {
    t: f,
    series: [
      { name: "|Y(f)| = 1/|Z|", x: f, y: mag, ylabel: "S" },
      { name: "相位 (deg)", x: f, y: phaseDeg, ylabel: "deg" },
    ],
    metrics: {
      f0,
      Q: (1 / R) * Math.sqrt(L / C),
      BW: R / (2 * Math.PI * L),
    },
    analyticalNote: "频响由复数阻抗闭式计算",
    errSource: "exact",
  };
}

export function runCircuit(params) {
  const { topo, R, L, C, src } = params;
  switch (topo) {
    case "parallel_rc":
      return { ...parallelRCDischarge({ R, C, V: src }), topo };
    case "series_rl":
      return { ...seriesRLStep({ R, L, V: src }), topo };
    case "ac_rlc":
      return { ...seriesRLCFreq({ R, L, C }), topo };
    case "series_rlc":
    default:
      return { ...seriesRLCStep({ R, L, C, V: src }), topo };
  }
}
