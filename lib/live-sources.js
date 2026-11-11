const SOURCES = [
  { id: "tourism-events", name: "Официальный туристический портал Мордовии — события", url: "https://turizmrm.ru/what-to-do/events/", category: "events" },
  { id: "tourism-culture", name: "Официальный туристический портал — музеи и культура", url: "https://turizmrm.ru/what-to-do/culture/", category: "general" },
  { id: "tourism-ecotourism", name: "Официальный туристический портал — экотуризм", url: "https://turizmrm.ru/what-to-do/ecotourism/", category: "nature" },
  { id: "erzia-home", name: "Музей Эрьзи — текущие события на главной странице", url: "https://erzia-museum.ru/", category: "events" },
  { id: "erzia-afisha", name: "Музей Эрьзи — афиша", url: "https://erzia-museum.ru/afisha/", category: "events" },
  { id: "voronin-events", name: "Краеведческий музей им. И. Д. Воронина — события", url: "https://mrkm.ru/", category: "events" },
  { id: "yaushev-afisha", name: "Театр оперы и балета им. Яушева — афиша", url: "https://muzteatr-saransk.ru/", category: "events" },
  { id: "drama-afisha", name: "Русский драматический театр Мордовии — афиша", url: "https://grdtrm.ru/", category: "events" },
  { id: "tourism-hotels", name: "Официальный туристический портал — гостиницы", url: "https://turizmrm.ru/where-to-stay/gostinitsy/", category: "stay" },
  { id: "tourism-bases", name: "Официальный туристический портал — базы отдыха", url: "https://turizmrm.ru/where-to-stay/bazy-otdykha/", category: "stay" },
  { id: "tourism-restaurants", name: "Официальный туристический портал — рестораны", url: "https://turizmrm.ru/where-to-eat/restorany/", category: "food" },
  { id: "tourism-cafes", name: "Официальный туристический портал — кафе", url: "https://turizmrm.ru/where-to-eat/kafe/", category: "food" },
  { id: "city-transport", name: "Администрация Саранска — изменения городского транспорта", url: "https://xn--80aa4alnee.xn--p1ai/mun-order/transportation-management/news.php", category: "transport" },
  { id: "bus-station", name: "Автовокзал Саранск — расписание", url: "https://xn--13-6kcaja9axlzb9b.xn--p1ai/", category: "transport" },
  { id: "rzd", name: "Вокзал Саранск / РЖД", url: "https://saransk.dzvr.ru/", category: "transport" },
  { id: "uvt-aero", name: "UVT Aero — расписание рейсов", url: "https://uvtaero.ru/raspisanie", category: "transport" },
  { id: "erzia-contacts", name: "Музей Эрьзи — контакты и режим работы", url: "https://erzia-museum.ru/ru/kontakty/", category: "hours" },
  { id: "erzia-price", name: "Музей Эрьзи — официальный прейскурант", url: "https://erzia-museum.ru/prejskurant/27051/", category: "hours" },
  { id: "voronin-contacts", name: "Краеведческий музей — контакты и режим работы", url: "https://mrkm.ru/kontakty/", category: "hours" },
  { id: "zapoved-rules", name: "Заповедная Мордовия — правила посещения", url: "https://zapoved-mordovia.ru/ru/правила-посещения.html", category: "hours" },
  { id: "tourism-home", name: "Туристско-информационный портал Республики Мордовия", url: "https://turizmrm.ru/", category: "general" },
  { id: "zapoved-home", name: "Заповедная Мордовия — официальный сайт", url: "https://zapoved-mordovia.ru/ru/", category: "nature" }
];

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();
const inflight = new Map();

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html) {
  let source = String(html || "");
  const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
    || source.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (main) source = main[1];
  source = source
    .replace(/<(script|style|noscript|svg|iframe|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|section|article|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(source).replace(/[\t\r ]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function sourceIdsForTopic(topic) {
  const map = {
    events: ["tourism-events", "erzia-home", "erzia-afisha", "voronin-events", "yaushev-afisha", "drama-afisha"],
    stay: ["tourism-hotels", "tourism-bases"],
    food: ["tourism-restaurants", "tourism-cafes"],
    transport: ["city-transport", "bus-station", "rzd", "uvt-aero"],
    hours: ["erzia-contacts", "erzia-price", "voronin-contacts", "zapoved-rules", "yaushev-afisha", "drama-afisha"],
    nature: ["tourism-ecotourism", "zapoved-home", "zapoved-rules", "tourism-home"],
    general: ["tourism-home", "tourism-culture", "erzia-home", "erzia-afisha", "zapoved-home"]
  };
  return map[topic] || map.general;
}

function inferTopic(query) {
  const q = String(query || "").toLowerCase().replace(/ё/g, "е");
  if (/отел|гостиниц|жиль|номер|баз[аыуе] отдыха|коттедж|глэмпинг|засел|брон/.test(q)) return "stay";
  if (/кафе|ресторан|поесть|перекус|обед|ужин|кухн|еда|средний чек/.test(q)) return "food";
  if (/(музей|экспозиц|посещени музея|входн).*(билет|цен|стоим|сколько стоит)|(билет|цен|стоим|сколько стоит).*(музей|экспозиц|посещени)/.test(q)) return "hours";
  if (/афиш|событи|концерт|спектакл|выставк|фестивал/.test(q)) return "events";
  if (/(билет|цен|стоим).*(концерт|спектакл|выставк|фестивал)/.test(q)) return "events";
  if (/автобус|троллейбус|поезд|жд|самолет|аэропорт|вокзал|транспорт|как добраться|рейс/.test(q)) return "transport";
  if (/часы|режим|работает|открыт|закрыт|график|время работы|посещени|сколько стоит билет/.test(q)) return "hours";
  if (/заповед|смольн|природ|экотроп|озер|лес/.test(q)) return "nature";
  if (/билет|афиш|событи/.test(q)) return "events";
  return "general";
}

async function fetchSource(source) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(source.url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5"
      },
      signal: AbortSignal.timeout(7000),
      redirect: "follow"
    });
    if (!response.ok) {
      return { ...source, status: "unavailable", httpStatus: response.status, checkedAt, content: "", excerpt: "" };
    }
    const html = await response.text();
    const content = htmlToText(html).slice(0, 5200);
    if (content.length < 40) {
      return { ...source, status: "empty", checkedAt, content: "", excerpt: "", freshnessNote: "Страница не содержит читаемого текста." };
    }
    const hasUpdateDate = /(?:обновлено|актуализировано|дата обновления|последнее обновление|last updated|last modified)\s*[:：-]?\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i.test(content);
    const hasDatedPeriod = /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\s*(?:[–—-]|по)\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/.test(content);
    const freshnessNote = hasUpdateDate
      ? "На странице найдено явное указание даты обновления. Сверь её с текущей датой."
      : hasDatedPeriod
        ? "На странице есть период действия расписания. Используй его только если текущая дата входит в этот период."
        : "На странице не найдено явной даты обновления. Не считай часы работы, цены, наличие и постоянные расписания подтверждённо актуальными; направь пользователя на страницу организатора.";
    return { ...source, status: "ok", checkedAt, content, excerpt: content.slice(0, 650), freshnessNote };
  } catch (error) {
    return { ...source, status: "unavailable", checkedAt, content: "", excerpt: "", error: error && error.name === "TimeoutError" ? "timeout" : "fetch_failed" };
  }
}

async function getLiveSources(topic = "all") {
  const key = topic === "all" ? "all" : topic;
  const now = Date.now();
  const saved = cache.get(key);
  if (saved && now - saved.at < TTL_MS) return saved.data;
  if (inflight.has(key)) return inflight.get(key);

  const selected = key === "all"
    ? SOURCES
    : sourceIdsForTopic(key).map(id => SOURCES.find(source => source.id === id)).filter(Boolean);

  const task = (async () => {
    const results = await Promise.all(selected.map(fetchSource));
    const data = { checkedAt: new Date().toISOString(), sources: results };
    cache.set(key, { at: Date.now(), data });
    inflight.delete(key);
    return data;
  })();
  inflight.set(key, task);
  return task;
}

module.exports = { SOURCES, getLiveSources, inferTopic };
