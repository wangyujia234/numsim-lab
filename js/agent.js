/**
 * Agent：根据问题类型与自然语言提示自动选择数值算法，并给出理由。
 */

const ALGO_META = {
  interpolate: {
    spline: {
      name: "三次样条插值 (Cubic Spline)",
      reason: "点较多或需要平滑曲线时，样条可避免龙格现象并保证二阶连续。",
    },
    lagrange: {
      name: "拉格朗日插值 (Lagrange)",
      reason: "点数较少且区间适中时，全局多项式形式直观、便于教学展示。",
    },
    newton: {
      name: "牛顿均差插值 (Newton)",
      reason: "便于递推增点，适合需要逐步提高次数或对比差分表的场景。",
    },
    linear: {
      name: "分段线性插值",
      reason: "数据可能含噪声或不需要过度光滑时，线性插值更稳健。",
    },
  },
  integrate: {
    simpson: {
      name: "Simpson 1/3 法则",
      reason: "光滑被积函数上，精度高于梯形法则，默认首选。",
    },
    trapezoid: {
      name: "复合梯形法则",
      reason: "实现简单、对弱奇异或不太光滑函数更稳妥。",
    },
    romberg: {
      name: "Romberg 外推积分",
      reason: "通过 Richardson 外推加速收敛，适合高精度需求。",
    },
    adaptive: {
      name: "自适应 Simpson",
      reason: "按局部误差自动细分区间，默认高精度首选。",
    },
  },
  ode: {
    rk45: {
      name: "Dormand–Prince RK45（自适应）",
      reason: "嵌入式 4(5) 阶自适应步长，精度与效率平衡好，推荐默认。",
    },
    rk4: {
      name: "经典四阶 Runge-Kutta",
      reason: "固定步长四阶方法，适合教学对比与指定步数复现。",
    },
    heun: {
      name: "改进 Euler / Heun 法",
      reason: "二阶精度，计算量小于 RK4，适合快速预览。",
    },
    euler: {
      name: "前向 Euler 法",
      reason: "步长较小时可作基准对比，或用于教学演示稳定性差异。",
    },
  },
  circuit: {
    series_rlc: {
      name: "串联 RLC 阶跃 · 解析阻尼分类",
      reason: "根据 α 与 ω0 判定过/欠/临界阻尼，并给出 i(t)、vc(t)。",
    },
    parallel_rc: {
      name: "并联 RC 放电 · 指数解析解",
      reason: "一阶线性电路，时间常数 τ=RC 控制衰减。",
    },
    series_rl: {
      name: "串联 RL 阶跃 · 指数解析解",
      reason: "一阶电感电路，τ=L/R，稳态电流 V/R。",
    },
    ac_rlc: {
      name: "串联 RLC 频率响应 |Y(f)|",
      reason: "扫频计算导纳幅值与相位，识别谐振频率与 Q。",
    },
  },
  imagefit: {
    poly: {
      name: "图像数字化 + 多项式最小二乘",
      reason: "从图中提取离散点后，用多项式拟合得到显式函数表达式。",
    },
    spline: {
      name: "图像数字化 + 三次样条",
      reason: "采样点足够时，样条能更光滑地贴合曲线形态。",
    },
    fourier: {
      name: "图像数字化 + 傅里叶级数截断",
      reason: "曲线呈周期或拟周期形态时，用截断傅里叶级数以有限谐波逼近。",
    },
  },
  transform: {
    fft: {
      name: "快速傅里叶变换 (FFT)",
      reason: "对有限时长采样信号做频谱分析，适合观测主频与谐波。",
    },
    fourier: {
      name: "数值傅里叶变换",
      reason: "直接数值积分 F(ω)=∫f(t)e^{-jωt}dt，适合有限支撑连续信号。",
    },
    laplace: {
      name: "数值拉普拉斯变换",
      reason: "计算 F(s)=∫f(t)e^{-st}dt（截断），并沿 σ+jω 展示幅频特性。",
    },
  },
  control: {
    second_order: {
      name: "二阶系统阶跃响应 (ζ–ωn)",
      reason: "经典自动控制对象，可判定欠/过/临界阻尼并估计超调与调节时间。",
    },
    tf_step: {
      name: "传递函数阶跃响应",
      reason: "将 G(s) 转为状态空间后 RK4 积分，适合任意低阶线性对象。",
    },
    pid: {
      name: "PID 闭环阶跃仿真",
      reason: "工业常用控制器，可观察超调、稳态误差与控制量饱和趋势。",
    },
    bode: {
      name: "Bode 幅相频特性",
      reason: "频域设计基础，可粗估增益穿越频率与相位裕度。",
    },
    dc_motor: {
      name: "直流电机电枢控制模型",
      reason: "机电系统典型对象，观察电压阶跃下的转速与电流动态。",
    },
    rlocus: {
      name: "根轨迹",
      reason: "绘制 1+KG(s)=0 闭环极点随增益 K 的轨迹，用于稳定性与增益选取。",
    },
    z_transform: {
      name: "数值 Z 变换（单位圆）",
      reason: "对离散序列在单位圆上求 F(e^{jω})，观察离散频谱特性。",
    },
    pole_place: {
      name: "状态反馈极点配置",
      reason: "Ackermann 公式求反馈增益 K，使闭环极点落到期望位置并仿真阶跃。",
    },
    sensor_cal: {
      name: "传感器标定",
      reason: "参考值–测量值最小二乘拟合，得到灵敏度、零偏与标定曲线。",
    },
    z_tf_step: {
      name: "离散传递函数阶跃",
      reason: "对 H(z)=num/den 用差分方程求单位阶跃，并用 Jury 判稳。",
    },
    jury: {
      name: "Jury 稳定性判据",
      reason: "对离散特征多项式构造 Jury 表，判定闭环是否渐近稳定。",
    },
  },
  pde: {
    heat1d: {
      name: "一维热方程 FTCS",
      reason: "显式差分求解 u_t=α u_xx，需满足 r≤0.5。",
    },
    heat1d_cn: {
      name: "一维热方程 Crank–Nicolson",
      reason: "隐式二阶格式，无条件稳定，精度通常优于显式 FTCS。",
    },
  },
};

const TYPE_PRIORITY = ["pde", "imagefit", "circuit", "control", "transform", "interpolate", "integrate", "ode"];

function testTypePattern(type, lowerText) {
  const t = lowerText;
  if (type === "imagefit") return /图像|图片|拍照|截图|拟合曲线|digitiz|curve fit|从图/.test(t);
  if (type === "pde") return /热方程|热传导|扩散方程|pde|偏微分|一维热/.test(t);
  if (type === "circuit") return /电路|rlc|电容|电感|谐振|阻抗|频响|电枢回路/.test(t);
  if (type === "control")
    return (
      /pid|bode|传递函数|二阶系统|阻尼比|相位裕度|直流电机|控制系统|根轨迹|伺服|极点配置|状态反馈|z\s*变换|离散.*传递|jury|传感器标定|标定曲线/.test(
        t
      ) || (/阶跃响应/.test(t) && !/电路|rlc|电容|电感/.test(t))
    );
  if (type === "transform") return /傅里叶|fft|拉普拉斯|laplace|频谱|积分变换|fourier|三角多项式|谐波/.test(t);
  if (type === "interpolate") return /插值|样条|lagrange|newton|spline|拟合点/.test(t);
  if (type === "integrate") return /积分|integral|∫|quad|simpson|trapez/.test(t) && !/变换/.test(t);
  if (type === "ode") return /微分|ode|微分方程|初值|runge|y'|dy\/dt/.test(t);
  return false;
}

export function detectAllTypes(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return [];
  const hits = [];
  for (const type of TYPE_PRIORITY) {
    if (testTypePattern(type, t)) hits.push(type);
  }
  return hits;
}

const CAPABILITY_LABEL = {
  imagefit: "多项式最小二乘 / 三次样条 / 傅里叶级数截断",
  transform: "FFT / 数值傅里叶 / 数值拉普拉斯",
  interpolate: "分段线性 / Lagrange / Newton / 三次样条",
  integrate: "梯形 / Simpson / Romberg / 自适应 Simpson",
  ode: "Euler / Heun / RK4 / RK45",
  circuit: "串联 RLC / 并联 RC / 串联 RL / 频响",
  control: "二阶阶跃 / PID / Bode / 电机 / 根轨迹 / Z 变换 / 极点配置 / 传感器标定",
  pde: "FTCS / Crank–Nicolson",
};

const INTENT_LABEL = {
  imagefit: "图像拟合",
  transform: "傅里叶变换 / 频谱分析",
  interpolate: "插值",
  integrate: "数值积分",
  ode: "常微分方程",
  circuit: "电路分析",
  control: "控制系统仿真",
  pde: "偏微分方程",
};

export function buildIntentWarnings(nl, chosenType) {
  const all = detectAllTypes(nl);
  if (all.length <= 1) return [];
  const extras = all.filter((t) => t !== chosenType);
  if (!extras.length) return [];
  return extras.map((t) => {
    const need = INTENT_LABEL[t] || t;
    const cap = CAPABILITY_LABEL[chosenType] || "当前模块能力";
    return `⚠ 检测到需求：${need}\n当前「${labelType(chosenType)}」模块仅支持：${cap}\n该需求未被执行，结果不包含「${need}」。`;
  });
}

export function detectTypeFromText(text, fallback) {
  const hits = detectAllTypes(text);
  if (hits.length) return hits[0];
  return fallback;
}

function pickInterpolate(nl, pointCount) {
  const t = nl.toLowerCase();
  if (/线性|linear|折线/.test(t)) return "linear";
  if (/lagrange|拉格朗日/.test(t)) return "lagrange";
  if (/newton|牛顿|均差/.test(t)) return "newton";
  if (/样条|spline|平滑/.test(t)) return "spline";
  if (pointCount <= 4) return "lagrange";
  if (pointCount >= 8) return "spline";
  return "spline";
}

function pickIntegrate(nl, a, b) {
  const t = nl.toLowerCase();
  if (/adaptive|自适应|高精度|精确/.test(t)) return "adaptive";
  if (/romberg|外推/.test(t)) return "romberg";
  if (/梯形|trapez/.test(t)) return "trapezoid";
  if (/simpson|辛普森/.test(t)) return "simpson";
  const span = Math.abs(b - a);
  if (span > 50) return "adaptive";
  return "adaptive";
}

function pickODE(nl, span) {
  const t = nl.toLowerCase();
  if (/euler|欧拉/.test(t) && !/改进|heun/.test(t)) return "euler";
  if (/heun|改进欧拉/.test(t)) return "heun";
  if (/rk4|runge-kutta\s*4|龙格.?库塔\s*4/.test(t) && !/rk45|自适应/.test(t)) return "rk4";
  if (/rk45|dopri|自适应|高精度/.test(t)) return "rk45";
  if (span > 40) return "rk45";
  return "rk45";
}

function pickPde(nl, schemeHint) {
  const t = nl.toLowerCase();
  if (/crank|nicolson|cn|隐式/.test(t)) return "heat1d_cn";
  if (/ftcs|显式/.test(t)) return "heat1d";
  if (schemeHint === "cn") return "heat1d_cn";
  return "heat1d";
}

function pickImageFit(nl, methodHint) {
  const t = nl.toLowerCase();
  if (/傅里叶|fourier|fft|谐波|三角多项式|周期/.test(t)) return "fourier";
  if (/样条|spline|光滑/.test(t)) return "spline";
  if (/多项式|poly|最小二乘|次数/.test(t)) return "poly";
  if (methodHint === "fourier") return "fourier";
  return methodHint === "spline" ? "spline" : "poly";
}

function pickTransform(nl, methodHint) {
  const t = nl.toLowerCase();
  if (/laplace|拉普拉斯/.test(t)) return "laplace";
  if (/fft|快速傅里叶|离散/.test(t)) return "fft";
  if (/傅里叶|fourier|频谱/.test(t)) return /fft|快速|离散/.test(t) ? "fft" : "fourier";
  return methodHint || "fft";
}

function pickControl(nl, methodHint) {
  const t = nl.toLowerCase();
  if (/pid|比例积分/.test(t)) return "pid";
  if (/bode|伯德|幅频|相频|相位裕度/.test(t)) return "bode";
  if (/电机|motor|电枢/.test(t)) return "dc_motor";
  if (/根轨迹|rlocus|root\s*locus/.test(t)) return "rlocus";
  if (/jury|判稳|稳定性判据/.test(t)) return "jury";
  if (/离散.*传递|z\s*域|h\(z\)|差分方程.*阶跃/.test(t)) return "z_tf_step";
  if (/z\s*变换|ztransform|离散.*谱|单位圆/.test(t)) return "z_transform";
  if (/极点配置|状态反馈|ackermann|pole\s*place/.test(t)) return "pole_place";
  if (/传感器|标定|校准|sensitivity|零偏/.test(t)) return "sensor_cal";
  if (/传递函数|g\(s\)|tf\b|分子|分母/.test(t)) return "tf_step";
  if (/二阶|阻尼比|ζ|zeta|ωn|wn|超调/.test(t)) return "second_order";
  return methodHint || "second_order";
}

function pickCircuit(nl, topo) {
  const t = nl.toLowerCase();
  if (/频响|频率|bode|谐振|交流|ac/.test(t)) return "ac_rlc";
  if (/放电|rc|并联/.test(t) && !/rlc/.test(t)) return "parallel_rc";
  if (/\brl\b|电感充电|串联 rl/.test(t) && !/rlc/.test(t)) return "series_rl";
  if (/rlc|阶跃|欠阻尼|过阻尼/.test(t)) return "series_rlc";
  return topo || "series_rlc";
}

/**
 * @returns {{ type, algorithm, algorithmName, reason, steps, overrides }}
 */
export function decide(context) {
  const nl = context.nl || "";
  const type = detectTypeFromText(nl, context.type);
  const steps = [];
  steps.push(`识别问题类型 → ${labelType(type)}`);

  let algorithm;
  let overrides = {};

  if (type === "interpolate") {
    const n = context.payload?.x?.length || 0;
    algorithm = pickInterpolate(nl, n);
    steps.push(`采样点数 = ${n}，结合描述选择插值器`);
  } else if (type === "integrate") {
    algorithm = pickIntegrate(nl, context.payload?.a ?? 0, context.payload?.b ?? 1);
    steps.push(`积分区间 [${context.payload?.a}, ${context.payload?.b}]，评估光滑度与精度需求`);
  } else if (type === "ode") {
    const span = Math.abs((context.payload?.tf ?? 1) - (context.payload?.t0 ?? 0));
    algorithm = pickODE(nl, span);
    steps.push(`时间跨度 ≈ ${span.toFixed(3)}，选择时间推进格式`);
  } else if (type === "imagefit") {
    algorithm = pickImageFit(nl, context.payload?.method);
    steps.push(`图像采样点数 = ${context.payload?.x?.length || 0}，选择拟合模型`);
  } else if (type === "transform") {
    algorithm = pickTransform(nl, context.payload?.method);
    steps.push(`信号 f(t)=${context.payload?.expr || "?"}，选择积分变换`);
  } else if (type === "control") {
    algorithm = pickControl(nl, context.payload?.method);
    steps.push(`控制系统仿真 → ${algorithm}`);
  } else if (type === "pde") {
    algorithm = pickPde(nl, context.payload?.scheme);
    overrides.scheme = algorithm === "heat1d_cn" ? "cn" : "ftcs";
    steps.push(`偏微分方程 → ${algorithm === "heat1d_cn" ? "Crank–Nicolson" : "FTCS"}`);
  } else {
    algorithm = pickCircuit(nl, context.payload?.topo);
    overrides.topo = algorithm;
    steps.push(`电路拓扑 / 分析目标 → ${algorithm}`);
  }

  const meta = ALGO_META[type][algorithm];
  steps.push(`选定算法：${meta.name}`);
  steps.push(`依据：${meta.reason}`);

  return {
    type,
    algorithm,
    algorithmName: meta.name,
    reason: meta.reason,
    steps,
    overrides,
  };
}

function labelType(type) {
  return (
    {
      interpolate: "插值",
      integrate: "数值积分",
      ode: "常微分方程初值问题",
      circuit: "电路暂态/频域分析",
      imagefit: "图像曲线拟合",
      transform: "积分变换",
      control: "控制系统 / 工程仿真",
      pde: "偏微分方程",
    }[type] || type
  );
}

export { ALGO_META };
