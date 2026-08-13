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

function cleanNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

async function fetchYahoo(symbol, range) {
  const now = Math.floor(Date.now() / 1000);

  const days = rangeDays[range] || rangeDays["3mo"];

  const from = now - days * 86400;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}` +
    `?period1=${from}` +
    `&period2=${now}` +
    `&interval=1d` +
    `&events=history` +
    `&includeAdjustedClose=true`;

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });
  } catch (error) {
    throw new Error(
      `Unable to connect to Yahoo Finance: ${error.message}`
    );
  }

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Yahoo Finance returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.chart?.error?.description ||
      `Yahoo Finance request failed (${response.status})`
    );
  }

  if (data?.chart?.error) {
    throw new Error(
      data.chart.error.description ||
      "Yahoo Finance returned an error."
    );
  }

  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      "No market data was returned for this ticker."
    );
  }

  return result;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  const params = event.queryStringParameters || {};

  const symbol = String(
    params.symbol || "AAPL"
  )
    .trim()
    .toUpperCase();

  const range = String(
    params.range || "3mo"
  );

  if (!/^[A-Z0-9.\-:]{1,20}$/.test(symbol)) {
    return json(400, {
      error: "Invalid ticker symbol."
    });
  }

  try {
    const result = await fetchYahoo(
      symbol,
      range
    );

    const meta = result.meta || {};

    const timestamps =
      Array.isArray(result.timestamp)
        ? result.timestamp
        : [];

    const quote =
      result.indicators?.quote?.[0] || {};

    const opens =
      Array.isArray(quote.open)
        ? quote.open
        : [];

    const highs =
      Array.isArray(quote.high)
        ? quote.high
        : [];

    const lows =
      Array.isArray(quote.low)
        ? quote.low
        : [];

    const closes =
      Array.isArray(quote.close)
        ? quote.close
        : [];

    const volumes =
      Array.isArray(quote.volume)
        ? quote.volume
        : [];

    const points = [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = cleanNumber(closes[i]);

      if (close == null) {
        continue;
      }

      points.push({
        timestamp: timestamps[i],
        open: cleanNumber(opens[i]),
        high: cleanNumber(highs[i]),
        low: cleanNumber(lows[i]),
        close,
        volume: cleanNumber(volumes[i])
      });
    }

    if (
      points.length === 0 &&
      cleanNumber(meta.regularMarketPrice) == null
    ) {
      throw new Error(
        "No market data was returned for this ticker."
      );
    }

    const latest =
      points.length > 0
        ? points[points.length - 1]
        : null;

    const price =
      cleanNumber(meta.regularMarketPrice) ??
      latest?.close ??
      null;

    const previousClose =
      cleanNumber(meta.chartPreviousClose) ??
      cleanNumber(meta.previousClose) ??
      null;

    const change =
      price != null && previousClose != null
        ? price - previousClose
        : null;

    const changePercent =
      change != null && previousClose
        ? (change / previousClose) * 100
        : null;

    const dayOpen =
      cleanNumber(meta.regularMarketOpen) ??
      latest?.open ??
      null;

    const dayHigh =
      cleanNumber(meta.regularMarketDayHigh) ??
      latest?.high ??
      null;

    const dayLow =
      cleanNumber(meta.regularMarketDayLow) ??
      latest?.low ??
      null;

    const response = {
      meta: {
        symbol,

        shortName:
          meta.shortName ||
          meta.displayName ||
          symbol,

        longName:
          meta.longName ||
          meta.displayName ||
          meta.shortName ||
          symbol,

        exchangeName:
          meta.fullExchangeName ||
          meta.exchangeName ||
          "Market",

        currency:
          meta.currency ||
          "USD",

        regularMarketPrice:
          price,

        regularMarketChange:
          change,

        regularMarketChangePercent:
          changePercent,

        regularMarketOpen:
          dayOpen,

        regularMarketDayHigh:
          dayHigh,

        regularMarketDayLow:
          dayLow,

        previousClose,

        chartPreviousClose:
          previousClose,

        fiftyTwoWeekLow:
          cleanNumber(meta.fiftyTwoWeekLow),

        fiftyTwoWeekHigh:
          cleanNumber(meta.fiftyTwoWeekHigh)
      },

      timestamp:
        points.map(point => point.timestamp),

      indicators: {
        quote: [
          {
            open:
              points.map(point => point.open),

            high:
              points.map(point => point.high),

            low:
              points.map(point => point.low),

            close:
              points.map(point => point.close),

            volume:
              points.map(point => point.volume)
          }
        ]
      }
    };

    return json(200, response);

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
