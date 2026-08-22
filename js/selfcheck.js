/**
 * 示例自检：根据预期结论对仿真结果做绿/红判定
 */

const META_BY_TITLE = {
  样条拟合振荡采样: {
    id: "interp-spline",
    expectHint: "查询点均有有限插值结果",
    expect: { kind: "interp_finite" },
  },
  阻尼正弦积分: {
    id: "integ-damped",
    expectHint: "与解析积分绝对误差 < 1e-6",
    expect: { kind: "integrate_exact", absTol: 1e-6 },
  },
  "强迫衰减 ODE": {
    id: "ode-forced",
    expectHint: "对解析解 RMSE < 1e-6",
    expect: { kind: "ode_rmse", maxRmse: 1e-6 },
  },
  "串联 RLC 阶跃": {
    id: "ckt-rlc-step",
    expectHint: "阻尼类型为欠阻尼",
    expect: { kind: "metric_includes", path: "metrics.regime", includes: "欠阻尼" },
  },
  "RLC 频率响应": {
    id: "ckt-rlc-ac",
    expectHint: "谐振频率 f0 > 0",
    expect: { kind: "metric_gt", path: "metrics.f0", min: 0 },
  },
  图像曲线拟合: {
    id: "img-poly",
    expectHint: "R² > 0.9",
    expect: { kind: "prop_gt", path: "r2", min: 0.9 },
  },
  "阻尼正弦 FFT": {
    id: "xf-fft",
    expectHint: "主频约在 1.2~1.8 Hz",
    expect: { kind: "prop_between", path: "fPeak", min: 1.2, max: 1.8 },
  },
  拉普拉斯幅频: {
    id: "xf-laplace",
    expectHint: "峰值幅度有限且 > 0",
    expect: { kind: "prop_gt", path: "magPeak", min: 0 },
  },
  二阶欠阻尼阶跃: {
    id: "ctl-2nd",
    expectHint: "判定为欠阻尼且超调 > 0",
    expect: { kind: "second_underdamped" },
  },
  "PID 控制一阶对象": {
    id: "ctl-pid",
    expectHint: "稳态输出接近 1（|y∞−1|<0.05）",
    expect: { kind: "metric_near", path: "metrics.y_final", target: 1, tol: 0.05 },
  },
  Bode图: {
    id: "ctl-bode",
    expectHint: "Bode 曲线已生成",
    expect: { kind: "method_is", method: "bode" },
  },
  "Bode 图": {
    id: "ctl-bode",
    expectHint: "Bode 曲线已生成",
    expect: { kind: "method_is", method: "bode" },
  },
  根轨迹: {
    id: "ctl-rlocus",
    expectHint: "根轨迹曲线已生成",
    expect: { kind: "method_is", method: "rlocus" },
  },
  "数值 Z 变换": {
    id: "ctl-z",
    expectHint: "单位圆频谱峰值 > 0",
    expect: { kind: "metric_gt", path: "metrics.max_mag", min: 0 },
  },
  极点配置: {
    id: "ctl-place",
    expectHint: "状态反馈仿真完成",
    expect: { kind: "method_is", method: "pole_place" },
  },
  传感器标定: {
    id: "ctl-sensor",
    expectHint: "标定 R² > 0.99",
    expect: { kind: "metric_gt", path: "metrics.R2", min: 0.99 },
  },
  "离散 TF 阶跃": {
    id: "ctl-ztf",
    expectHint: "Jury 判定稳定且 y[N]≈2/3",
    expect: { kind: "z_tf_ok" },
  },
  "Jury 判稳": {
    id: "ctl-jury",
    expectHint: "特征多项式渐近稳定",
    expect: { kind: "metric_true", path: "metrics.jury_stable" },
  },
  一维热方程: {
    id: "pde-heat",
    expectHint: "对解析解 RMSE < 1e-3",
    expect: { kind: "heat_ok", maxRmse: 1e-3 },
  },
};

export function attachExampleMeta(examples) {
  for (const ex of examples) {
    const m = META_BY_TITLE[ex.title];
    if (m) {
      ex.id = m.id;
      ex.expect = m.expect;
      ex.expectHint = m.expectHint;
    } else {
      ex.id = ex.id || `${ex.type}-${String(ex.title).slice(0, 12)}`;
    }
  }
  return examples;
}

function getPath(obj, path) {
  return String(path)
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * @returns {{ pass: boolean, message: string, hint?: string } | null}
 */
export function runSelfCheck(example, type, result, payload) {
  if (!example?.expect || !result) return null;
  const e = example.expect;
  const hint = example.expectHint || "";

  try {
    if (e.kind === "interp_finite") {
      const ok = Array.isArray(result.queryY) && result.queryY.every((v) => Number.isFinite(v));
      return { pass: ok, message: ok ? "查询点均为有限值" : "存在非有限查询值", hint };
    }
    if (e.kind === "integrate_exact") {
      const err = result.absErrExact;
      if (err == null) return { pass: false, message: "未找到解析对照（请关闭对比/扫描后重试）", hint };
      const ok = err < e.absTol;
      return { pass: ok, message: `对解析绝对误差 ${err.toExponential(3)}（阈值 ${e.absTol}）`, hint };
    }
    if (e.kind === "ode_rmse") {
      const rmse = result.rmseExact;
      if (rmse == null) return { pass: false, message: "未找到解析对照", hint };
      const ok = rmse < e.maxRmse;
      return { pass: ok, message: `RMSE=${rmse.toExponential(3)}（阈值 ${e.maxRmse}）`, hint };
    }
    if (e.kind === "second_underdamped") {
      const regime = String(result.metrics?.regime || "");
      const os = Number(result.metrics?.overshoot_pct);
      const ok = /欠阻尼/.test(regime) && os > 0;
      return { pass: ok, message: `regime=${regime}，超调=${os}%`, hint };
    }
    if (e.kind === "z_tf_ok") {
      const stable = !!result.metrics?.jury_stable;
      const yf = Number(result.metrics?.y_final);
      const near = Math.abs(yf - 2 / 3) < 0.05;
      const ok = stable && near;
      return { pass: ok, message: `Jury稳定=${stable}，y[N]=${yf.toFixed(4)}（期望≈0.667）`, hint };
    }
    if (e.kind === "heat_ok") {
      const r = Number(result.metrics?.r_stability);
      const rmse = result.rmseExact ?? result.metrics?.rmse_vs_exact;
      const isCN = result.scheme === "cn" || result.method === "heat1d_cn";
      const stableOk = isCN || r <= 0.5;
      const ok = stableOk && rmse != null && rmse < e.maxRmse;
      return {
        pass: ok,
        message: `${isCN ? "CN" : `r=${Number.isFinite(r) ? r.toFixed(3) : "?"}`}，RMSE=${rmse != null ? Number(rmse).toExponential(3) : "?"}`,
        hint,
      };
    }
    if (e.kind === "method_is") {
      const ok = result.method === e.method;
      return { pass: ok, message: `method=${result.method}`, hint };
    }
    if (e.kind === "metric_includes") {
      const v = String(getPath(result, e.path) ?? "");
      const ok = v.includes(e.includes);
      return { pass: ok, message: `${e.path}=${v}`, hint };
    }
    if (e.kind === "metric_gt" || e.kind === "prop_gt") {
      const v = Number(getPath(result, e.path));
      const ok = Number.isFinite(v) && v > e.min;
      return { pass: ok, message: `${e.path}=${v}`, hint };
    }
    if (e.kind === "metric_near") {
      const v = Number(getPath(result, e.path));
      const ok = Number.isFinite(v) && Math.abs(v - e.target) <= e.tol;
      return { pass: ok, message: `${e.path}=${v}（目标 ${e.target}±${e.tol}）`, hint };
    }
    if (e.kind === "metric_true") {
      const v = !!getPath(result, e.path);
      return { pass: v, message: `${e.path}=${v}`, hint };
    }
    if (e.kind === "prop_between") {
      const v = Number(getPath(result, e.path));
      const ok = Number.isFinite(v) && v >= e.min && v <= e.max;
      return { pass: ok, message: `${e.path}=${v}（期望 ${e.min}~${e.max}）`, hint };
    }
  } catch (err) {
    return { pass: false, message: `自检异常：${err.message}`, hint };
  }
  return null;
}
