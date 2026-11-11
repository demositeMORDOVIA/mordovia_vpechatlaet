const { getLiveSources } = require("../lib/live-sources");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Используйте GET-запрос." });
  }
  try {
    const data = await getLiveSources("events");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).json({
      checkedAt: data.checkedAt,
      sources: data.sources.map(source => ({
        id: source.id,
        name: source.name,
        url: source.url,
        category: source.category,
        status: source.status,
        checkedAt: source.checkedAt,
        excerpt: source.excerpt || ""
      }))
    });
  } catch (error) {
    console.error("LIVE_DATA_ERROR", error && error.message ? error.message : String(error));
    return res.status(502).json({ error: "Не удалось проверить официальные источники." });
  }
};
