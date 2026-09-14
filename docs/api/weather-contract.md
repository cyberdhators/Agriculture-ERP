# The weather route contract — agreed before either half exists

**For Alieu / Lane 2. Build the dashboard tile against this; Lane 1 builds the
backend to it.** Agreed by the owner on 2026-09-14, before any code on either
side.

**Why it exists in this form.** The auth seam — 49 route handlers and 29 pages
that had never spoken, recorded as the tenth silent-class instance — happened
because each half assumed something about the other and neither checked. A
comment in `require-role.ts` named the missing half and was read as a division
of labour rather than a debt. **So this contract is written down and agreed
first, and anything either side needs that is not here is a question, not an
assumption.**

This is the tile only (C-16). Advisories, severity, approval and SMS are
deliverable (e) and are **not** in this contract.

---

## 1. The route

```
GET /api/weather
```

No parameters in the first version. What a caller sees is decided entirely by
their role and scope, exactly as every other read route on this project works.

### Response, 200

```json
{
  "data": [
    {
      "location_id": "b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      "payam_id": "CE-JUB-MUN",
      "payam_name": "Munuki",
      "county_id": "CE-JUB",
      "state_id": "CE",
      "latitude": 4.85,
      "longitude": 31.58,
      "fetched_at": "2026-09-14T05:00:12Z",
      "stale": false,
      "current": {
        "temp_c": 31.4,
        "humidity_pct": 62,
        "wind_kph": 11.2,
        "rain_mm": 0,
        "conditions": "light rain",
        "icon": "10d"
      },
      "forecast": [
        {
          "forecast_for": "2026-09-15",
          "temp_max_c": 32.1,
          "temp_min_c": 22.0,
          "rain_mm": 8.4,
          "rain_probability": 0.7,
          "conditions": "rain",
          "icon": "10d"
        }
      ]
    }
  ],
  "attribution": {
    "text": "Weather data provided by OpenWeather",
    "url": "https://openweathermap.org",
    "logo_required": true
  }
}
```

### The fields, and which are guaranteed

| Field                                             | Guarantee                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `location_id`                                     | always present, a uuid                                                                             |
| `payam_id`, `payam_name`, `county_id`, `state_id` | always present                                                                                     |
| `latitude`, `longitude`                           | always present, decimal degrees                                                                    |
| `fetched_at`                                      | **always present, always the real fetch time.** Never `now()`, never null                          |
| `stale`                                           | always present. `true` means the last fetch attempt failed and this row is older than it should be |
| `current`                                         | **may be null** if the location has never been fetched                                             |
| `forecast`                                        | array, **may be empty**; ascending by `forecast_for`, starting tomorrow                            |
| `conditions`                                      | a short human string, lower case, provider-supplied                                                |
| `icon`                                            | provider icon code, or null. Map it or ignore it; do not parse it                                  |
| `attribution`                                     | always present, always the same shape                                                              |

**Forecast length is fixed by the route, not chosen by the caller.** Assume up to
seven days and render what arrives.

---

## 2. Scoping — what each role sees

| Role         | Sees                              |
| ------------ | --------------------------------- |
| `admin`      | every location                    |
| `supervisor` | locations in their own state only |
| `read_only`  | locations in their own state only |
| `officer`    | locations for **their own payam** |

**An officer's weather is their payam, not their caseload.** Their caseload is
farmers; weather is about where they work. This is the one scope rule that
differs from the farmer routes, and it is deliberate.

---

## 3. The empty case, which is the one most likely to be got wrong

**A caller with no locations gets `200` and `"data": []`.**

Never a `404`. Never an error. Never an empty body.

A supervisor for a state where no weather location has been created yet is a
**normal condition**, not a fault — and on the day this ships that will be true
for nine of the ten states. The tile should render an empty state, not an error
state: something like "No weather locations for your area yet", not "Failed to
load weather".

This is stated because it is exactly the kind of thing each side assumes the
other handles.

---

## 4. Failure responses

The standard envelope from `docs/api/CONVENTIONS.md` §3, unchanged:

| Status                   | When                                             | What the tile should do                              |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| `401`                    | no session, or a session with no application row | the portal's normal sign-in redirect                 |
| `403`                    | authenticated, role not permitted                | should not occur — every staff role may read weather |
| `503` `auth_unavailable` | the sign-in service failed to answer             | retry, then show a transient error                   |
| `500`                    | anything unexpected                              | the fixed 500 sentence; do not parse it              |

**There is no weather-specific error code.** If OpenWeather is unreachable the
route still returns `200` with the cached rows and `stale: true` — a failed
upstream fetch is never a failed request.

---

## 5. Three things the route will never do

- **It never fetches.** Reads read the cache. A scheduled job fills it. So no
  dashboard render, refresh or tab-switch can cost money or add latency.
- **It never returns a rendered sentence.** No "Rain likely Thursday". Numbers
  and provider strings only. Rendering is the tile's, and an advisory layer will
  be written over the same numbers later.
- **It never varies by query parameter in this version.** If the tile needs
  filtering or a single location, ask and it will be added deliberately.

---

## 6. What the tile must carry, as a licence condition

**Attribution is not optional and not cosmetic.** OpenWeather requires it
**visible where the data is displayed**; their FAQ requires the text, a
hyperlink to openweathermap.org, and their logo, obligatory on every plan from
Free to Professional.

The route supplies the text and URL in `attribution` so the server owns the
wording. **The tile must render them where the weather is shown** — not in a
footer, not in a settings page, not in a tooltip.

---

## 7. Honest limits to design around, not bugs to report

- **`fetched_at` is shown, deliberately.** The design's offline card says "saved
  this morning" and that is the honest thing to say. Show the time, not a
  pretence of live data.
- **A stale row is served rather than hidden.** If today's fetch failed,
  yesterday's row arrives with its real `fetched_at` and `stale: true`. A tile
  that vanishes when the provider is down is worse than one that says when it
  last knew something.
- **Neighbouring payams will read alike.** South Sudan has roughly 13 working
  weather stations, so these values are interpolated global-model output, not
  local measurement. **Do not build a UI that invites comparison between
  adjacent locations** — a table of payams side by side implies a precision the
  data does not have. See `docs/PROJECT-STATE.md`, I-03.
- **County-level locations are the likely starting point** for that reason, so
  the tile should not assume one row per payam.

---

## 8. What is NOT in this contract

Advisories, severity, approval workflow, SMS campaigns, the crop calendar and
any farmer-facing surface. The crop calendar is **out of scope** — recorded as a
rejected option in `docs/PROJECT-STATE.md` — so the twelve-month farming-year
strip and the "growing now" card should not be built against this.

If the tile needs something here that is missing, **ask in `docs/HANDOFF.md`
rather than assuming it.** That sentence is the whole point of the document.
