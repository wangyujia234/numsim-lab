import { compileExpr, formatNum } from "./math.js";

function rmse(a, b) {
  if (!a?.length || a.length !== b.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

function maxAbs(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** 常见被积函数的解析定积分（失败返回 null） */
export function exactIntegral(expr, a, b) {
  const e = String(expr || "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const F = (() => {
    if (e === "sin(x)") return (x) => -Math.cos(x);
    if (e === "cos(x)") return (x) => Math.sin(x);
    if (e === "cos(2*x)") return (x) => Math.sin(2 * x) / 2;
    if (e === "sin(2*x)") return (x) => -Math.cos(2 * x) / 2;
    if (e === "exp(-x)" || e === "e^(-x)") return (x) => -Math.exp(-x);
    if (e === "exp(x)" || e === "e^(x)") return (x) => Math.exp(x);
    if (e === "x*exp(-x)" || e === "exp(-x)*x") {
      return (x) => -Math.exp(-x) * (x + 1);
    }
    if (e === "1/(1+x*x)" || e === "1/(1+x**2)" || e === "1/(1+x^2)") {
      return (x) => Math.atan(x);
    }
    if (e === "1" || e === "1.0") return (x) => x;
    if (e === "x") return (x) => (x * x) / 2;
    if (e === "x*x" || e === "x**2" || e === "x^2") return (x) => (x * x * x) / 3;
    if (e === "1/x" || e === "x**(-1)") {
      if (a * b <= 0) return null;
      return (x) => Math.log(Math.abs(x));
    }
    if (/^sin\(x\)\*exp\(-0\.1\*x\)$/.test(e) || /^exp\(-0\.1\*x\)\*sin\(x\)$/.test(e)) {
      const alpha = 0.1;
      return (x) => {
        const d = alpha * alpha + 1;
        return (-Math.exp(-alpha * x) * (alpha * Math.sin(x) + Math.cos(x))) / d;
      };
    }
    return null;
  })();
  if (!F) return null;
  try {
    return F(b) - F(a);
  } catch {
    return null;
  }
}

/** 常见一阶线性 ODE 的解析解 y(t) */
export function exactODE(expr, t0, y0) {
  const e = String(expr || "")
    .replace(/\s+/g, "")
    .toLowerCase();

  let m = e.match(/^-([0-9.]+)\*y$/);
  if (m) {
    const a = Number(m[1]);
    return (t) => y0 * Math.exp(-a * (t - t0));
  }
  if (e === "-y") return (t) => y0 * Math.exp(-(t - t0));

  // y' = sin(t)
  if (e === "sin(t)") {
    return (t) => y0 - Math.cos(t) + Math.cos(t0);
  }

  // y' = -0.5 y + sin(t)
  if (e === "-0.5*y+sin(t)" || e === "sin(t)-0.5*y") {
    const A = -0.8;
    const B = 0.4;
    const C = (y0 - A * Math.cos(t0) - B * Math.sin(t0)) * Math.exp(0.5 * t0);
    return (t) => C * Math.exp(-0.5 * t) + A * Math.cos(t) + B * Math.sin(t);
  }

  // y' = a - b*y
  m = e.match(/^([0-9.]+)-([0-9.]+)\*y$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!(b > 0)) return null;
    const yinf = a / b;
    return (t) => yinf + (y0 - yinf) * Math.exp(-b * (t - t0));
  }

  // y' = -a*y + b  （b 常数）
  m = e.match(/^-([0-9.]+)\*y\+([0-9.]+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!(a > 0)) return null;
    const yinf = b / a;
    return (t) => yinf + (y0 - yinf) * Math.exp(-a * (t - t0));
  }

  return null;
}

/** 热方程 sine 初值 + 齐次 Dirichlet 的解析解 */
export function exactHeat1D(x, t, alpha, L) {
  return x.map((xi) => Math.exp((-alpha * Math.PI * Math.PI * t) / (L * L)) * Math.sin((Math.PI * xi) / L));
}

/**
 * 为仿真结果附加解析对照曲线与误差指标（可识别时）
 */
export function attachAnalytical(type, payload, result) {
  if (!result || result.compare || result.plotKind === "compare") return result;

  if (type === "integrate") {
    const exact = exactIntegral(payload.expr, payload.a, payload.b);
    if (exact == null || !Number.isFinite(exact)) return result;
    const absErr = Math.abs(result.value - exact);
    const relErr = Math.abs(exact) > 1e-14 ? absErr / Math.abs(exact) : absErr;
    result.exactValue = exact;
    result.absErrExact = absErr;
    result.relErrExact = relErr;
    result.errSourceExact = "exact";
    result.analyticalNote = `解析积分 ≈ ${formatNum(exact, 8)}，|误差|≈${formatNum(absErr, 4)}（对解析）`;
    return result;
  }

  if (type === "ode") {
    const yExactFn = exactODE(payload.expr, payload.t0, payload.y0);
    if (!yExactFn || !result.t) return result;
    const yExact = result.t.map((ti) => yExactFn(ti));
    result.analytical = { x: result.t, y: yExact, name: "解析解" };
    result.rmseExact = rmse(result.y, yExact);
    result.maxAbsExact = maxAbs(result.y, yExact);
    result.errSourceExact = "exact";
    result.analyticalNote = `已叠加解析解；RMSE≈${formatNum(result.rmseExact, 4)}（对解析）`;
    return result;
  }

  if (type === "pde" && payload.ic === "sine" && Number(payload.uLeft) === 0 && Number(payload.uRight) === 0) {
    const frames = result.series || [];
    const last = frames[frames.length - 1];
    if (!last) return result;
    const tFinal = Number(String(last.name).replace(/^t=/, "")) || Number(payload.tf) || 0;
    const uExact = exactHeat1D(last.x, tFinal, Number(payload.alpha), Number(payload.L));
    result.series = [
      ...frames,
      { name: "解析解(终时)", x: last.x, y: uExact, ylabel: "u", dash: "dash" },
    ];
    result.rmseExact = rmse(last.y, uExact);
    result.maxAbsExact = maxAbs(last.y, uExact);
    result.errSourceExact = "exact";
    result.metrics = {
      ...result.metrics,
      rmse_vs_exact: result.rmseExact,
      max_abs_err_vs_exact: result.maxAbsExact,
    };
    result.analyticalNote = `sine 初值解析对照；RMSE≈${formatNum(result.rmseExact, 4)}（对解析）`;
    return result;
  }

  if (type === "control" && result.method === "second_order") {
    result.analyticalNote = "二阶响应由闭式公式给出（解析解）";
    result.errSource = "exact";
    return result;
  }

  if (type === "circuit" && result.analyticalNote) {
    return result;
  }

  return result;
}

export { rmse, maxAbs, compileExpr };
