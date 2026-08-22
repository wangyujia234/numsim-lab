import { formatNum } from "./math.js";

export function buildReport(decision, payload, result, codes, extras = {}) {
  const time = new Date().toLocaleString("zh-CN");
  const problem = String(extras.problem || decision.nl || "").trim();
  const plotDataUrl = extras.plotDataUrl || "";
  const lines = [];
  lines.push(`# NumSim Lab 仿真报告`);
  lines.push(``);
  lines.push(`- 生成时间：${time}`);
  lines.push(`- 问题类型：${typeLabel(decision.type)}`);
  lines.push(`- 选定算法：${decision.algorithmName}`);
  lines.push(`- 选择依据：${decision.reason}`);
  if (decision.source) lines.push(`- 分析来源：${decision.source}`);
  lines.push(``);
  if (problem) {
    lines.push(`## 题目复述`);
    lines.push(problem);
    lines.push(``);
  }
  lines.push(`## 分析步骤`);
  for (const s of decision.steps) lines.push(`- ${s}`);
  lines.push(``);
  lines.push(`## 输入参数`);
  lines.push("```");
  lines.push(JSON.stringify(payload, null, 2));
  lines.push("```");
  lines.push(``);
  lines.push(`## 数值结果`);
  for (const m of result.metrics || []) {
    lines.push(`- ${m.label}：${m.value}`);
  }
  if (result.analyticalNote) {
    lines.push(``);
    lines.push(`## 解析对照`);
    lines.push(result.analyticalNote);
  }
  if (extras.selfCheck) {
    lines.push(``);
    lines.push(`## 例题自检`);
    lines.push(`- 结果：${extras.selfCheck.pass ? "通过" : "未通过"}`);
    lines.push(`- 说明：${extras.selfCheck.message}`);
    if (extras.selfCheck.hint) lines.push(`- 预期：${extras.selfCheck.hint}`);
  }
  if (extras.stampMarkdown) {
    lines.push(``);
    lines.push(extras.stampMarkdown.trimEnd());
  }
  lines.push(``);
  if (plotDataUrl) {
    lines.push(`## 曲线图`);
    lines.push(`![仿真曲线](${plotDataUrl})`);
    lines.push(``);
  }
  lines.push(`## 代码产物`);
  lines.push(`- 已生成 Python 与 MATLAB 脚本（见工作台代码页）`);
  lines.push(`- Python 行数：${(codes.python || "").split("\n").length}`);
  lines.push(`- MATLAB 行数：${(codes.matlab || "").split("\n").length}`);
  lines.push(``);
  lines.push(`## 结论`);
  lines.push(result.conclusion || "仿真完成。");

  return {
    markdown: lines.join("\n"),
    html: renderHtml(
      decision,
      payload,
      result,
      time,
      problem,
      plotDataUrl,
      extras.selfCheck,
      extras.stampHtml || ""
    ),
  };
}

function renderHtml(decision, payload, result, time, problem, plotDataUrl, selfCheck, stampHtml = "") {
  const metrics = (result.metrics || [])
    .map((m) => `<li><strong>${escapeHtml(m.label)}</strong>：${escapeHtml(String(m.value))}</li>`)
    .join("");
  const steps = decision.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const problemBlock = problem
    ? `<h3>题目复述</h3><p class="report-problem">${escapeHtml(problem)}</p>`
    : "";
  const analyticalBlock = result.analyticalNote
    ? `<h3>解析对照</h3><p>${escapeHtml(result.analyticalNote)}</p>`
    : "";
  const selfBlock = selfCheck
    ? `<h3>例题自检</h3><p class="${selfCheck.pass ? "ok" : "bad"}"><strong>${
        selfCheck.pass ? "通过" : "未通过"
      }</strong> — ${escapeHtml(selfCheck.message)}${
        selfCheck.hint ? `<br/><span class="muted">预期：${escapeHtml(selfCheck.hint)}</span>` : ""
      }</p>`
    : "";
  const plotBlock = plotDataUrl
    ? `<h3>曲线图</h3><img class="report-plot" src="${plotDataUrl}" alt="仿真曲线" />`
    : "";
  return `
    <h3>概要</h3>
    <ul>
      <li>时间：${escapeHtml(time)}</li>
      <li>类型：${escapeHtml(typeLabel(decision.type))}</li>
      <li>算法：${escapeHtml(decision.algorithmName)}</li>
      <li>依据：${escapeHtml(decision.reason)}</li>
      ${decision.source ? `<li>来源：${escapeHtml(decision.source)}</li>` : ""}
    </ul>
    ${problemBlock}
    <h3>分析步骤</h3>
    <ul>${steps}</ul>
    ${analyticalBlock}
    ${selfBlock}
    ${stampHtml}
    <h3>关键指标</h3>
    <ul>${metrics}</ul>
    ${plotBlock}
    <h3>结论</h3>
    <p>${escapeHtml(result.conclusion || "仿真完成。")}</p>
  `;
}

function typeLabel(type) {
  return (
    {
      interpolate: "插值",
      integrate: "积分",
      ode: "微分方程",
      circuit: "电路计算",
      imagefit: "图像拟合",
      transform: "积分变换",
      control: "控制系统",
      pde: "偏微分方程",
    }[type] || type
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function metricsFromResult(type, result, payload) {
  if (type === "interpolate") {
    return [
      { label: "采样点数", value: payload.x.length },
      { label: "查询点数", value: payload.query.length },
      {
        label: "查询值",
        value: result.queryY.map((v, i) => `y(${formatNum(result.queryX[i])})=${formatNum(v)}`).join("; "),
      },
    ];
  }
  if (type === "integrate") {
    if (result.compare && result.method === "sweep") {
      return (result.compare || []).map((c) => ({
        label: c.name,
        value: `I≈${formatNum(c.metrics?.value ?? c.value, 8)}`,
      }));
    }
    if (result.compare) {
      return (result.compare || []).map((c) => ({
        label: c.name,
        value: `I≈${formatNum(c.value, 8)}，err≈${formatNum(c.absErrEst, 4)}`,
      }));
    }
    const rows = [
      { label: "积分近似值", value: formatNum(result.value, 8) },
      {
        label:
          result.errSource === "adaptive"
            ? "自适应误差估计"
            : result.errSource === "richardson"
              ? "Richardson 误差估计"
              : "算法误差估计",
        value: formatNum(result.absErrEst, 4),
      },
      { label: "区间", value: `[${payload.a}, ${payload.b}]` },
    ];
    if (result.nEvals != null) rows.push({ label: "函数求值次数", value: result.nEvals });
    if (result.exactValue != null) {
      rows.push({ label: "解析值", value: formatNum(result.exactValue, 8) });
      rows.push({ label: "对解析绝对误差", value: formatNum(result.absErrExact, 4) });
    }
    return rows;
  }
  if (type === "ode") {
    if (result.compare && result.method === "sweep") {
      return (result.compare || []).map((c) => ({
        label: c.name,
        value: `y(tf)≈${formatNum(c.metrics?.yEnd ?? c.yEnd, 8)}`,
      }));
    }
    if (result.compare) {
      return (result.compare || []).map((c) => ({
        label: c.name,
        value: `y(tf)≈${formatNum(c.yEnd, 8)}，err≈${formatNum(c.errEst, 4)}`,
      }));
    }
    const rows = [
      { label: "y(tf)", value: formatNum(result.yEnd, 8) },
      { label: "步长 h", value: formatNum(result.h, 6) },
      {
        label:
          result.errSource === "adaptive"
            ? "自适应误差估计"
            : result.errSource === "richardson"
              ? "Richardson 误差估计"
              : "算法误差估计",
        value: formatNum(result.errEst, 4),
      },
    ];
    if (result.nSteps != null) rows.push({ label: "自适应步数", value: result.nSteps });
    if (result.rmseExact != null) {
      rows.push({ label: "对解析 RMSE", value: formatNum(result.rmseExact, 4) });
      rows.push({ label: "对解析最大误差", value: formatNum(result.maxAbsExact, 4) });
    }
    return rows;
  }
  if (type === "imagefit") {
    return [
      { label: "采样点数", value: result.sampleX.length },
      { label: "拟合方程", value: result.equation },
      { label: "次数", value: result.degree },
      { label: "R²", value: formatNum(result.r2, 6) },
      { label: "RMSE", value: formatNum(result.rmse, 6) },
    ];
  }
  if (type === "transform") {
    if (result.compare) {
      return (result.compare || []).map((c) => ({
        label: c.name,
        value: `峰频≈${formatNum(c.fPeak, 4)}，峰幅≈${formatNum(c.magPeak, 4)}`,
      }));
    }
    const rows = [
      { label: "变换", value: result.method },
      { label: "峰值频率 (Hz)", value: formatNum(result.fPeak, 5) },
      { label: "峰值幅度", value: formatNum(result.magPeak, 5) },
    ];
    if (result.fs) rows.push({ label: "采样率 fs", value: formatNum(result.fs, 4) });
    if (result.N) rows.push({ label: "FFT 点数 N", value: result.N });
    if (result.sigma != null && result.method === "laplace") {
      rows.push({ label: "σ", value: formatNum(result.sigma, 4) });
    }
    return rows;
  }
  if (type === "pde") {
    const m = result.metrics || {};
    return Object.entries(m).map(([k, v]) => ({
      label: k,
      value: typeof v === "number" ? formatNum(v, 6) : String(v),
    }));
  }
  if (type === "control") {
    if (result.compare && result.method === "sweep") {
      return (result.compare || []).map((c) => ({
        label: c.name,
        value: Object.entries(c.metrics || {})
          .slice(0, 3)
          .map(([k, v]) => `${k}=${typeof v === "number" ? formatNum(v, 4) : v}`)
          .join("; "),
      }));
    }
    const m = result.metrics || {};
    return Object.entries(m).map(([k, v]) => ({
      label: k,
      value: typeof v === "number" ? formatNum(v, 6) : String(v),
    }));
  }
  const m = result.metrics || {};
  return Object.entries(m).map(([k, v]) => ({
    label: k,
    value: typeof v === "number" ? formatNum(v, 6) : String(v),
  }));
}
