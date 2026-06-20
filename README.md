# Rebook Radar

A Windows desktop app that compares the price you **originally paid** (cash or
Rapid Rewards points) for Southwest Airlines flights against the **current
price**, so you can decide whether to cancel and rebook. Because Southwest
charges **no change fees**, refunds **points in full**, and converts cash fares
to **flight credit**, any genuine price drop is free money — this app finds it
for you and your family.

> ⚠️ **Disclaimer.** Southwest has no public API. The optional scraping feature
> automates the Southwest website using *your own* credentials and may be
> subject to Southwest's Terms of Use. It can break whenever the site changes.
> You can use the app fully with **manual entry** and the built-in demo data
> source. Use automation at your own risk.

---

## Architecture

A TypeScript monorepo (npm workspaces) with **strict separation** so business
logic is reusable and the app can migrate to the web later.

```
southwest-rebooker/
├── core/      # @swr/core — framework-agnostic business logic (NO Electron/Node UI)
│   └── src/
│       ├── models/        # Flight, Passenger, Account, PriceQuote, PriceComparison
│       ├── services/      # PricingComparisonService, PriceCheckService, PointsValuation
│       ├── providers/     # AirlineProvider interface + SouthwestProvider (+ fake)
│       ├── ports/         # Repository & SecretStore interfaces (hexagonal ports)
│       ├── utils/         # logger (redacts secrets), id, csv
│       ├── config.ts errors.ts index.ts
│
├── desktop/   # @swr/desktop — Electron shell (the ONLY place with Electron APIs)
│   └── src/
│       ├── main/          # Electron main process
│       │   ├── database/  # sql.js storage + repositories implementing core ports
│       │   ├── security/  # SafeStorageSecretStore (Windows DPAPI via safeStorage)
│       │   ├── scraping/  # PlaywrightSouthwestClient (implements core's client port)
│       │   ├── notifications/  monitoring/  services/
│       │   ├── container.ts ipc-handlers.ts config.ts index.ts
│       ├── preload/       # contextBridge → window.swr (typed)
│       ├── renderer/      # React + Tailwind UI
│       └── shared/        # IPC channel names + DTOs (main ⇄ preload ⇄ renderer)
│
└── web/       # @swr/web — future web client; imports @swr/core UNCHANGED
```

### Key design principles
- **All business logic lives in `/core`** and never imports Electron, Node-only,
  or browser-only APIs. Pricing, models, and Southwest integration are portable.
- **Dependency injection / ports & adapters.** Core defines interfaces
  (`AirlineProvider`, `SouthwestScraperClient`, `FlightRepository`,
  `SecretStore`); the desktop layer provides concrete implementations.
- **Electron APIs are confined to `/desktop`.** The renderer has no Node access
  (`contextIsolation: true`, `nodeIntegration: false`) and talks to the main
  process only through the typed `window.swr` bridge.

---

## Prerequisites

- **Node.js ≥ 18** and npm ≥ 9
- **Windows 10/11** (for DPAPI secure storage and toast notifications; the code
  also runs on macOS/Linux for development)

---

## Setup

```powershell
# 1. From the repo root, install all workspaces and build @swr/core
cd C:\Users\jospreng\southwest-rebooker
npm install

# 2. Create your local environment file
Copy-Item .env.example .env   # then edit values as desired

# 3. (Optional) install the Playwright browser for real scraping
npx playwright install chromium

# 4. Run the desktop app in development (hot reload)
npm run dev
```

`npm install` runs a `postinstall` that compiles `@swr/core` to `core/dist`, so
the desktop and web apps can import it.

### Build a Windows installer

```powershell
npm run build:win
# Output: desktop/release/Rebook Radar-<version>-setup.exe
```

### Run the web preview (proves core portability)

```powershell
npm run dev --workspace @swr/web   # http://localhost:5174
```

### Tests & type checking

```powershell
npm test          # core pricing engine unit tests (node:test)
npm run typecheck # all workspaces
```

---

## Using the app

1. **Passengers** — add yourself and family members.
2. **Accounts** *(optional)* — add Southwest logins. Passwords are encrypted
   with Windows DPAPI (`safeStorage`) and stored as ciphertext only. Map each
   account to one or more passengers. Use **Test** to verify login and **Sync
   trips** to import upcoming bookings.
3. **Dashboard** — add flights manually or via sync. Columns: *Passenger ·
   Route · Date · Original price · Current price · Savings · Recommendation*.
   Filter by passenger or account. Click **Check all prices** or a single row's
   refresh icon. Click a row for the full comparison breakdown. **Export CSV**
   any time.
4. **Settings** — points valuation (cents/point), alert thresholds, poll
   interval, background monitoring on/off, and whether to use **real scraping**
   (Playwright) or the **built-in demo** data source.

### Demo mode
With scraping disabled (default), a `FakeSouthwestScraperClient` returns sample
prices that include a simulated drop, so you can exercise the whole pricing and
notification pipeline without ever logging into Southwest.

---

## Pricing logic (Southwest policy embedded)

`PricingComparisonService` (in `/core`) is a pure, unit-tested function:

- **Points bookings:** points are fully refundable, so savings = original points
  − current points. Taxes/fees are refunded to the original form of payment.
- **Cash (Wanna Get Away) bookings:** refunded as flight credit, so savings =
  original fare − current fare; you keep the leftover as usable credit.
- **No change fees** means any drop above your threshold ⇒ **Rebook**.
- A configurable **points-to-cash valuation** (1.3–1.5¢/pt) normalizes points and
  cash to a common USD value for the dashboard and CSV.

---

## Security

- Passwords are **never** stored in plain text. They are encrypted via Electron
  `safeStorage` (Windows **DPAPI**, macOS Keychain, Linux libsecret) and only
  the base64 ciphertext is written to the local SQLite database.
- Secrets are **never logged**: the core logger recursively redacts any field
  whose key looks sensitive (`password`, `token`, `cookie`, …).
- The renderer is sandboxed (`contextIsolation`, no `nodeIntegration`) and a
  strict Content-Security-Policy is set in `index.html`.
- Environment-based config lives in `.env` (git-ignored); `.env.example`
  documents every value.

---

## Converting to a web app (Phase 7)

Because all logic is in `@swr/core`, migration is mostly about swapping adapters:

1. **Reuse `/core` unchanged** — models, `PricingComparisonService`,
   `PriceCheckService`, `AirlineProvider`/`SouthwestProvider`, and ports.
2. **Replace desktop adapters with web/server ones:**
   | Desktop adapter (`/desktop`) | Web equivalent |
   |---|---|
   | `Sqlite*Repository` (sql.js) | Postgres/Prisma or an HTTP API client implementing the same `*Repository` ports |
   | `SafeStorageSecretStore` (DPAPI) | Server-side KMS/Vault or per-user encrypted column |
   | `PlaywrightSouthwestClient` | A **server** process runs Playwright; the browser calls it over HTTPS via an `AirlineProvider`/`SouthwestScraperClient` HTTP client |
   | `ipc-handlers` + `window.swr` | REST/tRPC endpoints; the React app calls `fetch` instead of `window.swr` |
   | Electron `Notification` | Web Push / email |
3. **Move scraping to the backend.** Browsers cannot run Playwright, so the
   `SouthwestScraperClient` implementation becomes a server endpoint. The
   `SouthwestProvider` flow/parsing in `/core` stays identical.
4. The `web/` workspace already demonstrates step 1 by running the core pricing
   engine and `SouthwestProvider` (with the fake client) directly in the browser.

---

## Scripts (root)

| Command | Description |
|---|---|
| `npm run dev` | Run the Electron desktop app (dev) |
| `npm run build` | Build core + desktop |
| `npm run build:win` | Build a Windows installer |
| `npm test` | Run core unit tests |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | Lint the repo |

---

## License

MIT. For personal use. Not affiliated with or endorsed by Southwest Airlines.
"Southwest", "Rapid Rewards", and "Wanna Get Away" are trademarks of Southwest
Airlines Co.
