
import { Router } from "express";

const router = Router();

const NASA_FEED_URL = "https://api.nasa.gov/neo/rest/v1/feed";

router.get("/nasa/feed", async (req, res) => {
  const apiKey = process.env.NASA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "NASA API key is not configured on the server.",
    });
  }

  const startDate =
    typeof req.query.start_date === "string"
      ? req.query.start_date
      : "";

  const endDate =
    typeof req.query.end_date === "string"
      ? req.query.end_date
      : startDate;

  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

  if (
    !validDate(startDate) ||
    !validDate(endDate) ||
    endDate < startDate
  ) {
    return res.status(400).json({
      error: "Provide valid start_date and end_date in YYYY-MM-DD format.",
    });
  }

  // NASA's feed supports a limited date range per request.
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) /
    86_400_000;

  if (days > 7) {
    return res.status(400).json({
      error: "Choose a date range of no more than 7 days.",
    });
  }

  const url = new URL(NASA_FEED_URL);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("api_key", apiKey);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error("NASA API returned status:", response.status);

      return res.status(
        response.status === 429 ? 429 : 502
      ).json({
        error:
          response.status === 429
            ? "NASA's rate limit was reached. Please try again later."
            : "NASA's asteroid service is temporarily unavailable.",
      });
    }

    const data: unknown = await response.json();

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json(data);
  } catch (error) {
    console.error("NASA feed request failed:", error);

    return res.status(502).json({
      error: "Could not retrieve asteroid data from NASA.",
    });
  }
});

export default router;
