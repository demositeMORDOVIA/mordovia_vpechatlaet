const { getLiveEvents } = require("../lib/events");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Используйте GET-запрос." });
  }

  try {
    const data = await getLiveEvents();
    res.setHeader("X-Afisha-Source", "KASSIR.RU");
    if (data.status === "unavailable") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({
        status: data.status,
        checkedAt: data.checkedAt,
        events: [],
        source: data.source,
        message: "Не удалось получить свежие данные билетного сервиса. Старые события не показываются."
      });
    }
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    return res.status(200).json({
      status: data.status,
      checkedAt: data.checkedAt,
      events: data.events,
      source: data.source,
      diagnostics: data.diagnostics
    });
  } catch (error) {
    console.error("AFISHA_LIVE_DATA_ERROR", error && error.message ? error.message : String(error));
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      status: "unavailable",
      events: [],
      error: "Не удалось загрузить актуальную афишу. Откройте каталог билетного сервиса."
    });
  }
};
