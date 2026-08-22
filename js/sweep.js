/**
 * 参数扫描：对选定字段在 [min,max] 上取 n 个点，多次仿真并合并曲线
 */

const SWEEP_PRESETS = {
  control: [
    { id: "zeta", label: "阻尼比 ζ", field: "zeta", formId: "ctl-zeta", min: 0.1, max: 1.2, steps: 5, methods: ["second_order", "pid"] },
    { id: "wn", label: "自然频率 ωn", field: "wn", formId: "ctl-wn", min: 0.5, max: 4, steps: 5, methods: ["second_order", "pid"] },
    { id: "Kp", label: "PID Kp", field: "Kp", formId: "ctl-kp", min: 0.5, max: 5, steps: 5, methods: ["pid"] },
    { id: "K", label: "增益 K (根轨迹采样)", field: "kMax", formId: "ctl-kmax", min: 5, max: 40, steps: 4, methods: ["rlocus"] },
  ],
  pde: [
    { id: "alpha", label: "扩散系数 α", field: "alpha", formId: "pde-alpha", min: 0.05, max: 0.2, steps: 4, methods: ["heat1d"] },
  ],
  ode: [
    { id: "y0", label: "初值 y0", field: "y0", formId: "ode-y0", min: 0, max: 2, steps: 5, methods: ["*"] },
  ],
  integrate: [
    { id: "n", label: "分段数 n", field: "n", formId: "integ-n", min: 20, max: 200, steps: 5, methods: ["*"] },
  ],
};

export function sweepOptionsFor(type, method) {
  const list = SWEEP_PRESETS[type] || [];
  return list.filter((p) => p.methods.includes("*") || p.methods.includes(method));
}

export function linspaceSweep(min, max, steps) {
  const n = Math.max(2, Math.min(12, Math.floor(steps) || 5));
  const a = Number(min);
  const b = Number(max);
  if (!(Number.isFinite(a) && Number.isFinite(b)) || a === b) return [a];
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

/**
 * @param {{ runOnce: (payload)=>result, extractSeries: (result, label)=>trace[] }} hooks
 */
export function runSweep({ payload, field, values, runOnce, extractSeries }) {
  const series = [];
  const compare = [];
  let last = null;
  for (const v of values) {
    const p = { ...payload, [field]: v };
    const r = runOnce(p);
    last = r;
    const label = `${field}=${Number(v).toPrecision(3)}`;
    const traces = extractSeries(r, label);
    series.push(...traces);
    compare.push({ name: label, metrics: r.metrics || { yEnd: r.yEnd, value: r.value } });
  }
  return {
    ...(last || {}),
    series,
    compare,
    plotKind: "compare",
    method: "sweep",
    title: `参数扫描 · ${field}`,
    sweepField: field,
    sweepValues: values,
  };
}

export { SWEEP_PRESETS };
