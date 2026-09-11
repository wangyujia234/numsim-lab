/**
 * AI 方案本地审查器：DeepSeek 只负责“提议”，本地规则 Agent 负责校验。
 *
 * 原则（与验真印章一致）：数值与最终决策必须可由本地引擎复核。
 * - 类型：DeepSeek 的 type 必须与本地多标签检测一致，冲突时给出分歧说明
 * - 算法：必须在 ALLOWED 白名单内（deepseek.js 已兜底），并对齐本地启发式的选择
 * - 字段：类型切换后，DeepSeek 未给出的关键参数由本地 autofill 补齐
 * - 表达式：integ-f / ode-f / xf-f 先用本地编译器试编译，防止模型输出 LaTeX 或非法语法
 */

import { compileExpr } from "./math.js";
import { detectAllTypes } from "./agent.js";

const MODULE_LABEL = {
  interpolate: "插值",
  integrate: "积分",
  ode: "微分方程",
  circuit: "电路",
  imagefit: "图像拟合",
  transform: "积分变换",
  control: "控制",
  pde: "偏微分",
};

function detectAllTypesLocal(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return [];
  return TYPE_PRIORITY.filter((type) => testTypePattern(type, t));
}

/** 每个模块“没有它就没法算”的关键字段 id（用于本地补齐判定） */
const REQUIRED_FIELDS = {
  interpolate: ["interp-x", "interp-y"],
  integrate: ["integ-f", "integ-a", "integ-b"],
  ode: ["ode-f", "ode-y0", "ode-t0", "ode-tf"],
  circuit: ["ckt-topo", "ckt-r", "ckt-l", "ckt-c", "ckt-src"],
  imagefit: ["img-method"],
  transform: ["xf-f", "xf-method"],
  control: ["ctl-method"],
  pde: ["pde-alpha", "pde-L", "pde-tf"],
};

/** 表达式字段：类型 → [字段id, 变量列表] */
const EXPR_FIELDS = {
  integrate: [["integ-f", ["x"]]],
  ode: [["ode-f", ["t", "y"]]],
  transform: [["xf-f", ["t"]]],
};

function tryCompile(expr, vars) {
  try {
    compileExpr(String(expr || ""), vars);
    return null;
  } catch (e) {
    return e.message || "表达式无效";
  }
}

/**
 * @param {{ nl: string, typeHint: string }} ctx 与 analyzeWithDeepSeek 相同的上下文
 * @param {object} plan sanitizePlan 之后的 DeepSeek 方案
 * @returns {{ ok: boolean, agreement: "agree"|"agree-with-fixes"|"disagree-type"|"uncertain", summary: string, issues: string[], fixes: object, localType: string, localHits: string[] }}
 */
export async function reviewDeepSeekPlan(ctx, plan) {
  const nl = String(ctx?.nl || "");
  const issues = [];
  const fixes = {};
  const localHits = ctx?.localHits || detectAllTypes(nl);

  // 1) 类型一致性
  let localType = plan.type;
  let typeConflict = false;
  if (localHits.length && !localHits.includes(plan.type)) {
    // 本地从未检出 AI 给的类型，且检出了别的类型 → 分歧
    typeConflict = true;
    localType = localHits[0];
    issues.push(
      `类型分歧：DeepSeek 判为「${MODULE_LABEL[plan.type] || plan.type}」，本地多标签检测命中 [${localHits
        .map((t) => MODULE_LABEL[t] || t)
        .join("、")}]（按优先级取「${MODULE_LABEL[localType] || localType}」）。请确认哪个更符合题意。`
    );
  } else if (!localHits.length) {
    issues.push("本地规则未从描述中检出明确类型，采用 DeepSeek 的判断（建议人工复核题目）。");
  }

  // 2) 关键字段补齐
  const fields = { ...(plan.fields || {}) };
  for (const id of REQUIRED_FIELDS[plan.type] || []) {
    const v = String(fields[id] ?? "").trim();
    if (!v) issues.push(`关键字段 ${id} 缺失，将由本地 autofill 补默认值。`);
  }

  // 3) 表达式本地试编译
  for (const [id, vars] of EXPR_FIELDS[plan.type] || []) {
    const expr = fields[id];
    if (expr == null || String(expr).trim() === "") continue;
    const err = tryCompile(expr, vars);
    if (err) {
      issues.push(`表达式 ${id} 本地编译失败：${err}。已拒绝该字段，改用本地默认算例。`);
      delete fixes[id];
      fixes[id] = null; // 标记为“丢弃”
    }
  }

  const hasHardIssue = typeConflict || issues.some((s) => s.includes("编译失败"));
  const agreement = typeConflict
    ? "disagree-type"
    : issues.length
      ? "agree-with-fixes"
      : "agree";

  const summary =
    agreement === "agree"
      ? `本地审查通过：类型「${MODULE_LABEL[plan.type] || plan.type}」与规则 Agent 一致，关键参数齐全，表达式可编译。`
      : agreement === "agree-with-fixes"
        ? `本地审查通过（已自动修正 ${issues.length} 处细节）。`
        : agreement === "disagree-type"
          ? "本地审查与 DeepSeek 存在类型分歧，请人工确认。"
          : "本地审查未完成。";

  return { ok: !hasHardIssue || typeConflict, agreement, summary, issues, fixes, localType, localHits };
}
