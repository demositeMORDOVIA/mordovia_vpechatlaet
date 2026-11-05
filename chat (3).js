const https = require("https");
const crypto = require("crypto");

const SYSTEM_PROMPT = `Ты — Лисичка, дружелюбный туристический помощник сайта «Шумбрат — Мордовия». Помогай планировать поездки по Саранску и Республике Мордовия.

Главное правило: всегда старайся дать ПОЛНЫЙ, ЗАКОНЧЕННЫЙ ответ за одно сообщение. Не дели ответ на части и никогда не предлагай пользователю написать «продолжай», чтобы получить оставшуюся информацию. Не обрывай маршрут на середине.

Если пользователь просит составить маршрут на день, сразу распиши весь день: утро, обед, вторая половина дня и вечер. Для каждой остановки кратко объясни, что там посмотреть и зачем туда идти. В конце дай несколько практических советов.

Если пользователь просит подробный план, включай все основные пункты сразу. Если информации много, сокращай второстепенные подробности, но сохраняй целостность ответа.

Пиши естественным русским языком, тепло и без шаблонных вступлений. Не используй Markdown-разметку: символы #, звёздочки для выделения и списков, обратные кавычки и таблицы. Используй обычные названия разделов и короткие абзацы.

Учитывай предыдущие сообщения и не заставляй пользователя повторять уже сообщённые пожелания. Если данных достаточно, не задавай лишних вопросов — предложи разумный вариант и при необходимости укажи свои предположения.

Не выдумывай точные цены, расписания, часы работы, наличие мест и текущую погоду. Если эти сведения неизвестны, предупреди, что их нужно проверить перед поездкой.`;

// Токен доступа GigaChat живёт 30 минут — кэшируем его между запросами.
let cachedToken = null;
let cachedUntil = 0;

// HTTPS-запрос через встроенный модуль. Сертификаты Сбера (Минцифры) Node по умолчанию не знает,
// поэтому для запросов к Сберу есть два варианта: свой сертификат в GIGACHAT_CA_CERT
// или (если его нет) отключённая проверка — только для этих двух адресов, не для всего сервера.
function httpsRequest(urlString, { method = "POST", headers = {}, body = "", timeout = 20000 }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) }
    };
    const caCert = (process.env.GIGACHAT_CA_CERT || "").trim();
    if (caCert) {
      options.ca = caCert.replace(/\\n/g, "\n");
    } else {
      options.rejectUnauthorized = false;
    }

    const req = https.request(options, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => (data += chunk));
      response.on("end", () => {
        let json = {};
        try { json = JSON.parse(data); } catch (e) { json = { raw: data.slice(0, 300) }; }
        resolve({ status: response.statusCode, json });
      });
    });

    req.setTimeout(timeout, () => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      req.destroy(err);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getToken(authKey, scope) {
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;

  const key = authKey.replace(/^Basic\s+/i, "").trim();
  const { status, json } = await httpsRequest(
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: crypto.randomUUID(),
        Authorization: `Basic ${key}`
      },
      body: `scope=${encodeURIComponent(scope)}`,
      timeout: 15000
    }
  );

  if (status !== 200 || !json.access_token) {
    const msg = json.message || json.error_description || json.raw || "нет описания";
    throw Object.assign(new Error(`OAuth ${status}: ${msg}`), { oauth: true });
  }

  cachedToken = json.access_token;
  cachedUntil = Date.now() + 25 * 60 * 1000;
  return cachedToken;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Используйте POST-запрос." });
  }

  const authKey = process.env.GIGACHAT_AUTH_KEY;
  if (!authKey || !authKey.trim()) {
    console.error("LISICHKA_DIAG: GIGACHAT_AUTH_KEY is missing");
    return res.status(500).json({
      error: "Сервер не получил GIGACHAT_AUTH_KEY. Добавьте ключ в настройках Vercel и сделайте Redeploy."
    });
  }

  const scope = (process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS").trim();
  const model = (process.env.GIGACHAT_MODEL || "GigaChat").trim();

  try {
    const incoming = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];

    // Фронтенд присылает историю в формате {role: user|model, parts:[{text}]} — переводим в формат GigaChat.
    const history = incoming
      .filter(m => (m.role === "user" || m.role === "model") && Array.isArray(m.parts))
      .slice(-12)
      .map(m => ({
        role: m.role === "model" ? "assistant" : "user",
        content: m.parts
          .filter(p => p && typeof p.text === "string")
          .map(p => p.text.slice(0, 4000))
          .join("\n")
      }))
      .filter(m => m.content.trim());

    while (history.length && history[0].role !== "user") history.shift();

    if (!history.length) {
      return res.status(400).json({ error: "Напишите сообщение Лисичке." });
    }

    const payload = JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      temperature: 0.7,
      max_tokens: 2048
    });

    let result = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken(authKey, scope);
      console.log(`LISICHKA_DIAG: GigaChat attempt ${attempt + 1}/2`);

      result = await httpsRequest("https://gigachat.devices.sberbank.ru/api/v1/chat/completions", {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        },
        body: payload,
        timeout: 45000
      });

      if (result.status === 401 && attempt === 0) {
        cachedToken = null; // токен устарел — получим новый и повторим
        continue;
      }
      break;
    }

    if (result.status !== 200) {
      const msg = result.json.message || result.json.raw || "нет описания";
      console.error("LISICHKA_DIAG: GigaChat HTTP", result.status, msg);
      return res.status(502).json({ error: `Ошибка GigaChat (${result.status}): ${msg}` });
    }

    const reply = (result.json.choices?.[0]?.message?.content || "").trim();
    if (!reply) {
      return res.status(502).json({ error: "GigaChat не вернул текстовый ответ. Попробуйте ещё раз." });
    }

    console.log("LISICHKA_DIAG: response received successfully");
    return res.status(200).json({ reply });
  } catch (error) {
    console.error("LISICHKA_DIAG: internal error", error?.message || String(error));
    if (error && error.name === "TimeoutError") {
      return res.status(504).json({ error: "GigaChat слишком долго отвечает. Попробуйте ещё раз." });
    }
    if (error && error.oauth) {
      return res.status(502).json({ error: `Не удалось получить токен GigaChat: ${error.message}` });
    }
    return res.status(502).json({ error: `Не удалось связаться с GigaChat: ${error?.code || error?.message || "неизвестная ошибка"}` });
  }
};
