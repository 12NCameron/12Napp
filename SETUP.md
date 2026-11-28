# NH Site Docs: setup guide

NH Site Docs is an installable app for Neighbourly Homes sites. It runs on any computer, tablet or phone, keeps working without internet, and saves everything to Google Drive:

- **A central Google Sheet** (the Housing Director's): who can use the app (Access tab), the sites and settings, and a **Files** tab listing every file the app uses.
- **One spreadsheet per site** with that site's live records, one tab per log (named like the 12N Site Operations template). Each site's managers get view access to their site's folder.
- **A Google Doc for each formal report:** incident reports, room wellness checks, work orders and shift handoffs, filed by site, year and report type.
- **One archive spreadsheet per year** for every site's older closed entries, kept centrally.
- **Weekly backups** of all of the above.

```
NH Site Docs/                       (the Housing Director's folder, or a shared drive)
  NH Site Docs – Data               central sheet: Access, Setup, Files, Removed
  NH Site Docs – Records/
    Site A/                         shared (view) with Site A's managers
      NH Site Docs – Site A         Site A's live records
      2026/
        Incident Reports/           one Google Doc per report
        Room Wellness Checks/ …
    Site B/ …
    Archive/
      NH Site Docs Archive – 2025   every site's archived entries for 2025
    Backups/
      2026-11-30/                   copies of the central sheet and each site's sheet (newest 8 kept)
```

## How it fits together

| Piece | What it is | Where it lives |
|---|---|---|
| **Central sheet + server** | A Google Sheet with a script (`Code.gs`) that checks sign-ins and writes each site's records to its own file | The Housing Director's 12N Google Drive, or a shared drive |
| **Sign-in client** | Lets the app use "Sign in with Google", limited to 12N accounts | Google Cloud (free) |
| **The app** | The files in the `app/` folder | GitHub Pages, currently from the 12NCameron/12Napp repository (see "Moving the app to a new repository or address") |

Setup takes about 45 minutes, once for the whole organization. **Use your 12 Neighbours Google Workspace account (@12neighbours.com) for every step.**

---

## Step 1: Data sheet and server

1. In Google Drive, create a folder for NH Site Docs (restricted to managers), and in it a Google Sheet named **NH Site Docs – Data**.
2. In the sheet, open **Extensions → Apps Script**. Replace everything in `Code.gs` with the contents of **Code.gs** from this folder. Click **Save**.
3. Choose **setup** in the function menu, then click **Run**. Authorize when asked (if you see "Google hasn't verified this app", choose **Advanced → Go to …**; it's your own script).
4. Setup creates:
   - the Access, Setup, Files and Removed tabs in the sheet
   - the **NH Site Docs – Records** folder next to it, and a spreadsheet for each site in its own folder
   - a timer that writes the Google Docs every 5 minutes, and a daily one that keeps managers' folder access current and makes the weekly backup

   Setup is safe to run again at any time. When upgrading from the single-sheet version, it moves each site's records into the site's own spreadsheet. It skips anything already moved; if it says "Run again to continue", run it again.

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
     - **Don't** choose "Anyone within 12neighbours.com" or "Anyone with a Google account". Google then puts its own sign-in page in front of the script, the app's background requests can't get through it, and the app shows "No connection". The server already refuses anyone who isn't signed in with a 12neighbours.com account (`ALLOWED_DOMAIN` in `Code.gs`) and listed on the Access tab.
     - To change the code later, use **Manage deployments → Edit (pencil) → Version: New version**. This keeps the same address and the same access setting.
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

| Email | Role | Sites | Site account | What it means |
|---|---|---|---|---|
| you@12neighbours.com | Administrator | *(blank)* | | Everything at every site, including opening and closing sites |
| manager@12neighbours.com | Manager | Site A | | Runs one site: rosters, participants, publishing the schedule |
| supervisor@12neighbours.com | Supervisor | Site A | | Reviews reports and drafts that site's schedule |
| sitea@12neighbours.com | Facilitator | Site A | **Yes** | Site A's own account, used by facilitators on Site A's approved devices |

**Site accounts and approved devices.** Facilitators and Viewers can't sign in with their personal accounts. They use their site's own account (marked **Yes** under **Site account**), and only on a device a supervisor or manager has approved for that site. Supervisors, managers and administrators sign in with their own accounts on any device.

- A `*@12neighbours.com` row no longer lets anyone in as a Facilitator. You can delete it.
- **Approving a device:** sign the site account in on the shared device. It shows **This device needs to be approved** and a code such as `K7QX-2FMB`. A supervisor or manager of the site opens **This site → Devices**, checks the code matches, and chooses **Approve** (giving it a name like *Office tablet*). Or they can sign in on that device with their own account and choose **Approve this device**, then sign out so the site account can sign in.
- **Removing a device** (lost, replaced, retired): **This site → Devices → Remove**. It stops working at once, and its stored records are cleared the next time it connects.
- Approved devices are listed on the **Devices** tab of the central sheet.
- Approve only shared devices that stay at the site, never a personal phone or computer.
- Clearing the browser's data or reinstalling the app gives a device a new code, so it needs approving again.

**Roles** (each layer can do everything the layers below it can):

| | Viewer | Facilitator | Supervisor | Manager | Administrator |
|---|:-:|:-:|:-:|:-:|:-:|
| Read logs and the published schedule | ✓ | ✓ | ✓ | ✓ | ✓ |
| Log entries (notes, checks, incidents, in/out…) | | ✓ | ✓ | ✓ | ✓ |
| Review incidents, manage work order stages | | | ✓ | ✓ | ✓ |
| Staff roster and archive pages (view and search) | | | ✓ | ✓ | ✓ |
| Draft the schedule and submit it for approval | | | ✓ | ✓ | ✓ |
| Approve and publish the schedule | | | | ✓ | ✓ |
| Edit rosters, participants and site contacts | | | | ✓ | ✓ |
| Delete, archive and restore entries; export and import | | | | ✓ | ✓ |
| Approve and remove the site's devices | | | ✓ | ✓ | ✓ |
| Sign in with their own account on any device | | | ✓ | ✓ | ✓ |
| Open data sheet and records folder links | | | | ✓ | ✓ |
| Open or close sites, add or remove units, organization settings | | | | | ✓ |

- Facilitators don't see the schedule builder, review fields, rosters, the archive, Devices or Sites & Export.
- Supervisors' drafts stay private until a manager approves them. Managers see a reminder on the dashboard when a week is waiting.
- The older names still work: **Admin** counts as Administrator and **Staff** as Facilitator. Change them in the Access tab when convenient.
- The server enforces every limit, so hiding a button is never the only protection.

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

The app gets its own **NH Site Docs** icon and window. It remembers its site, so the icon opens straight to that site's dashboard. For a shared site device, sign it in with the site's own account (Site account **Yes** on the Access tab), then have a supervisor or manager approve the device (see above).

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
- **Staff:** **Active**, **On leave** or **Former staff** (has left the site). Former staff can be restored.
- **Schedule** (Shift → Schedule): managers and supervisors fill in two staff for each Day, Evening and Night shift, week by week. **Copy previous week** starts a new week as a draft, and **Publish** makes it visible to staff. The dashboard warns about shifts with fewer than 2 staff in the coming week, and **Use schedule** fills in "On shift" from the published schedule.
- **Formal reports:** each incident report, wellness check, work order and handoff gets its own Google Doc within about 5 minutes.
  - Edits update the same Doc.
  - Deleting an entry marks its Doc as deleted rather than removing it.
  - The Doc's link is in the **Google Doc** column of the sheet.
- **Archiving** (Archive page → Archive old entries, managers and administrators):
  - Moves **closed** entries older than the cutoff (12 months is a good default) into the central archive spreadsheet for that year (one per year, for all sites, in Records/Archive).
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
- **Limits:** about 30 people can save at the same moment. Docs are written in batches of up to 40 every 5 minutes. Each site has its own spreadsheet, so one busy site doesn't slow the others, and yearly archiving keeps each one small. (A Google Sheet holds up to 10 million cells; a site file with yearly archiving stays far below that.)
- **Privacy:** the site sheets, the Docs, the archive spreadsheets and the backups hold participant names, intake details and incident reports. Keep the NH Site Docs folder restricted to the Housing Director; managers see only their own site's folder.
- **Don't edit the data tabs by hand.** The app reads only its own hidden copy of each entry, so edits in the sheet don't reach the app, and deleted rows can confuse it. Each data tab shows a warning if someone tries. Make changes in the app.

## Site files and managers' folders

- Each site's spreadsheet is made when setup runs, or the first time anything is saved for a new site. Its link is in the **Files** tab, and managers see it under **Sites & Export**.
- Managers on the Access tab (role **Manager**, with the site in **Sites**, or Sites blank) get **view** access to their site's folder, checked daily. Take someone off the Access tab and the access the app gave them is removed the next day. Access you add by hand in Drive is left alone.
- To keep a site's folder somewhere else (for example a shared drive for that site), move the folder in Drive. The app finds files by ID, which doesn't change when they move. The account that owns the script must still be able to edit it.

## Backups

- Every week the daily timer copies the central sheet and each site's sheet into **Records/Backups/(date)**, plus the archive spreadsheets once a month. The newest 8 backups are kept; older ones go to the Drive bin (recoverable for 30 days).
- To back up right away: in Apps Script, run **backupNow**.
- To recover a site, copy rows from the backup into the site's sheet, or put the backup copy's ID on the site's **book** row in the Files tab and run **setup**.
- Google Sheets also keeps its own version history (**File → Version history**).

## Handing everything to a new owner (for example, the Housing Director)

The safest home is a **shared drive** owned by 12 Neighbours: files there belong to the organization, so nothing is lost when someone leaves. If you use one, move the NH Site Docs folder into it and skip step 1.

1. As the current owner, open Apps Script, set `var NEW_OWNER = 'jamie@12neighbours.com';` at the top of `Code.gs`, save, and run **transferOwnership**. It hands over the central sheet, the Records folder and everything in it. If it says "Run again to continue", run it again until it says Done.
2. The new owner opens the central sheet → **Extensions → Apps Script** and runs **setup**. This puts the timers under their account (timers always run as the person who made them).
3. The new owner chooses **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Edit the existing deployment rather than making a new one, so the `/exec` address stays the same and installed apps keep working. If the address does change, put the new one in `app/config.js` (`apiUrl`) and push.
4. In **Google Cloud** (console.cloud.google.com → the NH Site Docs project → IAM), add the new owner as **Owner** of the project. The sign-in client lives there; if its only owner's account is closed, sign-in stops working.
5. On the central sheet's Access tab, check the new owner is listed as Administrator.

Nothing in the app depends on who owns the files. Every file is listed by ID in the **Files** tab of the central sheet (not inside the script), so the setup survives a transfer, pasting a new version of `Code.gs`, or a copy of the script. If a file's ID ever stops working, the app looks for it by name in its folder before making a new one.

## Moving the app to a new repository or address

The app's files only use relative links, so the `app/` folder works from any address.

1. Copy or transfer the repository (for example to a 12 Neighbours GitHub organization). In the new repository turn on **Settings → Pages → Source: GitHub Actions**, then push once to publish.
   - Best: give the app its own domain (for example `docs.12neighbours.com`) under **Settings → Pages → Custom domain**. Future moves then keep the same address, and nobody has to reinstall.
2. In **Google Cloud → Credentials → the OAuth client**, add the new origin (for example `https://12neighbours.github.io`) to **Authorized JavaScript origins**. Keep the old one until everyone has moved.
3. Set `APP_URL` at the top of `Code.gs` to the new address (it's only used for a link) and deploy a new version.
4. Installed apps belong to their address, so each device opens the new address, signs in and installs again. To tell people, set `movedTo` in the **old** copy's `app/config.js` to the new address and push it there before retiring it. The old app then shows a notice with the link, and asks people to let any waiting entries sync first. Records are on the server, so reinstalling loses nothing.
5. Update the Staff Portal button and any bookmarks.
