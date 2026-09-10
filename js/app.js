import { decide, buildIntentWarnings, detectTypeFromText } from "./agent.js";
import { autofillFromText } from "./autofill.js";
import { generateCode } from "./codegen.js";
import { runInterpolation } from "./engines/interpolate.js";
import { runIntegration } from "./engines/integrate.js";
import { runODE } from "./engines/ode.js";
import { runCircuit } from "./engines/circuit.js";
import { runImageFit } from "./engines/imagefit.js";
import { runTransform } from "./engines/transform.js";
import { runControl } from "./engines/control.js";
import { runHeat1D } from "./engines/pde.js";
import { createDigitizer } from "./imageDigitizer.js";
import { parseNumberList, formatNum } from "./math.js";
import { buildReport, metricsFromResult } from "./report.js";
import { analyzeWithDeepSeek, loadAiSettings, saveAiSettings } from "./deepseek.js";
import { validatePayload } from "./validate.js";
import { loadHistory, saveHistoryEntry, getHistoryEntry, clearHistory } from "./history.js";
import { attachAnalytical } from "./analytical.js";
import { sweepOptionsFor, linspaceSweep, runSweep } from "./sweep.js";
import { encodeSession, decodeSessionFromLocation, copyText } from "./share.js";
import { attachExampleMeta, runSelfCheck } from "./selfcheck.js";
import { buildZipBlob, downloadBlob } from "./zip.js";
import { suggestFixes } from "./fixit.js";
import {
  ASSIGNMENTS,
  listCourses,
  getAssignment,
  loadMode,
  saveMode,
  evaluateAssignment,
  buildStamp,
  stampMarkdown,
  stampHtml,
  verifyStamp,
  ENGINE_VERSION,
} from "./homework.js";

const state = {
  type: "interpolate",
  view: "home",
  mode: "demo",
  exampleFilter: "all",
  hwCourseFilter: "all",
  lastReportMd: "",
  lastPlotDataUrl: "",
  lastCodes: { python: "", matlab: "" },
  lastSelfCheck: null,
  lastStamp: null,
  activeExample: null,
  activeAssignment: null,
  digitizer: null,
  running: false,
  lastNl: "",
  pendingAiPlan: null,
  skipAiConfirm: false,
};

const TYPE_LABELS = {
  interpolate: "插值",
  integrate: "积分",
  ode: "微分方程",
  circuit: "电路计算",
  imagefit: "图像拟合",
  transform: "积分变换",
  control: "控制系统",
  pde: "偏微分方程",
};

const VIEWS = ["home", "work", "examples", "homework", "history", "report"];
const THEME_KEY = "numsim.theme";
const DRAFT_KEY = "numsim.workspace.draft.v1";
const DRAFT_VERSION = 2;
const WORKSPACE_KIND = "numsim.workspace";
const COMPARE_TYPES = new Set(["interpolate", "integrate", "ode", "transform"]);
const COMPARE_ALGOS = {
  interpolate: ["linear", "lagrange", "spline"],
  integrate: ["trapezoid", "simpson", "romberg", "adaptive"],
  ode: ["euler", "heun", "rk4", "rk45"],
  transform: ["fft", "fourier"],
};

/** Plotly 统一配置：悬停时显示工具栏，允许缩放/保存图像 */
const PLOT_CFG = {
  responsive: true,
  displayModeBar: "hover",
  displaylogo: false,
  showLink: false,
  staticPlot: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
};

/** 将 Plotly 相关 localStorage 读写转到内存，避免浏览器 Tracking Prevention 警告 */
function disablePlotlyLocalStorage() {
  try {
    const mem = Object.create(null);
    const isPlotlyKey = (k) => /plotly/i.test(String(k));
    const rawSet = Storage.prototype.setItem;
    const rawGet = Storage.prototype.getItem;
    const rawRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function patchedSet(key, value) {
      if (isPlotlyKey(key)) {
        mem[key] = String(value);
        return;
      }
      return rawSet.call(this, key, value);
    };
    Storage.prototype.getItem = function patchedGet(key) {
      if (isPlotlyKey(key)) return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      return rawGet.call(this, key);
    };
    Storage.prototype.removeItem = function patchedRemove(key) {
      if (isPlotlyKey(key)) {
        delete mem[key];
        return;
      }
      return rawRemove.call(this, key);
    };
  } catch (_) {
    /* ignore */
  }
}

const NUMBER_LIST_RE = /^[\d\s,.\-eE]*$/;

function validateNumberListInput(el, label, { required = true } = {}) {
  const raw = String(el.value ?? "");
  el.classList.remove("field-error");
  if (!NUMBER_LIST_RE.test(raw)) {
    el.classList.add("field-error");
    el.focus();
    throw new Error(`${label} 含非法字符：仅允许数字、英文逗号、小数点、负号（及科学计数 e）`);
  }
  const trimmed = raw.trim();
  if (required && !trimmed) {
    el.classList.add("field-error");
    el.focus();
    throw new Error(`${label} 不能为空`);
  }
  if (!trimmed) return;
  // 额外保证能解析为数字列表
  try {
    parseNumberList(trimmed);
  } catch (e) {
    el.classList.add("field-error");
    el.focus();
    throw new Error(`${label} 格式不正确：${e.message}`);
  }
}

const EXAMPLES = [
  {
    type: "interpolate",
    title: "样条拟合振荡采样",
    desc: "对 6 个采样点做平滑插值，并在中间查询",
    nl: "用三次样条插值拟合这些点",
    fill() {
      setVal("interp-x", "0, 1, 2, 3, 4, 5");
      setVal("interp-y", "0, 0.8, 0.9, 0.1, -0.8, -1");
      setVal("interp-query", "0.5, 2.5, 4.2");
    },
  },
  {
    type: "integrate",
    title: "阻尼正弦积分",
    desc: "∫ sin(x)e^{-0.1x} dx，自适应 Simpson",
    nl: "高精度数值积分",
    fill() {
      setVal("integ-f", "sin(x)*exp(-0.1*x)");
      setVal("integ-a", "0");
      setVal("integ-b", "10");
      setVal("integ-n", "200");
    },
  },
  {
    type: "ode",
    title: "强迫衰减 ODE",
    desc: "y' = -0.5y + sin(t)，RK4 / RK45",
    nl: "用 RK4 求解初值问题",
    fill() {
      setVal("ode-f", "-0.5*y + sin(t)");
      setVal("ode-y0", "1");
      setVal("ode-t0", "0");
      setVal("ode-tf", "20");
      setVal("ode-n", "400");
    },
  },
  {
    type: "circuit",
    title: "串联 RLC 阶跃",
    desc: "自动判定阻尼类型并画 i(t)、vc(t)",
    nl: "串联 RLC 电路阶跃响应，判断欠阻尼还是过阻尼",
    fill() {
      setVal("ckt-topo", "series_rlc");
      setVal("ckt-r", "10");
      setVal("ckt-l", "0.5");
      setVal("ckt-c", "0.001");
      setVal("ckt-src", "12");
    },
  },
  {
    type: "circuit",
    title: "RLC 频率响应",
    desc: "扫频 |Y(f)|，定位谐振",
    nl: "画串联 RLC 的交流频率响应",
    fill() {
      setVal("ckt-topo", "ac_rlc");
      setVal("ckt-r", "5");
      setVal("ckt-l", "0.2");
      setVal("ckt-c", "0.0005");
      setVal("ckt-src", "1");
    },
  },
  {
    type: "imagefit",
    title: "图像曲线拟合",
    desc: "加载演示图并自动采样，拟合多项式",
    nl: "从图像拟合曲线，用多项式最小二乘",
    async fill() {
      setVal("img-method", "poly");
      setVal("img-degree", "4");
      await state.digitizer?.loadDemoImage();
      state.digitizer?.setMargin(0.1);
      state.digitizer?.autoSample();
    },
  },
  {
    type: "transform",
    title: "阻尼正弦 FFT",
    desc: "对衰减正弦做频谱，观测主频",
    nl: "对信号做 FFT 频谱分析",
    fill() {
      setVal("xf-f", "exp(-0.3*t)*sin(2*PI*1.5*t)");
      setVal("xf-method", "fft");
      setVal("xf-t0", "0");
      setVal("xf-tf", "8");
      setVal("xf-n", "512");
      setVal("xf-fmax", "5");
      setVal("xf-sigma", "0.5");
    },
  },
  {
    type: "transform",
    title: "拉普拉斯幅频",
    desc: "数值拉普拉斯 |F(σ+jω)|",
    nl: "计算信号的拉普拉斯变换频谱",
    fill() {
      setVal("xf-f", "exp(-t)");
      setVal("xf-method", "laplace");
      setVal("xf-t0", "0");
      setVal("xf-tf", "12");
      setVal("xf-n", "200");
      setVal("xf-fmax", "4");
      setVal("xf-sigma", "0.2");
    },
  },
  {
    type: "control",
    title: "二阶欠阻尼阶跃",
    desc: "ζ=0.3, ωn=2，观察超调与振荡",
    nl: "二阶系统阶跃响应，ζ=0.3，ωn=2",
    fill() {
      setVal("ctl-method", "second_order");
      setVal("ctl-zeta", "0.3");
      setVal("ctl-wn", "2");
      setVal("ctl-K", "1");
      setVal("ctl-tf", "8");
    },
  },
  {
    type: "control",
    title: "PID 控制一阶对象",
    desc: "Kp/Ki/Kd 闭环跟踪单位阶跃",
    nl: "PID 控制一阶对象阶跃响应",
    fill() {
      setVal("ctl-method", "pid");
      setVal("ctl-kp", "2");
      setVal("ctl-ki", "1");
      setVal("ctl-kd", "0.15");
      setVal("ctl-plant", "first");
      setVal("ctl-tau", "1");
      setVal("ctl-K", "1");
      setVal("ctl-tf", "10");
    },
  },
  {
    type: "control",
    title: "Bode 图",
    desc: "G(s)=1/(s^2+s+1) 幅相频",
    nl: "画传递函数 Bode 图，分析相位裕度",
    fill() {
      setVal("ctl-method", "bode");
      setVal("ctl-num", "1");
      setVal("ctl-den", "1, 1, 1");
      setVal("ctl-fmin", "0.01");
      setVal("ctl-fmax", "100");
    },
  },
  {
    type: "control",
    title: "根轨迹",
    desc: "G(s)=1/(s(s+1)(s+2)) 随 K 的极点轨迹",
    nl: "画开环传递函数根轨迹",
    fill() {
      setVal("ctl-method", "rlocus");
      setVal("ctl-num", "1");
      // s(s+1)(s+2) = s^3+3s^2+2s → [1, 3, 2, 0]
      setVal("ctl-den", "1, 3, 2, 0");
      setVal("ctl-kmin", "0");
      setVal("ctl-kmax", "20");
      setVal("ctl-nk", "150");
    },
  },
  {
    type: "control",
    title: "数值 Z 变换",
    desc: "衰减正弦序列在单位圆上的频谱",
    nl: "对离散序列做数值 Z 变换",
    fill() {
      setVal("ctl-method", "z_transform");
      setVal("ctl-T", "0.1");
      setVal("ctl-zn", "64");
      setVal("ctl-zalpha", "0.3");
      setVal("ctl-zfreq", "1.5");
      setVal("ctl-seq", "");
    },
  },
  {
    type: "control",
    title: "极点配置",
    desc: "Ackermann 将极点配置到 -4,-5",
    nl: "状态反馈极点配置到 -4 和 -5",
    fill() {
      setVal("ctl-method", "pole_place");
      setVal("ctl-order", "2");
      setVal("ctl-A", "0,1,-2,-3");
      setVal("ctl-B", "0,1");
      setVal("ctl-poles", "-4,-5");
      setVal("ctl-tf", "4");
    },
  },
  {
    type: "control",
    title: "传感器标定",
    desc: "参考–测量线性拟合得灵敏度",
    nl: "传感器标定：拟合参考值与测量值",
    fill() {
      setVal("ctl-method", "sensor_cal");
      setVal("ctl-xref", "0,1,2,3,4,5");
      setVal("ctl-ymeas", "0.05,1.1,1.95,3.05,4.1,4.9");
      setVal("ctl-caldeg", "1");
    },
  },
  {
    type: "control",
    title: "离散 TF 阶跃",
    desc: "H(z)=0.2/(1-0.7z^{-1}) 单位阶跃 + Jury",
    nl: "离散传递函数阶跃响应并 Jury 判稳",
    fill() {
      setVal("ctl-method", "z_tf_step");
      setVal("ctl-num", "0.2");
      setVal("ctl-den", "1, -0.7");
      setVal("ctl-zn", "60");
    },
  },
  {
    type: "control",
    title: "Jury 判稳",
    desc: "特征多项式 z²−1.5z+0.7",
    nl: "对特征多项式做 Jury 稳定性判据",
    fill() {
      setVal("ctl-method", "jury");
      setVal("ctl-den", "1, -1.5, 0.7");
    },
  },
  {
    type: "pde",
    title: "一维热方程",
    desc: "u_t=0.1 u_xx，Crank–Nicolson，初值 sin(πx)",
    nl: "用 Crank-Nicolson 求解一维热传导方程，α=0.1",
    fill() {
      setVal("pde-alpha", "0.1");
      setVal("pde-L", "1");
      setVal("pde-nx", "40");
      setVal("pde-tf", "0.5");
      setVal("pde-nt", "200");
      setVal("pde-ic", "sine");
      setVal("pde-uleft", "0");
      setVal("pde-uright", "0");
      setVal("pde-scheme", "cn");
    },
  },
];

attachExampleMeta(EXAMPLES);

function $(id) {
  return document.getElementById(id);
}

function setVal(id, v) {
  $(id).value = v;
}

function setType(type) {
  state.type = type;
  const sel = $("module-select");
  if (sel && sel.value !== type) sel.value = type;
  document.querySelectorAll(".type-form").forEach((form) => {
    const on = form.id === `form-${type}`;
    form.classList.toggle("active", on);
    form.toggleAttribute("hidden", !on);
    form.setAttribute("aria-hidden", on ? "false" : "true");
  });
  const label = $("work-type-label");
  if (label) label.textContent = `当前模块：${TYPE_LABELS[type] || type}`;
  if (type === "control") syncControlFields();
  syncCompareRow();
  syncSweepOptions();
}

function syncSweepOptions() {
  const sel = $("sweep-param");
  if (!sel) return;
  const method =
    state.type === "control"
      ? $("ctl-method")?.value
      : state.type === "transform"
        ? $("xf-method")?.value
        : state.type === "pde"
          ? "heat1d"
          : "*";
  const opts = sweepOptionsFor(state.type, method || "*");
  const prev = sel.value;
  sel.innerHTML = opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
  if (!opts.length) {
    sel.innerHTML = `<option value="">当前模块暂无扫描预设</option>`;
    return;
  }
  if (opts.some((o) => o.id === prev)) sel.value = prev;
  applySweepPreset(opts.find((o) => o.id === sel.value) || opts[0]);
}

function applySweepPreset(preset) {
  if (!preset) return;
  if ($("sweep-min")) $("sweep-min").value = String(preset.min);
  if ($("sweep-max")) $("sweep-max").value = String(preset.max);
  if ($("sweep-steps")) $("sweep-steps").value = String(preset.steps);
}

function readSweepConfig() {
  if (!$("sweep-enabled")?.checked) return null;
  const opts = sweepOptionsFor(
    state.type,
    state.type === "control" ? $("ctl-method")?.value : state.type === "pde" ? "heat1d" : "*"
  );
  const id = $("sweep-param")?.value;
  const preset = opts.find((o) => o.id === id) || opts[0];
  if (!preset) return null;
  return {
    field: preset.field,
    formId: preset.formId,
    values: linspaceSweep($("sweep-min")?.value, $("sweep-max")?.value, $("sweep-steps")?.value),
    label: preset.label,
  };
}

function syncCompareRow() {
  const row = $("compare-row");
  if (!row) return;
  row.style.display = COMPARE_TYPES.has(state.type) ? "" : "none";
}

function loadTheme() {
  const t = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(t);
}

function loadWorkspaceDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || (draft.v !== 1 && draft.v !== 2)) return null;
    return draft;
  } catch {
    return null;
  }
}

function collectImageFitSnapshot({ includeImage = true } = {}) {
  const snap = state.digitizer?.exportSnapshot?.();
  if (!snap) return null;
  return {
    margin: snap.margin,
    canvasWidth: snap.canvasWidth,
    canvasHeight: snap.canvasHeight,
    points: snap.points || [],
    hasImage: !!snap.hasImage,
    imgDataUrl: includeImage ? snap.imgDataUrl || "" : "",
  };
}

function buildWorkspaceDraft({ includeImage = true } = {}) {
  const sweep = $("sweep-enabled")?.checked
    ? {
        enabled: true,
        param: $("sweep-param")?.value || "",
        min: $("sweep-min")?.value || "",
        max: $("sweep-max")?.value || "",
        steps: $("sweep-steps")?.value || "",
      }
    : null;
  return {
    v: DRAFT_VERSION,
    kind: WORKSPACE_KIND,
    savedAt: Date.now(),
    mode: state.mode,
    type: state.type,
    view: state.view,
    nl: $("nl-input")?.value || "",
    fields: collectFormSnapshot(),
    compare: !!$("compare-algs")?.checked,
    sweep,
    assignmentId: state.activeAssignment?.id || null,
    imagefit: collectImageFitSnapshot({ includeImage }),
  };
}

function syncDraftBanner(draft = loadWorkspaceDraft()) {
  const banner = $("draft-banner");
  if (!banner) return;
  if (!draft) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const title = $("draft-banner-title");
  if (title) {
    title.textContent = draft.assignmentId ? `工作草稿 · 作业 ${draft.assignmentId}` : "工作草稿";
  }
  const text = $("draft-banner-text");
  if (text) {
    const ts = draft.savedAt ? new Date(draft.savedAt).toLocaleString("zh-CN") : "";
    const pts = draft.imagefit?.points?.length || 0;
    const hasImg = !!(draft.imagefit?.imgDataUrl || draft.imagefit?.hasImage);
    const imgHint = hasImg || pts ? ` · 图像拟合${hasImg ? "含图" : ""}${pts ? `${pts}点` : ""}` : "";
    text.textContent = ts
      ? `最后保存：${ts}${imgHint}。点击恢复可继续上次输入；工具栏可导出带走。`
      : `已自动保存当前输入${imgHint}。点击恢复可继续上次输入。`;
  }
}

function saveWorkspaceDraft() {
  try {
    const full = buildWorkspaceDraft({ includeImage: true });
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(full));
    } catch (err) {
      // 图像 dataURL 可能超出配额：降级为仅保存取点与参数
      if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
        const slim = buildWorkspaceDraft({ includeImage: false });
        localStorage.setItem(DRAFT_KEY, JSON.stringify(slim));
      }
    }
  } catch {
    /* ignore */
  }
  syncDraftBanner();
}

let draftSaveTimer = null;

function scheduleWorkspaceDraftSave(delay = 120) {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    saveWorkspaceDraft();
  }, delay);
}

function clearWorkspaceDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
  syncDraftBanner(null);
}

async function restoreWorkspaceDraft(draft = loadWorkspaceDraft(), { openView = true } = {}) {
  if (!draft) return false;
  const assignment = draft.assignmentId ? getAssignment(draft.assignmentId) : null;

  if (assignment) {
    state.activeAssignment = assignment;
    setMode("homework", { persist: false });
    setType(assignment.type);
    if (assignment.nl) $("nl-input").value = assignment.nl;
    applyAiFields(assignment.fields || {});
    applyFieldLocks(assignment.lockedFields || []);
    syncHwBanner();
    const locked = new Set(assignment.lockedFields || []);
    for (const [id, value] of Object.entries(draft.fields || {})) {
      if (locked.has(id)) continue;
      const el = $(id);
      if (el) el.value = String(value);
    }
  } else {
    state.activeAssignment = null;
    unlockAllFields();
    setMode(draft.mode || "demo", { persist: false });
    setType(draft.type || "interpolate");
    if (draft.nl != null) $("nl-input").value = draft.nl;
    applyAiFields(draft.fields || {});
    if (state.type === "control") syncControlFields();
    syncHwBanner();
  }

  if ($("compare-algs")) $("compare-algs").checked = !!draft.compare;
  if (draft.sweep?.enabled && $("sweep-enabled")) {
    $("sweep-enabled").checked = true;
    syncSweepOptions();
    if (draft.sweep.param && $("sweep-param")) $("sweep-param").value = draft.sweep.param;
    if (draft.sweep.min != null && $("sweep-min")) $("sweep-min").value = String(draft.sweep.min);
    if (draft.sweep.max != null && $("sweep-max")) $("sweep-max").value = String(draft.sweep.max);
    if (draft.sweep.steps != null && $("sweep-steps")) $("sweep-steps").value = String(draft.sweep.steps);
  } else if ($("sweep-enabled")) {
    $("sweep-enabled").checked = false;
    syncSweepOptions();
  }

  const imgNotes = await restoreImageFitSnapshot(draft.imagefit);

  if (openView) setView("work", { syncHash: false });
  scheduleWorkspaceDraftSave();
  syncDraftBanner(draft);
  logSteps(["已恢复工作草稿", "可直接继续编辑参数并重新运行", ...imgNotes]);
  return true;
}

async function restoreImageFitSnapshot(imagefit) {
  const notes = [];
  if (!imagefit || !state.digitizer?.restoreSnapshot) return notes;
  try {
    await state.digitizer.restoreSnapshot(imagefit);
    const n = imagefit.points?.length || 0;
    if (imagefit.imgDataUrl) {
      notes.push(n ? `图像拟合状态已恢复（${n} 个取点）` : "图像拟合图片已恢复");
    } else if (n) {
      notes.push(`图像拟合取点已恢复（${n} 个；图片未存入草稿，可重新上传）`);
    }
  } catch (e) {
    notes.push(`图像拟合状态恢复失败：${e.message || e}`);
  }
  return notes;
}

function workspaceExportFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `numsim-workspace-${stamp}.json`;
}

function exportWorkspaceFile() {
  const payload = {
    ...buildWorkspaceDraft({ includeImage: true }),
    kind: WORKSPACE_KIND,
    exportedAt: Date.now(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, workspaceExportFilename());
  logSteps(["工作区已导出为 JSON", "可在其他浏览器导入以恢复完整状态（含图像拟合）"]);
}

function parseWorkspacePayload(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || typeof data !== "object") throw new Error("无效的工作区文件");
  if (data.kind && data.kind !== WORKSPACE_KIND) throw new Error("文件类型不是 NumSim 工作区");
  if (data.v != null && data.v !== 1 && data.v !== 2) throw new Error(`不支持的工作区版本：${data.v}`);
  if (!data.type && !data.fields) throw new Error("工作区文件缺少必要字段");
  return data;
}

async function importWorkspaceFile(file) {
  if (!file) throw new Error("未选择文件");
  const text = await file.text();
  const data = parseWorkspacePayload(text);
  const ok = await restoreWorkspaceDraft(data);
  if (!ok) throw new Error("无法恢复工作区");
  saveWorkspaceDraft();
  logSteps(["工作区已从文件导入", "表单、草稿与图像拟合状态已写回"]);
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  const btn = $("btn-theme");
  if (btn) btn.textContent = next === "light" ? "深色" : "浅色";
}

function plotColors() {
  const light = document.documentElement.getAttribute("data-theme") === "light";
  return {
    paper: light ? "#f4f7f8" : "#0a1216",
    font: light ? "#1a2a32" : "#c9dde4",
    grid: light ? "rgba(30,60,70,0.12)" : "rgba(180,210,220,0.12)",
    zero: light ? "rgba(30,60,70,0.22)" : "rgba(180,210,220,0.2)",
  };
}

/** 切换主界面：home / work / examples / report */
function setView(view, { syncHash = true } = {}) {
  if (!VIEWS.includes(view)) view = "home";
  state.view = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const on = panel.dataset.viewPanel === view;
    panel.classList.toggle("active", on);
    if (on) {
      panel.removeAttribute("hidden");
      panel.removeAttribute("aria-hidden");
      if ("inert" in panel) panel.inert = false;
    } else {
      panel.setAttribute("hidden", "");
      panel.setAttribute("aria-hidden", "true");
      if ("inert" in panel) panel.inert = true;
    }
  });
  document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (syncHash) {
    const hash = view === "home" ? "#home" : `#${view}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }
  if (view === "work") {
    requestAnimationFrame(() => {
      const plot = $("plot");
      if (plot?.data && typeof Plotly !== "undefined") {
        try {
          Plotly.Plots.resize(plot);
        } catch (_) {
          /* ignore */
        }
      }
    });
  }
  if (view === "examples") applyExampleFilter(state.exampleFilter);
  if (view === "homework") renderHomework();
  if (view === "history") renderHistory();
}

function applyExampleFilter(filter) {
  state.exampleFilter = filter || "all";
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.filter === state.exampleFilter);
  });
  let visible = 0;
  document.querySelectorAll(".example-card").forEach((card) => {
    const t = card.dataset.type || "";
    const show = state.exampleFilter === "all" || t === state.exampleFilter;
    card.style.display = show ? "" : "none";
    if (show) visible += 1;
  });
  const empty = $("example-empty");
  if (empty) empty.hidden = visible > 0;
}

function openModule(type) {
  setType(type);
  setView("work");
  if (type === "control") syncControlFields();
  if (type === "imagefit") {
    logSteps(["已打开图像拟合模块", "请先加载演示图或上传图片，再点击自动采样/仿真"]);
  } else {
    const filled = applyAutofill({ forceGenerate: true, allowGenerate: true, fixedType: type });
    if (filled) {
      logSteps([
        `已打开模块：${TYPE_LABELS[type] || type}`,
        ...filled.notes.map((n) => `自动数据：${n}`),
        "参数已更新，可直接点击仿真",
      ]);
    }
  }
  scheduleWorkspaceDraftSave();
}

function setMode(mode, { persist = true } = {}) {
  const next = mode === "homework" ? "homework" : "demo";
  state.mode = next;
  document.body.setAttribute("data-mode", next);
  if (persist) saveMode(next);
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === next);
  });
  if (next === "homework") {
    // 作业模式默认关闭 DeepSeek，避免把模型口述当数值答案
    if ($("ai-enabled")?.checked) {
      $("ai-enabled").checked = false;
      const settings = readAiSettingsFromUi();
      saveAiSettings(settings);
      syncAiUi(settings);
    }
    if ($("compare-algs")) $("compare-algs").checked = false;
    if ($("sweep-enabled")) $("sweep-enabled").checked = false;
    logSteps(["已进入作业模式：数值仅认本地引擎 + 教师自检"]);
  } else if (!state.activeAssignment) {
    unlockAllFields();
    syncHwBanner();
  }
  syncHwBanner();
  syncInputLead();
}

function unlockAllFields() {
  document.querySelectorAll(".field-locked").forEach((el) => {
    el.classList.remove("field-locked");
    el.removeAttribute("readonly");
    if (el.tagName === "SELECT") el.disabled = false;
  });
}

function applyFieldLocks(lockedIds = []) {
  unlockAllFields();
  for (const id of lockedIds) {
    const el = $(id);
    if (!el) continue;
    el.classList.add("field-locked");
    if (el.tagName === "SELECT") el.disabled = true;
    else el.setAttribute("readonly", "readonly");
  }
}

function syncHwBanner() {
  const banner = $("hw-banner");
  if (!banner) return;
  const a = state.activeAssignment;
  if (!a || state.mode !== "homework") {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if ($("hw-banner-title")) $("hw-banner-title").textContent = `${a.course} · ${a.title}`;
  if ($("hw-banner-problem")) $("hw-banner-problem").textContent = a.problem;
  if ($("hw-banner-hint")) $("hw-banner-hint").textContent = `自检：${a.expectHint || ""}`;
}

function collectLockValues(assignment) {
  const out = {};
  for (const id of assignment?.lockedFields || []) {
    out[id] = $(id)?.value ?? assignment?.fields?.[id] ?? "";
  }
  return out;
}

function setIcanDemoStep(step, { fail = false } = {}) {
  const root = $("ican-demo-steps");
  if (!root) return;
  root.hidden = false;
  const order = ["lock", "run", "check", "seal"];
  const idx = order.indexOf(step);
  root.querySelectorAll("li").forEach((li) => {
    const key = li.dataset.step;
    const i = order.indexOf(key);
    li.classList.remove("active", "done", "fail");
    if (fail && key === step) li.classList.add("fail");
    else if (i < idx) li.classList.add("done");
    else if (i === idx) li.classList.add(fail ? "fail" : "active");
  });
}

function hideIcanDemoSteps() {
  const root = $("ican-demo-steps");
  if (!root) return;
  root.hidden = true;
  root.querySelectorAll("li").forEach((li) => li.classList.remove("active", "done", "fail"));
}

function highlightVerifySeal() {
  const seal = document.querySelector("#report-body .verify-seal") || $("verify-seal-block");
  if (!seal) return;
  seal.classList.add("pulse");
  seal.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => seal.classList.remove("pulse"), 1600);
}

function syncTeacherVerifyUi() {
  const btn = $("btn-verify-current");
  if (btn) btn.disabled = !state.lastStamp;
}

function showTeacherVerifyResult(result) {
  const el = $("teacher-verify-result");
  if (!el) return;
  el.hidden = false;
  el.classList.toggle("ok", !!result.ok);
  el.classList.toggle("bad", !result.ok);
  el.textContent = result.message || (result.ok ? "匹配" : "不匹配");
}

async function runIcanDemo() {
  if (state.running) {
    logSteps([], "仿真进行中，请稍候再开演示");
    return;
  }
  const assignment = getAssignment("na-integ-01");
  if (!assignment) {
    logSteps([], "演示题 na-integ-01 未找到");
    return;
  }
  try {
    setIcanDemoStep("lock");
    applyAssignment(assignment);
    logSteps([
      "iCAN 验真演示开始",
      `题目：${assignment.title}`,
      `已锁定：${(assignment.lockedFields || []).join(", ")}`,
    ]);
    await new Promise((r) => setTimeout(r, 280));

    setIcanDemoStep("run");
    const ok = await runPipeline({ skipAi: true });
    if (!ok) {
      setIcanDemoStep("run", { fail: true });
      return;
    }

    setIcanDemoStep("check");
    if (state.lastSelfCheck && state.lastSelfCheck.pass === false) {
      setIcanDemoStep("check", { fail: true });
      logSteps([], `自检未通过：${state.lastSelfCheck.message || ""}`);
      setView("report");
      return;
    }

    setIcanDemoStep("seal");
    setView("report");
    syncTeacherVerifyUi();
    const steps = $("ican-demo-steps");
    if (steps) {
      steps.querySelectorAll("li").forEach((li) => {
        li.classList.remove("active", "fail");
        li.classList.add("done");
      });
    }
    requestAnimationFrame(() => highlightVerifySeal());
    if (state.lastStamp) {
      const verify = await verifyStamp(state.lastStamp);
      showTeacherVerifyResult(verify);
    }
    logSteps([
      "演示完成：本地计算 → 自检通过 → 验真印章",
      "可点「复核当前结果」或打包 Zip 交给教师核对",
    ]);
  } catch (e) {
    setIcanDemoStep("run", { fail: true });
    logSteps([], e.message || String(e));
  }
}

function applyAssignment(assignment) {
  if (!assignment) return;
  setMode("homework");
  state.activeAssignment = assignment;
  state.activeExample = null;
  state.skipAiConfirm = true;
  setType(assignment.type);
  if (assignment.nl) $("nl-input").value = assignment.nl;
  applyAiFields(assignment.fields || {});
  if (assignment.type === "control") syncControlFields();
  if (assignment.type === "circuit" && assignment.fields?.["ckt-topo"]) {
    $("ckt-topo").value = assignment.fields["ckt-topo"];
  }
  applyFieldLocks(assignment.lockedFields || []);
  syncHwBanner();
  syncInputLead();
  setView("work");
  scheduleWorkspaceDraftSave();
  logSteps([
    `已载入作业：${assignment.title}`,
    `锁定字段：${(assignment.lockedFields || []).join(", ") || "无"}`,
    `自检：${assignment.expectHint || ""}`,
    "请点击仿真；通过后可打包提交",
  ]);
}

function clearAssignment() {
  state.activeAssignment = null;
  unlockAllFields();
  syncHwBanner();
  logSteps(["已退出当前作业题（仍可保持作业模式）"]);
  scheduleWorkspaceDraftSave();
}

function renderHomework() {
  const grid = $("homework-grid");
  const filters = $("hw-filters");
  if (!grid) return;
  if (filters && !filters.dataset.ready) {
    for (const course of listCourses()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.dataset.hwCourse = course;
      chip.textContent = course;
      chip.addEventListener("click", () => {
        state.hwCourseFilter = course;
        filters.querySelectorAll(".filter-chip").forEach((c) => {
          c.classList.toggle("active", c.dataset.hwCourse === course);
        });
        renderHomework();
      });
      filters.appendChild(chip);
    }
    filters.querySelector('[data-hw-course="all"]')?.addEventListener("click", () => {
      state.hwCourseFilter = "all";
      filters.querySelectorAll(".filter-chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.hwCourse === "all");
      });
      renderHomework();
    });
    filters.dataset.ready = "1";
  }
  grid.innerHTML = "";
  ASSIGNMENTS.filter(
    (a) => state.hwCourseFilter === "all" || a.course === state.hwCourseFilter
  ).forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hw-card";
    btn.innerHTML = `<span class="hw-course">${escapeHtml(a.course)}</span><p class="hw-title">${escapeHtml(
      a.title
    )}</p><p class="hw-desc">${escapeHtml(a.problem.slice(0, 72))}…</p><p class="hw-expect">自检：${escapeHtml(
      a.expectHint || ""
    )}</p>`;
    btn.addEventListener("click", () => applyAssignment(a));
    grid.appendChild(btn);
  });
}

/** 按控制系统仿真类型显示/隐藏相关参数行 */
function syncControlFields() {
  const method = $("ctl-method")?.value || "second_order";
  const form = $("form-control");
  if (!form) return;
  form.querySelectorAll("[data-ctl]").forEach((el) => {
    const allow = String(el.dataset.ctl || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const show = allow.includes(method);
    el.style.display = show ? "" : "none";
  });
}


function logSteps(steps, error) {
  const box = $("agent-log");
  if (error) {
    box.innerHTML = `<p class="step" style="color:var(--danger)">错误：${escapeHtml(error)}</p>`;
    return;
  }
  box.innerHTML = steps.map((s, i) => `<p class="step"><strong>${i + 1}.</strong> ${escapeHtml(s)}</p>`).join("");
}

/** P0-1: 多意图未被当前模块覆盖时，在结果区顶部给出醒目警示条 */
function showIntentWarning(warnings) {
  const box = $("intent-warning");
  if (!box) return;
  box.innerHTML = warnings.map((w) => `<div class="intent-warning-item">${escapeHtml(w).replace(/\n/g, "<br/>")}</div>`).join("");
  box.hidden = false;
}

function hideIntentWarning() {
  const box = $("intent-warning");
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readPayload(type) {
  if (type === "interpolate") {
    validateNumberListInput($("interp-x"), "采样点 x");
    validateNumberListInput($("interp-y"), "采样点 y");
    validateNumberListInput($("interp-query"), "查询点", { required: false });
    const x = parseNumberList($("interp-x").value);
    const y = parseNumberList($("interp-y").value);
    if (x.length !== y.length) throw new Error("x 与 y 长度必须一致");
    if (x.length < 2) throw new Error("至少需要 2 个采样点");
    let query = parseNumberList($("interp-query").value);
    if (!query.length) query = [(Math.min(...x) + Math.max(...x)) / 2];
    return { x, y, query };
  }
  if (type === "integrate") {
    return {
      expr: $("integ-f").value.trim(),
      a: Number($("integ-a").value),
      b: Number($("integ-b").value),
      n: Math.max(2, Math.floor(Number($("integ-n").value) || 100)),
    };
  }
  if (type === "ode") {
    return {
      expr: $("ode-f").value.trim(),
      y0: Number($("ode-y0").value),
      t0: Number($("ode-t0").value),
      tf: Number($("ode-tf").value),
      n: Math.max(10, Math.floor(Number($("ode-n").value) || 200)),
    };
  }
  if (type === "imagefit") {
    const pts = state.digitizer?.getDataPoints() || { x: [], y: [] };
    if (!pts.hasImage) throw new Error("请先上传图像或加载演示图");
    if (pts.x.length < 2) throw new Error("请先在图上取点，或点「自动采样曲线」");
    const method = $("img-method").value;
    const degree = Math.max(1, Math.floor(Number($("img-degree").value) || 3));
    return {
      x: pts.x,
      y: pts.y,
      method,
      degree,
      xmin: Number($("img-xmin").value),
      xmax: Number($("img-xmax").value),
      ymin: Number($("img-ymin").value),
      ymax: Number($("img-ymax").value),
    };
  }
  if (type === "transform") {
    return {
      expr: $("xf-f").value.trim(),
      method: $("xf-method").value,
      t0: Number($("xf-t0").value),
      tf: Number($("xf-tf").value),
      n: Math.max(16, Math.floor(Number($("xf-n").value) || 256)),
      fMax: Number($("xf-fmax").value) || 5,
      sigma: Number($("xf-sigma").value),
    };
  }
  if (type === "control") {
    return {
      method: $("ctl-method").value,
      zeta: Number($("ctl-zeta").value),
      wn: Number($("ctl-wn").value),
      K: Number($("ctl-K").value),
      tf: Number($("ctl-tf").value),
      num: $("ctl-num").value,
      den: $("ctl-den").value,
      Kp: Number($("ctl-kp").value),
      Ki: Number($("ctl-ki").value),
      Kd: Number($("ctl-kd").value),
      plant: $("ctl-plant").value,
      tau: Number($("ctl-tau").value),
      Va: Number($("ctl-va").value),
      fMin: Number($("ctl-fmin").value),
      fMax: Number($("ctl-fmax").value),
      kMin: Number($("ctl-kmin").value),
      kMax: Number($("ctl-kmax").value),
      nK: Math.max(50, Math.floor(Number($("ctl-nk").value) || 200)),
      T: Number($("ctl-T").value),
      zN: Math.max(8, Math.floor(Number($("ctl-zn").value) || 64)),
      zAlpha: Number($("ctl-zalpha").value),
      zFreq: Number($("ctl-zfreq").value),
      seq: $("ctl-seq").value,
      order: Number($("ctl-order").value) || 2,
      A: $("ctl-A").value,
      B: $("ctl-B").value,
      poles: $("ctl-poles").value,
      xref: $("ctl-xref").value,
      ymeas: $("ctl-ymeas").value,
      calDegree: Number($("ctl-caldeg").value) || 1,
      n: 1000,
      r: 1,
      amp: 1,
    };
  }
  if (type === "pde") {
    return {
      alpha: Number($("pde-alpha").value),
      L: Number($("pde-L").value),
      nx: Math.floor(Number($("pde-nx").value) || 40),
      tf: Number($("pde-tf").value),
      nt: Math.floor(Number($("pde-nt").value) || 200),
      ic: $("pde-ic").value,
      uLeft: Number($("pde-uleft").value),
      uRight: Number($("pde-uright").value),
      scheme: $("pde-scheme")?.value || "ftcs",
    };
  }
  return {
    topo: $("ckt-topo").value,
    R: Number($("ckt-r").value),
    L: Number($("ckt-l").value),
    C: Number($("ckt-c").value),
    src: Number($("ckt-src").value),
  };
}

function plotResult(type, result) {
  if (typeof Plotly === "undefined") {
    const box = $("plot");
    if (box) box.innerHTML = '<p class="muted">图表库加载中，请稍后重试…</p>';
    return;
  }
  const pc = plotColors();
  const layoutBase = {
    paper_bgcolor: pc.paper,
    plot_bgcolor: pc.paper,
    font: { color: pc.font, family: "Segoe UI, Microsoft YaHei, sans-serif" },
    margin: { t: 48, r: 24, b: 48, l: 56 },
    legend: { orientation: "h", y: 1.12 },
    xaxis: { gridcolor: pc.grid, zerolinecolor: pc.zero },
    yaxis: { gridcolor: pc.grid, zerolinecolor: pc.zero },
  };

  if (result.plotKind === "compare" || result.compare) {
    const colors = ["#3db8a0", "#d4a017", "#e07060", "#8ec8d8"];
    const traces = (result.series || []).map((s, i) => ({
      x: s.x,
      y: s.y,
      name: s.name,
      mode: "lines",
      line: { color: colors[i % colors.length], width: 2.2 },
    }));
    Plotly.newPlot("plot", traces, { ...layoutBase, title: result.title || "多算法对比" }, PLOT_CFG);
    return;
  }

  if (type === "pde") {
    const colors = ["#3db8a0", "#d4a017", "#e07060", "#8ec8d8", "#c090e0", "#90c070", "#70a0d0", "#d080a0"];
    const traces = (result.series || []).map((s, i) => ({
      x: s.x,
      y: s.y,
      name: s.name,
      mode: "lines",
      line: { color: colors[i % colors.length], width: 2, dash: s.dash || "solid" },
    }));
    Plotly.newPlot("plot", traces, { ...layoutBase, title: result.title || "热方程", xaxis: { ...layoutBase.xaxis, title: "x" }, yaxis: { ...layoutBase.yaxis, title: "u" } }, PLOT_CFG);
    return;
  }

  if (type === "interpolate") {
    Plotly.newPlot(
      "plot",
      [
        {
          x: result.denseX,
          y: result.denseY,
          mode: "lines",
          name: "插值曲线",
          line: { color: "#3db8a0", width: 2.4 },
        },
        {
          x: result.sampleX,
          y: result.sampleY,
          mode: "markers",
          name: "采样点",
          marker: { color: "#d4a017", size: 9 },
        },
        {
          x: result.queryX,
          y: result.queryY,
          mode: "markers",
          name: "查询点",
          marker: { color: "#e07060", size: 10, symbol: "x" },
        },
      ],
      { ...layoutBase, title: "插值结果" },
      PLOT_CFG
    );
    return;
  }

  if (type === "integrate") {
    const traces = [
      {
        x: result.xs,
        y: result.ys,
        fill: "tozeroy",
        fillcolor: "rgba(61,184,160,0.22)",
        line: { color: "#3db8a0", width: 2 },
        name: "f(x)",
      },
    ];
    const title =
      result.exactValue != null
        ? `积分 ≈ ${formatNum(result.value, 8)}（解析 ${formatNum(result.exactValue, 8)}）`
        : `积分 ≈ ${formatNum(result.value, 8)}`;
    Plotly.newPlot("plot", traces, { ...layoutBase, title }, PLOT_CFG);
    return;
  }

  if (type === "ode") {
    const traces = [
      {
        x: result.t,
        y: result.y,
        mode: "lines",
        name: "数值解 y(t)",
        line: { color: "#d4a017", width: 2.4 },
      },
    ];
    if (result.analytical) {
      traces.push({
        x: result.analytical.x,
        y: result.analytical.y,
        mode: "lines",
        name: result.analytical.name || "解析解",
        line: { color: "#3db8a0", width: 2, dash: "dash" },
      });
    }
    Plotly.newPlot(
      "plot",
      traces,
      {
        ...layoutBase,
        title: result.analytical ? "ODE：数值解 vs 解析解" : "ODE 数值解",
        xaxis: { ...layoutBase.xaxis, title: "t" },
        yaxis: { ...layoutBase.yaxis, title: "y" },
      },
      PLOT_CFG
    );
    return;
  }

  if (type === "imagefit") {
    Plotly.newPlot(
      "plot",
      [
        {
          x: result.denseX,
          y: result.denseY,
          mode: "lines",
          name: "拟合曲线",
          line: { color: "#3db8a0", width: 2.4 },
        },
        {
          x: result.sampleX,
          y: result.sampleY,
          mode: "markers",
          name: "图像采样点",
          marker: { color: "#d4a017", size: 7 },
        },
      ],
      { ...layoutBase, title: result.equation || "图像拟合结果" },
      PLOT_CFG
    );
    return;
  }

  if (type === "transform") {
    Plotly.newPlot(
      "plot",
      [
        {
          x: result.t,
          y: result.signal,
          name: "f(t)",
          line: { color: "#d4a017", width: 2 },
          xaxis: "x",
          yaxis: "y",
        },
        {
          x: result.freq,
          y: result.mag,
          name: result.method === "laplace" ? "|F(σ+jω)|" : "|F|",
          line: { color: "#3db8a0", width: 2.2 },
          xaxis: "x2",
          yaxis: "y2",
        },
      ],
      {
        paper_bgcolor: "#0a1216",
        plot_bgcolor: "#0a1216",
        font: { color: "#c9dde4", family: "Segoe UI, Microsoft YaHei, sans-serif" },
        title: result.title,
        margin: { t: 56, r: 24, b: 48, l: 56 },
        legend: { orientation: "h", y: 1.18 },
        xaxis: {
          domain: [0, 1],
          anchor: "y",
          title: "t",
          gridcolor: "rgba(180,210,220,0.12)",
        },
        yaxis: {
          domain: [0.55, 1],
          anchor: "x",
          title: "f(t)",
          gridcolor: "rgba(180,210,220,0.12)",
        },
        xaxis2: {
          domain: [0, 1],
          anchor: "y2",
          title: "f (Hz)",
          gridcolor: "rgba(180,210,220,0.12)",
        },
        yaxis2: {
          domain: [0, 0.42],
          anchor: "x2",
          title: "|F|",
          gridcolor: "rgba(180,210,220,0.12)",
        },
      },
      PLOT_CFG
    );
    return;
  }

  if (type === "control") {
    const colors = ["#3db8a0", "#d4a017", "#e07060", "#8ec8d8", "#c090e0", "#90c070"];
    const isBode = result.method === "bode";
    const isZ = result.method === "z_transform";
    if (isBode || isZ) {
      Plotly.newPlot(
        "plot",
        [
          {
            x: result.series[0].x,
            y: result.series[0].y,
            name: result.series[0].name,
            line: { color: colors[0], width: 2.2 },
            xaxis: "x",
            yaxis: "y",
          },
          {
            x: result.series[1].x,
            y: result.series[1].y,
            name: result.series[1].name,
            line: { color: colors[1], width: 2.2 },
            xaxis: "x2",
            yaxis: "y2",
          },
        ],
        {
          paper_bgcolor: "#0a1216",
          plot_bgcolor: "#0a1216",
          font: { color: "#c9dde4", family: "Segoe UI, Microsoft YaHei, sans-serif" },
          title: result.title,
          margin: { t: 56, r: 24, b: 48, l: 56 },
          legend: { orientation: "h", y: 1.18 },
          xaxis: {
            type: isBode ? "log" : "linear",
            domain: [0, 1],
            anchor: "y",
            title: isBode ? "f (Hz)" : "ω (rad/sample)",
            gridcolor: "rgba(180,210,220,0.12)",
          },
          yaxis: {
            domain: [0.55, 1],
            anchor: "x",
            title: isBode ? "dB" : "|F|",
            gridcolor: "rgba(180,210,220,0.12)",
          },
          xaxis2: {
            type: isBode ? "log" : "linear",
            domain: [0, 1],
            anchor: "y2",
            title: isBode ? "f (Hz)" : "ω (rad/sample)",
            gridcolor: "rgba(180,210,220,0.12)",
          },
          yaxis2: {
            domain: [0, 0.42],
            anchor: "x2",
            title: isBode ? "deg" : "phase (rad)",
            gridcolor: "rgba(180,210,220,0.12)",
          },
        },
        PLOT_CFG
      );
      return;
    }
    if (result.method === "rlocus") {
      const traces = result.series.map((s, i) => {
        const isMarker = s.mode === "markers";
        return {
          x: s.x,
          y: s.y,
          name: s.name,
          mode: s.mode || "lines",
          ...(isMarker
            ? { marker: { size: 10, symbol: s.markerSymbol || "x", color: colors[i % colors.length] } }
            : {}),
          ...(isMarker ? {} : { line: { width: 1.8, color: colors[i % colors.length] } }),
        };
      });
      Plotly.newPlot(
        "plot",
        traces,
        {
          ...layoutBase,
          title: result.title,
          xaxis: { ...layoutBase.xaxis, title: "Re", zeroline: true, scaleanchor: "y", scaleratio: 1 },
          yaxis: { ...layoutBase.yaxis, title: "Im", zeroline: true },
        },
        PLOT_CFG
      );
      return;
    }
    if (result.method === "jury") {
      const traces = result.series.map((s, i) => ({
        x: s.x,
        y: s.y,
        name: s.name,
        mode: "lines",
        line: { width: 2, color: colors[i % colors.length] },
      }));
      Plotly.newPlot(
        "plot",
        traces,
        {
          ...layoutBase,
          title: result.title,
          xaxis: { ...layoutBase.xaxis, title: "Re", scaleanchor: "y", scaleratio: 1, zeroline: true },
          yaxis: { ...layoutBase.yaxis, title: "Im", zeroline: true },
          annotations: [
            {
              text: result.metrics?.jury_stable
                ? "Jury：渐近稳定"
                : `Jury：不稳定（${result.metrics?.fail_reason || ""}）`,
              xref: "paper",
              yref: "paper",
              x: 0.02,
              y: 0.98,
              showarrow: false,
              font: { color: layoutBase.font.color, size: 13 },
            },
          ],
        },
        PLOT_CFG
      );
      return;
    }
    const traces = result.series.map((s, i) => {
      const isMarker = s.mode === "markers";
      return {
        x: s.x,
        y: s.y,
        name: s.name,
        mode: s.mode || "lines",
        // 仅在 markers 模式下附加 marker，避免传 undefined 导致 Plotly cleanData 报错
        ...(isMarker ? { marker: { size: 8, color: colors[i % colors.length] } } : {}),
        line: {
          width: i === 0 ? 2.4 : 1.8,
          color: colors[i % colors.length],
          dash: /参考|r=/.test(s.name) ? "dash" : "solid",
        },
      };
    });
    const xTitle = result.method === "sensor_cal" ? "参考值" : "t (s)";
    Plotly.newPlot(
      "plot",
      traces,
      {
        ...layoutBase,
        title: result.title,
        xaxis: { ...layoutBase.xaxis, title: xTitle },
        yaxis: { ...layoutBase.yaxis, title: result.series[0]?.ylabel || "" },
      },
      PLOT_CFG
    );
    return;
  }

  // circuit – possibly two series; plot first on left, second on right if different units
  const traces = result.series.map((s, i) => ({
    x: s.x,
    y: s.y,
    name: s.name,
    mode: "lines",
    line: { width: 2.2, color: i === 0 ? "#3db8a0" : "#d4a017" },
    yaxis: i === 0 ? "y" : "y2",
  }));
  const multi = result.series.length > 1;
  Plotly.newPlot(
    "plot",
    traces,
    {
      ...layoutBase,
      title: `电路仿真 · ${result.topo}`,
      yaxis: { ...layoutBase.yaxis, title: result.series[0]?.ylabel || "" },
      ...(multi
        ? {
            yaxis2: {
              title: result.series[1]?.ylabel || "",
              overlaying: "y",
              side: "right",
              gridcolor: "rgba(180,210,220,0.06)",
              zerolinecolor: "rgba(180,210,220,0.15)",
            },
          }
        : {}),
      xaxis: {
        ...layoutBase.xaxis,
        title: result.topo === "ac_rlc" ? "f (Hz)" : "t (s)",
      },
    },
    PLOT_CFG
  );
}

function renderMetrics(metrics) {
  $("metrics").innerHTML = metrics
    .map(
      (m) => `<div class="metric-card"><span class="label">${escapeHtml(m.label)}</span><span class="value">${escapeHtml(String(m.value))}</span></div>`
    )
    .join("");
}

/**
 * 统一有限性守卫：递归扫描仿真结果，发现 NaN/Infinity 即记录警示。
 * 覆盖引擎静默传播非有限值的路径（如固定步长 ODE 遇到刚性/奇点）。
 */
function guardNumerics(result) {
  if (!result || typeof result !== "object") return;
  let seen = 0;
  let sample = "";
  const limit = 40000;

  const walk = (node, path) => {
    if (seen > limit || sample) return;
    if (typeof node === "number") {
      seen++;
      if (!Number.isFinite(node)) {
        sample = `${path}=${node}`;
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      if (seen > limit || sample) return;
      const v = node[k];
      if (typeof v === "function") continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };

  walk(result, "");

  if (sample) {
    result.numericsWarning = `检测到非有限数值（${sample} …）：可能存在奇点、刚性方程或数值溢出。建议换用更稳健的方法（如 rk45 自适应 / Crank–Nicolson 隐式格式），或检查参数量级。`;
  }
}

function conclusionText(type, decision, result) {
  if (type === "integrate") {
    if (result.absErrExact != null) {
      return `定积分近似值为 ${formatNum(result.value, 8)}，对解析绝对误差约 ${formatNum(result.absErrExact, 4)}。`;
    }
    const src =
      result.errSource === "adaptive"
        ? "自适应局部误差估计"
        : result.errSource === "richardson"
          ? "Richardson 外推估计"
          : "数值估计";
    return `定积分近似值为 ${formatNum(result.value, 8)}。无解析对照，${src}约 ${formatNum(result.absErrEst, 4)}。`;
  }
  if (type === "ode") {
    if (result.rmseExact != null) {
      return `在 t=tf 处 y ≈ ${formatNum(result.yEnd, 8)}。对解析解 RMSE≈${formatNum(result.rmseExact, 4)}。`;
    }
    const src =
      result.errSource === "adaptive"
        ? "自适应局部误差估计"
        : result.errSource === "richardson"
          ? "Richardson 外推估计"
          : "数值估计";
    return `在 t=tf 处 y ≈ ${formatNum(result.yEnd, 8)}。无解析对照，${src}约 ${formatNum(result.errEst, 4)}。`;
  }
  if (type === "interpolate") {
    const warn = result.rungeWarning ? ` ${result.rungeWarning}` : "";
    return `采用 ${decision.algorithmName} 完成插值。查询点数值已给出；曲线见图。${warn}`;
  }
  if (type === "imagefit") {
    return `图像数字化得到 ${result.sampleX.length} 个点。${result.equation}；R²≈${formatNum(result.r2, 5)}，RMSE≈${formatNum(result.rmse, 5)}。`;
  }
  if (type === "transform") {
    return `${decision.algorithmName} 完成。峰值频率约 ${formatNum(result.fPeak, 4)} Hz，峰值幅度约 ${formatNum(result.magPeak, 4)}。`;
  }
  if (type === "control") {
    const m = result.metrics || {};
    if (result.method === "second_order") {
      return `二阶系统判定为「${m.regime}」。超调约 ${formatNum(m.overshoot_pct, 3)}%，2% 调节时间约 ${formatNum(m.ts_2pct, 4)} s。`;
    }
    if (result.method === "pid") {
      return `PID 闭环结束：y(∞)≈${formatNum(m.y_final, 4)}，超调约 ${formatNum(m.overshoot_pct, 3)}%，e(∞)≈${formatNum(m.e_final, 4)}。`;
    }
    if (result.method === "bode") {
      return `Bode 分析：增益穿越频率 ≈ ${m.gain_crossover_Hz == null ? "未穿越" : formatNum(m.gain_crossover_Hz, 4) + " Hz"}，相位裕度 ≈ ${m.phase_margin_deg == null ? "—" : formatNum(m.phase_margin_deg, 3) + "°"}。`;
    }
    if (result.method === "dc_motor") {
      return `电机稳态转速 ≈ ${formatNum(m.w_final, 4)} rad/s，稳态电流 ≈ ${formatNum(m.ia_final, 4)} A。`;
    }
    if (result.method === "rlocus") {
      return `根轨迹：开环极点 ${m.open_poles || "—"}，K ∈ [${formatNum(m.kMin, 3)}, ${formatNum(m.kMax, 3)}]。`;
    }
    if (result.method === "z_transform") {
      return `数值 Z 变换：N=${m.N}，|F| 峰值 ≈ ${formatNum(m.max_mag, 4)}（ω≈${formatNum(m.f_peak_rad, 4)} rad/sample）。`;
    }
    if (result.method === "pole_place") {
      return `极点配置：K=[${m.K}]，闭环极点 ${m.closed_poles || "—"}，y(∞)≈${formatNum(m.y_final, 4)}。`;
    }
    if (result.method === "sensor_cal") {
      return `标定完成：${m.equation}；R²≈${formatNum(m.R2, 5)}，最大绝对误差 ≈ ${formatNum(m.max_abs_error, 4)}。`;
    }
    if (result.method === "z_tf_step") {
      return `离散阶跃完成，y[N]≈${formatNum(m.y_final, 4)}；Jury：${m.jury_stable ? "稳定" : "不稳定"}（${m.jury_note}）。`;
    }
    if (result.method === "jury") {
      return `Jury 判据：${m.jury_stable ? "渐近稳定" : "不稳定/临界"}；${m.fail_reason !== "无" ? m.fail_reason : "各条件通过"}。`;
    }
    return `传递函数阶跃完成，y(∞)≈${formatNum(m.y_final, 4)}。`;
  }
  if (type === "pde") {
    return `热方程仿真完成：r=${formatNum(result.metrics?.r_stability, 4)}，中点温度 ≈ ${formatNum(result.metrics?.u_mid_final, 4)}。`;
  }
  if (result.compare) {
    return `已对比 ${result.compare.length} 种算法，见曲线与数值页。`;
  }
  const regime = result.metrics?.regime;
  if (regime) return `串联 RLC 判定为「${regime}」。峰值电流约 ${formatNum(result.metrics.Ipeak, 4)} A。`;
  if (result.metrics?.f0) return `谐振频率 f0 ≈ ${formatNum(result.metrics.f0, 6)} Hz，品质因数 Q ≈ ${formatNum(result.metrics.Q, 4)}。`;
  if (result.metrics?.tau) return `一阶时间常数 τ ≈ ${formatNum(result.metrics.tau, 6)} s。`;
  return "电路仿真完成。";
}

function formsHaveData(type) {
  try {
    readPayload(type);
    return true;
  } catch {
    return false;
  }
}

function applyAutofill(opts = {}) {
  const nl = $("nl-input").value.trim();
  const result = autofillFromText(nl, state.type, opts);
  if (!result) return null;
  setType(result.type);
  const onlyEmpty = !!opts.onlyEmpty;
  const methodIds = new Set(["ctl-method", "ckt-topo", "xf-method", "img-method"]);
  for (const [id, value] of Object.entries(result.fields)) {
    const el = $(id);
    if (!el) continue;
    // 表单已有内容时不覆盖（方法/拓扑选择器除外），防止示例参数被默认值冲掉
    if (onlyEmpty && !methodIds.has(id) && String(el.value ?? "").trim() !== "") continue;
    el.value = value;
  }
  return result;
}

function collectFormSnapshot() {
  const ids = [
    "interp-x", "interp-y", "interp-query",
    "integ-f", "integ-a", "integ-b", "integ-n",
    "ode-f", "ode-y0", "ode-t0", "ode-tf", "ode-n",
    "ckt-topo", "ckt-r", "ckt-l", "ckt-c", "ckt-src",
    "img-method", "img-degree", "img-xmin", "img-xmax", "img-ymin", "img-ymax", "img-margin",
    "xf-f", "xf-method", "xf-t0", "xf-tf", "xf-n", "xf-fmax", "xf-sigma",
    "ctl-method", "ctl-zeta", "ctl-wn", "ctl-K", "ctl-tf", "ctl-num", "ctl-den",
    "ctl-kp", "ctl-ki", "ctl-kd", "ctl-plant", "ctl-tau", "ctl-va", "ctl-fmin", "ctl-fmax",
    "ctl-kmin", "ctl-kmax", "ctl-nk", "ctl-T", "ctl-zn", "ctl-zalpha", "ctl-zfreq", "ctl-seq",
    "ctl-order", "ctl-A", "ctl-B", "ctl-poles", "ctl-xref", "ctl-ymeas", "ctl-caldeg",
    "pde-alpha", "pde-L", "pde-nx", "pde-tf", "pde-nt", "pde-ic", "pde-uleft", "pde-uright", "pde-scheme",
  ];
  const out = {};
  for (const id of ids) {
    const el = $(id);
    if (el) out[id] = el.value;
  }
  return out;
}

function applyAiFields(fields) {
  if (!fields) return;
  for (const [id, value] of Object.entries(fields)) {
    const el = $(id);
    if (el) el.value = String(value);
  }
}

function readAiSettingsFromUi() {
  return {
    enabled: !!$("ai-enabled")?.checked,
    useProxy: !!$("ai-use-proxy")?.checked,
    model: $("ai-model")?.value || "deepseek-chat",
    apiKey: $("ai-apikey")?.value || "",
  };
}

function syncInputLead() {
  const lead = $("input-lead");
  if (!lead) return;
  if (state.mode === "homework" && state.activeAssignment) {
    lead.textContent =
      "作业模式：关键参数已锁定；点击仿真后本地引擎出数，报告带自检与 SHA-256 验真印章。";
    return;
  }
  if (state.mode === "homework") {
    lead.textContent = "作业模式：从「作业」页选题，或点首页「3 分钟验真演示」一键体验完整流程。";
    return;
  }
  const aiOn = !!$("ai-enabled")?.checked;
  lead.textContent = aiOn
    ? "演示模式 · DeepSeek 负责分析与选型，数值仍由本地引擎计算。"
    : "演示模式 · 规则 Agent 选型，本地引擎完成计算；需要验真请切到作业模式。";
}

function syncAiUi(settings) {
  if ($("ai-enabled")) $("ai-enabled").checked = !!settings.enabled;
  if ($("ai-use-proxy")) $("ai-use-proxy").checked = !!settings.useProxy;
  if ($("ai-model")) $("ai-model").value = settings.model || "deepseek-chat";
  if ($("ai-apikey")) $("ai-apikey").value = settings.apiKey || "";
  syncInputLead();
  const runBtn = $("btn-run");
  if (runBtn && !state.running) {
    runBtn.textContent = settings.enabled ? "DeepSeek 分析并仿真" : "Agent 分析并仿真";
  }
}

function enrichDecisionNames(decision2, payload) {
  if (decision2.type === "integrate") {
    const names = {
      simpson: "Simpson 1/3 法则",
      trapezoid: "复合梯形法则",
      romberg: "Romberg 外推积分",
      adaptive: "自适应 Simpson",
    };
    decision2.algorithmName = names[decision2.algorithm] || decision2.algorithmName;
  }
  if (decision2.type === "ode") {
    const names = {
      euler: "前向 Euler 法",
      heun: "改进 Euler / Heun 法",
      rk4: "经典四阶 Runge-Kutta",
      rk45: "Dormand–Prince RK45（自适应）",
    };
    decision2.algorithmName = names[decision2.algorithm] || decision2.algorithmName;
  }
  if (decision2.type === "imagefit") {
    if (payload.method === "fourier") decision2.algorithm = "fourier";
    else if (payload.method === "spline") decision2.algorithm = "spline";
    else if (payload.method === "poly") decision2.algorithm = "poly";
    decision2.algorithmName =
      decision2.algorithm === "fourier"
        ? "图像数字化 + 傅里叶级数截断"
        : decision2.algorithm === "spline"
          ? "图像数字化 + 三次样条"
          : "图像数字化 + 多项式最小二乘";
  }
  if (decision2.type === "transform") {
    decision2.algorithm = payload.method || decision2.algorithm;
    const names = {
      fft: "快速傅里叶变换 (FFT)",
      fourier: "数值傅里叶变换",
      laplace: "数值拉普拉斯变换",
    };
    decision2.algorithmName = names[decision2.algorithm] || decision2.algorithmName;
  }
  if (decision2.type === "control") {
    decision2.algorithm = payload.method || decision2.algorithm;
    $("ctl-method").value = decision2.algorithm;
    syncControlFields();
    const names = {
      second_order: "二阶系统阶跃响应 (ζ–ωn)",
      tf_step: "传递函数阶跃响应",
      pid: "PID 闭环阶跃仿真",
      bode: "Bode 幅相频特性",
      dc_motor: "直流电机电枢控制模型",
      rlocus: "根轨迹",
      z_transform: "数值 Z 变换（单位圆）",
      z_tf_step: "离散传递函数阶跃 + Jury",
      jury: "Jury 稳定性判据",
      pole_place: "状态反馈极点配置",
      sensor_cal: "传感器标定",
    };
    decision2.algorithmName = names[decision2.algorithm] || decision2.algorithmName;
  }
  if (decision2.type === "pde") {
    const scheme = payload.scheme === "cn" || decision2.algorithm === "heat1d_cn" ? "cn" : "ftcs";
    payload.scheme = scheme;
    if ($("pde-scheme")) $("pde-scheme").value = scheme;
    decision2.algorithm = scheme === "cn" ? "heat1d_cn" : "heat1d";
    decision2.algorithmName =
      scheme === "cn" ? "一维热方程 Crank–Nicolson" : "一维热方程 FTCS";
  }
  return decision2;
}

function runCompared(type, payload) {
  const algos = COMPARE_ALGOS[type] || [];
  const colorsNames = {
    linear: "线性",
    lagrange: "Lagrange",
    spline: "样条",
    trapezoid: "梯形",
    simpson: "Simpson",
    romberg: "Romberg",
    adaptive: "自适应Simpson",
    euler: "Euler",
    heun: "Heun",
    rk4: "RK4",
    rk45: "RK45",
  };
  if (type === "interpolate") {
    const series = [];
    const compare = [];
    let base = null;
    for (const method of algos) {
      const r = runInterpolation({ ...payload, method });
      if (!base) base = r;
      series.push({ name: colorsNames[method] || method, x: r.denseX, y: r.denseY });
      compare.push({ name: colorsNames[method] || method, queryY: r.queryY });
    }
    series.push({ name: "采样点", x: base.sampleX, y: base.sampleY, mode: "markers" });
    return {
      ...base,
      series,
      compare,
      plotKind: "compare",
      title: "插值多算法对比",
      method: "compare",
    };
  }
  if (type === "integrate") {
    const series = [];
    const compare = [];
    let base = null;
    for (const method of algos) {
      const r = runIntegration({ ...payload, method });
      if (!base) base = r;
      series.push({ name: `${colorsNames[method] || method} · f(x)`, x: r.xs, y: r.ys });
      compare.push({ name: colorsNames[method] || method, value: r.value, absErrEst: r.absErrEst });
    }
    return {
      ...base,
      series,
      compare,
      plotKind: "compare",
      title: "积分多算法对比（被积函数）",
      method: "compare",
    };
  }
  if (type === "transform") {
    const names = { fft: "FFT", fourier: "数值傅里叶" };
    const series = [];
    const compare = [];
    let base = null;
    for (const method of algos) {
      const r = runTransform({ ...payload, method });
      if (!base) base = r;
      series.push({ name: `${names[method] || method} |F|`, x: r.freq, y: r.mag });
      compare.push({ name: names[method] || method, fPeak: r.fPeak, magPeak: r.magPeak });
    }
    return {
      ...base,
      series,
      compare,
      plotKind: "compare",
      title: "积分变换对比（幅频）",
      method: "compare",
    };
  }
  // ode
  const series = [];
  const compare = [];
  let base = null;
  for (const method of algos) {
    const r = runODE({ ...payload, method });
    if (!base) base = r;
    series.push({ name: colorsNames[method] || method, x: r.t, y: r.y });
    compare.push({ name: colorsNames[method] || method, yEnd: r.yEnd, errEst: r.errEst });
  }
  return {
    ...base,
    series,
    compare,
    plotKind: "compare",
    title: "ODE 多算法对比",
    method: "compare",
  };
}

function confirmAiPlan(plan) {
  const dlg = $("ai-confirm-dialog");
  if (!dlg || typeof dlg.showModal !== "function" || state.skipAiConfirm) {
    return Promise.resolve("confirm");
  }
  const summary = $("ai-confirm-summary");
  const list = $("ai-confirm-fields");
  if (summary) {
    summary.textContent = `${TYPE_LABELS[plan.type] || plan.type} · ${plan.algorithmName || plan.algorithm} — ${plan.reason || ""}`;
  }
  if (list) {
    const entries = Object.entries(plan.fields || {}).slice(0, 12);
    list.innerHTML = entries
      .map(([k, v]) => `<li><code>${escapeHtml(k)}</code> = ${escapeHtml(String(v))}</li>`)
      .join("");
  }
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue || "edit");
    };
    dlg.addEventListener("close", onClose);
    dlg.showModal();
  });
}

async function capturePlotDataUrl() {
  try {
    if (typeof Plotly === "undefined" || !$("plot")?.data) return "";
    return await Plotly.toImage("plot", { format: "png", width: 900, height: 520, scale: 1.2 });
  } catch {
    return "";
  }
}

function renderSelfCheck(check) {
  const badge = $("selfcheck-badge");
  const banner = $("selfcheck-banner");
  if (!check) {
    if (badge) {
      badge.hidden = true;
      badge.textContent = "";
      badge.className = "selfcheck-badge";
    }
    if (banner) {
      banner.hidden = true;
      banner.textContent = "";
      banner.className = "selfcheck-banner";
    }
    return;
  }
  const text = `${check.pass ? "自检通过" : "自检未通过"}：${check.message}`;
  if (badge) {
    badge.hidden = false;
    badge.className = `selfcheck-badge ${check.pass ? "pass" : "fail"}`;
    badge.textContent = text;
  }
  if (banner) {
    banner.hidden = false;
    banner.className = `selfcheck-banner ${check.pass ? "pass" : "fail"}`;
    banner.innerHTML = `<strong>${check.pass ? "例题自检通过" : "例题自检未通过"}</strong> — ${escapeHtml(
      check.message
    )}${check.hint ? `<div class="muted">预期：${escapeHtml(check.hint)}</div>` : ""}`;
  }
}

function hideErrorFixes() {
  const box = $("error-fixes");
  if (!box) return;
  box.hidden = true;
  box.innerHTML = "";
}

function showErrorFixes(message, type) {
  const box = $("error-fixes");
  if (!box) return;
  const fixes = suggestFixes(message, type);
  if (!fixes.length) {
    hideErrorFixes();
    return;
  }
  box.hidden = false;
  box.innerHTML = `<p class="fix-title">可尝试一键修复</p><div class="actions"></div>`;
  const actions = box.querySelector(".actions");
  fixes.forEach((fix) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = fix.label;
    btn.addEventListener("click", () => {
      fix.apply();
      if (state.type === "control") syncControlFields();
      logSteps([`已应用修复：${fix.label}`, "可再次点击仿真"]);
      hideErrorFixes();
    });
    actions.appendChild(btn);
  });
}

function renderHistory() {
  const list = $("history-list");
  const empty = $("history-empty");
  if (!list) return;
  const items = loadHistory();
  list.innerHTML = "";
  if (empty) empty.hidden = items.length > 0;
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-card";
    const t = new Date(item.time).toLocaleString("zh-CN");
    btn.innerHTML = `<div class="htime">${escapeHtml(t)}</div><p class="htitle">${escapeHtml(TYPE_LABELS[item.type] || item.type)} · ${escapeHtml(item.algorithmName || item.algorithm || "")}</p><p class="hdesc">${escapeHtml(item.nl || item.conclusion || "")}</p>`;
    btn.addEventListener("click", () => restoreHistory(item.id));
    list.appendChild(btn);
  });
}

function restoreHistory(id) {
  const item = getHistoryEntry(id);
  if (!item) return;
  setType(item.type || "interpolate");
  if (item.nl) $("nl-input").value = item.nl;
  if (item.fields) applyAiFields(item.fields);
  if (item.type === "control") syncControlFields();
  setView("work");
  runPipeline();
}

function restoreSharedSession() {
  const sess = decodeSessionFromLocation();
  if (!sess) return false;
  setType(sess.type || "interpolate");
  if (sess.nl) $("nl-input").value = sess.nl;
  if (sess.fields) applyAiFields(sess.fields);
  if ($("compare-algs")) $("compare-algs").checked = !!sess.compare;
  if (sess.sweep?.enabled) {
    if ($("sweep-enabled")) $("sweep-enabled").checked = true;
    syncSweepOptions();
    if (sess.sweep.param && $("sweep-param")) $("sweep-param").value = sess.sweep.param;
    if (sess.sweep.min != null && $("sweep-min")) $("sweep-min").value = String(sess.sweep.min);
    if (sess.sweep.max != null && $("sweep-max")) $("sweep-max").value = String(sess.sweep.max);
    if (sess.sweep.steps != null && $("sweep-steps")) $("sweep-steps").value = String(sess.sweep.steps);
  }
  if (sess.type === "control") syncControlFields();
  setView("work", { syncHash: false });
  logSteps(["已从分享链接恢复参数", "可直接点击仿真"]);
  return true;
}

async function runPipeline(opts = {}) {
  // 防止并发：正在运行时直接忽略新的触发
  if (state.running) return false;
  if (!opts.fromExample) state.activeExample = null;
  state.running = true;
  const runBtn = $("btn-run");
  const originalBtnText = runBtn.textContent;
  const aiSettings = readAiSettingsFromUi();
  if (opts.skipAi) aiSettings.enabled = false;
  runBtn.disabled = true;
  runBtn.classList.add("btn-loading");
  runBtn.textContent = aiSettings.enabled ? "DeepSeek 分析中…" : "运行中…";

  // 进入 pipeline 前先清空上次结果，避免错误情况下旧结果残留造成误导
  clearResults({ analyzing: true });

  try {
    const nl = $("nl-input").value.trim();
    let autofillNotes = [];
    let decision2;
    let payload;

    // 作业题：强制写回锁定字段，防止篡改后仍通过自检
    if (state.activeAssignment?.fields) {
      const locked = state.activeAssignment.lockedFields || [];
      const restore = {};
      for (const id of locked) {
        if (state.activeAssignment.fields[id] != null) restore[id] = state.activeAssignment.fields[id];
      }
      applyAiFields(restore);
      applyFieldLocks(locked);
    }

    // 作业模式不走 DeepSeek 数值规划
    if (state.mode === "homework") {
      aiSettings.enabled = false;
    }

    if (aiSettings.enabled) {
      logSteps(["DeepSeek 正在分析问题…"]);
      try {
        const plan = await analyzeWithDeepSeek(
          { nl, typeHint: state.type, formSnapshot: collectFormSnapshot() },
          aiSettings
        );
        const choice = await confirmAiPlan(plan);
        if (choice === "edit") {
          setType(plan.type);
          applyAiFields(plan.fields);
          if (plan.type === "control") syncControlFields();
          logSteps([
            "DeepSeek 方案已写入表单",
            "请检查参数后再次点击仿真",
            plan.reason || "",
          ].filter(Boolean));
          return;
        }
        if (choice === "fallback") {
          throw new Error("用户选择改用本地 Agent");
        }
        setType(plan.type);
        applyAiFields(plan.fields);
        if (plan.type === "control") syncControlFields();
        payload = readPayload(plan.type);
        validatePayload(plan.type, payload);
        decision2 = {
          type: plan.type,
          algorithm: plan.algorithm,
          algorithmName: plan.algorithmName,
          reason: plan.reason,
          steps: [
            `DeepSeek（${plan.rawModel || aiSettings.model} · ${plan.via || "api"}）接管分析`,
            "用户已确认 AI 方案",
            ...plan.steps,
            ...(plan.notes || []).map((n) => `备注：${n}`),
          ],
          overrides: plan.type === "circuit" ? { topo: plan.algorithm } : {},
          source: "deepseek",
          nl,
        };
        decision2 = enrichDecisionNames(decision2, payload);
        autofillNotes = [`智能分析来源：DeepSeek · ${plan.rawModel || aiSettings.model}`];
      } catch (aiErr) {
        const isUserFallback = /改用本地 Agent/.test(aiErr.message || "");
        autofillNotes = [
          isUserFallback
            ? "已按选择改用本地 Agent"
            : `DeepSeek 失败：${aiErr.message} → 已降级本地 Agent`,
        ];
        logSteps([...autofillNotes, "改用规则 Agent 分析…"]);
        if (state.type !== "imagefit" && !/图像|图片|拟合曲线/.test(nl)) {
          const hasData = formsHaveData(state.type);
          const filled = applyAutofill({
            forceGenerate: false,
            allowGenerate: !hasData,
            onlyEmpty: hasData,
          });
          if (filled) autofillNotes.push(...filled.notes.map((n) => `自动数据：${n}`));
        }
        let typeHint = state.type;
        if (/热方程|热传导|扩散方程|pde|偏微分/.test(nl)) typeHint = "pde";
        else if (/图像|图片|拟合曲线|digitiz/.test(nl)) typeHint = "imagefit";
        else if (/电路|rlc|电容|电感|谐振|阻抗|频响/.test(nl)) typeHint = "circuit";
        else if (/傅里叶|fft|拉普拉斯|laplace|积分变换|频谱/.test(nl)) typeHint = "transform";
        else if (
          /pid|bode|传递函数|二阶系统|直流电机|控制系统|相位裕度|伺服|根轨迹|极点配置|z\s*变换|jury|传感器标定|离散.*传递/.test(nl) ||
          (/阶跃响应/.test(nl) && !/电路|rlc/.test(nl))
        )
          typeHint = "control";

        const roughPayload = (() => {
          try {
            return readPayload(typeHint);
          } catch {
            return {};
          }
        })();
        const decision = decide({ type: typeHint, nl, payload: roughPayload });
        if (decision.type !== state.type) {
          setType(decision.type);
          if (decision.type !== "imagefit" && !formsHaveData(decision.type)) {
            const again = applyAutofill({ allowGenerate: true });
            if (again) autofillNotes.push(...again.notes.map((n) => `自动数据：${n}`));
          }
        }
        payload = readPayload(decision.type);
        validatePayload(decision.type, payload);
        decision2 = decide({ type: decision.type, nl, payload });
        Object.assign(decision2.overrides, decision.overrides);
        decision2.source = "agent-fallback";
        decision2.nl = nl;
        decision2 = enrichDecisionNames(decision2, payload);
      }
    } else {
      // 图像拟合依赖画布取点，不走表单自动生成覆盖
      if (state.type !== "imagefit" && !/图像|图片|拟合曲线/.test(nl)) {
        const hasData = formsHaveData(state.type);
        const filled = applyAutofill({
          forceGenerate: false,
          allowGenerate: !hasData,
          onlyEmpty: hasData,
        });
        if (filled) autofillNotes = filled.notes.map((n) => `自动数据：${n}`);
      }

      let typeHint = state.type;
      if (/热方程|热传导|扩散方程|pde|偏微分/.test(nl)) typeHint = "pde";
      else if (/图像|图片|拟合曲线|digitiz/.test(nl)) typeHint = "imagefit";
      else if (/电路|rlc|电容|电感|谐振|阻抗|频响/.test(nl)) typeHint = "circuit";
      else if (/傅里叶|fft|拉普拉斯|laplace|积分变换|频谱/.test(nl)) typeHint = "transform";
      else if (
        /pid|bode|传递函数|二阶系统|直流电机|控制系统|相位裕度|伺服|根轨迹|极点配置|z\s*变换|jury|传感器标定|离散.*传递/.test(nl) ||
        (/阶跃响应/.test(nl) && !/电路|rlc/.test(nl))
      )
        typeHint = "control";

      const roughPayload = (() => {
        try {
          return readPayload(typeHint);
        } catch {
          return {};
        }
      })();

      const decision = decide({ type: typeHint, nl, payload: roughPayload });
      if (decision.type !== state.type) {
        setType(decision.type);
        if (decision.type !== "imagefit" && !formsHaveData(decision.type)) {
          const again = applyAutofill({ allowGenerate: true });
          if (again) autofillNotes = again.notes.map((n) => `自动数据：${n}`);
        }
      }

      payload = readPayload(decision.type);
      validatePayload(decision.type, payload);
      decision2 = decide({ type: decision.type, nl, payload });
      Object.assign(decision2.overrides, decision.overrides);
      decision2.source = "agent";
      decision2.nl = nl;
      decision2 = enrichDecisionNames(decision2, payload);
    }

    if (state.activeAssignment) {
      decision2.type = state.activeAssignment.type;
      if (state.activeAssignment.algorithm) {
        decision2.algorithm = state.activeAssignment.algorithm;
      }
      decision2.source = "homework";
      decision2.reason = `作业题 ${state.activeAssignment.id}：按教师题目包执行本地仿真`;
      decision2.steps = [
        `作业模式 · ${state.activeAssignment.course}`,
        `题目：${state.activeAssignment.title}`,
        ...(state.activeAssignment.knowledge || []).map((k) => `知识点：${k}`),
        `自检规则：${state.activeAssignment.expectHint || ""}`,
        "数值由本地引擎计算（非模型口述）",
      ];
      setType(decision2.type);
      payload = readPayload(decision2.type);
      validatePayload(decision2.type, payload);
      decision2 = enrichDecisionNames(decision2, payload);
    }

    // P0-1: 多意图检测 — 禁止静默丢弃（非作业模式才提示）
    const intentWarnings = state.mode !== "homework" ? buildIntentWarnings(nl, decision2.type) : [];
    if (intentWarnings.length) {
      decision2.intentWarnings = intentWarnings;
      decision2.steps = [...decision2.steps, ...intentWarnings.map((w) => w.replace(/\n/g, " | "))];
    }

    const wantCompare =
      state.mode !== "homework" &&
      !!$("compare-algs")?.checked &&
      COMPARE_TYPES.has(decision2.type);
    const sweepCfg =
      state.mode !== "homework" && !wantCompare ? readSweepConfig() : null;
    const headSteps = [
      ...autofillNotes,
      ...decision2.steps,
      ...(wantCompare ? ["启用多算法对比模式"] : []),
      ...(sweepCfg ? [`参数扫描：${sweepCfg.label} × ${sweepCfg.values.length}`] : []),
    ];
    logSteps([...headSteps, "生成 Python / MATLAB 代码…", "运行浏览器内数值引擎…", "绘制曲线并汇总报告…"]);
    if (intentWarnings.length) showIntentWarning(intentWarnings);
    $("algo-badge").textContent = sweepCfg
      ? `${decision2.algorithmName} · 扫描`
      : wantCompare
        ? `${decision2.algorithmName} · 对比`
        : decision2.algorithmName;

    let sim;
    if (wantCompare) {
      sim = runCompared(decision2.type, payload);
      decision2.algorithmName = `${decision2.algorithmName}（多算法对比）`;
    } else if (sweepCfg) {
      sim = runSweep({
        payload,
        field: sweepCfg.field,
        values: sweepCfg.values,
        runOnce: (p) => {
          if (decision2.type === "interpolate") return runInterpolation({ ...p, method: decision2.algorithm });
          if (decision2.type === "integrate") return runIntegration({ ...p, method: decision2.algorithm });
          if (decision2.type === "ode") return runODE({ ...p, method: decision2.algorithm });
          if (decision2.type === "control") return runControl({ ...p, method: decision2.algorithm });
          if (decision2.type === "pde") return runHeat1D(p);
          if (decision2.type === "transform") {
            return runTransform({
              method: decision2.algorithm,
              expr: p.expr,
              t0: p.t0,
              tf: p.tf,
              n: p.n,
              fMax: p.fMax,
              sigma: p.sigma,
            });
          }
          return runCircuit({ ...p, topo: decision2.overrides.topo || p.topo });
        },
        extractSeries: (r, label) => {
          if (r.series?.length) {
            const primary = r.series[0];
            return [{ name: label, x: primary.x, y: primary.y }];
          }
          if (r.t && r.y) return [{ name: label, x: r.t, y: r.y }];
          if (r.denseX) return [{ name: label, x: r.denseX, y: r.denseY }];
          if (r.xs) return [{ name: label, x: r.xs, y: r.ys }];
          if (r.freq) return [{ name: label, x: r.freq, y: r.mag }];
          return [];
        },
      });
      decision2.algorithmName = `${decision2.algorithmName}（${sweepCfg.label} 扫描）`;
    } else if (decision2.type === "interpolate") {
      sim = runInterpolation({ ...payload, method: decision2.algorithm });
    } else if (decision2.type === "integrate") {
      sim = runIntegration({ ...payload, method: decision2.algorithm });
    } else if (decision2.type === "ode") {
      sim = runODE({ ...payload, method: decision2.algorithm });
    } else if (decision2.type === "imagefit") {
      sim = runImageFit({
        x: payload.x,
        y: payload.y,
        degree: payload.degree,
        method: decision2.algorithm,
      });
    } else if (decision2.type === "transform") {
      sim = runTransform({
        method: decision2.algorithm,
        expr: payload.expr,
        t0: payload.t0,
        tf: payload.tf,
        n: payload.n,
        fMax: payload.fMax,
        sigma: payload.sigma,
      });
    } else if (decision2.type === "control") {
      sim = runControl({ ...payload, method: decision2.algorithm });
    } else if (decision2.type === "pde") {
      sim = runHeat1D(payload);
    } else {
      const topo = decision2.overrides.topo || payload.topo;
      sim = runCircuit({ ...payload, topo });
      payload.topo = topo;
      $("ckt-topo").value = topo;
    }

    if (!wantCompare && !sweepCfg) {
      sim = attachAnalytical(decision2.type, payload, sim);
    }
    guardNumerics(sim);

    const codes = generateCode(decision2, payload, sim);
    $("python-code").textContent = codes.python;
    $("matlab-code").textContent = codes.matlab;
    state.lastCodes = codes;

    plotResult(decision2.type, sim);
    const metrics = metricsFromResult(decision2.type, sim, payload);
    renderMetrics(metrics);

    const selfCheck = state.activeAssignment
      ? evaluateAssignment(state.activeAssignment, decision2.type, sim, payload)
      : state.activeExample
        ? runSelfCheck(state.activeExample, decision2.type, sim, payload)
        : null;
    state.lastSelfCheck = selfCheck;
    renderSelfCheck(selfCheck);

    const stamp = await buildStamp({
      assignment: state.activeAssignment,
      type: decision2.type,
      algorithm: decision2.algorithm,
      payload,
      metrics,
      selfCheck,
      mode: state.mode,
      aiEnabled: !!$("ai-enabled")?.checked,
      lockValues: collectLockValues(state.activeAssignment),
    });
    state.lastStamp = stamp;
    syncTeacherVerifyUi();

    const conclusion = [
      conclusionText(decision2.type, decision2, sim),
      sim.analyticalNote || "",
      sim.stabilityNote || "",
      sim.singularNote || "",
      sim.numericsWarning || "",
      selfCheck ? `自检${selfCheck.pass ? "通过" : "未通过"}：${selfCheck.message}` : "",
      state.mode === "homework" ? `验真印章 ${stamp.seal} · ${ENGINE_VERSION}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    state.lastNl = nl;
    const plotDataUrl = await capturePlotDataUrl();
    state.lastPlotDataUrl = plotDataUrl || "";
    const problemText = state.activeAssignment?.problem || nl;
    const report = buildReport(
      decision2,
      payload,
      { metrics, conclusion, analyticalNote: sim.analyticalNote || "" },
      codes,
      {
        problem: problemText,
        plotDataUrl,
        selfCheck,
        stampMarkdown: stampMarkdown(stamp),
        stampHtml: stampHtml(stamp),
      }
    );
    $("report-body").innerHTML = report.html;
    state.lastReportMd = report.markdown;
    $("btn-export").disabled = false;
    if ($("btn-export-zip")) $("btn-export-zip").disabled = false;
    const gotoReport = $("btn-goto-report");
    if (gotoReport) {
      gotoReport.hidden = false;
      gotoReport.classList.add("btn-pulse");
      setTimeout(() => gotoReport.classList.remove("btn-pulse"), 1800);
    }

    saveHistoryEntry({
      type: decision2.type,
      algorithm: decision2.algorithm,
      algorithmName: decision2.algorithmName,
      nl,
      conclusion,
      fields: collectFormSnapshot(),
      selfCheck,
      assignmentId: state.activeAssignment?.id || null,
      stampHash: stamp.resultHash,
    });
    saveWorkspaceDraft();

    hideErrorFixes();
    logSteps([
      ...headSteps,
      "代码已生成",
      "仿真完成（本地引擎）",
      plotDataUrl ? "报告已嵌入曲线图" : "报告已更新",
      `验真哈希：${stamp.resultHash.slice(0, 12)}…`,
      "已写入本地历史",
      ...(sim.analyticalNote ? [sim.analyticalNote] : []),
      ...(selfCheck ? [`作业/例题自检：${selfCheck.pass ? "通过" : "未通过"} — ${selfCheck.message}`] : []),
    ]);
    return true;
  } catch (err) {
    console.error(err);
    clearResults({ silent: false });
    logSteps([], err.message || String(err));
    showErrorFixes(err.message || String(err), state.type);
    return false;
  } finally {
    state.running = false;
    runBtn.disabled = false;
    runBtn.classList.remove("btn-loading");
    const aiOn = !!$("ai-enabled")?.checked;
    runBtn.textContent = aiOn ? "DeepSeek 分析并仿真" : "Agent 分析并仿真";
  }
}

function clearResults({ silent = true, analyzing = false } = {}) {
  // 清理 Plotly 图表（若已渲染）
  try {
    if (typeof Plotly !== "undefined" && document.getElementById("plot")) {
      Plotly.purge("plot");
    }
  } catch (_) {
    /* Plotly 未就绪时忽略 */
  }
  $("agent-log").innerHTML = analyzing
    ? `<p class="muted step-loading">分析中…</p>`
    : `<p class="muted">等待输入…</p>`;
  $("algo-badge").textContent = "算法未选定";
  $("python-code").textContent = "# 运行仿真后生成";
  $("matlab-code").textContent = "% 运行仿真后生成";
  $("metrics").innerHTML = "";
  $("report-body").innerHTML = `<p class="muted">完成一次仿真后，此处生成完整报告。</p>`;
  $("btn-export").disabled = true;
  if ($("btn-export-zip")) $("btn-export-zip").disabled = true;
  const gotoReport = $("btn-goto-report");
  if (gotoReport) {
    gotoReport.hidden = true;
    gotoReport.classList.remove("btn-pulse");
  }
  state.lastReportMd = "";
  state.lastPlotDataUrl = "";
  state.lastCodes = { python: "", matlab: "" };
  state.lastSelfCheck = null;
  state.lastStamp = null;
  renderSelfCheck(null);
  hideErrorFixes();
  hideIntentWarning();
  syncTeacherVerifyUi();
  const verifyResult = $("teacher-verify-result");
  if (verifyResult) {
    verifyResult.hidden = true;
    verifyResult.textContent = "";
    verifyResult.classList.remove("ok", "bad");
  }
  // 清除所有字段错误高亮
  document.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
}

function bindUI() {
  state.digitizer = createDigitizer({
    canvas: $("img-canvas"),
    onChange(_pts, err) {
      if (err) logSteps([], err.message || String(err));
      scheduleWorkspaceDraftSave(250);
    },
  });

  $("img-file").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    try {
      await state.digitizer.loadFile(file);
      const m = Number($("img-margin").value);
      if (Number.isFinite(m)) state.digitizer.setMargin(m);
      scheduleWorkspaceDraftSave();
      logSteps(["图像已加载", "请填写坐标轴范围，然后点击曲线取点，或点「自动采样曲线」"]);
    } catch (e) {
      logSteps([], e.message || String(e));
    }
  });

  $("btn-img-demo").addEventListener("click", async () => {
    try {
      await state.digitizer.loadDemoImage();
      scheduleWorkspaceDraftSave();
      logSteps(["演示图已加载（轴范围 0~10, -1~1）", "可点「自动采样曲线」或手动点选"]);
    } catch (e) {
      logSteps([], e.message || String(e));
    }
  });

  $("btn-img-auto").addEventListener("click", () => {
    try {
      const m = Number($("img-margin").value);
      if (Number.isFinite(m)) state.digitizer.setMargin(m);
      const n = state.digitizer.autoSample();
      scheduleWorkspaceDraftSave();
      logSteps([`自动采样完成：${n} 个点`, "确认轴范围后点「Agent 分析并仿真」拟合函数"]);
    } catch (e) {
      logSteps([], e.message || String(e));
    }
  });

  $("btn-img-undo").addEventListener("click", () => {
    state.digitizer.undo();
    scheduleWorkspaceDraftSave();
  });
  $("btn-img-clear").addEventListener("click", () => {
    state.digitizer.clearPoints();
    scheduleWorkspaceDraftSave();
  });
  $("img-margin").addEventListener("change", () => {
    const m = Number($("img-margin").value);
    if (Number.isFinite(m)) state.digitizer.setMargin(m);
    scheduleWorkspaceDraftSave();
  });

  const moduleSelect = $("module-select");
  if (moduleSelect) {
    moduleSelect.addEventListener("change", () => {
      const nextType = moduleSelect.value;
      state.activeExample = null;
      setType(nextType);
      if (nextType === "control") syncControlFields();
      if (nextType === "imagefit") {
        logSteps([`已切换到模块：${TYPE_LABELS[nextType] || nextType}`, "请先加载图片或使用演示图，再点击仿真"]);
        scheduleWorkspaceDraftSave();
        return;
      }
      const filled = applyAutofill({ forceGenerate: true, allowGenerate: true, fixedType: nextType });
      if (filled) {
        logSteps([
          `已切换到模块：${TYPE_LABELS[nextType] || nextType}`,
          ...filled.notes.map((n) => `自动数据：${n}`),
          "参数已更新，可直接点击仿真",
        ]);
      } else {
        logSteps([`已切换到模块：${TYPE_LABELS[nextType] || nextType}`, "请填写问题描述或手动调整参数后再运行"]);
      }
      scheduleWorkspaceDraftSave();
    });
  }

  const btnGotoReport = $("btn-goto-report");
  if (btnGotoReport) {
    btnGotoReport.addEventListener("click", () => setView("report"));
  }

  // 采样点输入实时校验（仅允许数字列表字符）
  ["interp-x", "interp-y", "interp-query"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      if (!NUMBER_LIST_RE.test(el.value)) {
        el.classList.add("field-error");
      } else {
        el.classList.remove("field-error");
      }
    });
    el.addEventListener("blur", () => {
      try {
        validateNumberListInput(el, id === "interp-query" ? "查询点" : id === "interp-x" ? "采样点 x" : "采样点 y", {
          required: id !== "interp-query",
        });
      } catch (e) {
        logSteps([], e.message || String(e));
      }
    });
  });

  document.querySelectorAll(".result-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".result-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".result-pane").forEach((p) => p.classList.remove("active"));
      $(`pane-${btn.dataset.pane}`).classList.add("active");
      if (btn.dataset.pane === "plot") {
        const plot = $("plot");
        if (plot?.data) Plotly.Plots.resize(plot);
      }
    });
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.copy;
      const text = $(id).textContent;
      await navigator.clipboard.writeText(text);
      btn.textContent = "已复制";
      setTimeout(() => (btn.textContent = "复制"), 1200);
    });
  });

  // metrics 复制全部
  const btnCopyMetrics = $("btn-copy-metrics");
  if (btnCopyMetrics) {
    btnCopyMetrics.addEventListener("click", async () => {
      const text = $("metrics").innerText.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btnCopyMetrics.textContent = "已复制";
        setTimeout(() => (btnCopyMetrics.textContent = "复制全部"), 1200);
      } catch (_) {
        // 剪贴板 API 在非 HTTPS / 旧浏览器中可能失败，降级提示
        btnCopyMetrics.textContent = "复制失败";
        setTimeout(() => (btnCopyMetrics.textContent = "复制全部"), 1200);
      }
    });
  }

  $("btn-run").addEventListener("click", runPipeline);
  $("btn-clear").addEventListener("click", () => clearResults({ silent: true }));
  $("btn-log-clear").addEventListener("click", () => {
    $("agent-log").innerHTML = `<p class="muted">等待输入…</p>`;
  });
  $("btn-autofill").addEventListener("click", async () => {
    if (state.type === "imagefit" || /图像|图片/.test($("nl-input").value)) {
      setType("imagefit");
      await state.digitizer.loadDemoImage();
      state.digitizer.setMargin(0.1);
      const n = state.digitizer.autoSample();
      logSteps([`已加载演示图并自动采样 ${n} 点`, "可直接点仿真，或换成你自己的图片"]);
      return;
    }
    const filled = applyAutofill({ forceGenerate: !$("nl-input").value.trim(), allowGenerate: true });
    if (!filled) {
      logSteps([], "未能生成数据");
      return;
    }
    logSteps(filled.notes.map((n) => `自动数据：${n}`).concat(["参数已写入表单，可直接点仿真"]));
  });
  $("btn-export").addEventListener("click", () => {
    const blob = new Blob([state.lastReportMd], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `numsim-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("btn-export-zip")?.addEventListener("click", () => {
    if (!state.lastReportMd) return;
    const stamp = state.lastStamp;
    const stampId = stamp?.resultHash?.slice(0, 8) || String(Date.now());
    const files = [
      { name: "report.md", content: state.lastReportMd },
      { name: "code.py", content: state.lastCodes.python || "# empty" },
      { name: "code.m", content: state.lastCodes.matlab || "% empty" },
      {
        name: "VERIFY.txt",
        content: [
          "NumSim Lab 验真说明",
          "==================",
          "本压缩包内数值结果由浏览器本地数值引擎计算，",
          "并非大模型直接生成的最终数值。",
          "",
          `引擎：${ENGINE_VERSION}`,
          `模式：${state.mode}`,
          `题目：${state.activeAssignment?.id || "自由练习"}`,
          `哈希算法：SHA-256（canonicalVersion=${stamp?.canonicalVersion || 2}）`,
          `锁定字段：${(stamp?.lockedFields || state.activeAssignment?.lockedFields || []).join(", ") || "无"}`,
          `锁参摘要：${stamp?.lockDigest || ""}`,
          `哈希：${stamp?.resultHash || ""}`,
          `自检：${state.lastSelfCheck == null ? "未启用" : state.lastSelfCheck.pass ? "通过" : "未通过"}`,
          "",
          "教师可在报告页点「复核当前结果」，或导入 stamp.json 重算哈希核对是否被改写。",
        ].join("\n"),
      },
    ];
    if (stamp) files.push({ name: "stamp.json", content: JSON.stringify(stamp, null, 2) });
    if (state.lastPlotDataUrl) files.push({ name: "plot.png", dataUrl: state.lastPlotDataUrl });
    if (state.lastSelfCheck) {
      files.push({ name: "selfcheck.json", content: JSON.stringify(state.lastSelfCheck, null, 2) });
    }
    if (state.activeAssignment) {
      files.push({
        name: "assignment.json",
        content: JSON.stringify(
          {
            id: state.activeAssignment.id,
            title: state.activeAssignment.title,
            course: state.activeAssignment.course,
            expectHint: state.activeAssignment.expectHint,
            lockedFields: state.activeAssignment.lockedFields || [],
            reflect: state.activeAssignment.reflect || [],
          },
          null,
          2
        ),
      });
    }
    const zip = buildZipBlob(files);
    downloadBlob(zip, `numsim-homework-${stampId}.zip`);
    logSteps(["作业包已下载（报告+代码+曲线+验真印章）"]);
  });

  const bindIcanDemo = (id) => {
    $(id)?.addEventListener("click", () => {
      runIcanDemo().catch((e) => logSteps([], e.message || String(e)));
    });
  };
  bindIcanDemo("btn-ican-demo");
  bindIcanDemo("btn-ican-demo-hw");

  $("btn-verify-current")?.addEventListener("click", async () => {
    if (!state.lastStamp) {
      showTeacherVerifyResult({ ok: false, message: "尚无印章，请先完成一次仿真" });
      return;
    }
    try {
      const result = await verifyStamp(state.lastStamp);
      showTeacherVerifyResult(result);
      logSteps([result.ok ? "教师复核：哈希匹配" : `教师复核失败：${result.message}`]);
    } catch (e) {
      showTeacherVerifyResult({ ok: false, message: e.message || String(e) });
    }
  });
  $("btn-verify-import")?.addEventListener("click", () => $("verify-import-file")?.click());
  $("verify-import-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const stamp = JSON.parse(text);
      const result = await verifyStamp(stamp);
      showTeacherVerifyResult(result);
      setView("report");
      logSteps([
        `已导入 stamp.json（${file.name}）`,
        result.ok ? "导入复核：哈希匹配" : `导入复核失败：${result.message}`,
      ]);
    } catch (e) {
      showTeacherVerifyResult({ ok: false, message: e.message || String(e) });
    }
  });
  syncTeacherVerifyUi();

  const grid = $("example-grid");
  EXAMPLES.forEach((ex) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "example-card";
    card.dataset.type = ex.type;
    card.innerHTML = `<span class="etype">${ex.type}</span><p class="etitle">${ex.title}</p><p class="edesc">${ex.desc}</p>${
      ex.expectHint ? `<span class="eexpect">预期：${ex.expectHint}</span>` : ""
    }`;
    card.addEventListener("click", async () => {
      card.classList.add("card-active");
      setTimeout(() => card.classList.remove("card-active"), 1200);
      state.activeExample = ex;
      state.skipAiConfirm = true;
      setType(ex.type);
      $("nl-input").value = ex.nl;
      await ex.fill();
      if (ex.type === "control") syncControlFields();
      setView("work");
      scheduleWorkspaceDraftSave();
      try {
        await runPipeline({ fromExample: true });
      } finally {
        state.skipAiConfirm = false;
      }
    });
    grid.appendChild(card);
  });

  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      setView(el.dataset.view);
    });
  });

  document.querySelectorAll("[data-open-type]").forEach((el) => {
    el.addEventListener("click", () => openModule(el.dataset.openType));
  });

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => applyExampleFilter(chip.dataset.filter));
  });

  window.addEventListener("hashchange", () => {
    if ((location.hash || "").startsWith("#s=")) {
      restoreSharedSession();
      scheduleWorkspaceDraftSave();
      return;
    }
    const raw = (location.hash || "#home").replace(/^#/, "") || "home";
    const view = VIEWS.includes(raw) ? raw : "home";
    setView(view, { syncHash: false });
  });

  const ctlMethod = $("ctl-method");
  if (ctlMethod) {
    // change 已在下方与 syncSweepOptions 一并绑定
    syncControlFields();
  }

  loadTheme();
  syncCompareRow();
  syncSweepOptions();
  setMode(loadMode(), { persist: false });
  const draftAutosaveRoot = $("view-work");
  if (draftAutosaveRoot) {
    ["input", "change", "click"].forEach((eventName) => {
      draftAutosaveRoot.addEventListener(eventName, () => scheduleWorkspaceDraftSave());
    });
  }
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode);
      scheduleWorkspaceDraftSave();
    });
  });
  $("btn-hw-clear")?.addEventListener("click", () => clearAssignment());
  $("btn-draft-restore")?.addEventListener("click", () => {
    restoreWorkspaceDraft().catch((e) => logSteps([], e.message || String(e)));
  });
  $("btn-draft-clear")?.addEventListener("click", () => {
    clearWorkspaceDraft();
    logSteps(["已清除本地工作草稿"]);
  });
  $("btn-workspace-export")?.addEventListener("click", () => {
    try {
      exportWorkspaceFile();
    } catch (e) {
      logSteps([], e.message || String(e));
    }
  });
  $("btn-workspace-import")?.addEventListener("click", () => $("workspace-import-file")?.click());
  $("workspace-import-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      await importWorkspaceFile(file);
    } catch (e) {
      logSteps([], e.message || String(e));
    }
  });
  $("btn-theme")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(cur === "light" ? "dark" : "light");
    const plot = $("plot");
    if (plot?.data) {
      try {
        Plotly.relayout("plot", {
          paper_bgcolor: plotColors().paper,
          plot_bgcolor: plotColors().paper,
          "font.color": plotColors().font,
        });
      } catch (_) {
        /* ignore */
      }
    }
  });
  $("btn-history-clear")?.addEventListener("click", () => {
    clearHistory();
    renderHistory();
  });
  $("sweep-param")?.addEventListener("change", () => {
    const opts = sweepOptionsFor(
      state.type,
      state.type === "control" ? $("ctl-method")?.value : state.type === "pde" ? "heat1d" : "*"
    );
    applySweepPreset(opts.find((o) => o.id === $("sweep-param").value));
  });
  $("ctl-method")?.addEventListener("change", () => {
    syncControlFields();
    syncSweepOptions();
  });
  $("btn-share")?.addEventListener("click", async () => {
    const url = encodeSession({
      type: state.type,
      nl: $("nl-input")?.value || "",
      fields: collectFormSnapshot(),
      compare: !!$("compare-algs")?.checked,
      sweep: $("sweep-enabled")?.checked
        ? {
            enabled: true,
            param: $("sweep-param")?.value,
            min: $("sweep-min")?.value,
            max: $("sweep-max")?.value,
            steps: $("sweep-steps")?.value,
          }
        : null,
    });
    const abs = new URL(url, location.href).href;
    const ok = await copyText(abs);
    logSteps([ok ? "分享链接已复制到剪贴板" : `请手动复制：${abs}`]);
  });

  // DeepSeek AI 设置
  const aiSettings = loadAiSettings();
  // 若本地有密钥但 localStorage 尚未写入，补写一次
  if (aiSettings.apiKey && !localStorage.getItem("numsim.deepseek")) {
    saveAiSettings(aiSettings);
  }
  syncAiUi(aiSettings);
  $("btn-ai-save")?.addEventListener("click", () => {
    const next = readAiSettingsFromUi();
    saveAiSettings(next);
    syncAiUi(next);
    logSteps(["DeepSeek 设置已保存到本机浏览器"]);
  });
  ["ai-enabled", "ai-use-proxy", "ai-model"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      const next = readAiSettingsFromUi();
      saveAiSettings(next);
      syncAiUi(next);
    });
  });

  const initial = (location.hash || "#home").replace(/^#/, "") || "home";
  if (initial.startsWith("s=")) {
    setType(state.type);
    restoreSharedSession();
    scheduleWorkspaceDraftSave();
  } else {
    const draft = loadWorkspaceDraft();
    if (draft) {
      setView(VIEWS.includes(initial) ? initial : "home", { syncHash: false });
      syncDraftBanner(draft);
      logSteps(["检测到本地工作草稿", "点击「恢复草稿」可继续上次编辑"]);
    } else {
      setView(VIEWS.includes(initial) ? initial : "home", { syncHash: false });
      setType(state.type);
      syncDraftBanner(null);
    }
  }
}

function animateHero() {
  const canvas = $("hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.width;
  const h = canvas.height;
  canvas.style.width = "100%";
  let t0 = performance.now();

  function wave(t, x, amp, freq, phase) {
    return amp * Math.sin(freq * x + t + phase) * Math.exp(-0.0012 * x);
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.fillStyle = "rgba(61,184,160,0.08)";
    for (let i = 0; i < 12; i++) {
      const y = (h / 12) * i + 8;
      ctx.fillRect(0, y, w, 1);
    }

    const draws = [
      { color: "#3db8a0", amp: 42, freq: 0.028, phase: 0 },
      { color: "#d4a017", amp: 28, freq: 0.041, phase: 1.2 },
      { color: "#8ec8d8", amp: 18, freq: 0.055, phase: 2.4 },
    ];
    for (const d of draws) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = h * 0.55 + wave(t * 1.6, x, d.amp, d.freq, d.phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // sampling markers
    ctx.fillStyle = "#d4a017";
    for (let i = 0; i < 8; i++) {
      const x = 60 + i * 80;
      const y = h * 0.55 + wave(t * 1.6, x, 42, 0.028, 0);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  void dpr;
}

disablePlotlyLocalStorage();
bindUI();
animateHero();
setType("interpolate");
