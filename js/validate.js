import { compileExpr } from "./math.js";

export function markFieldError(id, on = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("field-error", !!on);
  const wrap = el.closest(".field");
  if (wrap) wrap.classList.toggle("field-error", !!on);
}

export function clearFieldErrors() {
  document.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
}

/** 运行前按类型做更严的校验，失败抛错并高亮字段 */
export function validatePayload(type, payload) {
  clearFieldErrors();
  if (type === "interpolate") {
    if (!Array.isArray(payload.x) || !Array.isArray(payload.y) || payload.x.length < 2) {
      markFieldError("interp-x");
      markFieldError("interp-y");
      throw new Error("至少需要 2 个采样点");
    }
    if (payload.x.length !== payload.y.length) {
      markFieldError("interp-x");
      markFieldError("interp-y");
      throw new Error("x 与 y 长度必须一致");
    }
    if (payload.x.some((v) => !Number.isFinite(v)) || payload.y.some((v) => !Number.isFinite(v))) {
      markFieldError("interp-x");
      markFieldError("interp-y");
      throw new Error("采样点含非有限数值");
    }
  }
  if (type === "integrate") {
    if (!payload.expr) {
      markFieldError("integ-f");
      throw new Error("请填写被积函数 f(x)");
    }
    try {
      const f = compileExpr(payload.expr, ["x"]);
      f((Number(payload.a) + Number(payload.b)) / 2);
    } catch (e) {
      markFieldError("integ-f");
      throw new Error(`被积函数无效：${e.message}`);
    }
    if (!Number.isFinite(payload.a) || !Number.isFinite(payload.b)) {
      markFieldError("integ-a");
      markFieldError("integ-b");
      throw new Error("积分上下限须为有限数值");
    }
    if (payload.a === payload.b) {
      markFieldError("integ-a");
      markFieldError("integ-b");
      throw new Error("积分上下限不能相等");
    }
  }
  if (type === "ode") {
    if (!payload.expr) {
      markFieldError("ode-f");
      throw new Error("请填写 f(t,y)");
    }
    try {
      const f = compileExpr(payload.expr, ["t", "y"]);
      f(payload.t0, payload.y0);
    } catch (e) {
      markFieldError("ode-f");
      throw new Error(`ODE 右端无效：${e.message}`);
    }
    if (!(payload.tf > payload.t0)) {
      markFieldError("ode-t0");
      markFieldError("ode-tf");
      throw new Error("须满足 tf > t0");
    }
  }
  if (type === "transform") {
    if (!payload.expr) {
      markFieldError("xf-f");
      throw new Error("请填写信号 f(t)");
    }
    try {
      compileExpr(payload.expr, ["t"])(payload.t0);
    } catch (e) {
      markFieldError("xf-f");
      throw new Error(`信号表达式无效：${e.message}`);
    }
  }
  if (type === "control" && payload.method === "pole_place") {
    const n = Math.floor(Number(payload.order) || 2);
    const A = String(payload.A || "")
      .split(/[,，\s]+/)
      .filter(Boolean);
    const B = String(payload.B || "")
      .split(/[,，\s]+/)
      .filter(Boolean);
    if (A.length !== n * n) {
      markFieldError("ctl-A");
      throw new Error(`A 需要 ${n * n} 个元素（当前 ${A.length}）`);
    }
    if (B.length !== n) {
      markFieldError("ctl-B");
      throw new Error(`B 需要 ${n} 个元素（当前 ${B.length}）`);
    }
  }
  if (type === "imagefit") {
    if (!Array.isArray(payload.x) || payload.x.length < 2) {
      throw new Error("请先在图上取点，或点「自动采样曲线」");
    }
    const deg = Number(payload.degree);
    if (!Number.isFinite(deg) || deg < 1 || deg > 8) {
      markFieldError("img-degree");
      throw new Error("拟合次数/谐波阶数须为 1~8");
    }
  }
  if (type === "transform") {
    const n = Number(payload.n);
    if (!Number.isFinite(n) || n < 16) {
      markFieldError("xf-n");
      throw new Error("点数 N 至少为 16");
    }
    const fMax = Number(payload.fMax);
    if (Number.isFinite(fMax) && fMax <= 0) {
      markFieldError("xf-fmax");
      throw new Error("fMax 须为正数");
    }
  }
  if (type === "control") {
    if (payload.method === "second_order" || payload.method === "pid") {
      const zeta = Number(payload.zeta);
      const wn = Number(payload.wn);
      if (!Number.isFinite(zeta) || zeta <= 0) {
        markFieldError("ctl-zeta");
        throw new Error("阻尼比 ζ 须为正数（标准二阶系统）");
      }
      if (!Number.isFinite(wn) || wn <= 0) {
        markFieldError("ctl-wn");
        throw new Error("自然频率 ωn 须为正数");
      }
    }
    if (payload.method === "bode") {
      const fmin = Number(payload.fmin);
      const fmax = Number(payload.fmax);
      if (Number.isFinite(fmin) && Number.isFinite(fmax) && !(fmax > fmin)) {
        markFieldError("ctl-fmin");
        markFieldError("ctl-fmax");
        throw new Error("Bode 需满足 fMax > fMin");
      }
    }
  }
  if (type === "pde") {
    const a = Number(payload.alpha);
    if (!(a > 0)) {
      markFieldError("pde-alpha");
      throw new Error("热扩散系数 α 须为正数");
    }
    const L = Number(payload.L);
    if (!Number.isFinite(L) || L <= 0) {
      markFieldError("pde-L");
      throw new Error("杆长 L 须为正数");
    }
    const nx = Number(payload.nx);
    const nt = Number(payload.nt);
    if (!Number.isFinite(nx) || nx < 4) {
      markFieldError("pde-nx");
      throw new Error("空间分段 nx 至少为 4");
    }
    if (!Number.isFinite(nt) || nt < 4) {
      markFieldError("pde-nt");
      throw new Error("时间步 nt 至少为 4");
    }
    if (payload.scheme === "ftcs") {
      const dx = L / nx;
      const dt = Number(payload.tf) / nt;
      const r = a * dt / (dx * dx);
      if (!Number.isFinite(r) || r > 0.5) {
        markFieldError("pde-nt");
        throw new Error(`FTCS 稳定性要求 r=α·dt/dx² ≤ 0.5，当前 r≈${Number.isFinite(r) ? r.toFixed(3) : String(r)}`);
      }
    }
    if (Number(payload.tf) <= 0) {
      markFieldError("pde-tf");
      throw new Error("终时 tf 须为正数");
    }
  }
}
