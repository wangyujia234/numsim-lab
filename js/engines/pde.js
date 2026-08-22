import { linspace } from "../math.js";
import { thomas } from "./_numeric.js";

/**
 * 一维热传导方程：u_t = α u_xx
 * scheme: "ftcs"（显式）| "cn"（Crank–Nicolson）
 */
export function runHeat1D({
  alpha = 0.1,
  L = 1,
  nx = 40,
  tf = 0.5,
  nt = 200,
  ic = "sine",
  uLeft = 0,
  uRight = 0,
  scheme = "ftcs",
}) {
  const a = Math.max(1e-6, Number(alpha) || 0.1);
  const length = Math.max(1e-6, Number(L) || 1);
  const Nx = Math.max(8, Math.min(200, Math.floor(Number(nx) || 40)));
  const Tf = Math.max(1e-4, Number(tf) || 0.5);
  let Nt = Math.max(20, Math.min(5000, Math.floor(Number(nt) || 200)));
  const useCN = String(scheme || "ftcs").toLowerCase() === "cn";
  const dx = length / Nx;
  let dt = Tf / Nt;
  let r = (a * dt) / (dx * dx);
  let stabilityNote = "";

  if (!useCN && r > 0.5) {
    const ntNeed = Math.ceil((a * Tf) / (0.5 * dx * dx)) + 1;
    const Nt2 = Math.min(8000, Math.max(Nt, ntNeed));
    if ((a * Tf) / (Nt2 * dx * dx) > 0.5) {
      throw new Error(`显式格式不稳定：r 无法压到 ≤0.5，请减小 tf 或增大 nx，或改用 Crank–Nicolson`);
    }
    Nt = Nt2;
    dt = Tf / Nt;
    r = (a * dt) / (dx * dx);
    stabilityNote = `已自动将 nt 调整为 ${Nt} 以满足 r≤0.5`;
  }

  const x = linspace(0, length, Nx + 1);
  let u = x.map((xi) => {
    if (ic === "tent") {
      const m = length / 2;
      return xi <= m ? xi / m : (length - xi) / m;
    }
    if (ic === "pulse") return xi > 0.4 * length && xi < 0.6 * length ? 1 : 0;
    return Math.sin((Math.PI * xi) / length);
  });
  u[0] = Number(uLeft) || 0;
  u[u.length - 1] = Number(uRight) || 0;

  const frames = [{ t: 0, u: u.slice() }];
  const snapEvery = Math.max(1, Math.floor(Nt / 8));

  if (useCN) {
    // (I - θ r δ²) u^{n+1} = (I + (1-θ) r δ²) u^n，θ=1/2
    const theta = 0.5;
    const Nint = Nx - 1; // 内点 1..Nx-1
    for (let n = 1; n <= Nt; n++) {
      const aa = new Array(Nint).fill(0);
      const bb = new Array(Nint).fill(0);
      const cc = new Array(Nint).fill(0);
      const dd = new Array(Nint).fill(0);
      const ul = Number(uLeft) || 0;
      const ur = Number(uRight) || 0;

      for (let i = 1; i <= Nx - 1; i++) {
        const k = i - 1;
        const left = i === 1 ? ul : u[i - 1];
        const right = i === Nx - 1 ? ur : u[i + 1];
        // RHS: u_i + (1-θ)r (u_{i+1}-2u_i+u_{i-1}) + 边界对 LHS 的贡献在求解时处理
        const lap = right - 2 * u[i] + left;
        dd[k] = u[i] + (1 - theta) * r * lap;
        aa[k] = -theta * r;
        bb[k] = 1 + 2 * theta * r;
        cc[k] = -theta * r;
      }
      // 边界并入 RHS：i=1 项含 u0，i=Nx-1 含 uN
      dd[0] += theta * r * ul;
      dd[Nint - 1] += theta * r * ur;
      aa[0] = 0;
      cc[Nint - 1] = 0;

      const interior = thomas(aa, bb, cc, dd);
      const next = u.slice();
      for (let i = 1; i <= Nx - 1; i++) next[i] = interior[i - 1];
      next[0] = ul;
      next[next.length - 1] = ur;
      u = next;
      if (n % snapEvery === 0 || n === Nt) frames.push({ t: n * dt, u: u.slice() });
    }
  } else {
    for (let n = 1; n <= Nt; n++) {
      const next = u.slice();
      for (let i = 1; i < Nx; i++) {
        next[i] = u[i] + r * (u[i + 1] - 2 * u[i] + u[i - 1]);
      }
      next[0] = Number(uLeft) || 0;
      next[next.length - 1] = Number(uRight) || 0;
      u = next;
      if (n % snapEvery === 0 || n === Nt) frames.push({ t: n * dt, u: u.slice() });
    }
  }

  const series = frames.map((fr) => ({
    name: `t=${fr.t.toFixed(3)}`,
    x,
    y: fr.u,
    ylabel: "u",
  }));

  const schemeName = useCN ? "Crank–Nicolson" : "FTCS";
  return {
    method: useCN ? "heat1d_cn" : "heat1d",
    scheme: useCN ? "cn" : "ftcs",
    t: x,
    series,
    metrics: {
      alpha: a,
      L: length,
      r_stability: r,
      dx,
      dt,
      Nx,
      Nt,
      scheme: schemeName,
      u_mid_final: u[Math.floor(u.length / 2)],
      u_max_final: Math.max(...u),
      ...(stabilityNote ? { auto_nt_note: stabilityNote } : {}),
    },
    title: `一维热方程 ${schemeName} · α=${a} · r=${r.toFixed(3)}`,
    plotKind: "heat",
    stabilityNote,
  };
}
