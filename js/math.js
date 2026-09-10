/**
 * 安全表达式求值：仅允许数学运算与常用函数
 *
 * 实现说明：
 *   原实现使用 `new Function()` 编译表达式，在严格 CSP 环境
 *   （Netlify 默认禁止 'unsafe-eval'）下会被浏览器拦截，导致积分 /
 *   ODE / 控制系统 / FFT / 图像拟合等所有依赖表达式求值的功能全部失效。
 *   现改用纯 JS 递归下降解析器（Recursive Descent Parser），
 *   无需 eval / new Function，符合严格 CSP，且安全可控。
 *
 * 支持的语法（类 JavaScript 数学表达式）：
 *   - 数字字面量（含科学计数 1e-3、小数 0.5）
 *   - 变量（由调用方指定，如 x、t）
 *   - 常量：PI, E
 *   - 一元负号 / 正号：-x, +x
 *   - 二元运算：+ - * / **（也支持 ^ 作为幂的别名）
 *   - 括号分组
 *   - 函数调用：sin(x), exp(-0.1*t), atan2(y, x), max(a, b), ...
 *
 * 文法（优先级从低到高）：
 *   expr      := term (('+' | '-') term)*
 *   term      := factor (('*' | '/') factor)*
 *   factor    := unary ('**' factor)?            # 右结合
 *   unary     := ('+' | '-') unary | postfix
 *   postfix   := primary
 *   primary   := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'
 *   args      := expr (',' expr)*
 */

const ALLOWED_FUNCS = {
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  atan2: Math.atan2,
  ceil: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  floor: Math.floor,
  log: Math.log,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
};

const ALLOWED_CONSTS = {
  PI: Math.PI,
  E: Math.E,
};

/**
 * Tokenizer：把表达式字符串切分为 token 流。
 * Token 类型：num, ident, op, lparen, rparen, comma, eof
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    // 跳过空白
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // 数字字面量（支持 0.5, .5, 1e3, 1.2e-3 等）
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] || ""))) {
      let j = i;
      // 整数 / 小数部分
      while (j < n && /[0-9]/.test(input[j])) j++;
      if (input[j] === ".") {
        j++;
        while (j < n && /[0-9]/.test(input[j])) j++;
      }
      // 指数部分
      if (input[j] === "e" || input[j] === "E") {
        const next = input[j + 1] || "";
        if (next === "+" || next === "-") {
          if (/[0-9]/.test(input[j + 2] || "")) {
            j += 2;
            while (j < n && /[0-9]/.test(input[j])) j++;
          }
        } else if (/[0-9]/.test(next)) {
          j++;
          while (j < n && /[0-9]/.test(input[j])) j++;
        }
      }
      const num = Number(input.slice(i, j));
      if (!Number.isFinite(num)) {
        throw new Error(`无法解析数字: "${input.slice(i, j)}"`);
      }
      tokens.push({ type: "num", value: num });
      i = j;
      continue;
    }

    // 标识符（函数名 / 常量 / 变量）
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }

    // 运算符（含 ** 与 ^ 转幂）
    if (ch === "*" && input[i + 1] === "*") {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }
    if (ch === "^") {
      // ^ 作为 ** 的别名
      tokens.push({ type: "op", value: "**" });
      i++;
      continue;
    }
    if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    // 括号 / 逗号
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }

    throw new Error(`表达式含有非法字符: "${ch}"（位置 ${i}）`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

/**
 * 递归下降解析器：把 token 流编译为一个返回数值的闭包。
 *
 * 编译期完成所有语法/语义校验，运行期只执行数值计算 ——
 * 无 eval / new Function，符合严格 CSP。
 */
class Parser {
  constructor(tokens, varNames) {
    this.tokens = tokens;
    this.pos = 0;
    this.varNames = new Set(varNames);
    this.depth = 0;
    this.maxDepth = 200;
  }

  /** 递归进入嵌套层，超限即中止，防止深嵌套表达式耗尽调用栈 */
  enter() {
    this.depth++;
    if (this.depth > this.maxDepth) {
      throw new Error(`表达式嵌套过深（超过 ${this.maxDepth} 层），请简化表达式`);
    }
  }

  leave() {
    this.depth--;
  }

  peek() {
    return this.tokens[this.pos];
  }

  advance() {
    return this.tokens[this.pos++];
  }

  expect(type) {
    const t = this.peek();
    if (t.type !== type) {
      throw new Error(`解析错误：期望 ${type}，但遇到 ${t.type}（${t.value ?? ""}）`);
    }
    return this.advance();
  }

  /** 编译入口：解析整个表达式并返回一个 (...args) => number 闭包 */
  parse() {
    const node = this.parseExpr();
    if (this.peek().type !== "eof") {
      throw new Error("表达式存在多余内容（可能括号未闭合）");
    }
    return node;
  }

  // expr := term (('+' | '-') term)*
  parseExpr() {
    let left = this.parseTerm();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.advance().value;
      const right = this.parseTerm();
      const l = left;
      left = (ctx) => (op === "+" ? l(ctx) + right(ctx) : l(ctx) - right(ctx));
    }
    return left;
  }

  // term := factor (('*' | '/') factor)*
  parseTerm() {
    let left = this.parseFactor();
    while (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.advance().value;
      const right = this.parseFactor();
      const l = left;
      left = (ctx) => (op === "*" ? l(ctx) * right(ctx) : l(ctx) / right(ctx));
    }
    return left;
  }

  // factor := unary ('**' factor)?   # 右结合
  parseFactor() {
    const base = this.parseUnary();
    if (this.peek().type === "op" && this.peek().value === "**") {
      this.advance();
      this.enter();
      const exp = this.parseFactor(); // 右结合：递归调用 parseFactor
      this.leave();
      return (ctx) => Math.pow(base(ctx), exp(ctx));
    }
    return base;
  }

  // unary := ('+' | '-') unary | postfix
  parseUnary() {
    if (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.advance().value;
      this.enter();
      const operand = this.parseUnary();
      this.leave();
      if (op === "-") {
        return (ctx) => -operand(ctx);
      }
      return operand;
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    return this.parsePrimary();
  }

  // primary := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'
  parsePrimary() {
    const t = this.peek();

    if (t.type === "num") {
      this.advance();
      const v = t.value;
      return () => v;
    }

    if (t.type === "lparen") {
      this.advance();
      this.enter();
      const inner = this.parseExpr();
      this.leave();
      this.expect("rparen");
      return inner;
    }

    if (t.type === "ident") {
      this.advance();
      const name = t.value;

      // 函数调用
      if (this.peek().type === "lparen") {
        this.advance();
        const args = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek().type === "comma") {
            this.advance();
            args.push(this.parseExpr());
          }
        }
        this.expect("rparen");

        const fn = ALLOWED_FUNCS[name];
        if (!fn) {
          throw new Error(`未知的函数: ${name}`);
        }
        return (ctx) => fn(...args.map((a) => a(ctx)));
      }

      // 常量
      if (Object.prototype.hasOwnProperty.call(ALLOWED_CONSTS, name)) {
        const v = ALLOWED_CONSTS[name];
        return () => v;
      }

      // 变量（按位置索引）
      if (this.varNames.has(name)) {
        const idx = [...this.varNames].indexOf(name);
        return (ctx) => ctx[idx];
      }

      throw new Error(`表达式含有未允许的标识符: ${name}`);
    }

    throw new Error(`解析错误：意外的 token ${t.type}（${t.value ?? ""}）`);
  }
}

/**
 * 编译数学表达式为可调用函数。
 * @param {string} expr 表达式字符串，如 "sin(x)*exp(-0.1*x)"
 * @param {string[]} vars 变量名列表，如 ["x"] 或 ["t"] 或 ["t","y"]
 * @returns {(...args:number[]) => number} 接收与 vars 对应位置的数值参数
 */
/** 把教材/网页常见符号归一成 ASCII，便于粘贴输入 */
function normalizeExpr(src) {
  return String(src)
    .replace(/[−–—]/g, "-") // unicode 减号 / en-dash / em-dash
    .replace(/[×·⋅]/g, "*") // 乘号 / 中点
    .replace(/÷/g, "/")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/，/g, ",")
    .replace(/π/gi, "PI");
}

export function compileExpr(expr, vars = ["x"]) {
  const src = normalizeExpr(expr ?? "");
  if (!src.trim()) {
    throw new Error("表达式不能为空");
  }

  const tokens = tokenize(src);
  const parser = new Parser(tokens, vars);
  const evalNode = parser.parse();

  // 包装：检查非有限值，提供清晰错误
  return (...args) => {
    const v = evalNode(args);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("表达式在某些点上返回非有限值");
    }
    return v;
  };
}

export function parseNumberList(text) {
  return String(text)
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Error(`无法解析数值: ${s}`);
      return n;
    });
}

export function linspace(a, b, n) {
  const N = Math.max(2, Math.floor(n));
  const out = new Array(N);
  out[0] = a;
  out[N - 1] = b;
  for (let i = 1; i < N - 1; i++) out[i] = a + ((b - a) * i) / (N - 1);
  return out;
}

export function mean(arr) {
  if (!arr?.length) return NaN;
  let s = 0;
  let c = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
    else c += (v - t) + s;
    s = t;
  }
  return (s + c) / arr.length;
}

export function formatNum(x, digits = 6) {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(digits - 1);
  return Number(x.toPrecision(digits)).toString();
}
