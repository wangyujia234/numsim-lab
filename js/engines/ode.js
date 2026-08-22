import { compileExpr, linspace } from "../math.js";
import { richardsonError } from "./_numeric.js";

export function euler(f, t0, y0, tf, n) {
  const h = (tf - t0) / n;
  const t = [t0];
  const y = [y0];
  for (let i = 0; i < n; i++) {
    const yi = y[i] + h * f(t[i], y[i]);
    t.push(t[i] + h);
    y.push(yi);
  }
  return { t, y, h };
}

export function heun(f, t0, y0, tf, n) {
  const h = (tf - t0) / n;
  const t = [t0];
  const y = [y0];
  for (let i = 0; i < n; i++) {
    const k1 = f(t[i], y[i]);
    const k2 = f(t[i] + h, y[i] + h * k1);
    const yi = y[i] + (h / 2) * (k1 + k2);
    t.push(t[i] + h);
    y.push(yi);
  }
  return { t, y, h };
}

export function rk4(f, t0, y0, tf, n) {
  const h = (tf - t0) / n;
  const t = [t0];
  const y = [y0];
  for (let i = 0; i < n; i++) {
    const ti = t[i];
    const yi = y[i];
    const k1 = f(ti, yi);
    const k2 = f(ti + h / 2, yi + (h / 2) * k1);
    const k3 = f(ti + h / 2, yi + (h / 2) * k2);
    const k4 = f(ti + h, yi + h * k3);
    t.push(ti + h);
    y.push(yi + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4));
  }
  return { t, y, h };
}

/** Dormand–Prince RK5(4) 系数 */
const DP = {
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ],
  b5: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  b4: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40],
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
};

/**
 * 自适应 Dormand–Prince 4(5)
 * @returns {{ t, y, h, errEst, errSource, nSteps, nRejects }}
 */
export function rk45(f, t0, y0, tf, opts = {}) {
  const rtol = opts.rtol ?? 1e-8;
  const atol = opts.atol ?? 1e-10;
  const maxSteps = opts.maxSteps ?? 50000;
  const hMin = opts.hMin ?? 1e-12 * Math.max(1, Math.abs(tf - t0));
  const hMax = opts.hMax ?? Math.abs(tf - t0);

  let t = t0;
  let y = y0;
  let h = Math.min(hMax, Math.abs(tf - t0) / 50 || 1e-3);
  if (tf < t0) h = -h;

  const ts = [t];
  const ys = [y];
  let errEst = 0;
  let nSteps = 0;
  let nRejects = 0;
  const k = new Array(7);

  const dir = Math.sign(tf - t0) || 1;

  while ((dir > 0 && t < tf) || (dir < 0 && t > tf)) {
    if (nSteps >= maxSteps) throw new Error("RK45：超过最大步数，请放宽 tol 或缩短区间");
    if (Math.abs(h) < hMin) throw new Error("RK45：步长过小，可能遇到刚性或奇点");

    if ((dir > 0 && t + h > tf) || (dir < 0 && t + h < tf)) h = tf - t;

    k[0] = f(t, y);
    for (let i = 1; i < 7; i++) {
      let yi = y;
      for (let j = 0; j < i; j++) yi += h * DP.a[i][j] * k[j];
      k[i] = f(t + DP.c[i] * h, yi);
    }

    let y5 = y;
    let y4 = y;
    for (let i = 0; i < 7; i++) {
      y5 += h * DP.b5[i] * k[i];
      y4 += h * DP.b4[i] * k[i];
    }

    const sc = atol + rtol * Math.max(Math.abs(y), Math.abs(y5));
    const err = Math.abs(y5 - y4) / sc;
    const safety = 0.9;
    const order = 5;

    if (err <= 1 || Math.abs(h) <= hMin * 1.01) {
      t += h;
      y = y5;
      ts.push(t);
      ys.push(y);
      errEst = Math.max(errEst, Math.abs(y5 - y4));
      nSteps++;
      const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, safety * Math.pow(1 / err, 1 / order)));
      h = Math.min(hMax, Math.max(hMin, Math.abs(h) * fac)) * dir;
    } else {
      nRejects++;
      const fac = Math.max(0.2, safety * Math.pow(1 / err, 1 / order));
      h = Math.max(hMin, Math.abs(h) * fac) * dir;
    }
  }

  return {
    t: ts,
    y: ys,
    h: ts.length > 1 ? ts[ts.length - 1] - ts[ts.length - 2] : 0,
    errEst,
    errSource: "adaptive",
    nSteps,
    nRejects,
  };
}

export function runODE({ expr, t0, y0, tf, n, method, rtol, atol }) {
  const f = compileExpr(expr, ["t", "y"]);
  let sol;
  let errEst;
  let errSource;

  switch (method) {
    case "euler": {
      const n1 = Math.max(10, n);
      const coarse = euler(f, t0, y0, tf, n1);
      const fine = euler(f, t0, y0, tf, n1 * 2);
      sol = fine;
      errEst = richardsonError(coarse.y[coarse.y.length - 1], fine.y[fine.y.length - 1], 1);
      errSource = "richardson";
      break;
    }
    case "heun": {
      const n1 = Math.max(10, n);
      const coarse = heun(f, t0, y0, tf, n1);
      const fine = heun(f, t0, y0, tf, n1 * 2);
      sol = fine;
      errEst = richardsonError(coarse.y[coarse.y.length - 1], fine.y[fine.y.length - 1], 2);
      errSource = "richardson";
      break;
    }
    case "rk45": {
      sol = rk45(f, t0, y0, tf, { rtol, atol });
      errEst = sol.errEst;
      errSource = sol.errSource;
      break;
    }
    case "rk4":
    default: {
      const n1 = Math.max(10, n);
      const coarse = rk4(f, t0, y0, tf, n1);
      const fine = rk4(f, t0, y0, tf, n1 * 2);
      sol = fine;
      errEst = richardsonError(coarse.y[coarse.y.length - 1], fine.y[fine.y.length - 1], 4);
      errSource = "richardson";
      break;
    }
  }

  const yEnd = sol.y[sol.y.length - 1];

  return {
    ...sol,
    yEnd,
    errEst,
    errSource,
    denseT: linspace(t0, tf, 200),
  };
}
