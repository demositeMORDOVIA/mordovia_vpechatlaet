const BASE_URL = "https://saransk.kassir.ru";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_EVENTS = 36;
const DEFAULT_MAX_EVENT_PAGES = 36;

const CATEGORY_PAGES = [
  "/",
  "/bilety-na-koncert",
  "/bilety-v-teatr",
  "/bilety-na-shou",
  "/bilety-na-sportivnye-meropriyatiya",
  "/detskaya-afisha",
  "/bilety-v-muzei",
  "/bilety-na-festival"
];

// Known event pages are only starting points for a fresh fetch, never static event data.
// Each page is reloaded and its current date/status is checked before it can appear.
const SEED_EVENT_PATHS = [
  "/teatr/opasnyie-svyazi-myuzikl",
  "/teatr/gertsoginya-iz-chikago-operetta",
  "/teatr/tristan-i-izolda-folk-rok-myuzikl",
  "/teatr/kot-v-sapogah-muzyikalnaya-skazka",
  "/koncert/concord-orchestra-simfonicheskie-hityi-koleso-lyubvi",
  "/sport/genezis-mma-7",
  "/koncert/orkestr-cagmo-simfoniya-mtv-pri-svechah",
  "/koncert/zveri-27",
  "/shou/vanya-usovich-8",
  "/koncert/ruki-vverh-27",
  "/koncert/nensi-15",
  "/teatr/myuzikl-karnavalnaya-noch-egora-drujinina",
  "/teatr/balet-schelkunchik-35"
];

const MONTHS = {
  "января": 0, "февраля": 1, "марта": 2, "апреля": 3,
  "мая": 4, "июня": 5, "июля": 6, "августа": 7,
  "сентября": 8, "октября": 9, "ноября": 10, "декабря": 11
};

const MONTHS_NOM = {
  "январь": 0, "февраль": 1, "март": 2, "апрель": 3,
  "май": 4, "июнь": 5, "июль": 6, "август": 7,
  "сентябрь": 8, "октябрь": 9, "ноябрь": 10, "декабрь": 11
};

const cachedResults = new Map();
const inflightResults = new Map();

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch (_) { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return ""; }
    });
}

function stripHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|section|article|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function getMeta(html, key, attribute = "property") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}\\s*=\\s*["']${escaped}["'])(?=[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'])[^>]*>`, "i");
  const match = String(html || "").match(re);
  return match ? decodeEntities(match[1]) : "";
}

function getCanonical(html, fallback) {
  const match = String(html || "").match(/<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>/i);
  if (!match) return fallback;
  try {
    const url = new URL(decodeEntities(match[1]), BASE_URL);
    return url.hostname === "saransk.kassir.ru" ? url.href : fallback;
  } catch (_) {
    return fallback;
  }
}

function collectJsonLdEvents(html) {
  const found = [];
  const scripts = String(html || "").matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== "object") return;
    const rawType = value["@type"];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    if (types.some(type => typeof type === "string" && /event/i.test(type))) found.push(value);
    if (value["@graph"]) walk(value["@graph"]);
    if (value.itemListElement) walk(value.itemListElement);
    if (value.item) walk(value.item);
  }
  for (const match of scripts) {
    try { walk(JSON.parse(match[1].trim())); } catch (_) { /* malformed JSON-LD is ignored */ }
  }
  return found;
}

function firstImage(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstImage(value[0]);
  if (typeof value === "object") return value.url || value.contentUrl || "";
  return "";
}

function parseDateText(text, html) {
  const source = String(text || "");
  let match = source.match(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(20\d{2})(?:\s*[,·-]?\s*(\d{1,2}:\d{2}))?/i);
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = Number(match[3]);
    const time = match[4] || "";
    return makeDateParts(year, month, day, time);
  }

  match = source.match(/\b(\d{1,2})[.](\d{1,2})[.](20\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
  if (match) return makeDateParts(Number(match[3]), Number(match[2]) - 1, Number(match[1]), match[4] || "");

  // KASSIR event pages normally print the year. If it is absent, do not invent it.
  return null;
}

function makeDateParts(year, month, day, time) {
  if (!Number.isInteger(year) || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const timeValue = /^\d{1,2}:\d{2}$/.test(time || "") ? time : "";
  const sortable = new Date(`${isoDate}T${timeValue || "12:00"}:00+03:00`);
  if (Number.isNaN(sortable.getTime())) return null;
  return { date: isoDate, time: timeValue, dateTime: sortable.toISOString(), dateLabel: `${day} ${Object.keys(MONTHS)[month]} ${year}` };
}

function mapCategory(path, text) {
  const lower = String(text || "").toLowerCase().replace(/ё/g, "е");
  const route = String(path || "").split("/")[1] || "";
  const routeTypes = {
    koncert: "concert", teatr: "theater", shou: "show", sport: "sport",
    festival: "festival", detyam: "family", muzei: "culture", ekskursii: "culture"
  };
  const types = [];
  if (routeTypes[route]) types.push(routeTypes[route]);
  if (/концерт/.test(lower)) types.push("concert");
  if (/театр|мюзикл|опера|балет|спектакл|оперетт/.test(lower)) types.push("theater");
  if (/шоу|стендап|юмор|цирк/.test(lower)) types.push("show");
  if (/спорт|турнир|матч|соревнован/.test(lower)) types.push("sport");
  if (/фестивал/.test(lower)) types.push("festival");
  if (/музей|выставк|экспозиц|экскурс|лекци|образован/.test(lower)) types.push("culture");
  if (/детям|детск|семейн|сказк|кукольн/.test(lower) || /\b0\+/.test(lower)) types.push("family");
  if (!types.length) types.push("culture");
  return [...new Set(types)];
}

function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base || BASE_URL);
    if (url.protocol !== "https:" || url.hostname !== "saransk.kassir.ru") return "";
    url.hash = "";
    return url.href;
  } catch (_) {
    return "";
  }
}

function extractEventPaths(html) {
  const paths = new Set();
  const pattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const url = normalizeUrl(decodeEntities(match[1]), BASE_URL);
    if (!url) continue;
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (!/^\/(koncert|teatr|shou|sport|festival|detyam|muzei|ekskursii)\/[^/]+\/?$/i.test(path)) continue;
    paths.add(path.replace(/\/$/, ""));
  }
  return [...paths];
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
      "Referer": BASE_URL + "/"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (/подтвердите, что вы не робот|вы не робот|проверка на робота|пройдите проверку|необходимо подтверждение|captcha|доступ ограничен/i.test(html.slice(0, 30000))) {
    throw new Error("Источник запросил проверку браузера");
  }
  return html;
}

function parseEventPage(url, html) {
  const schemaEvents = collectJsonLdEvents(html);
  const schema = schemaEvents[0] || {};
  const text = stripHtml(html);
  const path = new URL(url).pathname;

  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
  const title = decodeEntities(String(schema.name || stripHtml(h1) || getMeta(html, "og:title") || "").replace(/\s*[|–-]\s*KASSIR\.RU.*$/i, "").trim());
  if (!title || title.length < 3) return null;

  let dateParts = null;
  if (schema.startDate && /T\d{2}:\d{2}/.test(String(schema.startDate))) {
    const start = new Date(schema.startDate);
    if (!Number.isNaN(start.getTime())) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      }).formatToParts(start).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
      dateParts = makeDateParts(Number(parts.year), Number(parts.month) - 1, Number(parts.day), `${parts.hour}:${parts.minute}`);
    }
  }
  if (!dateParts) dateParts = parseDateText(text, html);
  if (!dateParts) return null;

  const now = Date.now();
  const eventTime = new Date(dateParts.dateTime).getTime();
  if (!Number.isFinite(eventTime) || eventTime < now - 2 * 60 * 60 * 1000 || eventTime > now + 550 * 24 * 60 * 60 * 1000) return null;
  if (/мероприятие\s+(?:отменено|отменяется)|событие\s+отменено|билеты\s+аннулированы/i.test(text)) return null;

  const rawLocation = schema.location && (schema.location.name || schema.location.address && schema.location.address.name);
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const dateLineIndex = lines.findIndex(line => /\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+20\d{2}/i.test(line));
  let place = typeof rawLocation === "string" ? rawLocation : "";
  if (!place && dateLineIndex >= 0) {
    const candidates = lines.slice(dateLineIndex + 1, dateLineIndex + 5);
    place = candidates.find(line => /саранск|театр|арена|дворец|музей|клуб|центр|зал|стадион|дом культуры|библиотек/i.test(line) && !/продолжительность|билеты|\d{1,2}\+/.test(line)) || "";
  }
  if (!place) place = "Саранск";

  const offer = Array.isArray(schema.offers) ? schema.offers[0] : schema.offers;
  let priceNum = null;
  if (offer && offer.price !== undefined && offer.price !== null && offer.price !== "") {
    const n = Number(String(offer.price).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n) && n >= 0) priceNum = n;
  }
  if (priceNum === null) {
    const priceMatch = text.match(/(?:билеты\s+от|от)\s*([\d\s\u00a0]+)\s*₽/i);
    if (priceMatch) {
      const n = Number(priceMatch[1].replace(/[\s\u00a0]/g, ""));
      if (Number.isFinite(n)) priceNum = n;
    }
  }
  const price = priceNum === null ? "Уточняйте на странице билетов" : priceNum === 0 ? "Бесплатно" : `от ${Math.round(priceNum).toLocaleString("ru-RU")} ₽`;

  const categoryLine = lines.find(line => /\b(?:0|6|12|16|18)\s*\+/.test(line)) || "";
  const types = mapCategory(path, `${categoryLine} ${schema.category || ""}`);
  const category = types[0];
  const image = normalizeImage(firstImage(schema.image) || getMeta(html, "og:image") || getMeta(html, "twitter:image"), url);
  const canonical = getCanonical(html, url);
  const description = stripHtml(schema.description || getMeta(html, "description", "name") || "").replace(/\s+/g, " ").trim().slice(0, 320);
  const soldOut = /билетов\s+нет|нет\s+билетов|распродано/i.test(text.slice(0, 6000));
  const ageMatch = text.match(/\b(0|6|12|16|18)\s*\+/);

  return {
    id: canonical,
    title,
    category,
    types,
    date: dateParts.date,
    dateTime: dateParts.dateTime,
    dateLabel: dateParts.dateLabel,
    time: dateParts.time,
    place: place.replace(/\s+/g, " ").slice(0, 160),
    district: "Саранск",
    price,
    priceNum,
    image,
    description: description || "Подробности мероприятия и актуальные условия покупки билетов доступны на странице организатора продажи.",
    url: canonical,
    provider: "KASSIR.RU",
    soldOut,
    age: ageMatch ? `${ageMatch[1]}+` : ""
  };
}

function normalizeImage(raw, base) {
  if (!raw || typeof raw !== "string") return "";
  try {
    const url = new URL(raw, base);
    return /^https:$/.test(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); }
      catch (_) { results[index] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadEvents(maxPages, concurrency) {
  const checkedAt = new Date().toISOString();
  const pageResults = await Promise.allSettled(CATEGORY_PAGES.map(path => fetchHtml(BASE_URL + path)));
  const successfulPages = pageResults.filter(result => result.status === "fulfilled").length;
  const paths = new Set(SEED_EVENT_PATHS);
  for (const result of pageResults) {
    if (result.status === "fulfilled") extractEventPaths(result.value).forEach(path => paths.add(path));
  }

  const eventPaths = [...paths].slice(0, maxPages);
  const details = await mapLimit(eventPaths, concurrency, async path => {
    const url = BASE_URL + path;
    const html = await fetchHtml(url);
    return parseEventPage(url, html);
  });

  const unique = new Map();
  for (const event of details) {
    if (!event) continue;
    const key = `${event.title.toLowerCase()}|${event.date}|${event.time}`;
    if (!unique.has(key)) unique.set(key, event);
  }
  const events = [...unique.values()]
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime))
    .slice(0, MAX_EVENTS);

  const status = events.length ? "ok" : successfulPages ? "empty" : "unavailable";
  return {
    checkedAt,
    status,
    source: { name: "KASSIR.RU — афиша Саранска", url: BASE_URL + "/", status: successfulPages ? "ok" : "unavailable" },
    events,
    diagnostics: { categoryPagesChecked: CATEGORY_PAGES.length, categoryPagesAvailable: successfulPages, eventPagesChecked: eventPaths.length, eventsFound: events.length }
  };
}

async function getLiveEvents(options = {}) {
  const maxPages = Math.min(48, Math.max(10, Number(options.maxPages) || DEFAULT_MAX_EVENT_PAGES));
  const concurrency = Math.min(16, Math.max(6, Number(options.concurrency) || 12));
  const key = `${maxPages}:${concurrency}`;
  const now = Date.now();
  const cached = cachedResults.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;
  if (inflightResults.has(key)) return inflightResults.get(key);
  const task = loadEvents(maxPages, concurrency)
    .then(result => {
      cachedResults.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => { inflightResults.delete(key); });
  inflightResults.set(key, task);
  return task;
}

module.exports = { getLiveEvents, parseEventPage, extractEventPaths };
