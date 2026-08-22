/** 生成可下载/复制的 Python 与 MATLAB 代码 */

export function generateCode(decision, payload, result) {
  switch (decision.type) {
    case "interpolate":
      return genInterp(decision, payload, result);
    case "integrate":
      return genInteg(decision, payload, result);
    case "ode":
      return genODE(decision, payload, result);
    case "circuit":
      return genCircuit(decision, payload, result);
    case "imagefit":
      return genImageFit(decision, payload, result);
    case "transform":
      return genTransform(decision, payload, result);
    case "control":
      return genControl(decision, payload, result);
    case "pde":
      return genPde(decision, payload, result);
    default:
      return { python: "# unsupported", matlab: "% unsupported" };
  }
}

function genPde(decision, p) {
  const python = `import numpy as np
import matplotlib.pyplot as plt

alpha, L, Nx, Tf, Nt = ${p.alpha}, ${p.L}, ${p.nx}, ${p.tf}, ${p.nt}
dx = L / Nx
dt = Tf / Nt
r = alpha * dt / dx**2
assert r <= 0.5, f'unstable r={r}'
x = np.linspace(0, L, Nx + 1)
u = np.sin(np.pi * x / L)
u[0] = ${p.uLeft}; u[-1] = ${p.uRight}
for n in range(Nt):
    u[1:-1] = u[1:-1] + r * (u[2:] - 2*u[1:-1] + u[:-2])
    u[0] = ${p.uLeft}; u[-1] = ${p.uRight}
plt.plot(x, u); plt.grid(True); plt.title('heat 1D FTCS'); plt.show()
`;
  const matlab = `alpha=${p.alpha}; L=${p.L}; Nx=${p.nx}; Tf=${p.tf}; Nt=${p.nt};
dx=L/Nx; dt=Tf/Nt; r=alpha*dt/dx^2;
x=linspace(0,L,Nx+1); u=sin(pi*x/L); u(1)=${p.uLeft}; u(end)=${p.uRight};
for n=1:Nt
  u(2:end-1)=u(2:end-1)+r*(u(3:end)-2*u(2:end-1)+u(1:end-2));
  u(1)=${p.uLeft}; u(end)=${p.uRight};
end
plot(x,u); grid on;
`;
  return { python, matlab };
}

function genInterp(decision, p) {
  const method = decision.algorithm;
  const x = JSON.stringify(p.x);
  const y = JSON.stringify(p.y);
  const q = JSON.stringify(p.query);

  const pyMap = {
    spline: "CubicSpline",
    lagrange: "lagrange",
    newton: "BarycentricInterpolator",
    linear: "interp1d",
  };

  let python;
  if (method === "spline") {
    python = `import numpy as np
from scipy.interpolate import CubicSpline
import matplotlib.pyplot as plt

x = np.array(${x})
y = np.array(${y})
query = np.array(${q})

cs = CubicSpline(x, y, bc_type='natural')
xd = np.linspace(x.min(), x.max(), 300)
yd = cs(xd)
yq = cs(query)

plt.figure(figsize=(8, 4.5))
plt.plot(xd, yd, label='cubic spline')
plt.plot(x, y, 'o', label='samples')
plt.plot(query, yq, 'x', label='query')
plt.legend(); plt.grid(True); plt.xlabel('x'); plt.ylabel('y')
plt.title('Cubic Spline Interpolation')
plt.show()
print('query values:', yq)
`;
  } else if (method === "linear") {
    python = `import numpy as np
from scipy.interpolate import interp1d
import matplotlib.pyplot as plt

x = np.array(${x})
y = np.array(${y})
query = np.array(${q})
f = interp1d(x, y, kind='linear', fill_value='extrapolate')
xd = np.linspace(x.min(), x.max(), 300)
plt.plot(xd, f(xd)); plt.plot(x, y, 'o'); plt.plot(query, f(query), 'x')
plt.grid(True); plt.show()
print(f(query))
`;
  } else {
    python = `import numpy as np
from scipy.interpolate import ${pyMap[method] || "CubicSpline"}
import matplotlib.pyplot as plt

x = np.array(${x})
y = np.array(${y})
query = np.array(${q})
# method: ${method}
poly = ${method === "lagrange" ? "lagrange(x, y)" : "BarycentricInterpolator(x, y)"}
xd = np.linspace(x.min(), x.max(), 300)
plt.plot(xd, poly(xd)); plt.plot(x, y, 'o'); plt.plot(query, poly(query), 'x')
plt.grid(True); plt.show()
print(poly(query))
`;
  }

  const matlab = `% ${decision.algorithmName}
x = ${matlabRow(p.x)};
y = ${matlabRow(p.y)};
query = ${matlabRow(p.query)};
xd = linspace(min(x), max(x), 300);

${
  method === "spline"
    ? "yd = spline(x, y, xd);\nyq = spline(x, y, query);"
    : method === "linear"
      ? "yd = interp1(x, y, xd, 'linear');\nyq = interp1(x, y, query, 'linear');"
      : "p = polyfit(x, y, numel(x)-1);\nyd = polyval(p, xd);\nyq = polyval(p, query);"
}

figure; plot(xd, yd, 'LineWidth', 1.4); hold on;
plot(x, y, 'o', 'MarkerSize', 7);
plot(query, yq, 'x', 'MarkerSize', 9);
grid on; xlabel('x'); ylabel('y'); legend('interp','samples','query');
disp(yq);
`;

  return { python, matlab };
}

function genInteg(decision, p, result) {
  const method = decision.algorithm;
  const python = `import numpy as np
from scipy import integrate
import matplotlib.pyplot as plt

def f(x):
    return ${pyExpr(p.expr)}

a, b, n = ${p.a}, ${p.b}, ${p.n}
${
  method === "simpson"
    ? "val = integrate.simpson(f(np.linspace(a, b, n+1)), x=np.linspace(a, b, n+1))"
    : method === "trapezoid"
      ? "val = integrate.trapezoid(f(np.linspace(a, b, n+1)), x=np.linspace(a, b, n+1))"
      : method === "adaptive"
        ? "val, err = integrate.quad(f, a, b, epsabs=1e-8)"
        : "val, _ = integrate.romberg(f, a, b) if hasattr(integrate,'romberg') else integrate.quad(f, a, b)"
}

xs = np.linspace(a, b, 400)
plt.fill_between(xs, f(xs), alpha=0.25)
plt.plot(xs, f(xs))
plt.title(f'Integral ≈ {val:.8g}')
plt.grid(True); plt.show()
print('integral =', val)
# NumSim browser result ≈ ${result?.value}
`;

  const matlab = `% ${decision.algorithmName}
f = @(x) ${matlabExpr(p.expr)};
a = ${p.a}; b = ${p.b}; n = ${p.n};
${
  method === "simpson"
    ? "val = integral(f, a, b, 'AbsTol', 1e-10); % or simpson via trapz on fine grid"
    : method === "romberg"
      ? "val = integral(f, a, b, 'AbsTol', 1e-12);"
      : method === "adaptive"
        ? "val = integral(f, a, b, 'AbsTol', 1e-8);"
        : "x = linspace(a, b, n+1); val = trapz(x, f(x));"
}
xs = linspace(a, b, 400);
figure; area(xs, f(xs), 'FaceAlpha', 0.25); hold on; plot(xs, f(xs));
grid on; title(sprintf('Integral = %.8g', val));
disp(val);
`;

  return { python, matlab };
}

function genODE(decision, p) {
  const method = decision.algorithm;
  const python = `import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

def f(t, y):
    return ${pyExpr(p.expr, ["t", "y"])}

t0, tf, y0 = ${p.t0}, ${p.tf}, [${p.y0}]
sol = solve_ivp(f, (t0, tf), y0, method='RK45', dense_output=True, rtol=1e-8, atol=1e-10)
t = np.linspace(t0, tf, ${p.n})
y = sol.sol(t)[0]

# Browser engine method: ${method}
plt.plot(t, y, label='solve_ivp RK45')
plt.xlabel('t'); plt.ylabel('y'); plt.grid(True); plt.legend()
plt.title('ODE: y\\' = ${p.expr}')
plt.show()
print('y(tf) =', y[-1])
`;

  const matlab = `% ${decision.algorithmName}
f = @(t, y) ${matlabExpr(p.expr, ["t", "y"])};
tspan = [${p.t0}, ${p.tf}];
y0 = ${p.y0};
[t, y] = ode45(f, tspan, y0); % analogous to RK45
figure; plot(t, y, 'LineWidth', 1.4); grid on;
xlabel('t'); ylabel('y'); title('ODE45 solution');
disp(y(end));
`;

  return { python, matlab };
}

function genCircuit(decision, p) {
  const topo = decision.overrides?.topo || p.topo;
  const python = `import numpy as np
import matplotlib.pyplot as plt

R, L, C, src = ${p.R}, ${p.L}, ${p.C}, ${p.src}
topo = '${topo}'

if topo == 'series_rlc':
    alpha = R / (2*L)
    w0 = 1/np.sqrt(L*C)
    t = np.linspace(0, max(8/max(alpha,1e-6), 20), 800)
    if alpha > w0:
        d = np.sqrt(alpha**2 - w0**2); s1, s2 = -alpha+d, -alpha-d
        A1 = src/(L*(s1-s2)); i = A1*np.exp(s1*t) - A1*np.exp(s2*t)
    elif np.isclose(alpha, w0):
        i = (src/L)*t*np.exp(-alpha*t)
    else:
        wd = np.sqrt(w0**2 - alpha**2)
        i = (src/(L*wd))*np.exp(-alpha*t)*np.sin(wd*t)
    plt.plot(t, i); plt.title('Series RLC current'); plt.grid(True); plt.show()
elif topo == 'parallel_rc':
    tau = R*C; t = np.linspace(0, 6*tau, 600)
    v = src*np.exp(-t/tau)
    plt.plot(t, v); plt.title('RC discharge'); plt.grid(True); plt.show()
elif topo == 'series_rl':
    tau = L/R; t = np.linspace(0, 6*tau, 600)
    i = (src/R)*(1-np.exp(-t/tau))
    plt.plot(t, i); plt.title('RL step current'); plt.grid(True); plt.show()
else:
    f0 = 1/(2*np.pi*np.sqrt(L*C))
    f = np.linspace(f0/20, f0*8, 500)
    w = 2*np.pi*f
    Z = R + 1j*(w*L - 1/(w*C))
    plt.semilogy(f, 1/np.abs(Z)); plt.title('|Y(f)|'); plt.grid(True); plt.show()
`;

  const matlab = `% ${decision.algorithmName}
R = ${p.R}; L = ${p.L}; C = ${p.C}; src = ${p.src};
topo = '${topo}';
% 与 Python 脚本同构的解析实现，可按 topo 分支改写
syms t
% 建议：对 RLC 使用 dsolve 或直接写出欠/过/临界阻尼公式
figure; grid on; title(topo);
`;

  return { python, matlab };
}

function genImageFit(decision, p, result) {
  const x = JSON.stringify(p.x);
  const y = JSON.stringify(p.y);
  const deg = p.degree || 3;
  const eq = result?.equation || "";
  const python = `import numpy as np
import matplotlib.pyplot as plt

# Digitized from image; fitted: ${eq}
x = np.array(${x})
y = np.array(${y})
deg = ${deg}

coef = np.polyfit(x, y, deg)  # highest power first
xd = np.linspace(x.min(), x.max(), 300)
yd = np.polyval(coef, xd)

plt.figure(figsize=(8, 4.5))
plt.plot(xd, yd, label='fit')
plt.plot(x, y, 'o', label='digitized')
plt.grid(True); plt.legend()
plt.title(${JSON.stringify(eq)})
plt.xlabel('x'); plt.ylabel('y')
plt.show()
print('coefficients (high→low):', coef)
print('R^2 approx via residuals can be computed similarly')
`;

  const matlab = `% ${decision.algorithmName}
% ${eq}
x = ${matlabRow(p.x)};
y = ${matlabRow(p.y)};
deg = ${deg};
p = polyfit(x, y, deg);
xd = linspace(min(x), max(x), 300);
yd = polyval(p, xd);
figure; plot(xd, yd, 'LineWidth', 1.4); hold on;
plot(x, y, 'o'); grid on; legend('fit','digitized');
disp(p);
`;

  return { python, matlab };
}

function genTransform(decision, p) {
  const method = decision.algorithm;
  const expr = pyExpr(p.expr, ["t"]);
  let python;
  if (method === "fft") {
    python = `import numpy as np
import matplotlib.pyplot as plt

def f(t):
    return ${expr}

t0, tf, N = ${p.t0}, ${p.tf}, ${p.n}
t = np.linspace(t0, tf, N, endpoint=False)
sig = f(t)
dt = t[1] - t[0]
Fs = 1/dt
Y = np.fft.rfft(sig)
freq = np.fft.rfftfreq(N, dt)
mag = 2*np.abs(Y)/N
mag[0] /= 2

plt.figure(figsize=(8,4.5))
plt.subplot(2,1,1); plt.plot(t, sig); plt.title('f(t)'); plt.grid(True)
plt.subplot(2,1,2); plt.plot(freq, mag); plt.title('FFT |F|'); plt.grid(True)
plt.tight_layout(); plt.show()
print('peak freq ~', freq[np.argmax(mag)], 'Hz')
`;
  } else if (method === "fourier") {
    python = `import numpy as np
from scipy import integrate
import matplotlib.pyplot as plt

def f(t):
    return ${expr}

t0, tf = ${p.t0}, ${p.tf}
fmax = ${p.fMax}
omega = 2*np.pi*np.linspace(-fmax, fmax, ${p.n})

def FT(w):
    re, _ = integrate.quad(lambda t: f(t)*np.cos(w*t), t0, tf, epsabs=1e-6)
    im, _ = integrate.quad(lambda t: -f(t)*np.sin(w*t), t0, tf, epsabs=1e-6)
    return re + 1j*im

F = np.array([FT(w) for w in omega])
plt.plot(omega/(2*np.pi), np.abs(F))
plt.xlabel('f (Hz)'); plt.ylabel('|F|'); plt.grid(True); plt.show()
`;
  } else {
    python = `import numpy as np
from scipy import integrate
import matplotlib.pyplot as plt

def f(t):
    return ${expr}

T, sigma, fmax = ${p.tf}, ${p.sigma}, ${p.fMax}
omega = 2*np.pi*np.linspace(0, fmax, ${p.n})

def Laplace(s):
    # numerical truncated Laplace
    def integrand(t):
        return f(t)*np.exp(-s*t)
    # complex via real/imag
    re,_ = integrate.quad(lambda t: np.real(integrand(t)), 0, T, epsabs=1e-5)
    im,_ = integrate.quad(lambda t: np.imag(integrand(t)), 0, T, epsabs=1e-5)
    return re+1j*im

F = np.array([Laplace(sigma + 1j*w) for w in omega])
plt.plot(omega/(2*np.pi), np.abs(F))
plt.title(f'|F(σ+jω)| σ={sigma}'); plt.grid(True); plt.show()
`;
  }

  const matlab = `% ${decision.algorithmName}
f = @(t) ${matlabExpr(p.expr)};
t0 = ${p.t0}; tf = ${p.tf};
${
  method === "fft"
    ? `N = ${p.n}; t = linspace(t0, tf, N+1); t(end)=[]; sig = f(t);
Y = fft(sig); Fs = 1/(t(2)-t(1));
freq = (0:floor(N/2))*Fs/N; mag = abs(Y(1:numel(freq)))*2/N; mag(1)=mag(1)/2;
figure; subplot(2,1,1); plot(t,sig); grid on; subplot(2,1,2); plot(freq,mag); grid on;`
    : method === "fourier"
      ? `% 可用 integral 数值计算 FT；或 fft 近似
t = linspace(t0, tf, 1024); plot(t, f(t)); grid on; title('f(t)');`
      : `syms t s; % 若有符号工具箱可用 laplace(f(t))
% 否则数值截断积分 F(s)=int(f(t)*exp(-s*t),0,tf)
tf = ${p.tf}; sigma = ${p.sigma};`
}
`;

  return { python, matlab };
}

function genControl(decision, p) {
  const method = decision.algorithm;
  let python = "";
  let matlab = "";
  if (method === "second_order") {
    python = `import numpy as np
import matplotlib.pyplot as plt
from scipy import signal

zeta, wn, K = ${p.zeta}, ${p.wn}, ${p.K}
sys = signal.TransferFunction([K*wn**2], [1, 2*zeta*wn, wn**2])
t, y = signal.step(sys, T=np.linspace(0, ${p.tf}, 800))
plt.plot(t, y); plt.grid(True); plt.title('2nd-order step'); plt.show()
`;
    matlab = `zeta=${p.zeta}; wn=${p.wn}; K=${p.K};
sys = tf(K*wn^2, [1, 2*zeta*wn, wn^2]);
step(sys); grid on;
`;
  } else if (method === "pid") {
    python = `import numpy as np
import matplotlib.pyplot as plt
from scipy import signal

# Plant + PID (continuous approximation)
Kp, Ki, Kd = ${p.Kp}, ${p.Ki}, ${p.Kd}
# Example: first-order plant K/(tau s+1)
tau, K = ${p.tau}, ${p.K}
plant = signal.TransferFunction([K], [tau, 1])
# Use feedback simulation via forced response / control library if available
print('Prefer python-control: control.forced_response / pid_tf')
t = np.linspace(0, ${p.tf}, 1000)
# Simple closed-loop with PI for illustration via signal.lti series not shown
plt.title('PID demo – see NumSim browser result'); plt.grid(True); plt.show()
`;
    matlab = `Kp=${p.Kp}; Ki=${p.Ki}; Kd=${p.Kd};
plant = tf(${p.K}, [${p.tau} 1]);
C = pid(Kp, Ki, Kd);
T = feedback(C*plant, 1);
step(T); grid on;
`;
  } else if (method === "bode") {
    python = `import numpy as np
import matplotlib.pyplot as plt
from scipy import signal

num = [${String(p.num)}]
den = [${String(p.den)}]
sys = signal.TransferFunction(num, den)
w, mag, phase = signal.bode(sys)
plt.figure(); plt.semilogx(w, mag); plt.ylabel('dB'); plt.grid(True, which='both')
plt.figure(); plt.semilogx(w, phase); plt.ylabel('deg'); plt.grid(True, which='both')
plt.show()
`;
    matlab = `sys = tf([${p.num}], [${p.den}]);
bode(sys); grid on;
`;
  } else if (method === "dc_motor") {
    python = `import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

Ra, La, Kt, Kb, J, B, Va = ${p.Ra ?? 1}, ${p.La ?? 0.5}, ${p.Kt ?? 0.01}, ${p.Kb ?? 0.01}, ${p.J ?? 0.01}, ${p.B ?? 0.1}, ${p.Va}
def f(t, x):
    ia, w = x
    return [(Va - Ra*ia - Kb*w)/La, (Kt*ia - B*w)/J]
sol = solve_ivp(f, [0, ${p.tf}], [0, 0], dense_output=True, rtol=1e-6)
t = np.linspace(0, ${p.tf}, 500)
ia, w = sol.sol(t)
plt.plot(t, w, label='omega'); plt.plot(t, ia, label='ia'); plt.legend(); plt.grid(True); plt.show()
`;
    matlab = `% DC motor armature model
% La*dia = Va - Ra*ia - Kb*w; J*dw = Kt*ia - B*w
`;
  } else if (method === "rlocus") {
    python = `import numpy as np
import matplotlib.pyplot as plt
from scipy import signal

num = [${String(p.num)}]
den = [${String(p.den)}]
sys = signal.TransferFunction(num, den)
# Prefer python-control: control.root_locus(sys)
r, k = signal.rlocus(sys) if hasattr(signal, 'rlocus') else (None, None)
print('Use python-control.root_locus or MATLAB rlocus')
`;
    matlab = `sys = tf([${p.num}], [${p.den}]);
rlocus(sys); grid on;
`;
  } else if (method === "z_transform") {
    python = `import numpy as np
import matplotlib.pyplot as plt

T, N = ${p.T}, ${p.zN}
n = np.arange(N)
a, f0 = ${p.zAlpha ?? 0.3}, ${p.zFreq ?? 1.5}
seq = np.exp(-a*n*T)*np.sin(2*np.pi*f0*n*T)
w = np.linspace(0, np.pi, 256)
F = np.array([np.sum(seq * np.exp(-1j*wi*n)) for wi in w])
plt.subplot(2,1,1); plt.plot(w, np.abs(F)); plt.ylabel('|F|'); plt.grid(True)
plt.subplot(2,1,2); plt.plot(w, np.angle(F)); plt.ylabel('phase'); plt.xlabel('omega'); plt.grid(True)
plt.show()
`;
    matlab = `T=${p.T}; N=${p.zN}; n=0:N-1;
seq = exp(-${p.zAlpha ?? 0.3}*n*T).*sin(2*pi*${p.zFreq ?? 1.5}*n*T);
w = linspace(0,pi,256);
F = arrayfun(@(wi) sum(seq.*exp(-1j*wi*n)), w);
subplot(2,1,1); plot(w, abs(F)); grid on;
subplot(2,1,2); plot(w, angle(F)); grid on;
`;
  } else if (method === "z_tf_step") {
    python = `import numpy as np
import matplotlib.pyplot as plt
num=[${String(p.num)}]; den=[${String(p.den)}]
# y[k] from difference equation, unit step
N=${p.zN || 80}
y=np.zeros(N); u=np.ones(N)
a0=den[0]
for k in range(N):
    s=0.0
    for i,b in enumerate(num):
        s += b*(u[k-i] if k-i>=0 else 0)
    for j in range(1,len(den)):
        s -= den[j]*(y[k-j] if k-j>=0 else 0)
    y[k]=s/a0
plt.stem(range(N), y); plt.grid(True); plt.show()
`;
    matlab = `num=[${p.num}]; den=[${p.den}];
sys=tf(num,den,1); step(sys, ${p.zN || 80}); grid on;
`;
  } else if (method === "jury") {
    python = `import numpy as np
den = np.array([${String(p.den)}], dtype=float)
print('Jury test poly (high→low):', den)
print('F(1)=', np.polyval(den, 1), ' F(-1)=', np.polyval(den, -1))
print('Use control library or implement Jury table for full test')
`;
    matlab = `den=[${p.den}];
% Jury table / roots inside unit circle
r=roots(den); disp(abs(r));
`;
  } else if (method === "pole_place") {
    python = `import numpy as np
from scipy import signal

A = np.array([${String(p.A)}], dtype=float).reshape(${p.order}, ${p.order})
B = np.array([${String(p.B)}], dtype=float).reshape(${p.order}, 1)
poles = [${String(p.poles)}]
# place poles (requires control library ideally)
print('K = place(A,B,poles); use python-control.place or scipy.signal.place_poles')
fsys = signal.place_poles(A, B, poles)
print('K=', fsys.gain_matrix)
`;
    matlab = `A = reshape([${p.A}], ${p.order}, ${p.order})';
B = [${p.B}]';
p = [${p.poles}];
K = place(A, B, p)
sys = ss(A-B*K, B, [1 zeros(1,${Number(p.order) || 2}-1)], 0);
step(sys); grid on;
`;
  } else if (method === "sensor_cal") {
    python = `import numpy as np
import matplotlib.pyplot as plt

x = np.array([${String(p.xref)}])
y = np.array([${String(p.ymeas)}])
deg = ${p.calDegree ?? 1}
coef = np.polyfit(x, y, deg)
xd = np.linspace(x.min(), x.max(), 100)
yd = np.polyval(coef, xd)
plt.plot(xd, yd, label='fit'); plt.scatter(x, y, label='data'); plt.legend(); plt.grid(True); plt.show()
print('poly coeffs (high→low):', coef)
`;
    matlab = `x=[${p.xref}]; y=[${p.ymeas}];
p = polyfit(x, y, ${p.calDegree ?? 1});
xd = linspace(min(x), max(x), 100);
plot(xd, polyval(p, xd), x, y, 'o'); grid on;
`;
  } else {
    python = `import numpy as np
from scipy import signal
import matplotlib.pyplot as plt
num=[${p.num}]; den=[${p.den}]
sys=signal.TransferFunction(num, den)
t,y=signal.step(sys)
plt.plot(t,y); plt.grid(True); plt.show()
`;
    matlab = `sys=tf([${p.num}],[${p.den}]); step(sys); grid on;`;
  }
  return { python, matlab };
}

function matlabRow(arr) {
  return `[${arr.join(" ")}]`;
}

function pyExpr(expr, vars = ["x"]) {
  return String(expr)
    .replace(/\^/g, "**")
    .replace(/\bPI\b/gi, "np.pi")
    .replace(/\bE\b/g, "np.e");
}

function matlabExpr(expr) {
  return String(expr)
    .replace(/\*\*/g, "^")
    .replace(/\bPI\b/gi, "pi")
    .replace(/\bexp\b/g, "exp")
    .replace(/\blog\b/g, "log");
}
