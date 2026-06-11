# NOTEV – Nord Ovest Toscana EVenti

**A free, community‑driven local event board for North‑West Tuscany.**  
Built entirely on Cloudflare’s free tier – zero hosting costs, no personal server required.

---

## Table of Contents

- [Il Progetto](#il-progetto)
- [Features](#features)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone and install](#1-clone-and-install)
  - [2. Set up Cloudflare resources](#2-set-up-cloudflare-resources)
  - [3. Configure secrets](#3-configure-secrets)
  - [4. Apply the database schema](#4-apply-the-database-schema)
  - [5. Run locally](#5-run-locally)
  - [6. Deploy to production](#6-deploy-to-production)
- [Environment variables & secrets](#environment-variables--secrets)
- [API endpoints](#api-endpoints)
- [Contributing](#contributing)
- [Code of conduct](#code-of-conduct)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## Il Progetto

**NOTEV** cerca di risolvere un problema reale: avere una bacheca affidabile e aperta dove diffondere e trovare eventi dal basso. Su questa piattaforma  **chiunque** può aggiungere un evento, che poi apparirà sulla home page principale dopo aver ricevuto abbastanza approvazioni dalla comunità.

Lo scopo è quello di non lasciare a Meta o altre corporation la gestione della nostra socialità reale sul territorio, che nello specifico è il nord-ovest della toscana. L'augurio è che questo possa ispirare altre soluzioni su altri territori, come altre esperienze hanno ispirato questa.

Affinchè la piattaforma funzioni la sua diffusione deve passare dal reale, passaparola/stickers negli spazi che attraversiamo. 

Non prendiamoci in giro, la piattaforma al momento è semplice ma per la maggior parte vibe-codata in maniera rozza e sicuramente ci sono criticità. Chiunque voglia contribuire è il benvenuto. Anche la struttura (serverless su Cloudflare) può essere messa benissimo in discussione.

Comunque per gli aspetti tecnici lascio la parola al mio collega clanker che continuerà questo README...

---

## Features

- 🌍 **Add events** with title, description, date, location, link, and image  
- 🗺️ **Interactive map** (Leaflet) to pick and view locations  
- 🔒 **Two separate passwords** – one for editing, one for revealing hidden locations  
- ✅ **Crowd‑sourced moderation** – an event needs 10 approvals before going public  
- 🚩 **Report system** – 10 reports hide an event and notify the admin via Telegram  
- 🔐 **Hidden location** – organisers can hide the exact spot and share a password  
- ⏱️ **Automatic cleanup** – events older than the scheduled date are removed  
- 📱 **Fully responsive** – works on mobile and desktop  
- 💸 **100% free to operate** – built on Cloudflare’s generous free tier  

---

## How it works

1. **A user creates an event** (title, date, location, optional password for hidden location).  
2. **The event goes into “pending”** and appears on `/pending.html`.  
3. **Anyone can approve** pending events. Once an event reaches **10 approvals**, it becomes “active” and appears on the homepage.  
4. **Active events are publicly visible**. If the location is hidden, only users with the **location password** can see it on the map.  
5. **Report button** – after 10 reports the event is hidden and the admin receives a Telegram notification.  
6. **Only the admin** can permanently cancel an event (using a secret key).  
7. **Old events** are automatically deleted every hour.

---

## Tech stack

| Layer        | Technology |
|--------------|------------|
| Backend      | Cloudflare Workers (TypeScript) |
| Database     | Cloudflare D1 (SQLite at the edge) |
| Frontend     | Plain HTML/CSS/JS, served as static assets by the Worker |
| Maps         | Leaflet + OpenStreetMap |
| Anti‑bot     | Google reCAPTCHA v2 |
| Notifications| Telegram Bot API |
| Cryptography | Web Crypto API (PBKDF2 password hashing) |
| Scheduling   | Cloudflare Workers Cron Triggers |

---

## Repository structure

```
localevents/
├── public/                  # Static frontend files
│   ├── index.html           # Main event list
│   ├── create.html          # Form to add an event
│   ├── pending.html         # Pending events & approval page
│   └── edit.html            # Edit event (password protected)
├── src/
│   └── worker.ts            # Cloudflare Worker – all backend logic
├── schema.sql               # D1 database schema
├── wrangler.jsonc           # Cloudflare Wrangler configuration
└── README.md
```

---

## Getting started

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Node.js](https://nodejs.org) (v18 or newer)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed globally:
  ```bash
  npm install -g wrangler
  ```
- A [Google reCAPTCHA](https://www.google.com/recaptcha) site (free, choose v2 “I’m not a robot” checkbox)
- A [Telegram bot](https://t.me/BotFather) for notifications (optional)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/notev.git
cd notev
npm install
```

*Note: there are no Node dependencies for the Worker itself (it’s just TypeScript), but the frontend uses no build step. `npm install` is optional here, mainly for development tooling.*

### 2. Set up Cloudflare resources

1. **Login to Wrangler**:
   ```bash
   npx wrangler login
   ```

2. **Create the D1 database** (the binding name `events_db` is already configured in `wrangler.jsonc`):
   ```bash
   npx wrangler d1 create events-db
   ```
   This outputs a `database_id`. Paste it into `wrangler.jsonc` if it’s not already there (the provided file already contains an ID, but you can replace it with yours).

3. **Add the static assets folder**:  
   The `wrangler.jsonc` already points `assets.directory` to `./public/` – no changes needed.

### 3. Configure secrets

All sensitive values are stored as Cloudflare secrets. Set them with:

```bash
npx wrangler secret put RECAPTCHA_SECRET      # your reCAPTCHA secret key
npx wrangler secret put TELEGRAM_BOT_TOKEN    # bot token from BotFather
npx wrangler secret put TELEGRAM_CHAT_ID      # your Telegram chat ID
npx wrangler secret put ADMIN_KEY             # a long random string (used to cancel events)
```

### 4. Apply the database schema

Apply the SQL file **to the remote production database**:

```bash
npx wrangler d1 execute events-db --file=./schema.sql --remote
```

If you want a local copy for testing, run the same command **without** `--remote` (it will use a local SQLite file).

### 5. Run locally

```bash
npx wrangler dev
```

Your site will be available at `http://localhost:8787`.  
The Worker serves both the API and the static HTML files.  
**Note:** reCAPTCHA may not work on `localhost` unless you add `localhost` to your reCAPTCHA allowed domains and use test keys during development.

### 6. Deploy to production

```bash
npx wrangler deploy
```

Your site will be live at `https://notev.YOUR_SUBDOMAIN.workers.dev` (or your custom domain after configuring it in the Cloudflare dashboard).  
The included `wrangler.jsonc` enables a cron trigger (`0 * * * *`) that cleans old events every hour.

---

## Environment variables & secrets

| Variable              | Description                                | Required |
|-----------------------|--------------------------------------------|----------|
| `RECAPTCHA_SECRET`    | Google reCAPTCHA secret key                | Yes      |
| `TELEGRAM_BOT_TOKEN`  | Telegram Bot token for alerts              | No (alerts are skipped if missing) |
| `TELEGRAM_CHAT_ID`    | Telegram chat ID to receive notifications  | No       |
| `ADMIN_KEY`           | Secret key used to cancel events           | Yes      |

All of these are set via `wrangler secret put` and are never exposed in the code.

---

## API endpoints

All endpoints are prefixed with `/api/`.

| Method | Path                          | Description |
|--------|-------------------------------|-------------|
| GET    | `/api/events`                 | List active upcoming events |
| POST   | `/api/events`                 | Create a new event (requires reCAPTCHA token) |
| GET    | `/api/events/pending`         | List pending events |
| POST   | `/api/events/:id/approve`     | Approve an event (one per IP) |
| POST   | `/api/events/:id/report`      | Report an event (one per IP) |
| POST   | `/api/events/:id/reveal`      | Reveal hidden location (requires location password) |
| POST   | `/api/events/:id/edit`        | Edit an event (requires event password) |
| DELETE | `/api/events/:id`             | Cancel an event (admin only, pass `?key=ADMIN_KEY`) |
| GET    | `/api/events/:id?password=X`  | Get full event data (for editing, requires event password) |
| GET    | `/api/admin?key=ADMIN_KEY`    | List all events (admin only) |

The static pages (`/`, `/create.html`, `/pending.html`, `/edit.html`) are served automatically from the `public/` directory by the Worker.

---

## Contributing

We welcome contributions! Here’s how you can help:

- **Report bugs** by opening an issue.
- **Suggest features** – the project is open to ideas from the local community.
- **Submit pull requests** – please keep them small and focused.

Before submitting, ensure:
- The code is formatted (no strict style guide yet, just be consistent).
- The Worker compiles without errors (`npx wrangler deploy --dry-run` can be used).
- New features are accompanied by a clear description in the PR.

For major changes, open an issue first to discuss what you would like to change.

---

## Code of conduct

We are committed to providing a welcoming and harassment‑free experience for everyone.  
Please read and follow our [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).  
*(You can add a separate `CODE_OF_CONDUCT.md` file – I’ll provide a standard one below.)*

---

## License

This project is open source and available under the **MIT License**.  
See the [LICENSE](LICENSE) file for details.

---

## Acknowledgements

- Cloudflare for the incredibly generous free tier
- Leaflet for the beautiful, lightweight maps
- Google reCAPTCHA for keeping bots away
- The people of North‑West Tuscany – this is for you!

---

**NOTEV** is built to be simple, transparent, and sustainable.  
If you find it useful, consider sharing it with your neighbours.  
Questions? Open an issue or reach out directly on GitHub.
```

---

## Optional extras

You can also create a `CODE_OF_CONDUCT.md` (standard Contributor Covenant v2.1) and a `LICENSE` file (MIT). I’ll give you the condensed versions to include:

### `CODE_OF_CONDUCT.md`

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment‑free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio‑economic status,
nationality, personal appearance, race, religion, or sexual identity
and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming,
diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment:

* Demonstrating empathy and kindness toward other people
* Being respectful of differing opinions, viewpoints, and experiences
* Giving and gracefully accepting constructive feedback
* Accepting responsibility and apologizing to those affected by our mistakes

Examples of unacceptable behavior:

* The use of sexualized language or imagery, and sexual attention or
  advances of any kind
* Trolling, insulting or derogatory comments, and personal or political attacks
* Public or private harassment
* Publishing others’ private information without their explicit permission

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the project maintainers. All complaints will be reviewed and
investigated promptly and fairly.

**Attribution:** This Code of Conduct is adapted from the [Contributor Covenant][homepage],
version 2.1, available at
[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html][v2.1].

[homepage]: https://www.contributor-covenant.org
[v2.1]: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html
```

### `LICENSE` (MIT)

```text
MIT License

Copyright (c) 2026 NOTEV contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```