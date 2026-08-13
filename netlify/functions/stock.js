const FINNHUB_BASE = "https://finnhub.io/api/v1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const rangeDays = {
  "3mo": 100,
  "6mo": 200,
  "1y": 370,
  "5y": 1850
};

function json(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

async function getJson(path, token) {
  const response = await fetch(
    `${FINNHUB_BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Finnhub returned invalid JSON (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      data?.error || `Finnhub request failed (${response.status})`
    );
  }

  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  const token = process.env.FINNHUB_API_KEY;

  const symbol = String(
    event.queryStringParameters?.symbol || "AAPL"
  )
    .trim()
    .toUpperCase();

  const range = String(
    event.queryStringParameters?.range || "3mo"
  );

  if (!token) {
    return json(500, {
      error: "FINNHUB_API_KEY is not configured in Netlify."
    });
  }

  if (!/^[A-Z0-9.\-:]{1,20}$/.test(symbol)) {
    return json(400, {
      error: "Invalid ticker symbol."
    });
  }

  const now = Math.floor(Date.now() / 1000);

  const from =
    now -
    (rangeDays[range] || rangeDays["3mo"]) *
      86400;

  try {
    const [
      quote,
      candles,
      profile,
      metrics
    ] = await Promise.allSettled([
      getJson(
        `/quote?symbol=${encodeURIComponent(symbol)}`,
        token
      ),

      getJson(
        `/stock/candle?symbol=${encodeURIComponent(
          symbol
        )}&resolution=D&from=${from}&to=${now}`,
        token
      ),

      getJson(
        `/stock/profile2?symbol=${encodeURIComponent(
          symbol
        )}`,
        token
      ),

      getJson(
        `/stock/metric?symbol=${encodeURIComponent(
          symbol
        )}&metric=all`,
        token
      )
    ]);

    if (quote.status !== "fulfilled") {
      throw quote.reason;
    }

    const q = quote.value || {};

    const c =
      candles.status === "fulfilled"
        ? candles.value
        : {};

    const p =
      profile.status === "fulfilled"
        ? profile.value
        : {};

    const m =
      metrics.status === "fulfilled"
        ? metrics.value?.metric || {}
        : {};

    if (
      c?.s &&
      c.s !== "ok" &&
      q.c == null
    ) {
      throw new Error(
        "No market data was returned for this ticker."
      );
    }

    return json(200, {
      meta: {
        symbol,

        shortName:
          p.name || symbol,

        longName:
          p.name || symbol,

        exchangeName:
          p.exchange || "Market",

        currency:
          p.currency || "USD",

        regularMarketPrice:
          q.c,

        regularMarketChange:
          q.d,

        regularMarketChangePercent:
          q.dp,

        regularMarketOpen:
          q.o,

        regularMarketDayHigh:
          q.h,

        regularMarketDayLow:
          q.l,

        previousClose:
          q.pc,

        chartPreviousClose:
          q.pc,

        fiftyTwoWeekLow:
          m["52WeekLow"],

        fiftyTwoWeekHigh:
          m["52WeekHigh"]
      },

      timestamp:
        c.t || [],

      indicators: {
        quote: [
          {
            open: c.o || [],
            high: c.h || [],
            low: c.l || [],
            close: c.c || [],
            volume: c.v || []
          }
        ]
      }
    });

  } catch (error) {
    console.error(
      "Stock function error:",
      error
    );

    return json(502, {
      error:
        error?.message ||
        "Unable to load market data."
    });
  }
};
