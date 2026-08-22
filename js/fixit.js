/**
 * 将常见报错映射为一键可执行的改参建议
 */

export function suggestFixes(message, type) {
  const msg = String(message || "");
  const fixes = [];

  if (/r=.*?>\s*0\.5|显式格式不稳定|无法压到/.test(msg)) {
    fixes.push({
      id: "pde-nt",
      label: "增大时间步 nt=400",
      apply() {
        const el = document.getElementById("pde-nt");
        if (el) el.value = "400";
      },
    });
    fixes.push({
      id: "pde-tf",
      label: "减小终时 tf=0.2",
      apply() {
        const el = document.getElementById("pde-tf");
        if (el) el.value = "0.2";
      },
    });
  }

  if (/上下限不能相等|积分上下限/.test(msg)) {
    fixes.push({
      id: "integ-b",
      label: "将上限设为 a+1",
      apply() {
        const a = Number(document.getElementById("integ-a")?.value) || 0;
        const b = document.getElementById("integ-b");
        if (b) b.value = String(a + 1);
      },
    });
  }

  if (/须满足 tf > t0|tf > t0/.test(msg)) {
    fixes.push({
      id: "ode-tf",
      label: "将 tf 设为 t0+10",
      apply() {
        const t0 = Number(document.getElementById("ode-t0")?.value) || 0;
        const tf = document.getElementById("ode-tf");
        if (tf) tf.value = String(t0 + 10);
      },
    });
  }

  if (/分母首项|分母不能为空/.test(msg)) {
    fixes.push({
      id: "ctl-den",
      label: "重置分母为 1,2,2",
      apply() {
        const den = document.getElementById("ctl-den");
        if (den) den.value = "1, 2, 2";
      },
    });
  }

  if (/A 需要|B 需要/.test(msg)) {
    fixes.push({
      id: "ctl-place",
      label: "恢复二阶极点配置默认矩阵",
      apply() {
        const map = {
          "ctl-order": "2",
          "ctl-A": "0,1,-2,-3",
          "ctl-B": "0,1",
          "ctl-poles": "-4,-5",
        };
        for (const [id, v] of Object.entries(map)) {
          const el = document.getElementById(id);
          if (el) el.value = v;
        }
      },
    });
  }

  if (/至少需要 2 个采样点|x 与 y 长度/.test(msg)) {
    fixes.push({
      id: "interp-demo",
      label: "填入演示采样点",
      apply() {
        const x = document.getElementById("interp-x");
        const y = document.getElementById("interp-y");
        if (x) x.value = "0, 1, 2, 3, 4, 5";
        if (y) y.value = "0, 0.8, 0.9, 0.1, -0.8, -1";
      },
    });
  }

  if (/API Key|代理失败|DeepSeek/.test(msg) && type !== "ignore") {
    fixes.push({
      id: "ai-off",
      label: "关闭 DeepSeek，改用本地 Agent",
      apply() {
        const el = document.getElementById("ai-enabled");
        if (el) {
          el.checked = false;
          el.dispatchEvent(new Event("change"));
        }
      },
    });
  }

  if (/请先在图上取点|请先上传图像/.test(msg)) {
    fixes.push({
      id: "img-demo",
      label: "加载演示图并自动采样",
      apply() {
        document.getElementById("btn-img-demo")?.click();
        setTimeout(() => document.getElementById("btn-img-auto")?.click(), 400);
      },
    });
  }

  return fixes;
}
