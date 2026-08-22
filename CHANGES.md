# NumSim Lab 优化交付清单

## 数值精确度与可信度升级 · 第二轮（engine 1.4.0）

### 补偿求和（Neumaier）—— 对抗大数组累加的舍入误差
- **`js/engines/_numeric.js`**：新增 `compensatedSum`；`rmseVec`、`l2Norm` 改用补偿累加
- **`js/engines/integrate.js`**：`trapezoid`、`simpson` 求和改为补偿累加（Romberg 经梯形自动受益）；自适应 Simpson 的局部误差估计同样补偿累加
- **`js/engines/transform.js`**：`simpsonComplex`（数值傅里叶 / 拉普拉斯积分）改为补偿累加
- **`js/math.js`**：`mean` 补偿求和；`linspace` 保证首末点**精确**等于 a / b（此前末点存在舍入偏差）
- **`js/engines/imagefit.js`**：`rSquared`、`rmse` 改为补偿累加

### 消除灾难性对消 —— 电路 `vc(t)` 闭式解 t→0 精度
- **过阻尼**：`exp(s·t)−1` → `Math.expm1(s·t)`
- **临界阻尼**：`1−e^{−x}(1+x)` → `(expm1(x)−x)·e^{−x}`，并去除不必要的大数除法
- **欠阻尼**：`F(t)−F(0)` → `[wd(1−e^{−αt}cos wd t) − α e^{−αt} sin wd t]/w0²`，其中 `1−cos` 用 `2sin²(wd t/2)`、`1−e^{−αt}` 用 `expm1`
- 验证：中等 t 下与旧公式一致（0~1 采样差异 < 1e-15）；小 t 下绝对误差从 ~1e-17 量级改善到机器精度极限

### 最小二乘条件数 —— 多项式拟合 / 传感器标定
- **`js/engines/imagefit.js`** `polyfit`：先中心化 + 缩放再建正规方程，再展开回原坐标。大偏移 + 高次场景 RMSE 提升约 8×（3.3e-4 → 4.0e-5）
- **`js/engines/control.js`** `sensorCalibrate`：中心化基直接求值（不再展开回原坐标），方程以 `(x−μ)` 形式展示；`sensitivity`=coefC[1]、`offset`=evalC(0)，消除展开对消

### 验证
- 35 项精度专项检查 + 30 项全引擎冒烟测试全部通过

---

## 数值精确度与可信度升级（engine 1.3.0）

### 算法升级
- **积分**（`js/engines/integrate.js`）：新增自适应 Simpson；Romberg 按收敛提前停止；固定梯形/Simpson 改用 Richardson 误差估计（替代加密梯形差）
- **ODE**（`js/engines/ode.js`）：新增 Dormand–Prince RK45 自适应；固定步长方法用 n vs 2n Richardson 估计末端误差
- **插值**（`js/engines/interpolate.js`）：自然三次样条改为 Thomas 三对角求解；重复 x 检测；高次 Lagrange/Newton Runge 风险提示
- **PDE**（`js/engines/pde.js`）：新增 Crank–Nicolson（默认可选），复用 Thomas；FTCS 仍保留
- **控制**（`js/engines/control.js`）：状态空间 RK4 按 ‖A‖F 估步并双步加密；PID 按时间尺度自动加密
- **电路**（`js/engines/circuit.js`）：`vc(t)` 改为闭式解；与 RK4 数值验真 RMSE；临界阻尼相对容差

### 可信度展示
- 统一 `errSource`：`adaptive` / `richardson` / `exact`
- 结论与报告优先展示「对解析误差」，否则标明估计来源（不再暗示加密参考=真误差）
- 扩展解析对照：`cos(2x)`、`1/(1+x²)`、`x*exp(-x)`、`y'=sin(t)`、`y'=-a y+b` 等
- 自检/作业阈值收紧：积分与 ODE → 1e-6；PID → 0.05；热方程示例（CN）→ 1e-3

### 共享工具
- 新增 `js/engines/_numeric.js`：Thomas、Richardson、范数辅助

---

## 概述
本次对 NumSim Lab 网站进行了系统性的问题诊断与优化，发现并修复了 **1 个致命级 (P0) 阻塞问题**、**3 个 P0 级严重缺陷**、**7 个 P1 级问题**、**6 个 P2 级问题**，并新增了多处体验改进。

---

## 🔴 P0 — 致命问题修复

### ✅ P0-1：CSP 阻止 `new Function()` — 全部核心功能失效
**根因**：`math.js:52` 使用 `new Function(argList, ...)` 编译数学表达式；Netlify 默认 CSP 不允许 `'unsafe-eval'`，导致浏览器拦截。波及**积分、ODE、控制系统（PID/Bode/根轨迹/电机/极点配置）、FFT/拉普拉斯、图像拟合**等几乎所有依赖表达式求值的功能。

**修复**：
- **`js/math.js`**：用纯 JS 实现的**递归下降解析器**（Recursive Descent Parser）替换 `new Function()`，完全无需 `eval` / `new Function`
- 支持语法：数字、科学计数、四则运算、`^`/`**` 幂（右结合）、括号、单/多变量、20+ 数学函数、PI/E 常量
- 自带 Tokenizer + Parser 类，编译期校验，运行期纯计算
- 拒绝非法字符（`@`、`'`、`.` 等），自动拦截 `eval('hi')`、`window.location` 等危险表达式
- **21 个单元测试全部通过**（覆盖正常 / 边界 / 错误情况）
- **`netlify.toml`**：保持严格 CSP（无需 `'unsafe-eval'`），安全性优于原方案

### ✅ P0-2：状态污染 — 切换类型时旧结果不清理
**根因**：`runPipeline` 入口和 catch 块未调用 `clearResults()`

**修复**（`js/app.js`）：
- `runPipeline` 开头调用 `clearResults({ analyzing: true })`，先清空再分析
- catch 块也调用 `clearResults({ silent: false })`，确保错误时旧结果被清

### ✅ P0-3：仿真失败时 UI 残留旧结果
**根因**：catch 块只写一行错误日志，plot/metrics/code 不清理

**修复**：见 P0-2，新增的 catch 清理使错误时 UI 完全重置

### ✅ 额外修复（发现于测试过程）：Plotly `marker: undefined` 致绘图崩溃
**根因**：`app.js:710` 在非 markers 模式下也设置了 `marker: undefined`，Plotly 2.35 的 `cleanData` 用 `'line' in obj` 检查时崩溃

**修复**：
- `app.js:705-718`（控制系统普通 trace）：用条件展开运算符，仅在 markers 模式才附加 `marker` 属性
- `app.js:681-696`（根轨迹）：同样改写
- `app.js:763`（电路布局）：`yaxis2: undefined` 也改为条件展开

---

## 🟡 P1 — 严重问题修复

### ✅ P1-1：清理 `math.js` 死代码
原 14-16 行的 `if (!/^...$/.test(...)) { /* 注释 */ }` 完全没做检查。新代码（解析器中）实现完整语义校验。

### ✅ P1-2：开启 Plotly 工具栏
- `displayModeBar: "hover"`（hover 时显示）
- 保留缩放、平移、截图、自动缩放等按钮
- 移除不常用的 `lasso2d`、`select2d`

### ✅ P1-3：loading 状态 + 防并发点击
- `state.running` 锁，正在运行时忽略新的触发
- 按钮变 "运行中…" + 旋转 spinner + disabled
- 测试：5 次快速点击只产生 1 次仿真（验证通过）

### ✅ P1-5：Tab 可访问性增强
- `.type-tab` 添加 `aria-selected` 与 `tabindex`（roving tabindex）
- 键盘左右方向键可在 7 个 tab 间切换
- 焦点环（`:focus-visible`）可见

### ✅ P1-6：agent-log 清屏按钮
- 右上角 `×` 圆形按钮
- 仅清除日志，不动其他结果

### ✅ P1-7：Plotly 内存 storage 补丁容错
- 在 `clearResults` 中用 try/catch 包裹 `Plotly.purge`，避免 Plotly 未加载时报错

---

## 🟢 P2 — 一般改进

### ✅ P2-1 / P2-2：响应式断点扩展 + 汉堡菜单
- 新增 `@media (max-width: 640px)`：手机端布局优化
  - type-tabs 可横向滚动（防止挤压）
  - 示例卡片网格 1 列
  - 按钮占满全宽
- 焦点环：键盘导航可见

### ✅ P2-3：字段错误视觉增强
- 错误字段添加抖动动画 + 红色高亮

### ✅ P2-4：示例卡片点击反馈
- 1.2 秒绿色高亮 + 微上移效果

### ✅ P2-5：metrics "复制全部" 按钮
- 新增 `btn-copy-metrics`，含降级提示

### ✅ P2-6：图像采样 canvas 触摸支持
- `imageDigitizer.js`：用 `pointerdown`/`pointerup` 替代 `click`
- 8px 移动阈值避免拖拽误触
- `touch-action: none` 阻止移动端默认滚动

---

## 📂 交付文件清单

```
/workspace/
├── netlify.toml           # 新增：严格 CSP 配置（无 unsafe-eval）
├── index.html             # 修改：tab aria 属性、log 清屏按钮、metrics 复制按钮
├── css/
│   └── styles.css         # 修改：响应式 640px、loading 动画、焦点环、抖动动画
└── js/
    ├── math.js            # 重写：递归下降解析器（替代 new Function）
    ├── app.js             # 修改：clearResults、loading、tab 可访问性、Plotly 修复
    ├── imageDigitizer.js  # 修改：pointer 事件 + 触摸支持
    ├── agent.js           # 无改动
    ├── autofill.js        # 无改动
    ├── codegen.js         # 无改动
    ├── report.js          # 无改动
    └── engines/
        ├── interpolate.js # 无改动
        ├── integrate.js   # 无改动
        ├── ode.js         # 无改动
        ├── circuit.js     # 无改动
        ├── imagefit.js    # 无改动
        ├── transform.js   # 无改动
        └── control.js     # 无改动
```

---

## ✅ 验证结果（本地 HTTP 服务器实测）

| 功能模块 | 修复前 | 修复后 | 备注 |
|---------|--------|--------|------|
| 插值（Cubic Spline） | ❌ CSP 报错 | ✅ 正常 | 含查询点 |
| 数值积分（Simpson） | ❌ CSP 报错 | ✅ 正常 | 积分值 1.3155 |
| ODE（RK4） | ❌ CSP 报错 | ✅ 正常 | |
| 电路（RLC 阶跃） | ❌ CSP 报错 | ✅ 正常 | 解析阻尼分类 |
| 图像拟合（多项式） | ❌ CSP 报错 | ✅ 正常 | 65 点自动采样 |
| FFT（衰减正弦） | ❌ CSP 报错 | ✅ 正常 | 单边频谱正确 |
| 二阶系统阶跃 | ❌ CSP 报错 | ✅ 正常 | 超调 37.23% |
| Bode 图 | ❌ Plotly 崩溃 | ✅ 正常 | 双轴 + 对数频率 |
| 状态污染（错误时清理） | ❌ 残留旧结果 | ✅ 完整清理 | algo→未选定、plot→空 |
| 防并发点击 | ❌ 无保护 | ✅ 5 连点只跑 1 次 | |
| Plotly 工具栏 | ❌ 隐藏 | ✅ hover 显示 | 截图/缩放可用 |

**解析器单元测试**：21/21 通过

---

## 📋 部署说明

将 `/workspace/` 下所有文件覆盖到 Netlify 仓库根目录即可（保持目录结构）：
- `index.html` → 根目录
- `css/styles.css` → `css/styles.css`
- `js/*.js` → `js/*.js`
- `js/engines/*.js` → `js/engines/*.js`
- `netlify.toml` → 根目录（新增）

`netlify.toml` 会让 Netlify 自动应用自定义 CSP（无需手动配置 `_headers`）。