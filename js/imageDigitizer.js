/**
 * 图像数字化：上传曲线图 → 标定坐标 → 点选 / 自动采样
 */

import { autoSampleCurve, pixelToData } from "./engines/imagefit.js";

export function createDigitizer({ canvas, onChange }) {
  const ctx = canvas.getContext("2d");
  const state = {
    img: null,
    imgDataUrl: "",
    points: [], // {px, py, x, y}
    margin: 0.06,
  };

  function axisMeta() {
    return {
      width: canvas.width,
      height: canvas.height,
      xmin: Number(document.getElementById("img-xmin").value),
      xmax: Number(document.getElementById("img-xmax").value),
      ymin: Number(document.getElementById("img-ymin").value),
      ymax: Number(document.getElementById("img-ymax").value),
      margin: state.margin,
    };
  }

  function recomputePoints() {
    const meta = axisMeta();
    state.points = state.points.map((p) => {
      const d = pixelToData(p.px, p.py, meta);
      return { ...p, x: d.x, y: d.y };
    });
  }

  function loadImageFromSrc(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("鍥惧儚鍔犺浇澶辫触"));
      img.src = src;
    });
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.img) {
      ctx.drawImage(state.img, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#0a1216";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#8aa0ab";
      ctx.font = "14px IBM Plex Sans, sans-serif";
      ctx.fillText("上传曲线图像后，在图上点击取点", 24, 40);
    }

    // 绘图区边框（margin）
    const m = state.margin;
    ctx.strokeStyle = "rgba(212,160,23,0.55)";
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      canvas.width * m,
      canvas.height * m,
      canvas.width * (1 - 2 * m),
      canvas.height * (1 - 2 * m)
    );
    ctx.setLineDash([]);

    for (const p of state.points) {
      ctx.beginPath();
      ctx.fillStyle = "#e07060";
      ctx.arc(p.px, p.py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const tip = document.getElementById("img-point-count");
    if (tip) tip.textContent = `已取点 ${state.points.length}`;
    onChange?.(getDataPoints());
  }

  function getDataPoints() {
    return {
      x: state.points.map((p) => p.x),
      y: state.points.map((p) => p.y),
      pixel: state.points.map((p) => ({ px: p.px, py: p.py })),
      hasImage: !!state.img,
    };
  }

  function addPixelPoint(px, py) {
    const meta = axisMeta();
    if (![meta.xmin, meta.xmax, meta.ymin, meta.ymax].every(Number.isFinite)) {
      throw new Error("请先填写坐标轴范围 xmin/xmax/ymin/ymax");
    }
    if (meta.xmax === meta.xmin || meta.ymax === meta.ymin) {
      throw new Error("坐标轴范围无效");
    }
    const { x, y } = pixelToData(px, py, meta);
    state.points.push({ px, py, x, y });
    redraw();
  }

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("未选择文件"));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("图像加载失败"));
      reader.onload = async () => {
        try {
          const dataUrl = String(reader.result || "");
          const img = await loadImageFromSrc(dataUrl);
          state.img = img;
          state.imgDataUrl = dataUrl;
          // 限制画布最大边，保持比例
          const maxW = 640;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          state.points = [];
          redraw();
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function clearPoints() {
    state.points = [];
    redraw();
  }

  function undo() {
    state.points.pop();
    redraw();
  }

  function autoSample() {
    if (!state.img) throw new Error("请先上传图像");
    const meta = axisMeta();
    // 离屏原图像素更准
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext("2d");
    octx.drawImage(state.img, 0, 0, off.width, off.height);
    const imageData = octx.getImageData(0, 0, off.width, off.height);
    const pix = autoSampleCurve(imageData, { margin: state.margin });
    if (pix.length < 5) throw new Error("自动采样点太少，请换更清晰的曲线图或改为手动点选");
    state.points = pix.map(({ px, py }) => {
      const d = pixelToData(px, py, meta);
      return { px, py, x: d.x, y: d.y };
    });
    redraw();
    return state.points.length;
  }

  /** 生成一张演示曲线图（无外部文件时也能试） */
  function loadDemoImage() {
    const w = 640;
    const h = 360;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const c = off.getContext("2d");
    c.fillStyle = "#f4f7f8";
    c.fillRect(0, 0, w, h);
    // axes
    const m = 0.1;
    const L = w * m;
    const R = w * (1 - m);
    const T = h * m;
    const B = h * (1 - m);
    c.strokeStyle = "#333";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(L, T);
    c.lineTo(L, B);
    c.lineTo(R, B);
    c.stroke();
    // curve y = sin(x)*exp(-0.15x) on [0,10]
    c.strokeStyle = "#1a6b5a";
    c.lineWidth = 2.5;
    c.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = (10 * i) / 200;
      const y = Math.sin(x) * Math.exp(-0.15 * x);
      const px = L + (x / 10) * (R - L);
      const py = B - ((y - -1) / (1 - -1)) * (B - T);
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.stroke();
    c.fillStyle = "#444";
    c.font = "12px sans-serif";
    c.fillText("0", L - 4, B + 14);
    c.fillText("10", R - 10, B + 14);
    c.fillText("1", L - 16, T + 6);
    c.fillText("-1", L - 22, B);

    return new Promise((resolve) => {
      const dataUrl = off.toDataURL("image/png");
      const img = new Image();
      img.onload = () => {
        state.img = img;
        state.imgDataUrl = dataUrl;
        canvas.width = w;
        canvas.height = h;
        state.points = [];
        document.getElementById("img-xmin").value = "0";
        document.getElementById("img-xmax").value = "10";
        document.getElementById("img-ymin").value = "-1";
        document.getElementById("img-ymax").value = "1";
        const marginEl = document.getElementById("img-margin");
        if (marginEl) marginEl.value = "0.1";
        state.margin = 0.1;
        redraw();
        resolve();
      };
      img.src = dataUrl;
    });
  }

  function exportSnapshot() {
    return {
      imgDataUrl: state.imgDataUrl || "",
      points: state.points.map((p) => ({ px: p.px, py: p.py, x: p.x, y: p.y })),
      margin: state.margin,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      hasImage: !!state.img,
    };
  }

  async function restoreSnapshot(snap) {
    if (!snap || typeof snap !== "object") return false;
    if (snap.margin != null && Number.isFinite(Number(snap.margin))) {
      state.margin = Number(snap.margin);
    }
    if (snap.imgDataUrl) {
      const img = await loadImageFromSrc(String(snap.imgDataUrl));
      state.img = img;
      state.imgDataUrl = String(snap.imgDataUrl);
      const cw = Number(snap.canvasWidth);
      const ch = Number(snap.canvasHeight);
      if (Number.isFinite(cw) && Number.isFinite(ch) && cw > 0 && ch > 0) {
        canvas.width = Math.round(cw);
        canvas.height = Math.round(ch);
      } else {
        const maxW = 640;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
      }
    } else {
      state.img = null;
      state.imgDataUrl = "";
    }
    state.points = Array.isArray(snap.points)
      ? snap.points
          .filter((p) => p && Number.isFinite(p.px) && Number.isFinite(p.py))
          .map((p) => ({
            px: Number(p.px),
            py: Number(p.py),
            x: Number(p.x),
            y: Number(p.y),
          }))
      : [];
    if (state.img && state.points.length) recomputePoints();
    redraw();
    return true;
  }

  // 使用 pointerdown 统一处理鼠标 / 触摸 / 触控笔，移动端体验更好
  // 注：pointerdown 比 click 更即时，且在触摸设备上不会与 click 重复触发
  let pointerDownInfo = null;
  canvas.addEventListener("pointerdown", (ev) => {
    if (!state.img) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    pointerDownInfo = { px, py, t: Date.now(), x: ev.clientX, y: ev.clientY };
  });
  // pointerup 上判定：移动小于 5px 才视为"点击"（避免拖拽误触发）
  canvas.addEventListener("pointerup", (ev) => {
    if (!state.img || !pointerDownInfo) return;
    const dx = ev.clientX - pointerDownInfo.x;
    const dy = ev.clientY - pointerDownInfo.y;
    const moved = Math.hypot(dx, dy);
    pointerDownInfo = null;
    if (moved > 8) return; // 视为拖拽，忽略
    const rect = canvas.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    try {
      addPixelPoint(px, py);
    } catch (e) {
      onChange?.(null, e);
    }
  });
  // 阻止移动端默认滚动行为，否则点图时页面会跟着滚
  canvas.style.touchAction = "none";

  redraw();

  return {
    loadFile,
    loadDemoImage,
    clearPoints,
    undo,
    autoSample,
    getDataPoints,
    exportSnapshot,
    restoreSnapshot,
    redraw,
    setMargin(v) {
      state.margin = v;
      // 重新映射已有像素点
      const meta = axisMeta();
      state.points = state.points.map((p) => {
        const d = pixelToData(p.px, p.py, { ...meta, margin: v });
        return { ...p, x: d.x, y: d.y };
      });
      redraw();
    },
  };
}
