# NH Site Docs: setup guide

NH Site Docs is an installable app for Neighbourly Homes sites. It runs on any computer, tablet or phone, keeps working without internet, and saves everything to Google Drive:

- **A Google Sheet** with every record, one tab per log (named like the 12N Site Operations template).
- **A Google Doc for each formal report:** incident reports, room wellness checks, work orders and shift handoffs, filed by site, year and report type.
- **A yearly archive spreadsheet per site** for older closed entries.

```
NH Site Docs – Records/           (next to the data sheet in your Drive)
  Site A/
    2026/
      Incident Reports/           one Google Doc per report
      Room Wellness Checks/
      Work Orders/
      Shift Handoffs/
    Archive/
      NH Site Docs Archive – Site A – 2025   (spreadsheet)
  Site B/ …
```

## How it fits together

| Piece | What it is | Where it lives |
|---|---|---|
| **Data sheet + server** | A Google Sheet with a script (`Code.gs`) that checks sign-ins and writes to Drive | Your 12N Google Drive |
| **Sign-in client** | Lets the app use "Sign in with Google", limited to 12N accounts | Google Cloud (free) |
| **The app** | The files in the `app/` folder | GitHub Pages, from the 12NCameron/12Napp repository |

Setup takes about 45 minutes, once for the whole organization. **Use your 12 Neighbours Google Workspace account (@12neighbours.com) for every step.**

---

## Step 1: Data sheet and server

1. In Google Drive, create a folder for NH Site Docs (restricted to managers), and in it a Google Sheet named **NH Site Docs – Data**.
2. In the sheet, open **Extensions → Apps Script**. Replace everything in `Code.gs` with the contents of **Code.gs** from this folder. Click **Save**.
3. Choose **setup** in the function menu, then click **Run**. Authorize when asked (if you see "Google hasn't verified this app", choose **Advanced → Go to …**; it's your own script).
4. Setup creates:
   - the Access tab and the log tabs in the sheet
   - the **NH Site Docs – Records** folder next to it
   - a timer that writes the Google Docs every 5 minutes

Staff never need access to the sheet or the folder. The server writes to them on their behalf.

## Step 2: Google sign-in (Google Cloud, free)

1. Go to **console.cloud.google.com** and create a project named **NH Site Docs**.
2. Open **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding).
   - Set the app name to NH Site Docs, and use your email for support.
   - Set **Audience / User type: Internal**. This limits sign-in to 12 Neighbours accounts, and Google doesn't need to review the app.
3. Open **Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**. Name: NH Site Docs.
   - **Authorized JavaScript origins:** add `https://12ncameron.github.io` (the app's address from Step 4, origin only, no path).
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.

## Step 3: Connect the server

1. At the top of `Code.gs` in Apps Script, fill in:
   ```js
   var OAUTH_CLIENT_ID = '…apps.googleusercontent.com';
   var ALLOWED_DOMAIN = '12neighbours.com';
   var APP_URL = 'https://12ncameron.github.io/12Napp/';
   ```
2. Save. Then **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone**. The address is reachable, but every request must carry a valid 12N Google sign-in, which the server checks against the Access tab.
3. Copy the **Web app URL**. It ends in `/exec`.

## Step 4: Put the app online

1. Open `app/config.js` in this folder and fill in:
   ```js
   apiUrl: 'https://script.google.com/macros/s/…/exec',   // from Step 3
   clientId: '…apps.googleusercontent.com',                // from Step 2
   domain: '12neighbours.com'
   ```
2. Publish it with **GitHub Pages**. This project lives in the GitHub repository **12NCameron/12Napp**, and the included workflow (`.github/workflows/pages.yml`) publishes the `app/` folder every time it changes on `main`.
   1. On GitHub, open the repository, then go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   2. Commit and push your filled-in `app/config.js`. The **Actions** tab shows the publish running, which takes about a minute.
   3. The app's address is **`https://12ncameron.github.io/12Napp/`**.
   - On GitHub's free plan, Pages requires the repository to be **public**. The repository holds no participant data; records live only in Google Drive and on signed-in devices. To keep the repository private, you need a paid GitHub plan, or another host such as Netlify (drag the `app/` folder onto **app.netlify.com/drop**).
3. Put the origin **`https://12ncameron.github.io`** (no path) in the **Authorized JavaScript origins** from Step 2. Set `APP_URL` in Step 3 to the full address. If you changed `APP_URL` after deploying, deploy a new version of the script.

The app files contain no participant data. Records live only in Google Drive and on signed-in devices.

## Step 5: First sign-in and first site

1. Open the app's address and choose **Sign in with Google**.
2. Choose **Set up the first site**. A setup checklist on the dashboard walks you through:
   - the address and phone
   - units
   - the staff roster
   - contacts
   - moving participants in
   - the inventory list

---

## Who can use it (Access tab in the data sheet)

| Email | Role | Sites | What it means |
|---|---|---|---|
| you@12neighbours.com | Admin | *(blank)* | Everything at every site |
| `*@12neighbours.com` | Staff | *(blank)* | Everyone at 12N can log entries at any site |
| supervisor@12neighbours.com | Admin | Site A | Manages one site |
| sitea-tablet@12neighbours.com | Staff | Site A | A shared site device, locked to that site |
| someone@12neighbours.com | Viewer | | Read only |

**Roles:**
- **Admin:** sets up and closes sites, manages rosters and participants, archives entries, and deletes entries.
- **Staff:** logs entries.
- **Viewer:** reads only.

**Sites:**
- Leave Sites blank for all sites, or list site names separated by commas.
- A person's own row takes priority over the `*@` row.
- The server enforces these limits, so a locked account never receives other sites' data.

## Installing on each device

Open the app's address on the device (or a site's **launch link** from **Sites & Export**, which ends in `?site=…`), sign in, then install it:

| Device | How |
|---|---|
| **Windows / Mac (Chrome or Edge)** | The **Install** icon at the right of the address bar, or **Sites & Export → Install this app** |
| **Android** | Chrome menu ⋮ → **Install app** (or **Add to Home screen**) |
| **iPad / iPhone** | Safari Share button → **Add to Home Screen** |

The app gets its own **NH Site Docs** icon and window. It remembers its site, so the icon opens straight to that site's dashboard. For a shared site device, sign it in with a site Google account that's locked to that site on the Access tab.

## Working offline

- After the first sign-in, the app opens and works **without internet**. New entries, edits, room checks and handoffs are saved on the device and sync automatically when the connection returns.
- The header always shows the state: **Live · shared**, **Offline · 3 waiting to sync**, or **Syncing…**
- Google sign-ins last about an hour and usually renew on their own. If one can't renew, a **Sign in** button appears in the banner. Entries are kept on the device until then.
- **Searching or restoring archived entries** needs a connection.
- **Sign out of this device** (in Sites & Export) removes the records stored on the device. If changes haven't synced yet, it warns you first.

## In the 12N Staff Portal

The app's menu links to the Staff Portal (you can change the link under **Sites & Export → Organization**). In the portal, add a **Button** (Google Sites: Insert → Button) pointing to the app's address. Use a button rather than an embed, because Google sign-in doesn't work inside an embedded frame.

---

## Over a site's life

- **Opening a site:** **Sites & Export → Open a new site**, then work through the setup checklist.
- **Participants:**
  - **Move in**, **Transfer**, **Move out** (with date and reason) and **Re-admit**, all on the Participants & Units page.
  - Past participants keep their full history, along with every log entry about them.
  - Units can be marked **Out of service**.
- **Staff:** **Active**, **Inactive** (on leave) or **Archived** (has left the site). Archived staff can be restored.
- **Formal reports:** each incident report, wellness check, work order and handoff gets its own Google Doc within about 5 minutes.
  - Edits update the same Doc.
  - Deleting an entry marks its Doc as deleted rather than removing it.
  - The Doc's link is in the **Google Doc** column of the sheet.
- **Archiving** (Archive page → Archive old entries, Admins only):
  - Moves **closed** entries older than the cutoff (12 months is a good default) into that site's archive spreadsheet for that year.
  - Open items are never archived.
  - Archived entries stay searchable and can be restored.
  - Doing this about once a year keeps the app fast.
- **Closing a site:** keeps every record and Doc, removes the site from the site picker, and it can be reopened later.

## Updating the app later

1. Edit `NH-Site-Docs-Shared.html`, then run `python build.py`. Your `app/config.js` is never overwritten.
2. Commit and push to `main`. GitHub Pages republishes `app/` automatically, and devices pick up the update the next time they open the app online.
3. If `Code.gs` changed, paste it into Apps Script. Then choose **Deploy → Manage deployments → Edit → New version**. The `/exec` address stays the same.

## Files in this folder

| File | What it is |
|---|---|
| `Code.gs` | The server. Paste into Apps Script. |
| `NH-Site-Docs-Shared.html` | The app's source. Edit this one. It's also what the claude.ai page publishes. |
| `build.py` | Builds `app/` and the offline copy: `python build.py` |
| `app/` | The installable app. Upload its contents to the web host. `config.js` holds your connection settings. |
| `NH-Site-Docs-Offline.html` | An emergency single-device copy with no server. Entries stay in that browser only. |

## Good to know

- **Device security:** the installed app keeps a copy of its sites' records on the device so it can work offline. Use a passcode or screen lock on every device, and sign out of personal devices.
- **Limits:** about 30 people can save at the same moment. Docs are written in batches of up to 40 every 5 minutes. Yearly archiving keeps the live sheet small.
- **Privacy:** the data sheet, the Docs and the archive spreadsheets hold participant names, intake details and incident reports. Keep the NH Site Docs folder restricted to managers.
