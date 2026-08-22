/**

 * DeepSeek 智能分析层

 * - 优先 Netlify 代理（前端零密钥）

 * - 代理失败且有 Key 时回退直连

 * - 模型只负责选型 / 填参 / 步骤说明；数值计算仍在本地引擎完成。

 */



const STORAGE_KEY = "numsim.deepseek";

const API_URL = "https://api.deepseek.com/chat/completions";

const PROXY_URL = "/.netlify/functions/deepseek";



// ai.secrets.js 为可选本地密钥文件（被 .gitignore 排除，不会部署）。
// 动态导入 + 容错：文件缺失（如公网部署）时回退到空默认值，不影响应用启动。
const secrets = { key: "", enabledDefault: false };

try {

  const mod = await import("./ai.secrets.js");

  secrets.key = String(mod.LOCAL_DEEPSEEK_KEY || "");

  secrets.enabledDefault = !!mod.LOCAL_AI_ENABLED_DEFAULT;

} catch {

  secrets.key = "";

  secrets.enabledDefault = false;

}



const ALLOWED = {

  types: ["interpolate", "integrate", "ode", "circuit", "imagefit", "transform", "control", "pde"],

  algorithms: {

    interpolate: ["linear", "lagrange", "newton", "spline"],

    integrate: ["trapezoid", "simpson", "romberg", "adaptive"],

    ode: ["euler", "heun", "rk4", "rk45"],

    circuit: ["series_rlc", "parallel_rc", "series_rl", "ac_rlc"],

    imagefit: ["poly", "spline"],

    transform: ["fft", "fourier", "laplace"],

    control: [

      "second_order",

      "tf_step",

      "pid",

      "bode",

      "dc_motor",

      "rlocus",

      "z_transform",

      "z_tf_step",

      "jury",

      "pole_place",

      "sensor_cal",

    ],

    pde: ["heat1d", "heat1d_cn"],

  },

};



function defaultSettings() {

  const onNetlify = typeof location !== "undefined" && /netlify\.(app|com)$/i.test(location.hostname || "");

  return {

    enabled: !!secrets.enabledDefault,

    apiKey: secrets.key,

    model: "deepseek-chat",

    useProxy: onNetlify || !secrets.key,

  };

}



export function loadAiSettings() {

  try {

    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return defaultSettings();

    const o = JSON.parse(raw);

    const base = defaultSettings();

    return {

      enabled: o.enabled != null ? !!o.enabled : base.enabled,

      apiKey: String(o.apiKey || secrets.key || ""),

      model: o.model === "deepseek-reasoner" ? "deepseek-reasoner" : "deepseek-chat",

      useProxy: o.useProxy != null ? !!o.useProxy : base.useProxy,

    };

  } catch {

    return defaultSettings();

  }

}



export function saveAiSettings(settings) {

  localStorage.setItem(

    STORAGE_KEY,

    JSON.stringify({

      enabled: !!settings.enabled,

      apiKey: String(settings.apiKey || ""),

      model: settings.model || "deepseek-chat",

      useProxy: !!settings.useProxy,

    })

  );

}



function systemPrompt() {

  return `你是 NumSim Lab 的数值仿真规划助手。根据用户中文问题，选择模块与算法，并给出可执行参数。

只输出 JSON（不要 markdown 代码块），格式：

{

  "type": "<模块>",

  "algorithm": "<算法>",

  "algorithmName": "<中文名>",

  "reason": "<一句话依据>",

  "steps": ["步骤1","步骤2","步骤3","步骤4"],

  "fields": { "<表单id>": "<字符串值>" },

  "notes": ["补充说明"]

}



模块 type 只能是: ${ALLOWED.types.join(", ")}

各模块 algorithm 只能是:

${Object.entries(ALLOWED.algorithms)

  .map(([k, v]) => `- ${k}: ${v.join(", ")}`)

  .join("\n")}



常用 fields id：

- 插值: interp-x, interp-y, interp-query

- 积分: integ-f, integ-a, integ-b, integ-n

- ODE: ode-f, ode-y0, ode-t0, ode-tf, ode-n

- 电路: ckt-topo, ckt-r, ckt-l, ckt-c, ckt-src

- 图像: img-method, img-degree

- 变换: xf-f, xf-method, xf-t0, xf-tf, xf-n, xf-fmax, xf-sigma

- 控制: ctl-method, ctl-zeta, ctl-wn, ctl-K, ctl-tf, ctl-num, ctl-den, ctl-kp, ctl-ki, ctl-kd, ctl-plant, ctl-tau, ctl-va, ctl-fmin, ctl-fmax, ctl-kmin, ctl-kmax, ctl-nk, ctl-T, ctl-zn, ctl-zalpha, ctl-zfreq, ctl-seq, ctl-order, ctl-A, ctl-B, ctl-poles, ctl-xref, ctl-ymeas, ctl-caldeg

- PDE: pde-alpha, pde-L, pde-nx, pde-tf, pde-nt, pde-ic, pde-uleft, pde-uright



规则：

1. fields 的值必须是字符串；表达式用 JS 数学语法（如 sin(x)*exp(-0.1*x)，用 * 与 PI，不要 LaTeX）。

2. ctl-method 必须与 algorithm 一致；ckt-topo 与 circuit 的 algorithm 一致；xf-method / img-method 同理。

3. 若信息不足，给合理默认算例并在 notes 说明。

4. steps 写清晰的分析步骤（4~6 条），面向学生可读。

5. 不要编造本系统不支持的算法。

6. 热传导 / 热方程 / PDE / 扩散方程 → type=pde, algorithm=heat1d 或 heat1d_cn（Crank–Nicolson）。

7. 离散传递函数阶跃 / Z 域 TF → z_tf_step；Jury 判稳 → jury。`;

}



function extractJson(text) {

  const s = String(text || "").trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);

  const body = fence ? fence[1].trim() : s;

  const start = body.indexOf("{");

  const end = body.lastIndexOf("}");

  if (start < 0 || end <= start) throw new Error("模型未返回 JSON");

  return JSON.parse(body.slice(start, end + 1));

}



function sanitizePlan(plan) {

  const type = ALLOWED.types.includes(plan.type) ? plan.type : "control";

  const algos = ALLOWED.algorithms[type];

  let algorithm = String(plan.algorithm || "");

  if (!algos.includes(algorithm)) algorithm = algos[0];



  const fields = {};

  if (plan.fields && typeof plan.fields === "object") {

    for (const [k, v] of Object.entries(plan.fields)) {

      if (typeof k === "string" && /^[a-z0-9-]+$/i.test(k)) fields[k] = String(v ?? "");

    }

  }

  if (type === "control") fields["ctl-method"] = algorithm;

  if (type === "circuit") fields["ckt-topo"] = algorithm;

  if (type === "transform") fields["xf-method"] = algorithm;

  if (type === "imagefit") fields["img-method"] = algorithm;

  if (type === "pde") fields["pde-scheme"] = algorithm === "heat1d_cn" ? "cn" : "ftcs";



  const steps = Array.isArray(plan.steps)

    ? plan.steps.map((x) => String(x)).filter(Boolean).slice(0, 8)

    : [];

  const notes = Array.isArray(plan.notes) ? plan.notes.map((x) => String(x)).filter(Boolean) : [];



  return {

    type,

    algorithm,

    algorithmName: String(plan.algorithmName || algorithm),

    reason: String(plan.reason || "由 DeepSeek 根据题意选型"),

    steps: steps.length

      ? steps

      : [`DeepSeek 识别类型 → ${type}`, `选定算法 → ${algorithm}`, String(plan.reason || "")].filter(Boolean),

    fields,

    notes,

    source: "deepseek",

  };

}



async function callViaProxy(messages, model) {

  const res = await fetch(PROXY_URL, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({ model, messages }),

  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || `代理错误 HTTP ${res.status}`);

  return data;

}



async function callDirect(apiKey, messages, model) {

  const res = await fetch(API_URL, {

    method: "POST",

    headers: {

      "Content-Type": "application/json",

      Authorization: `Bearer ${apiKey}`,

    },

    body: JSON.stringify({

      model,

      temperature: 0.2,

      messages,

      response_format: { type: "json_object" },

    }),

  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {

    const msg = data?.error?.message || data?.error || `DeepSeek HTTP ${res.status}`;

    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));

  }

  return data;

}



function preferProxyFirst(settings) {

  if (settings.useProxy) return true;

  const host = typeof location !== "undefined" ? location.hostname || "" : "";

  if (/netlify\.(app|com)$/i.test(host) && !settings.apiKey?.trim()) return true;

  return false;

}



/**

 * @param {{ nl: string, typeHint: string, formSnapshot?: object }} ctx

 * @param {{ enabled: boolean, apiKey: string, model: string, useProxy: boolean }} settings

 */

export async function analyzeWithDeepSeek(ctx, settings) {

  if (!settings?.enabled) return null;

  const nl = String(ctx.nl || "").trim();

  if (!nl) throw new Error("请先填写问题描述，再使用 DeepSeek 分析");



  const userPayload = {

    question: nl,

    currentModuleHint: ctx.typeHint || null,

    currentForm: ctx.formSnapshot || {},

  };



  const messages = [

    { role: "system", content: systemPrompt() },

    {

      role: "user",

      content: `请分析并输出 JSON：\n${JSON.stringify(userPayload, null, 2)}`,

    },

  ];



  let data;

  let via = "proxy";

  const key = settings.apiKey?.trim() || "";

  const proxyFirst = preferProxyFirst(settings);



  if (proxyFirst) {

    try {

      data = await callViaProxy(messages, settings.model);

      via = "proxy";

    } catch (e) {

      if (!key) throw new Error(`代理失败：${e.message}（未配置浏览器 API Key，无法直连）`);

      data = await callDirect(key, messages, settings.model);

      via = "direct-fallback";

    }

  } else {

    if (!key) {

      try {

        data = await callViaProxy(messages, settings.model);

        via = "proxy";

      } catch (e) {

        throw new Error(`未配置 API Key，且代理失败：${e.message}`);

      }

    } else {

      try {

        data = await callDirect(key, messages, settings.model);

        via = "direct";

      } catch (e) {

        try {

          data = await callViaProxy(messages, settings.model);

          via = "proxy-fallback";

        } catch (e2) {

          throw new Error(`DeepSeek 直连失败：${e.message}；代理亦失败：${e2.message}`);

        }

      }

    }

  }



  const content = data?.choices?.[0]?.message?.content;

  if (!content) throw new Error("DeepSeek 返回为空");

  const plan = sanitizePlan(extractJson(content));

  plan.rawModel = settings.model;

  plan.usage = data.usage || null;

  plan.via = via;

  return plan;

}



export { ALLOWED };


