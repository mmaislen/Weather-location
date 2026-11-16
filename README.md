# Was it raining when you were born?

Pick a date that matters to you, like a birthday, an anniversary or a wedding day, and any town in the world. The page answers the question in the title, then paints that date for every year since: one watercolor stripe per year, colored by how warm it was compared with normal, with raindrops for the rain that fell. After a "today" line come the next ten years, sketched in pencil, showing the odds.

Tap any past stripe to see that day's weather hour by hour. Tap a future stripe to see the chance it stays dry, the likely high, and which nearby days usually stay driest. If the date falls within the next 16 days, you get the real forecast.

## How it works

It's a static site with no build step and no server. It's plain HTML, CSS and JavaScript, and it calls free public weather APIs directly from the browser.

| What | Where it comes from |
| --- | --- |
| Place search (any town worldwide) | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) |
| Weather on every past date back to 1940 | [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (ERA5 reanalysis) |
| The next 16 days | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) |
| The odds for the next ten years | Worked out on the page from the last 41 years of that date, two days either side, adjusted for the local warming trend |

The page fetches only the weeks it needs, around the chosen date in each year, rather than decades of daily data. That keeps each visit small and polite to a free service.

### The AI-written note

The note under the chart can be written by Claude. The site calls a small backend in `worker/` (a Cloudflare Worker) so the API key never reaches the browser. The backend only answers this site, limits each visitor to 10 notes a minute, caches each note for a day, and checks every note against the quality bar in `evals/` before returning it. If anything fails, the page keeps the plain note written by code. It is off until `NOTE_API` in `js/config.js` is set.

### Files

- `index.html`: the page.
- `styles.css`: the hand-drawn journal look.
- `js/weather.js`: everything that talks to Open-Meteo, plus caching.
- `js/app.js`: the odds math, the canvas drawing and the interactions.
- `js/config.js`: where the AI note backend lives (empty means off).
- `worker/`: the AI note backend, its prompt and its checks.
- `evals/`: the quality bar and 25 test cases for the AI note.

## Run it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Credits

Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Fonts are Caveat and Patrick Hand from Google Fonts.

Designed by [Michelle Maislen](https://mmaislen.github.io/) and built with Claude.
