# NH Site Docs

Shift documentation for 12 Neighbours · Neighbourly Homes sites: shift notes, handoffs, perimeter checks, incident reports, room and wellness checks, participant requests, intakes, engagement, work orders, inventory and requisitions.

- An installable app that works offline on computers, tablets and phones.
- Sign-in with 12 Neighbours Google accounts.
- Records are preserved in Google Drive: a Google Sheet, a Google Doc per formal report, and yearly archive spreadsheets per site.
- No participant data is stored in this repository.

**Setting it up:** see [SETUP.md](SETUP.md).

| Path | What it is |
|---|---|
| `NH-Site-Docs-Shared.html` | The app's source. Edit this, then run `python build.py`. |
| `app/` | The built, installable app. Published to GitHub Pages by `.github/workflows/pages.yml`. |
| `Code.gs` | The Google Apps Script server. Paste into Apps Script; it isn't run from here. |
| `build.py` | Builds `app/` and `NH-Site-Docs-Offline.html` from the source. |
| `NH-Site-Docs-Offline.html` | An emergency single-device copy with no server. |
| `app/schedule.html` | A temporary, standalone schedule generator (no sign-in; saved in the browser) at `https://12ncameron.github.io/12Napp/schedule.html`. It's hand-written, so `build.py` doesn't touch it. |
| `assets/` | The 12 Neighbours logo. The app icons in `app/` and the wordmark inside the app are made from it. |
