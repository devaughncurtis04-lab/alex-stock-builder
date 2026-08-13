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

function num(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Upstream returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.chart?.error?.description ||
      data?.finance?.error?.description ||
      `Upstream request failed (${response.status})`
    );
  }

  return data;
}


/* =========================================
   PRICE / CHART DATA
========================================= */

async function getChart(symbol, range) {

  const now = Math.floor(Date.now() / 1000);

  const days =
    rangeDays[range] ||
    rangeDays["3mo"];

  const from =
    now - days * 86400;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}` +
    `?period1=${from}` +
    `&period2=${now}` +
    `&interval=1d` +
    `&events=history` +
    `&includeAdjustedClose=true`;

  const data =
    await fetchJson(url);

  const result =
    data?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      "No market data was returned for this ticker."
    );
  }

  return result;
}


/* =========================================
   FUNDAMENTALS
========================================= */

async function getFundamentals(symbol) {

  const modules = [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "price"
  ];

  try {

    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/` +
      `${encodeURIComponent(symbol)}` +
      `?modules=${modules.join(",")}`;

    const data =
      await fetchJson(url);

    const result =
      data?.quoteSummary?.result?.[0] || {};

    function raw(object, key) {
      return num(object?.[key]?.raw);
    }

    return {

      marketCap:
        raw(result.price, "marketCap"),

      pe:
        raw(result.summaryDetail, "trailingPE"),

      forwardPe:
        raw(result.summaryDetail, "forwardPE"),

      pegRatio:
        raw(result.defaultKeyStatistics, "pegRatio"),

      eps:
        raw(result.defaultKeyStatistics, "trailingEps"),

      forwardEps:
        raw(result.defaultKeyStatistics, "forwardEps"),

      revenue:
        raw(result.financialData, "totalRevenue"),

      revenueGrowth:
        raw(result.financialData, "revenueGrowth"),

      profitMargin:
        raw(result.financialData, "profitMargins"),

      operatingMargin:
        raw(result.financialData, "operatingMargins"),

      grossMargin:
        raw(result.financialData, "grossMargins"),

      debtToEquity:
        raw(result.financialData, "debtToEquity"),

      freeCashFlow:
        raw(result.financialData, "freeCashflow"),

      operatingCashFlow:
        raw(result.financialData, "operatingCashflow"),

      returnOnEquity:
        raw(result.financialData, "returnOnEquity"),

      returnOnAssets:
        raw(result.financialData, "returnOnAssets"),

      targetPrice:
        raw(result.financialData, "targetMeanPrice"),

      targetHigh:
        raw(result.financialData, "targetHighPrice"),

      targetLow:
        raw(result.financialData, "targetLowPrice")
    };

  } catch (error) {

    return {
      error:
        error?.message ||
        "Fundamental data unavailable."
    };
  }
}


/* =========================================
   NEWS
========================================= */

async function getNews(symbol) {

  try {

    const url =
      `https://query1.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(symbol)}` +
      `&newsCount=15` +
      `&quotesCount=0`;

    const data =
      await fetchJson(url);

    const items =
      Array.isArray(data?.news)
        ? data.news
        : [];

    return items
      .slice(0, 15)
      .map(item => ({

        title:
          item.title ||
          "Untitled",

        publisher:
          item.publisher ||
          "Yahoo Finance",

        link:
          item.link ||
          "#",

        published:
          item.providerPublishTime ||
          null,

        thumbnail:
          item.thumbnail
            ?.resolutions
            ?.at(-1)
            ?.url ||
          null
      }));

  } catch (error) {

    return {
      error:
        error?.message ||
        "News unavailable."
    };
  }
}


/* =========================================
   TECHNICAL ANALYSIS
========================================= */

function calculateSMA(values, period) {

  if (values.length < period) {
    return null;
  }

  const slice =
    values.slice(-period);

  return (
    slice.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / period
  );
}


function calculateRSI(values, period = 14) {

  if (values.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const averageGain =
    gains / period;

  const averageLoss =
    losses / period;

  const rs =
    averageGain /
    averageLoss;

  return 100 -
    100 / (1 + rs);
}


function calculateEMA(values, period) {

  if (values.length < period) {
    return null;
  }

  const multiplier =
    2 / (period + 1);

  let ema =
    values
      .slice(0, period)
      .reduce(
        (sum, value) =>
          sum + value,
        0
      ) / period;

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    ema =
      (values[i] - ema) *
      multiplier +
      ema;
  }

  return ema;
}


function calculateMACD(values) {

  if (values.length < 35) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const ema12 =
    calculateEMA(values, 12);

  const ema26 =
    calculateEMA(values, 26);

  if (
    ema12 === null ||
    ema26 === null
  ) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const macd =
    ema12 - ema26;

  return {
    macd,
    signal: null,
    histogram: null
  };
}


function getTechnicals(points) {

  const closes =
    points
      .map(point => point.close)
      .filter(
        value =>
          typeof value === "number"
      );

  const current =
    closes.at(-1) || null;

  const sma20 =
    calculateSMA(closes, 20);

  const sma50 =
    calculateSMA(closes, 50);

  const sma200 =
    calculateSMA(closes, 200);

  const rsi =
    calculateRSI(closes, 14);

  const macd =
    calculateMACD(closes);

  let trend =
    "NEUTRAL";

  if (
    current &&
    sma20 &&
    sma50
  ) {

    if (
      current > sma20 &&
      sma20 > sma50
    ) {
      trend = "BULLISH";
    }

    if (
      current < sma20 &&
      sma20 < sma50
    ) {
      trend = "BEARISH";
    }
  }

  let rsiSignal =
    "NEUTRAL";

  if (rsi !== null) {

    if (rsi >= 70) {
      rsiSignal = "OVERBOUGHT";
    }

    else if (rsi <= 30) {
      rsiSignal = "OVERSOLD";
    }
  }

  return {

    current,

    sma20,

    sma50,

    sma200,

    rsi,

    rsiSignal,

    macd,

    trend
  };
}


/* =========================================
   MAIN HANDLER
========================================= */

exports.handler =
  async function(event) {

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {

      return {
        statusCode: 204,
        headers,
        body: ""
      };
    }

    const params =
      event.queryStringParameters ||
      {};

    const symbol =
      String(
        params.symbol ||
        "AAPL"
      )
        .trim()
        .toUpperCase();

    const type =
      String(
        params.type ||
        "chart"
      )
        .trim()
        .toLowerCase();

    const range =
      String(
        params.range ||
        "3mo"
      );

    if (
      !/^[A-Z0-9.\-:]{1,20}$/
        .test(symbol)
    ) {

      return json(
        400,
        {
          error:
            "Invalid ticker symbol."
        }
      );
    }

    try {

      /* FUNDAMENTALS */

      if (
        type ===
        "fundamentals"
      ) {

        const fundamentals =
          await getFundamentals(
            symbol
          );

        return json(
          200,
          {
            symbol,
            fundamentals
          }
        );
      }


      /* NEWS */

      if (
        type ===
        "news"
      ) {

        const news =
          await getNews(
            symbol
          );

        return json(
          200,
          {
            symbol,
            news
          }
        );
      }


      /* CHART */

      const result =
        await getChart(
          symbol,
          range
        );

      const meta =
        result.meta ||
        {};

      const quote =
        result
          .indicators
          ?.quote
          ?.[0] ||
        {};

      const timestamps =
        Array.isArray(
          result.timestamp
        )
          ? result.timestamp
          : [];

      const opens =
        Array.isArray(
          quote.open
        )
          ? quote.open
          : [];

      const highs =
        Array.isArray(
          quote.high
        )
          ? quote.high
          : [];

      const lows =
        Array.isArray(
          quote.low
        )
          ? quote.low
          : [];

      const closes =
        Array.isArray(
          quote.close
        )
          ? quote.close
          : [];

      const volumes =
        Array.isArray(
          quote.volume
        )
          ? quote.volume
          : [];

      const points = [];

      for (
        let i = 0;
        i < timestamps.length;
        i++
      ) {

        const close =
          num(closes[i]);

        if (
          close === null
        ) {
          continue;
        }

        points.push({

          timestamp:
            timestamps[i],

          open:
            num(opens[i]),

          high:
            num(highs[i]),

          low:
            num(lows[i]),

          close,

          volume:
            num(volumes[i])
        });
      }

      const latest =
        points.at(-1) ||
        null;

      const price =
        num(
          meta.regularMarketPrice
        ) ??
        latest?.close ??
        null;

      const previousClose =
        num(
          meta.chartPreviousClose
        ) ??
        num(
          meta.previousClose
        ) ??
        null;

      const change =
        price !== null &&
        previousClose !== null
          ? price -
            previousClose
          : null;

      const changePercent =
        change !== null &&
        previousClose
          ? (
              change /
              previousClose
            ) * 100
          : null;

      const technicals =
        getTechnicals(
          points
        );

      return json(
        200,
        {

          meta: {

            symbol,

            shortName:
              meta.shortName ||
              meta.displayName ||
              symbol,

            longName:
              meta.longName ||
              meta.displayName ||
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
              num(
                meta.regularMarketOpen
              ) ??
              latest?.open ??
              null,

            regularMarketDayHigh:
              num(
                meta.regularMarketDayHigh
              ) ??
              latest?.high ??
              null,

            regularMarketDayLow:
              num(
                meta.regularMarketDayLow
              ) ??
              latest?.low ??
              null,

            previousClose,

            chartPreviousClose:
              previousClose,

            fiftyTwoWeekLow:
              num(
                meta.fiftyTwoWeekLow
              ),

            fiftyTwoWeekHigh:
              num(
                meta.fiftyTwoWeekHigh
              )
          },

          timestamp:
            points.map(
              point =>
                point.timestamp
            ),

          indicators: {

            quote: [

              {

                open:
                  points.map(
                    point =>
                      point.open
                  ),

                high:
                  points.map(
                    point =>
                      point.high
                  ),

                low:
                  points.map(
                    point =>
                      point.low
                  ),

                close:
                  points.map(
                    point =>
                      point.close
                  ),

                volume:
                  points.map(
                    point =>
                      point.volume
                  )
              }
            ]
          },

          technicals
        }
      );

    } catch (error) {

      console.error(
        "Stock function error:",
        error
      );

      return json(
        502,
        {
          error:
            error?.message ||
            "Unable to load market data."
        }
      );
    }
  };
