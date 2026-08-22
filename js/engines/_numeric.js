/**
 * 共享数值工具：Thomas 三对角、Richardson 估计、范数
 */

/** 三对角 Thomas 算法：a 下对角, b 主对角, c 上对角, d 右端 → x */
export function thomas(a, b, c, d) {
  const n = d.length;
  if (b.length !== n || d.length !== n) throw new Error("Thomas：维度不一致");
  const cp = new Array(n);
  const dp = new Array(n);
  const x = new Array(n);

  let bi = b[0];
  if (Math.abs(bi) < 1e-30) throw new Error("Thomas：主元过小（奇异）");
  cp[0] = (c[0] || 0) / bi;
  dp[0] = d[0] / bi;

  for (let i = 1; i < n; i++) {
    const ai = a[i] || 0;
    const denom = b[i] - ai * cp[i - 1];
    if (Math.abs(denom) < 1e-30) throw new Error("Thomas：主元过小（奇异）");
    cp[i] = i < n - 1 ? (c[i] || 0) / denom : 0;
    dp[i] = (d[i] - ai * dp[i - 1]) / denom;
  }

  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/** |coarse - fine| / (2^p - 1)，默认 p=2（梯形/中点）或 p=4（Simpson） */
export function richardsonError(coarse, fine, order = 2) {
  const den = Math.pow(2, order) - 1;
  if (!(den > 0)) return Math.abs(fine - coarse);
  return Math.abs(fine - coarse) / den;
}

/**
 * Neumaier 补偿求和：对正负相抵或数值悬殊的序列，
 * 比朴素累加显著降低舍入误差（Kahan 的改进版，无分支缺陷）。
 */
export function compensatedSum(arr) {
  let s = 0;
  let c = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
    else c += (v - t) + s;
    s = t;
  }
  return s + c;
}

export function rmseVec(a, b) {
  if (!a?.length || a.length !== b.length) return NaN;
  let s = 0;
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    const v = d * d;
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
    else c += (v - t) + s;
    s = t;
  }
  return Math.sqrt((s + c) / a.length);
}

export function maxAbsVec(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export function l2Norm(v) {
  let s = 0;
  let c = 0;
  for (let i = 0; i < v.length; i++) {
    const vi = v[i];
    const vv = vi * vi;
    const t = s + vv;
    if (Math.abs(s) >= Math.abs(vv)) c += (s - t) + vv;
    else c += (vv - t) + s;
    s = t;
  }
  return Math.sqrt(s + c);
}

export function errSourceLabel(src) {
  switch (src) {
    case "adaptive":
      return "自适应局部误差估计";
    case "richardson":
      return "Richardson 外推估计";
    case "exact":
      return "对解析解误差";
    case "reference":
      return "相对参考解估计";
    default:
      return "误差估计";
  }
}
