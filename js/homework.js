/**
 * 作业模式：题目包 + 教师自检规则 + 验真印章
 * AI 只可讲解；数值结果必须来自本地引擎。
 */

import { runSelfCheck } from "./selfcheck.js";

export const ENGINE_VERSION = "numsim-engine/1.3.0";
export const MODE_KEY = "numsim.ui.mode";

/** @typedef {{ id: string, course: string, title: string, problem: string, type: string, algorithm?: string, nl?: string, fields: Record<string,string>, lockedFields?: string[], rules: object[], expectHint: string, knowledge?: string[], reflect?: string[] }} Assignment */

/** @type {Assignment[]} */
export const ASSIGNMENTS = [
  {
    id: "na-integ-01",
    course: "数值分析",
    title: "阻尼正弦定积分",
    problem:
      "用数值积分计算 I=∫_0^10 sin(x)e^{-0.1x} dx。要求与解析值对照，绝对误差小于 1e-6。可调整分段数 n，但不得改被积函数与积分限。",
    type: "integrate",
    algorithm: "adaptive",
    nl: "作业：阻尼正弦定积分并对照解析值（自适应高精度）",
    fields: {
      "integ-f": "sin(x)*exp(-0.1*x)",
      "integ-a": "0",
      "integ-b": "10",
      "integ-n": "200",
    },
    lockedFields: ["integ-f", "integ-a", "integ-b"],
    rules: [{ kind: "integrate_exact", absTol: 1e-6 }],
    expectHint: "对解析绝对误差 < 1e-6",
    knowledge: ["自适应 Simpson", "解析对照与误差"],
    reflect: ["若改用梯形公式，同样 n 下误差如何变化？", "自适应方法的函数求值次数说明了什么？"],
  },
  {
    id: "na-ode-01",
    course: "数值分析",
    title: "强迫衰减 ODE",
    problem:
      "求解 y'=-0.5y+sin(t)，y(0)=1，t∈[0,20]。使用 RK4 或更高精度方法，并与解析解比较，要求 RMSE < 1e-6。方程与初值锁定。",
    type: "ode",
    algorithm: "rk4",
    nl: "作业：RK4 求解强迫衰减 ODE 并对照解析解",
    fields: {
      "ode-f": "-0.5*y + sin(t)",
      "ode-y0": "1",
      "ode-t0": "0",
      "ode-tf": "20",
      "ode-n": "400",
    },
    lockedFields: ["ode-f", "ode-y0", "ode-t0", "ode-tf"],
    rules: [{ kind: "ode_rmse", maxRmse: 1e-6 }],
    expectHint: "对解析解 RMSE < 1e-6",
    knowledge: ["RK4", "局部/全局误差"],
    reflect: ["把 n 减到 50，RMSE 会怎样？说明原因。"],
  },
  {
    id: "ac-2nd-01",
    course: "自动控制原理",
    title: "二阶欠阻尼阶跃",
    problem:
      "二阶系统 ζ=0.3、ωn=2、K=1 的单位阶跃响应。判定阻尼类型，并确认存在超调。ζ 与 ωn 锁定。",
    type: "control",
    algorithm: "second_order",
    nl: "作业：二阶欠阻尼阶跃响应",
    fields: {
      "ctl-method": "second_order",
      "ctl-zeta": "0.3",
      "ctl-wn": "2",
      "ctl-K": "1",
      "ctl-tf": "8",
    },
    lockedFields: ["ctl-method", "ctl-zeta", "ctl-wn", "ctl-K"],
    rules: [{ kind: "second_underdamped" }],
    expectHint: "欠阻尼且超调 > 0",
    knowledge: ["阻尼比", "超调量", "调节时间"],
    reflect: ["若 ζ 改为 1.2，响应形态如何变化？"],
  },
  {
    id: "ac-pid-01",
    course: "自动控制原理",
    title: "PID 跟踪一阶对象",
    problem:
      "对一阶对象 τ=1 设计 PID（默认 Kp=2,Ki=1,Kd=0.15），单位阶跃下稳态 |y∞−1|<0.05。对象参数锁定，PID 参数可调。",
    type: "control",
    algorithm: "pid",
    nl: "作业：PID 控制一阶对象",
    fields: {
      "ctl-method": "pid",
      "ctl-kp": "2",
      "ctl-ki": "1",
      "ctl-kd": "0.15",
      "ctl-plant": "first",
      "ctl-tau": "1",
      "ctl-K": "1",
      "ctl-tf": "10",
    },
    lockedFields: ["ctl-method", "ctl-plant", "ctl-tau", "ctl-K"],
    rules: [{ kind: "metric_near", path: "metrics.y_final", target: 1, tol: 0.05 }],
    expectHint: "稳态 |y∞−1|<0.05",
    knowledge: ["PID", "稳态误差"],
    reflect: ["只增大 Ki，稳态误差与超调如何权衡？"],
  },
  {
    id: "ac-jury-01",
    course: "自动控制原理",
    title: "Jury 判稳",
    problem: "对特征多项式 z²−1.5z+0.7 做 Jury 判据，判定是否渐近稳定。多项式锁定。",
    type: "control",
    algorithm: "jury",
    nl: "作业：Jury 稳定性判据",
    fields: {
      "ctl-method": "jury",
      "ctl-den": "1, -1.5, 0.7",
    },
    lockedFields: ["ctl-method", "ctl-den"],
    rules: [{ kind: "metric_true", path: "metrics.jury_stable" }],
    expectHint: "Jury：渐近稳定",
    knowledge: ["离散系统稳定性", "Jury 表"],
    reflect: ["若常数项改为 1.2，稳定性结论如何？"],
  },
  {
    id: "ee-rlc-01",
    course: "电路分析",
    title: "串联 RLC 阶跃阻尼判定",
    problem: "R=10Ω, L=0.5H, C=0.001F 串联 RLC 阶跃，判定阻尼类型应为欠阻尼。元件参数锁定。",
    type: "circuit",
    algorithm: "series_rlc",
    nl: "作业：串联 RLC 阶跃阻尼判定",
    fields: {
      "ckt-topo": "series_rlc",
      "ckt-r": "10",
      "ckt-l": "0.5",
      "ckt-c": "0.001",
      "ckt-src": "12",
    },
    lockedFields: ["ckt-topo", "ckt-r", "ckt-l", "ckt-c"],
    rules: [{ kind: "metric_includes", path: "metrics.regime", includes: "欠阻尼" }],
    expectHint: "阻尼类型为欠阻尼",
    knowledge: ["二阶电路", "过/欠/临界阻尼"],
    reflect: ["增大 R 到什么量级会进入过阻尼？"],
  },
  {
    id: "pde-heat-01",
    course: "数值分析",
    title: "一维热方程 FTCS",
    problem:
      "求解 u_t=0.1 u_xx，L=1，初值 sin(πx)，齐次 Dirichlet，使用 FTCS。要求 r≤0.5，且终时对解析解 RMSE<5e-3。α、L、初边值锁定。",
    type: "pde",
    algorithm: "heat1d",
    nl: "作业：一维热方程 FTCS 与解析对照",
    fields: {
      "pde-alpha": "0.1",
      "pde-L": "1",
      "pde-nx": "40",
      "pde-tf": "0.5",
      "pde-nt": "200",
      "pde-ic": "sine",
      "pde-uleft": "0",
      "pde-uright": "0",
      "pde-scheme": "ftcs",
    },
    lockedFields: ["pde-alpha", "pde-L", "pde-ic", "pde-uleft", "pde-uright", "pde-scheme"],
    rules: [{ kind: "heat_ok", maxRmse: 5e-3 }],
    expectHint: "r≤0.5 且 RMSE<5e-3",
    knowledge: ["FTCS", "稳定性条件 r≤1/2"],
    reflect: ["为何 r>1/2 会不稳定？结合你的仿真说明。"],
  },
];

export function listCourses() {
  return [...new Set(ASSIGNMENTS.map((a) => a.course))];
}

export function getAssignment(id) {
  return ASSIGNMENTS.find((a) => a.id === id) || null;
}

export function loadMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "homework" ? "homework" : "demo";
  } catch {
    return "demo";
  }
}

export function saveMode(mode) {
  const m = mode === "homework" ? "homework" : "demo";
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
  return m;
}

/**
 * 多条教师规则全部通过才算通过
 */
export function evaluateAssignment(assignment, type, result, payload) {
  if (!assignment?.rules?.length) return null;
  const checks = [];
  for (const rule of assignment.rules) {
    const fakeEx = {
      expect: rule,
      expectHint: assignment.expectHint || "",
    };
    const c = runSelfCheck(fakeEx, type, result, payload);
    if (c) checks.push(c);
  }
  if (!checks.length) return null;
  const pass = checks.every((c) => c.pass);
  return {
    pass,
    message: checks.map((c) => c.message).join("；"),
    hint: assignment.expectHint || "",
    checks,
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
  };
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // 极简回退（非密码学，仅防误改提示）
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (`00000000${(h >>> 0).toString(16)}`).slice(-8).padStart(64, "0");
}

/**
 * 稳定序列化锁定字段取值，供印章哈希绑定「锁参未被改写」
 * @param {string[]} lockedFields
 * @param {Record<string, string>} lockValues
 */
export function buildLockDigest(lockedFields = [], lockValues = {}) {
  const ids = [...lockedFields].map(String).sort();
  const pairs = ids.map((id) => [id, String(lockValues[id] ?? "")]);
  return JSON.stringify(pairs);
}

function stampCanonical({
  engine,
  assignmentId,
  type,
  algorithm,
  payload,
  metrics,
  selfCheckPass,
  lockedFields,
  lockDigest,
  canonicalVersion,
}) {
  return JSON.stringify({
    engine,
    assignmentId,
    type,
    algorithm,
    payload,
    metrics,
    selfCheckPass,
    lockedFields: [...(lockedFields || [])].map(String).sort(),
    lockDigest: lockDigest || "",
    canonicalVersion: canonicalVersion || 2,
  });
}

/**
 * 生成验真印章：证明结果来自本地引擎快照，而非模型口述
 */
export async function buildStamp({
  assignment,
  type,
  algorithm,
  payload,
  metrics,
  selfCheck,
  mode,
  aiEnabled,
  lockValues = {},
}) {
  const lockedFields = [...(assignment?.lockedFields || [])].map(String).sort();
  const lockDigest = buildLockDigest(lockedFields, lockValues);
  const canonicalVersion = 2;
  const canonical = stampCanonical({
    engine: ENGINE_VERSION,
    assignmentId: assignment?.id || null,
    type,
    algorithm,
    payload,
    metrics,
    selfCheckPass: selfCheck?.pass ?? null,
    lockedFields,
    lockDigest,
    canonicalVersion,
  });
  const hash = await sha256Hex(canonical);
  return {
    seal: "NUMSIM-LOCAL-ENGINE",
    claim: "本结果由浏览器本地数值引擎计算，非大模型直接给出数值。",
    engine: ENGINE_VERSION,
    mode: mode || "demo",
    assignmentId: assignment?.id || null,
    assignmentTitle: assignment?.title || null,
    computedAt: new Date().toISOString(),
    payloadAlgorithm: algorithm,
    type,
    resultHash: hash,
    selfCheckPass: selfCheck?.pass ?? null,
    aiEnabledDuringRun: !!aiEnabled,
    numericsFromModel: false,
    lockedFields,
    lockDigest,
    canonicalVersion,
    // 供教师复核重算（不含时间等非哈希字段）
    _canonical: {
      engine: ENGINE_VERSION,
      assignmentId: assignment?.id || null,
      type,
      algorithm,
      payload,
      metrics,
      selfCheckPass: selfCheck?.pass ?? null,
      lockedFields,
      lockDigest,
      canonicalVersion,
    },
  };
}

/**
 * 复核印章：用 stamp 内嵌的 canonical 材料重算哈希并比对
 * @returns {Promise<{ ok: boolean, message: string, expected?: string, actual?: string }>}
 */
export async function verifyStamp(stamp) {
  if (!stamp || typeof stamp !== "object") {
    return { ok: false, message: "无效的 stamp.json" };
  }
  if (!stamp.resultHash) {
    return { ok: false, message: "印章缺少 resultHash" };
  }
  let material = stamp._canonical;
  if (!material) {
    // 兼容旧印章：尽力用公开字段拼回 v1/v2
    material = {
      engine: stamp.engine,
      assignmentId: stamp.assignmentId || null,
      type: stamp.type,
      algorithm: stamp.payloadAlgorithm || stamp.algorithm,
      payload: stamp.payload,
      metrics: stamp.metrics,
      selfCheckPass: stamp.selfCheckPass ?? null,
      lockedFields: stamp.lockedFields || [],
      lockDigest: stamp.lockDigest || "",
      canonicalVersion: stamp.canonicalVersion || 1,
    };
    if (material.payload == null || material.metrics == null) {
      return {
        ok: false,
        message: "旧版印章缺少 payload/metrics，无法独立复核；请使用本页「复核当前结果」或重新导出 Zip。",
      };
    }
  }
  const version = material.canonicalVersion || stamp.canonicalVersion || 2;
  const text =
    version >= 2
      ? stampCanonical(material)
      : JSON.stringify({
          engine: material.engine,
          assignmentId: material.assignmentId,
          type: material.type,
          algorithm: material.algorithm,
          payload: material.payload,
          metrics: material.metrics,
          selfCheckPass: material.selfCheckPass,
        });
  const actual = await sha256Hex(text);
  const expected = String(stamp.resultHash);
  if (actual === expected) {
    return {
      ok: true,
      message: `哈希匹配 · ${stamp.seal || "NUMSIM-LOCAL-ENGINE"} · ${stamp.assignmentId || "自由练习"}`,
      expected,
      actual,
    };
  }
  return {
    ok: false,
    message: "哈希不匹配：印章可能被改写，或与当前引擎材料不一致。",
    expected,
    actual,
  };
}

export function stampMarkdown(stamp) {
  if (!stamp) return "";
  const locks = (stamp.lockedFields || []).join(", ") || "无";
  return [
    `## 验真印章`,
    ``,
    `- 印章：\`${stamp.seal}\``,
    `- 声明：${stamp.claim}`,
    `- 引擎：${stamp.engine}`,
    `- 模式：${stamp.mode}`,
    `- 题目：${stamp.assignmentId || "（自由练习）"} ${stamp.assignmentTitle || ""}`,
    `- 时间：${stamp.computedAt}`,
    `- 结果哈希：\`${stamp.resultHash}\``,
    `- 规范版本：${stamp.canonicalVersion || 1}`,
    `- 锁定字段：${locks}`,
    `- 锁参摘要：\`${stamp.lockDigest || ""}\``,
    `- 自检：${stamp.selfCheckPass == null ? "未启用" : stamp.selfCheckPass ? "通过" : "未通过"}`,
    `- 运行时 AI 分析：${stamp.aiEnabledDuringRun ? "开启（仅规划，数值仍本地）" : "关闭"}`,
    `- 数值是否来自模型：否`,
    ``,
  ].join("\n");
}

export function stampHtml(stamp) {
  if (!stamp) return "";
  const pass =
    stamp.selfCheckPass === true ? "pass" : stamp.selfCheckPass === false ? "fail" : "";
  const locks = (stamp.lockedFields || []).map(escape).join(", ") || "无";
  return `
    <div class="verify-seal ${pass}" id="verify-seal-block">
      <div class="verify-seal-mark">验真印章</div>
      <p><strong>${escape(stamp.seal)}</strong></p>
      <p>${escape(stamp.claim)}</p>
      <ul>
        <li>引擎：${escape(stamp.engine)}</li>
        <li>模式：${escape(stamp.mode)}</li>
        <li>题目：${escape(stamp.assignmentId || "自由练习")}</li>
        <li>锁定字段：${locks}</li>
        <li>规范版本：${escape(stamp.canonicalVersion || 1)}</li>
        <li>哈希：<code>${escape(stamp.resultHash)}</code></li>
        <li>自检：${
          stamp.selfCheckPass == null ? "未启用" : stamp.selfCheckPass ? "通过" : "未通过"
        }</li>
      </ul>
    </div>
  `;
}

function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
