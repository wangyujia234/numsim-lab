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
  if (type === "pde") {
    const a = Number(payload.alpha);
    if (!(a > 0)) {
      markFieldError("pde-alpha");
      throw new Error("热扩散系数 α 须为正数");
    }
  }
}
