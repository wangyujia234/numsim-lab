/**
 * Netlify Function：代理 DeepSeek Chat Completions
 * 环境变量：DEEPSEEK_API_KEY
 * 可选：DEEPSEEK_MODEL（默认 deepseek-chat）
 */

const API_URL = "https://api.deepseek.com/chat/completions";

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    return {
      statusCode: 501,
      headers,
      body: JSON.stringify({
        error: "未配置 DEEPSEEK_API_KEY。请在 Netlify 环境变量中设置，或改用浏览器直连（填写个人 Key）。",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "messages required" }) };
  }

  const model = body.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message || String(e) }),
    };
  }
};
