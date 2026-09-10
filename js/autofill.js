/**
 * 从自然语言解析参数；不足时自动生成可用数据。
 */

import { detectTypeFromText } from "./agent.js";

const NUM = "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";

function fmtList(arr, digits = 4) {
  return arr
    .map((v) => {
      if (!Number.isFinite(v)) return String(v);
      const r = Math.round(v * 10 ** digits) / 10 ** digits;
      return String(r);
    })
    .join(", ");
}

function extractPairs(text) {
  const pairs = [];
  const re = new RegExp(`\\(\\s*(${NUM})\\s*[,，]\\s*(${NUM})\\s*\\)`, "g");
  let m;
  while ((m = re.exec(text))) {
    pairs.push([Number(m[1]), Number(m[2])]);
  }
  return pairs;
}

function extractNamedList(text, names) {
  for (const name of names) {
    const re = new RegExp(`${name}\\s*[=＝:]\\s*\\[([^\\]]+)\\]`, "i");
    const m = text.match(re);
    if (m) {
      return m[1]
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);
    }
  }
  return null;
}

function extractNumberNear(text, patterns, fallback = null) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

function extractExprAfter(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim().replace(/[。；;]+$/, "");
  }
  return null;
}

function genInterpolate() {
  const n = 6;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = x.map((xi) => Math.sin(0.9 * xi) * Math.exp(-0.08 * xi));
  const query = [0.5, (n - 1) / 2, n - 1.3].map((v) => Math.round(v * 100) / 100);
  return {
    type: "interpolate",
    fields: {
      "interp-x": fmtList(x, 2),
      "interp-y": fmtList(y, 4),
      "interp-query": fmtList(query, 2),
    },
    notes: ["未给出采样点 → 自动生成 sin 衰减采样与查询点"],
  };
}

function genIntegrate() {
  return {
    type: "integrate",
    fields: {
      "integ-f": "sin(x)*exp(-0.1*x)",
      "integ-a": "0",
      "integ-b": "10",
      "integ-n": "200",
    },
    notes: ["未给出被积函数 → 使用阻尼正弦默认算例"],
  };
}

function genODE() {
  return {
    type: "ode",
    fields: {
      "ode-f": "-0.5*y + sin(t)",
      "ode-y0": "1",
      "ode-t0": "0",
      "ode-tf": "20",
      "ode-n": "400",
    },
    notes: ["未给出 ODE → 使用强迫衰减方程默认算例"],
  };
}

function genCircuit(topoHint = "series_rlc") {
  const presets = {
    series_rlc: { R: 10, L: 0.5, C: 0.001, src: 12 },
    parallel_rc: { R: 1000, L: 0.5, C: 0.0001, src: 5 },
    series_rl: { R: 8, L: 0.2, C: 0.001, src: 12 },
    ac_rlc: { R: 5, L: 0.2, C: 0.0005, src: 1 },
  };
  const p = presets[topoHint] || presets.series_rlc;
  return {
    type: "circuit",
    fields: {
      "ckt-topo": topoHint,
      "ckt-r": String(p.R),
      "ckt-l": String(p.L),
      "ckt-c": String(p.C),
      "ckt-src": String(p.src),
    },
    notes: [`未给出完整电路参数 → 自动填充 ${topoHint} 典型值`],
  };
}

function parseInterpolate(text) {
  const notes = [];
  const pairs = extractPairs(text);
  let x = extractNamedList(text, ["x", "X"]);
  let y = extractNamedList(text, ["y", "Y"]);

  if (pairs.length >= 2) {
    x = pairs.map((p) => p[0]);
    y = pairs.map((p) => p[1]);
    notes.push(`从描述解析到 ${pairs.length} 个坐标点`);
  } else if (x && y && x.length === y.length && x.length >= 2) {
    notes.push(`从 x=/y= 列表解析到 ${x.length} 个点`);
  } else {
    return null;
  }

  let query = extractNamedList(text, ["query", "xq", "查询点"]);
  const qSingle = extractNumberNear(text, [
    new RegExp(`(?:在|求)\\s*x\\s*[=＝]?\\s*(${NUM})`, "i"),
    new RegExp(`x\\s*[=＝]\\s*(${NUM})`, "i"),
  ]);
  if (!query?.length && qSingle != null) query = [qSingle];
  if (!query?.length) {
    const xmin = Math.min(...x);
    const xmax = Math.max(...x);
    query = [xmin + 0.25 * (xmax - xmin), 0.5 * (xmin + xmax), xmax - 0.25 * (xmax - xmin)];
    notes.push("未指定查询点 → 自动取区间内 3 个位置");
  }

  return {
    type: "interpolate",
    fields: {
      "interp-x": fmtList(x),
      "interp-y": fmtList(y),
      "interp-query": fmtList(query),
    },
    notes,
  };
}

function parseIntegrate(text) {
  const notes = [];
  let expr =
    extractExprAfter(text, [
      /∫\s*([^d]+?)\s*d\s*x/i,
      /(?:积分|integrate)\s*[:：]?\s*([^\n,，从到]+)/i,
      /f\s*\(\s*x\s*\)\s*[=＝]\s*([^\n,，]+)/i,
      /被积函数\s*[=：:]\s*([^\n]+)/i,
    ]) || null;

  // common function names mentioned without full expression
  if (!expr) {
    if (/sin.*exp|阻尼正弦/.test(text)) expr = "sin(x)*exp(-0.1*x)";
    else if (/高斯|e\^\(-x\^2\)|exp\(-x\^2\)/.test(text)) expr = "exp(-x*x)";
    else if (/1\/\(1\+x\^2\)|arctan/.test(text)) expr = "1/(1+x*x)";
    else if (/\bsin\b/.test(text)) expr = "sin(x)";
    else if (/\bcos\b/.test(text)) expr = "cos(x)";
  }

  let a = extractNumberNear(text, [
    new RegExp(`从\\s*(${NUM})`, "i"),
    new RegExp(`下限\\s*[=：:]?\\s*(${NUM})`, "i"),
    new RegExp(`a\\s*[=＝]\\s*(${NUM})`, "i"),
    /∫\s*_?\s*(-?\d+(?:\.\d+)?)/,
  ]);
  let b = extractNumberNear(text, [
    new RegExp(`到\\s*(${NUM})`, "i"),
    new RegExp(`上限\\s*[=：:]?\\s*(${NUM})`, "i"),
    new RegExp(`b\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`∫\\s*_?[^\\^]*\\^\\s*(${NUM})`),
  ]);

  const range = text.match(new RegExp(`\\[\\s*(${NUM})\\s*[,，]\\s*(${NUM})\\s*\\]`));
  if (range) {
    a = Number(range[1]);
    b = Number(range[2]);
  }

  if (!expr && a == null && b == null) return null;

  if (!expr) {
    expr = "sin(x)*exp(-0.1*x)";
    notes.push("未解析到函数 → 使用默认阻尼正弦");
  } else {
    notes.push(`解析被积函数：${expr}`);
  }
  if (a == null) {
    a = 0;
    notes.push("下限默认 0");
  } else notes.push(`下限 a=${a}`);
  if (b == null) {
    b = 10;
    notes.push("上限默认 10");
  } else notes.push(`上限 b=${b}`);

  const n = extractNumberNear(text, [new RegExp(`n\\s*[=＝]\\s*(${NUM})`, "i")], 200);

  return {
    type: "integrate",
    fields: {
      "integ-f": expr,
      "integ-a": String(a),
      "integ-b": String(b),
      "integ-n": String(Math.max(2, Math.floor(n))),
    },
    notes,
  };
}

function parseODE(text) {
  const notes = [];
  let expr =
    extractExprAfter(text, [
      /y'\s*[=＝]\s*([^\n,，；;]+)/i,
      /dy\s*\/\s*dt\s*[=＝]\s*([^\n,，；;]+)/i,
      /f\s*\(\s*t\s*,\s*y\s*\)\s*[=＝]\s*([^\n,，；;]+)/i,
    ]) || null;

  if (!expr) {
    if (/衰减|damping/.test(text) && /sin/.test(text)) expr = "-0.5*y + sin(t)";
    else if (/logistic|逻辑/.test(text)) expr = "y*(1-y)";
    else if (/-\s*y|衰减/.test(text)) expr = "-y";
  }

  const y0 = extractNumberNear(text, [
    new RegExp(`y\\s*\\(\\s*${NUM}\\s*\\)\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`初值\\s*[=：:]?\\s*(${NUM})`, "i"),
    new RegExp(`y0\\s*[=＝]\\s*(${NUM})`, "i"),
  ]);
  const t0 = extractNumberNear(text, [
    new RegExp(`t0\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`从\\s*t\\s*[=＝]?\\s*(${NUM})`, "i"),
  ]);
  const tf = extractNumberNear(text, [
    new RegExp(`tf\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`到\\s*t\\s*[=＝]?\\s*(${NUM})`, "i"),
    new RegExp(`t\\s*∈\\s*\\[\\s*${NUM}\\s*[,，]\\s*(${NUM})\\s*\\]`, "i"),
  ]);
  const span = text.match(new RegExp(`t\\s*(?:∈|in)\\s*\\[\\s*(${NUM})\\s*[,，]\\s*(${NUM})\\s*\\]`, "i"));

  if (!expr && y0 == null && tf == null && !span) return null;

  const fields = {
    "ode-f": expr || "-0.5*y + sin(t)",
    "ode-y0": String(y0 ?? 1),
    "ode-t0": String(span ? Number(span[1]) : t0 ?? 0),
    "ode-tf": String(span ? Number(span[2]) : tf ?? 20),
    "ode-n": "400",
  };
  if (!expr) notes.push("未解析到方程 → 使用默认强迫衰减 ODE");
  else notes.push(`解析方程：y' = ${fields["ode-f"]}`);
  notes.push(`初值 y0=${fields["ode-y0"]}，区间 [${fields["ode-t0"]}, ${fields["ode-tf"]}]`);

  return { type: "ode", fields, notes };
}

function genTransformDefault() {
  return {
    type: "transform",
    fields: {
      "xf-f": "exp(-0.3*t)*sin(2*PI*1.5*t)",
      "xf-method": "fft",
      "xf-t0": "0",
      "xf-tf": "8",
      "xf-n": "512",
      "xf-fmax": "5",
      "xf-sigma": "0.5",
    },
    notes: ["未给出完整信号 → 使用衰减正弦默认算例做 FFT"],
  };
}

function genControlDefault(method = "second_order") {
  const base = {
    type: "control",
    fields: {
      "ctl-method": method,
      "ctl-zeta": "0.3",
      "ctl-wn": "2",
      "ctl-K": "1",
      "ctl-tf": "8",
      "ctl-num": "1",
      "ctl-den": "1, 2, 2",
      "ctl-kp": "2",
      "ctl-ki": "1",
      "ctl-kd": "0.2",
      "ctl-plant": "first",
      "ctl-tau": "1",
      "ctl-va": "12",
      "ctl-fmin": "0.01",
      "ctl-fmax": "100",
      "ctl-kmin": "0",
      "ctl-kmax": "50",
      "ctl-nk": "200",
      "ctl-T": "0.1",
      "ctl-zn": "64",
      "ctl-zalpha": "0.3",
      "ctl-zfreq": "1.5",
      "ctl-seq": "",
      "ctl-order": "2",
      "ctl-A": "0,1,-2,-3",
      "ctl-B": "0,1",
      "ctl-poles": "-4,-5",
      "ctl-xref": "0,1,2,3,4,5",
      "ctl-ymeas": "0.05,1.1,1.95,3.05,4.1,4.9",
      "ctl-caldeg": "1",
    },
    notes: [`控制系统默认算例 → ${method}`],
  };
  return base;
}

function parseControl(text) {
  const notes = [];
  let method = "second_order";
  if (/pid/i.test(text)) method = "pid";
  else if (/bode|伯德|相位裕度/i.test(text)) method = "bode";
  else if (/电机|motor/i.test(text)) method = "dc_motor";
  else if (/根轨迹|rlocus|root\s*locus/i.test(text)) method = "rlocus";
  else if (/jury|判稳/i.test(text)) method = "jury";
  else if (/离散.*传递|h\(z\)|z\s*域/i.test(text)) method = "z_tf_step";
  else if (/z\s*变换|ztransform|单位圆/i.test(text)) method = "z_transform";
  else if (/极点配置|状态反馈|ackermann|pole\s*place/i.test(text)) method = "pole_place";
  else if (/传感器|标定|校准/i.test(text)) method = "sensor_cal";
  else if (/传递函数|g\(s\)/i.test(text)) method = "tf_step";
  else if (/二阶|阻尼比|ζ|zeta|ωn|wn/i.test(text)) method = "second_order";

  // 只回填「识别到的」字段，避免用默认值覆盖示例/用户已填参数（如根轨迹分母）
  const fields = { "ctl-method": method };
  const zeta = extractNumberNear(
    text,
    [new RegExp(`ζ\\s*[=＝]\\s*(${NUM})`), new RegExp(`zeta\\s*[=＝]\\s*(${NUM})`, "i")],
    null
  );
  const wn = extractNumberNear(
    text,
    [new RegExp(`ωn\\s*[=＝]\\s*(${NUM})`), new RegExp(`wn\\s*[=＝]\\s*(${NUM})`, "i")],
    null
  );
  if (zeta != null) fields["ctl-zeta"] = String(zeta);
  if (wn != null) fields["ctl-wn"] = String(wn);
  notes.push(`控制系统 → ${method}`);
  return { type: "control", fields, notes };
}

function parseTransform(text) {
  const notes = [];
  let method = "fft";
  if (/laplace|拉普拉斯/.test(text)) method = "laplace";
  else if (/傅里叶|fourier/.test(text) && !/fft|快速|离散/.test(text)) method = "fourier";
  else if (/fft|快速傅里叶|频谱/.test(text)) method = "fft";

  let expr =
    extractExprAfter(text, [
      /f\s*\(\s*t\s*\)\s*[=＝]\s*([^\n,，；;]+)/i,
      /信号\s*[=：:]\s*([^\n]+)/i,
    ]) || null;
  if (!expr) {
    if (/exp\(-t\)|单位阶跃.*衰减|e\^-t/.test(text)) expr = "exp(-t)";
    else if (/rect|门函数/.test(text)) expr = "1"; // 有限区间上常数
    else expr = "exp(-0.3*t)*sin(2*PI*1.5*t)";
    notes.push(`信号默认：${expr}`);
  } else notes.push(`解析信号：${expr}`);

  const t0 = extractNumberNear(text, [new RegExp(`t0\\s*[=＝]\\s*(${NUM})`, "i")], 0);
  const tf = extractNumberNear(
    text,
    [new RegExp(`tf\\s*[=＝]\\s*(${NUM})`, "i"), new RegExp(`到\\s*(${NUM})`, "i")],
    method === "laplace" ? 12 : 8
  );
  const sigma = extractNumberNear(text, [new RegExp(`σ\\s*[=＝]\\s*(${NUM})`), new RegExp(`sigma\\s*[=＝]\\s*(${NUM})`, "i")], 0.5);

  notes.push(`变换类型 → ${method}`);
  return {
    type: "transform",
    fields: {
      "xf-f": expr,
      "xf-method": method,
      "xf-t0": String(t0),
      "xf-tf": String(tf),
      "xf-n": method === "fft" ? "512" : "200",
      "xf-fmax": "5",
      "xf-sigma": String(sigma),
    },
    notes,
  };
}

function parseCircuit(text) {
  const notes = [];
  const R = extractNumberNear(text, [
    new RegExp(`R\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`电阻\\s*[=：:]?\\s*(${NUM})`),
  ]);
  const L = extractNumberNear(text, [
    new RegExp(`L\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`电感\\s*[=：:]?\\s*(${NUM})`),
  ]);
  const C = extractNumberNear(text, [
    new RegExp(`C\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`电容\\s*[=：:]?\\s*(${NUM})`),
  ]);
  const src = extractNumberNear(text, [
    new RegExp(`V\\s*[=＝]\\s*(${NUM})`, "i"),
    new RegExp(`电压\\s*[=：:]?\\s*(${NUM})`),
    new RegExp(`源\\s*[=：:]?\\s*(${NUM})`),
  ]);

  let topo = "series_rlc";
  if (/频响|频率|bode|交流|ac/.test(text)) topo = "ac_rlc";
  else if (/并联\s*RC|RC\s*放电/.test(text)) topo = "parallel_rc";
  else if (/串联\s*RL(?!C)|\bRL\b(?!C)/.test(text)) topo = "series_rl";

  if (R == null && L == null && C == null && src == null && !/(电路|rlc|rc|rl)/i.test(text)) {
    return null;
  }

  // 只写入识别到的字段，保留示例/用户已填的 RLC 数值
  const fields = { "ckt-topo": topo };
  if (R != null) {
    fields["ckt-r"] = String(R);
    notes.push(`R=${R}`);
  }
  if (L != null) {
    fields["ckt-l"] = String(L);
    notes.push(`L=${L}`);
  }
  if (C != null) {
    fields["ckt-c"] = String(C);
    notes.push(`C=${C}`);
  }
  if (src != null) {
    fields["ckt-src"] = String(src);
    notes.push(`源=${src}`);
  }
  notes.unshift(`电路拓扑 → ${topo}`);

  return { type: "circuit", fields, notes };
}

/**
 * @param {string} nl
 * @param {string} typeHint
 * @param {{ forceGenerate?: boolean, allowGenerate?: boolean, fixedType?: string }} opts
 *   fixedType：强制锁定补参目标类型（用于“当前模块”手动切换，避免 NL 描述反推覆盖用户选择）
 */
export function autofillFromText(nl, typeHint = "interpolate", opts = {}) {
  const text = (nl || "").trim();
  const type = opts.fixedType || (text ? detectTypeFromText(text, typeHint) : typeHint);
  const notes = [];
  const allowGenerate = opts.allowGenerate !== false;

  let parsed = null;
  if (text && !opts.forceGenerate) {
    if (type === "interpolate") parsed = parseInterpolate(text);
    else if (type === "integrate") parsed = parseIntegrate(text);
    else if (type === "ode") parsed = parseODE(text);
    else if (type === "circuit") parsed = parseCircuit(text);
    else if (type === "transform") parsed = parseTransform(text);
    else if (type === "control") parsed = parseControl(text);
    else if (type === "pde") {
      parsed = {
        type: "pde",
        fields: {
          "pde-alpha": "0.1",
          "pde-L": "1",
          "pde-nx": "40",
          "pde-tf": "0.5",
          "pde-nt": "200",
          "pde-ic": "sine",
          "pde-uleft": "0",
          "pde-uright": "0",
        },
        notes: ["偏微分 → 一维热方程 FTCS 默认算例"],
      };
    }
    else if (type === "imagefit") {
      parsed = {
        type: "imagefit",
        fields: {
          "img-method": /样条|spline/.test(text) ? "spline" : "poly",
          "img-degree": "4",
        },
        notes: ["图像拟合：请上传图片或点「加载演示图」，再自动采样"],
      };
    }
  }

  if (!parsed) {
    if (!allowGenerate && !opts.forceGenerate) return null;
    if (type === "interpolate") parsed = genInterpolate();
    else if (type === "integrate") parsed = genIntegrate();
    else if (type === "ode") parsed = genODE();
    else if (type === "transform") parsed = genTransformDefault();
    else if (type === "control") parsed = genControlDefault();
    else if (type === "pde") {
      parsed = {
        type: "pde",
        fields: {
          "pde-alpha": "0.1",
          "pde-L": "1",
          "pde-nx": "40",
          "pde-tf": "0.5",
          "pde-nt": "200",
          "pde-ic": "sine",
          "pde-uleft": "0",
          "pde-uright": "0",
        },
        notes: ["生成热方程默认参数"],
      };
    }
    else if (type === "imagefit") {
      parsed = {
        type: "imagefit",
        fields: { "img-method": "poly", "img-degree": "4" },
        notes: ["请使用「加载演示图」或上传曲线图完成取点"],
      };
    } else if (type === "circuit") {
      let topo = "series_rlc";
      if (/频响|频率|ac/i.test(text)) topo = "ac_rlc";
      else if (/rc/i.test(text) && !/rlc/i.test(text)) topo = "parallel_rc";
      else if (/\brl\b/i.test(text) && !/rlc/i.test(text)) topo = "series_rl";
      parsed = genCircuit(topo);
    } else {
      parsed = genControlDefault();
    }
    if (text) notes.push("描述信息不完整，已自动补全算例数据");
    else notes.push("无描述 → 按当前类型自动生成算例数据");
  }

  return {
    type: parsed.type,
    fields: parsed.fields,
    notes: [...notes, ...(parsed.notes || [])],
  };
}

export { detectTypeFromText };
