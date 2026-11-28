/**
 * NH Site Docs — server (Google Apps Script)
 * 12 Neighbours · Neighbourly Homes
 *
 * The NH Site Docs app (installed on each site's devices) signs staff in with
 * their 12 Neighbours Google account and sends changes here. This script:
 *   • checks every request's Google sign-in and the Access tab,
 *   • keeps access, sites and settings in this (central) Google Sheet,
 *   • stores each site's records in that site's own spreadsheet, in the site's folder,
 *   • keeps a Google Doc for each formal report (incident reports, wellness
 *     checks, work orders, shift handoffs) in Drive, filed by site, year and type,
 *   • moves archived entries into one archive spreadsheet per year for all sites,
 *   • backs everything up weekly and shares each site's folder with its managers.
 * Nothing is ever erased: deletes are marked, archived entries stay searchable.
 *
 * Setup: see SETUP.md. Check the settings below, run setup() once,
 * then Deploy > New deployment > Web app (Execute as: Me · Who has access: Anyone).
 * "Anyone" is required: the app calls this script from its own address, and Google's
 * own sign-in wall would block those calls. Access is enforced here instead: every
 * request needs a Google sign-in from ALLOWED_DOMAIN plus a row on the Access tab.
 */

/* ===== SETTINGS (see SETUP.md). These match app/config.js, so pasting a new version keeps them. ===== */
var OAUTH_CLIENT_ID = '451384662035-bg8i5o78qphr0ufq8lan906khdeid4c9.apps.googleusercontent.com'; // Web client ID from Google Cloud
var ALLOWED_DOMAIN = '12neighbours.com';    // only accounts from this Google Workspace domain may use the app
var APP_URL = 'https://12ncameron.github.io/12Napp/'; // where the installed app is hosted (only used for a link)
var NEW_OWNER = '';                          // only when handing everything to someone else: their email, then run transferOwnership

var FIXED = ['Collection', 'ID', 'Server Updated', 'Deleted', 'Record (JSON)', 'Saved By'];
var DOC_COLS = ['Google Doc', 'Doc Updated'];
var TAB_NAMES = {
  notes: 'Notes Data', handoff: 'Shift Handoff Log', patrols: 'Perimeter Check Data', incidents: 'Incident Reports',
  visitors: 'Visitor Log', roomchecks: 'Room Operations Data', wellness: 'Room Wellness Checks',
  schedpref: 'Schedule Preferences', schedreq: 'Schedule Requests', requests: 'Participant Requests', intakes: 'Intake Data', engagement: 'Participant Engagement Data',
  workorders: 'Work Orders', requisitions: 'Requisitions', inout: 'Participant In-Out Log',
  guestunit: 'Guest Unit Bookings', safetyaudit: 'Safety Audits', firstaid: 'First Aid Kit Checks',
  trespass: 'No-Trespass List', notices: 'Community Notices', inspections: 'Home Inspections', plans: 'Stabilization & Improvement Plans',
  rent: 'Rent Checks', pets: 'Pet Registrations', parking: 'Parking Concerns', entries: 'Emergency Entry Records',
  escalations: 'Resident Escalations', foodbank: 'Foodbank Orders',
  tplan: 'Transition Plans', session: 'Programming Sessions', eventprop: 'Event Proposals', moveon: 'Move-On Checklists'
};
/* Logs that also get a Google Doc per entry, and the Drive folder each goes in. */
var FORMAL = { incidents: 'Incident Reports', wellness: 'Room Wellness Checks', workorders: 'Work Orders', handoff: 'Shift Handoffs', safetyaudit: 'Safety Audits',
  notices: 'Community Notices', inspections: 'Home Inspections', plans: 'Support Plans', entries: 'Emergency Entry Records',
  escalations: 'Resident Escalations' };
var COLLECTION_RE = /^((log|arch)-[a-z]+|inv-[A-Za-z0-9_-]+|config|checks|sites\/[A-Za-z0-9_-]+\/(staff|participants|schedule))$/;
var ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
var REQ_EMAIL = null; // set per request from the verified Google sign-in
var REQ_DEVICE = null; // {id, label} the app sends with every request (see Devices below)

/* ---------------- Web entry points ---------------- */

function doGet() {
  var link = APP_URL ? '<p><a href="' + APP_URL + '" target="_top">Open NH Site Docs</a></p>' : '';
  return HtmlService.createHtmlOutput('<div style="font-family:system-ui,sans-serif;padding:24px"><h2>NH Site Docs</h2>' +
    '<p>This is the NH Site Docs server. Staff use the installed app.</p>' + link + '</div>').setTitle('NH Site Docs');
}

/** All app requests arrive here: {fn, args, token}. */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var fn = API_[req.fn];
    if (!fn) throw new Error('DENIED: Unknown request.');
    REQ_EMAIL = verifyToken_(req.token);
    REQ_DEVICE = { id: /^[A-Za-z0-9_-]{20,64}$/.test(String(req.device || '')) ? String(req.device) : '', label: String(req.label || '').slice(0, 80) };
    out = { ok: true, result: fn.apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Checks a Google sign-in (ID token) and returns the signed-in email. Results are cached until the token expires. */
function verifyToken_(token) {
  if (!token) throw new Error('AUTH: Sign in to continue.');
  if (!OAUTH_CLIENT_ID) throw new Error('DENIED: The server is missing its OAuth client ID. See SETUP.md.');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 43);
  var hit = cache.get(key);
  if (hit) return hit;
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: Your sign-in has expired. Sign in again.');
  var info = JSON.parse(res.getContentText());
  var exp = Number(info.exp) * 1000;
  if (info.aud !== OAUTH_CLIENT_ID) throw new Error('AUTH: This sign-in is not for NH Site Docs.');
  if (String(info.email_verified) !== 'true') throw new Error('AUTH: Your Google account email is not verified.');
  if (ALLOWED_DOMAIN && String(info.hd || '').toLowerCase() !== ALLOWED_DOMAIN.toLowerCase()) throw new Error('AUTH: Sign in with your ' + ALLOWED_DOMAIN + ' account.');
  if (!(exp > Date.now())) throw new Error('AUTH: Your sign-in has expired. Sign in again.');
  var email = String(info.email || '').toLowerCase();
  var ttl = Math.min(21600, Math.floor((exp - Date.now()) / 1000) - 30);
  if (ttl > 0) cache.put(key, email, ttl);
  return email;
}

/* ---------------- One-time setup (run from the editor) ---------------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Apps Script editor from the Google Sheet (Extensions > Apps Script), then run setup again.');
  var owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var access = ss.getSheetByName('Access') || ss.insertSheet('Access', 0);
  if (access.getLastRow() < 1) {
    access.getRange(1, 1, 1, 5).setValues([['Email', 'Role', 'Sites', 'Notes', 'Site account']]).setFontWeight('bold');
    access.getRange(2, 1, 1, 5).setValues([[owner, 'Administrator', '', 'Owner of the data sheet · blank Sites = every site', '']]);
    access.setFrozenRows(1);
    access.setColumnWidths(1, 5, 240);
  }
  // Site account (column E): Yes for a site's own Google account. Facilitators and Viewers can only sign in with one,
  // on a device registered to the site. Supervisors and up use their own accounts anywhere.
  if (String(access.getRange(1, 5).getValue()) !== 'Site account') access.getRange(1, 5).setValue('Site account').setFontWeight('bold');
  access.getRange('E2:E500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes'], true).build());
  devicesTab_();
  // Roles, lowest to highest: Viewer, Facilitator, Supervisor, Manager, Administrator. Re-applied on every run.
  access.getRange('B2:B500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Administrator', 'Manager', 'Supervisor', 'Facilitator', 'Viewer'], true).build());
  ['Setup', 'Removed'].forEach(function (n) { tabByName_(ss, n); });
  filesTab_();
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  importLegacyRegistry_();
  var root = rootFolder_();
  // Site files: create one for each site, move existing records into it, and warn people who edit by hand.
  var cfg = readConfig_();
  Object.keys((cfg && cfg.sites) || {}).forEach(function (k) { siteBook_(k, true); });
  var moved = moveToSiteFiles();
  books_(null).forEach(function (b) { b.ss.getSheets().forEach(function (sh) { if (sh.getName() !== 'Access' && sh.getName() !== 'About') warnProtect_(sh); }); });
  var shared = '';
  try { shared = shareSiteFolders(); } catch (e) { shared = 'Sharing site folders failed: ' + e.message; }
  // Timers belong to whoever runs setup. After an ownership transfer, the new owner runs setup to own them.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (/^(syncDocs|dailyMaintenance)$/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncDocs').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(3).create();
  var missing = [];
  if (!OAUTH_CLIENT_ID) missing.push('OAUTH_CLIENT_ID');
  if (!ALLOWED_DOMAIN) missing.push('ALLOWED_DOMAIN');
  return 'Setup complete. Records folder: ' + root.getUrl() + '  ' + moved + '  ' + shared +
    (missing.length ? '  Still to fill in at the top of Code.gs: ' + missing.join(', ') + '.' : '') +
    '  Next: Deploy > Manage deployments > Edit > New version (or New deployment the first time).';
}
/** Hands every file to NEW_OWNER (set it at the top first). Run from the current owner's account. */
function transferOwnership() { return transferOwnershipTo(NEW_OWNER); }

/* ---------------- Access control ---------------- */

/** Returns {email, role, sites}. sites = null (every site) or a list of site names / ids from the Access tab. */
function user_() {
  var email = String(REQ_EMAIL || Session.getActiveUser().getEmail() || '').toLowerCase();
  var owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
  var rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues() : [];
  var own = null, wild = null;
  rows.forEach(function (r) {
    var who = String(r[0] || '').trim().toLowerCase(), role = normRole_(r[1]);
    if (!who || !role) return;
    var entry = { role: role, sites: parseSites_(r[2]), siteAccount: /^(yes|y|true)$/i.test(String(r[4] || '').trim()) && who.indexOf('*') < 0 };
    if (email && who === email) own = entry;
    else if (!wild && email && who.indexOf('*@') === 0 && email.split('@')[1] === who.slice(2)) wild = entry;
  });
  if (!email) throw new Error('AUTH: Sign in with your 12 Neighbours account.');
  if (email === owner) return { email: email, role: 'Administrator', sites: own ? own.sites : null };
  var e = own || wild;
  if (!e) throw new Error('DENIED: ' + email + ' is not on the NH Site Docs access list. Ask a manager to add you.');
  var u = { email: email, role: e.role, sites: e.sites, siteAccount: !!e.siteAccount };
  if (!atLeast_(u, 'Supervisor')) deviceGate_(u);
  return u;
}

/* ---------------- Devices: Facilitators and Viewers work only from registered site devices ----------------
   The app makes a random ID for each device and sends it with every request. A device signed in with a site
   account appears on the Devices tab as Waiting; a supervisor or manager of that site approves it in the app
   (Devices page). Supervisors, managers and administrators can sign in from any device with their own accounts. */
var DEV_COLS = ['Device ID', 'Code', 'Site', 'Name', 'Status', 'Requested by', 'Requested', 'Approved by', 'Approved', 'Last seen'];
function devicesTab_() {
  var ss = central_(), sh = ss.getSheetByName('Devices');
  if (!sh) {
    sh = ss.insertSheet('Devices');
    sh.getRange(1, 1, 1, DEV_COLS.length).setValues([DEV_COLS]).setFontWeight('bold').setBackground('#efe2d4');
    sh.setFrozenRows(1);
    warnProtect_(sh);
  }
  return sh;
}
function deviceCode_(id) { var s = String(id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); return s.slice(0, 4) + '-' + s.slice(4, 8); }
function deviceRows_() {
  var sh = central_().getSheetByName('Devices');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, DEV_COLS.length).getValues().map(function (r, i) {
    return { row: i + 2, id: String(r[0]), code: String(r[1]), site: String(r[2]), name: String(r[3]), status: String(r[4]), requestedBy: String(r[5]),
      requested: r[6] ? new Date(r[6]).toISOString() : '', approvedBy: String(r[7]), approved: r[8] ? new Date(r[8]).toISOString() : '', lastSeen: r[9] ? new Date(r[9]).toISOString() : '' };
  });
}
function deviceRow_(id) { if (!id) return null; var all = deviceRows_(); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
function deviceGate_(u) {
  if (!u.siteAccount) throw new Error('DENIED: ' + u.email + ' is a personal account. Facilitators sign in with the site\'s own account, on a device registered to the site. (Supervisors, managers and administrators can use their own accounts on any device.)');
  var id = REQ_DEVICE && REQ_DEVICE.id;
  if (!id) throw new Error('DEVICE: This copy of the app is out of date. Reload it, then try again.||');
  var dev = deviceRow_(id), allowed = allowedIds_(u);
  if (dev && dev.status === 'Active' && dev.site && siteOk_(allowed, dev.site)) {
    if (!dev.lastSeen || Date.now() - new Date(dev.lastSeen).getTime() > 3600000) {
      try { withLock_(function () { central_().getSheetByName('Devices').getRange(dev.row, 10).setValue(new Date()); }); } catch (e) {}
    }
    return;
  }
  var guess = '';
  if (allowed) { var ks = Object.keys(allowed); if (ks.length === 1) guess = ks[0]; }
  if (!dev) {
    try { withLock_(function () {
      if (deviceRow_(id)) return;
      var sh = devicesTab_();
      sh.getRange(sh.getLastRow() + 1, 1, 1, DEV_COLS.length).setValues([[id, deviceCode_(id), guess, REQ_DEVICE.label || '', 'Waiting', u.email, new Date(), '', '', new Date()]]);
    }); } catch (e) {}
  }
  var why = dev && dev.status === 'Revoked' ? 'This device\'s access was removed.' : dev && dev.status === 'Active' ? 'This device is registered to a different site.' : 'This device isn\'t registered to a site yet.';
  throw new Error('DEVICE: ' + why + '||' + deviceCode_(id));
}
function devCanSite_(u, site) { return siteOk_(allowedIds_(u), site); }
/** The Devices page: this device, and the devices of the sites this account may manage. */
function devices() {
  var u = user_();
  need_(u, 'Supervisor', 'Only supervisors and managers can register devices.');
  var allowed = allowedIds_(u), me = REQ_DEVICE && REQ_DEVICE.id;
  var list = deviceRows_().filter(function (d) { return !d.site || siteOk_(allowed, d.site); }).map(function (d) { delete d.row; d.mine = d.id === me; return d; });
  var self = list.filter(function (d) { return d.mine; })[0] || null;
  return { me: me ? { id: me, code: deviceCode_(me), status: self ? self.status : 'Not registered', site: self ? self.site : '' } : null, list: list };
}
/** Approves a device for a site (or registers this device). */
function registerDevice(id, site, name) {
  var u = user_();
  need_(u, 'Supervisor', 'Only supervisors and managers can register devices.');
  id = String(id || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) throw new Error('DENIED: Unknown device.');
  var cfg = readConfig_();
  if (!cfg || !cfg.sites || !cfg.sites[site]) throw new Error('DENIED: Unknown site.');
  if (!devCanSite_(u, site)) throw new Error('DENIED: Your account is not set up for that site.');
  return withLock_(function () {
    var sh = devicesTab_(), d = deviceRow_(id);
    if (d && d.site && d.site !== site && !devCanSite_(u, d.site)) throw new Error('DENIED: That device belongs to a site you don\'t manage.');
    var row = d ? d.row : sh.getLastRow() + 1;
    var vals = [id, deviceCode_(id), site, String(name || (d && d.name) || '').slice(0, 80), 'Active', d ? d.requestedBy : u.email, d && d.requested ? new Date(d.requested) : new Date(), u.email, new Date(), d && d.lastSeen ? new Date(d.lastSeen) : ''];
    sh.getRange(row, 1, 1, DEV_COLS.length).setValues([vals]);
    return { ok: true };
  });
}
/** Takes a device's access away (lost, replaced, or no longer at the site). */
function revokeDevice(id) {
  var u = user_();
  need_(u, 'Supervisor', 'Only supervisors and managers can remove devices.');
  return withLock_(function () {
    var d = deviceRow_(String(id || ''));
    if (!d) throw new Error('DENIED: Unknown device.');
    if (d.site && !devCanSite_(u, d.site)) throw new Error('DENIED: That device belongs to a site you don\'t manage.');
    central_().getSheetByName('Devices').getRange(d.row, 5).setValue('Revoked');
    return { ok: true };
  });
}
/* Layers, lowest to highest. "Admin" and "Staff" are the names used before Nov 2026 and still work. */
var RANK = { Viewer: 0, Facilitator: 1, Supervisor: 2, Manager: 3, Administrator: 4 };
function normRole_(v) {
  v = String(v || '').trim().toLowerCase();
  return v === 'administrator' || v === 'admin' ? 'Administrator' : v === 'manager' ? 'Manager' : v === 'supervisor' ? 'Supervisor'
    : v === 'facilitator' || v === 'staff' ? 'Facilitator' : v === 'viewer' ? 'Viewer' : '';
}
function atLeast_(u, role) { return (RANK[u.role] || 0) >= RANK[role]; }
function need_(u, role, what) { if (!atLeast_(u, role)) throw new Error('DENIED: ' + what); }
/* Managers may change their own sites' details, contacts and units; opening or closing sites,
   adding or removing units and organization settings need an Administrator. */
function checkConfigChange_(u, data) {
  if (atLeast_(u, 'Administrator')) return;
  need_(u, 'Manager', 'Only managers and administrators can change site details.');
  var old = readConfig_();
  if (!old) throw new Error('DENIED: Only an administrator can set up the first site.');
  if (String(old.portalUrl || '') !== String(data.portalUrl || '')) throw new Error('DENIED: Only administrators can change organization settings.');
  var a = Object.keys(old.sites || {}).sort().join('|'), b = Object.keys(data.sites || {}).sort().join('|');
  if (a !== b) throw new Error('DENIED: Only administrators can open new sites.');
  var allowed = allowedIds_(u);
  Object.keys(data.sites || {}).forEach(function (k) {
    var o = old.sites[k] || {}, n = data.sites[k] || {};
    if (!siteOk_(allowed, k)) { if (JSON.stringify(o) !== JSON.stringify(n)) throw new Error('DENIED: Your account is not set up for that site.'); return; }
    if ((o.status || 'Active') !== (n.status || 'Active') || String(o.closed || '') !== String(n.closed || '')) throw new Error('DENIED: Only administrators can close or reopen sites.');
    if ((o.units || []).length !== (n.units || []).length) throw new Error('DENIED: Only administrators can add or remove units.');
    if ((o.kind || 'shelter') !== (n.kind || 'shelter') || String(o.program || '') !== String(n.program || '')) throw new Error('DENIED: Only administrators can change a site\'s program.');
  });
}
/* Fields only Managers and Administrators may see. They are removed from everything sent to other roles,
   and kept as they were when someone below Manager saves the entry. Keys are the log name; values are
   [field key in the record, column heading in the Sheet]. */
var RESTRICTED = { intakes: [['hifisNo', 'HIFIS number']] };
function restrictedFor_(c) { var m = String(c).replace(/^(log|arch)-/, ''); return /^(log|arch)-/.test(c) ? (RESTRICTED[m] || []) : []; }
function stripRestricted_(u, c, d) {
  if (!d || atLeast_(u, 'Manager')) return d;
  restrictedFor_(c).forEach(function (f) { delete d[f[0]]; });
  return d;
}
/* Schedule Requests: any staff member can ask; only a Manager approves or declines. */
var DECISION_FIELDS = ['status', 'decisionNote', 'decidedBy', 'decidedAt'];
function checkScheduleRequest_(u, c, id, data) {
  if (atLeast_(u, 'Manager')) return;
  var old = readRecord_(c, id, data);
  DECISION_FIELDS.forEach(function (k) {
    var was = old ? String(old[k] || '') : '', now = String(data[k] || '');
    if (!old && k === 'status' && (now === '' || now === 'Pending')) return;
    if (was !== now) throw new Error('DENIED: Only a manager can approve or decline schedule requests.');
  });
}
/* Participant-led event proposals: only a manager approves, asks for changes or declines. */
var EVENT_DECISION = ['decision', 'decisionNote', 'decidedBy', 'decidedAt'];
function checkEventProposal_(u, c, id, data) {
  if (atLeast_(u, 'Manager')) return;
  var old = readRecord_(c, id, data);
  EVENT_DECISION.forEach(function (k) {
    var was = old ? String(old[k] || '') : '', now = String(data[k] || '');
    if (!old && k === 'decision' && (now === '' || now === 'Pending')) return;
    if (was !== now) throw new Error('DENIED: Only a manager can approve or decline event proposals.');
  });
}
/* Resident Escalation forms: who may complete each one (NH Behaviour Escalation Framework). */
var ESC_MIN = { 'Room Status Update': 'Supervisor', 'Community Accountability Review (CAR)': 'Supervisor', '10-Day Final Improvement Notice': 'Supervisor',
  'Debrief & lessons learned': 'Supervisor', 'Urgent Warning (Final Written Notice)': 'Manager', 'Eviction Request': 'Manager' };
function checkEscalation_(u, c, id, data) {
  if (ESC_MIN[data.step]) need_(u, ESC_MIN[data.step], 'The ' + data.step + ' is completed by a ' + ESC_MIN[data.step].toLowerCase() + ' or above.');
  var old = readRecord_(c, id, data) || {};
  if ((old.decision || 'Pending') !== (data.decision || 'Pending')) need_(u, 'Manager', 'Only managers record the Program Review decision.');
}
/* Supervisors build drafts and submit them; publishing (what facilitators see) needs a Manager. */
var PUBLISH_FIELDS = ['publishedDays', 'publishedAt', 'publishedBy', 'published'];
function checkScheduleChange_(u, c, id, data) {
  if (atLeast_(u, 'Manager')) return;
  need_(u, 'Supervisor', 'Only supervisors and managers can work on the schedule.');
  var old = readRecord_(c, id, data) || {};
  PUBLISH_FIELDS.forEach(function (k) {
    if (JSON.stringify(old[k] === undefined ? null : old[k]) !== JSON.stringify(data[k] === undefined ? null : data[k]))
      throw new Error('DENIED: Publishing the schedule needs a manager. Submit it for approval instead.');
  });
}
function parseSites_(v) {
  var list = String(v || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
  if (!list.length || list.some(function (s) { return /^all$/i.test(s); })) return null;
  return list;
}
function allowedIds_(u) {
  if (!u.sites) return null;
  var want = u.sites.map(function (s) { return s.toLowerCase(); });
  var cfg = readConfig_(), ids = {};
  Object.keys((cfg && cfg.sites) || {}).forEach(function (k) {
    if (want.indexOf(k.toLowerCase()) >= 0 || want.indexOf(String(cfg.sites[k].name || '').trim().toLowerCase()) >= 0) ids[k] = true;
  });
  return ids;
}
function readConfig_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Setup');
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === 'config' && String(vals[i][1]) === 'main' && vals[i][3] !== true) {
      try { return JSON.parse(vals[i][4]); } catch (e) { return null; }
    }
  }
  return null;
}
function siteName_(siteId, cfg) {
  cfg = cfg || readConfig_();
  return (cfg && cfg.sites && cfg.sites[siteId] && cfg.sites[siteId].name) || siteId;
}
function siteOf_(c, id, d) {
  if (/^(log|arch)-/.test(c)) return d && d.site ? String(d.site) : '';
  if (c.indexOf('inv-') === 0) return c.slice(4);
  var m = c.match(/^sites\/([^/]+)\//);
  if (m) return m[1];
  if (c === 'checks') return id.indexOf('audit_') === 0 ? id.slice(6) : id.split('_')[0];
  return '';
}
function siteOk_(allowed, site) { return !allowed || !site || allowed[site] === true; }

/* ---------------- API ---------------- */

function whoami() {
  var u = user_(), admin = atLeast_(u, 'Manager'), org = atLeast_(u, 'Administrator');
  var siteSheets = {}, siteFolders = {};
  if (admin) {
    var cfg = readConfig_(), allowed = allowedIds_(u);
    Object.keys((cfg && cfg.sites) || {}).forEach(function (k) {
      if (!siteOk_(allowed, k)) return;
      var b = regGet_('book', k), f = regGet_('folder', k);
      if (b) siteSheets[k] = 'https://docs.google.com/spreadsheets/d/' + b + '/edit';
      if (f) siteFolders[k] = 'https://drive.google.com/drive/folders/' + f;
    });
  }
  return {
    email: u.email, role: u.role, sites: u.sites,
    sheetUrl: org ? central_().getUrl() : '',
    recordsUrl: org ? rootFolder_().getUrl() : '',
    siteSheets: siteSheets, siteFolders: siteFolders
  };
}

/** Everything changed since a timestamp (only the sites this account may see). */
function changes(since) {
  var u = user_(), allowed = allowedIds_(u);
  since = Number(since) || 0;
  var props = PropertiesService.getScriptProperties();
  var lastTs = Number(props.getProperty('ts')) || 0;
  if (since && since >= lastTs) return { ts: lastTs, docs: [] };
  var tabTs = JSON.parse(props.getProperty('tabTs') || '{}');
  var docs = [];
  books_(allowed).forEach(function (b) {
    b.ss.getSheets().forEach(function (sh) {
      var name = sh.getName();
      if (!b.site && CENTRAL_ONLY[name]) return;
      if (since && (Number(tabTs[b.key + name]) || 0) <= since) return;
      readChanged_(sh, since).forEach(function (r) {
        var c = String(r[0]), id = String(r[1]);
        var del = r[3] === true || String(r[3]).toUpperCase() === 'TRUE';
        var d = null;
        if (!del) { try { d = JSON.parse(r[4]); } catch (e) { return; } }
        if (!del && !siteOk_(allowed, siteOf_(c, id, d))) return;
        if (del && b.site && !siteOk_(allowed, b.site)) return;
        docs.push({ c: c, id: id, del: del, d: stripRestricted_(u, c, d) });
      });
    });
  });
  return { ts: lastTs, docs: docs };
}

function put(c, id, json, flatJson) {
  var u = user_();
  check_(c, id);
  need_(u, 'Facilitator', 'You have view-only access.');
  if (c.indexOf('arch-') === 0) throw new Error('DENIED: Use the Archive page to archive entries.');
  if (String(json).length > 45000) throw new Error('DENIED: This entry is too long to save. Shorten the notes and try again.');
  var data = JSON.parse(json);
  if (c === 'config') checkConfigChange_(u, data);
  else if (/^sites\/[^/]+\/schedule$/.test(c)) checkScheduleChange_(u, c, id, data);
  else if (c === 'log-escalations') checkEscalation_(u, c, id, data);
  else if (c === 'log-schedreq') checkScheduleRequest_(u, c, id, data);
  else if (c === 'log-eventprop') checkEventProposal_(u, c, id, data);
  else if (c.indexOf('sites/') === 0) need_(u, 'Manager', 'Only managers can change staff rosters and participants.');
  var site = siteOf_(c, id, data);
  if (!siteOk_(allowedIds_(u), site)) throw new Error('DENIED: Your account is not set up for that site.');
  if (/^log-/.test(c) && !site) throw new Error('DENIED: This entry has no site.');
  var flat = {};
  try { flat = flatJson ? JSON.parse(flatJson) : {}; } catch (e) { flat = {}; }
  DOC_COLS.forEach(function (k) { delete flat[k]; });
  var hidden = atLeast_(u, 'Manager') ? [] : restrictedFor_(c);
  if (hidden.length) {
    var prev = readRecord_(c, id, data) || {};
    hidden.forEach(function (f) { delete data[f[0]]; if (prev[f[0]] !== undefined) data[f[0]] = prev[f[0]]; delete flat[f[1]]; });
    json = JSON.stringify(data);
  }
  var keepCols = DOC_COLS.concat(hidden.map(function (f) { return f[1]; }));
  return withLock_(function () {
    var ss = site ? siteBook_(site, true) : central_();
    var sh = tabByName_(ss, tabName_(c)), ts = nextTs_(tsKey_(ss, site, sh.getName()));
    var headers = ensureHeaders_(sh, Object.keys(flat));
    var row = findRow_(sh, c, id), old = null, legacy = null;
    if (row) old = rowByHeader_(sh, row);
    else if (site) { legacy = locateCentral_(c, id); if (legacy) old = rowByHeader_(legacy.sh, legacy.row); }
    var vals = headers.map(function (h) { return old && keepCols.indexOf(h) >= 0 && old[h] !== undefined ? old[h] : ''; });
    vals[0] = c; vals[1] = id; vals[2] = ts; vals[3] = false; vals[4] = json; vals[5] = u.email;
    Object.keys(flat).forEach(function (k) {
      var i = headers.indexOf(k);
      if (i >= FIXED.length) vals[i] = safe_(flat[k]);
    });
    if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, vals.length).setValues([vals]);
    if (legacy) deleteRowsAt_(legacy.sh, [legacy.row]); // the entry now lives in its site's file
    return { ts: ts };
  });
}

/** Deleting keeps the row (marked Deleted) and its Google Doc, so there is always an audit trail. */
function remove(c, id) {
  var u = user_();
  check_(c, id);
  need_(u, 'Manager', 'Only managers can delete entries.');
  var allowed = allowedIds_(u);
  return withLock_(function () {
    var hit = locate_(c, id, allowed);
    if (!hit) return { ts: Number(PropertiesService.getScriptProperties().getProperty('ts')) || 0 };
    if (hit.site && !siteOk_(allowed, hit.site)) throw new Error('DENIED: Your account is not set up for that site.');
    var ts = nextTs_(tsKey_(hit.sh.getParent(), hit.site, hit.sh.getName()));
    hit.sh.getRange(hit.row, 3, 1, 4).setValues([[ts, true, '', u.email]]);
    hit.sh.getRange(hit.row, 1, 1, hit.sh.getLastColumn()).setFontLine('line-through').setFontColor('#999999');
    return { ts: ts };
  });
}

/* ---------------- Archive: one spreadsheet per year for every site, in the central Records folder ---------------- */

function archiveMove(m, ids) {
  var u = user_();
  need_(u, 'Manager', 'Only managers can archive entries.');
  if (!TAB_NAMES[m]) throw new Error('DENIED: Unknown log.');
  var want = {};
  (ids || []).forEach(function (id) { if (ID_RE.test(String(id))) want[String(id)] = true; });
  var allowed = allowedIds_(u);
  return withLock_(function () {
    var moved = [];
    books_(allowed).forEach(function (b) {
      var live = b.ss.getSheetByName(TAB_NAMES[m]);
      if (!live || live.getLastRow() < 2) return;
      var groups = {};
      live.getRange(2, 1, live.getLastRow() - 1, 5).getValues().forEach(function (r) {
        if (r[0] !== 'log-' + m || !want[String(r[1])]) return;
        var d = null; try { d = JSON.parse(r[4]); } catch (e) { return; }
        if (!d || !d.site || !siteOk_(allowed, d.site)) return;
        var year = String(d.date || d.createdAt || '').slice(0, 4);
        if (!/^\d{4}$/.test(year)) year = 'Undated';
        (groups[year] = groups[year] || {})[String(r[1])] = true;
      });
      Object.keys(groups).forEach(function (year) {
        var dst = tabByName_(archiveBook_(year, true), TAB_NAMES[m]);
        moved = moved.concat(moveRows_(live, dst, 'log-' + m, 'arch-' + m, groups[year], allowed));
      });
    });
    if (moved.length) {
      var ts = nextTs_('Removed'), removed = tabByName_(central_(), 'Removed');
      removed.getRange(removed.getLastRow() + 1, 1, moved.length, 6)
        .setValues(moved.map(function (id) { return ['log-' + m, id, ts, true, '', u.email]; }));
    }
    return { moved: moved.length };
  });
}

function archiveRestore(m, ids, site, year) {
  var u = user_();
  need_(u, 'Manager', 'Only managers can restore entries.');
  if (!TAB_NAMES[m]) throw new Error('DENIED: Unknown log.');
  var allowed = allowedIds_(u);
  if (!site || !siteOk_(allowed, String(site))) throw new Error('DENIED: Your account is not set up for that site.');
  var want = {}, left = 0;
  (ids || []).forEach(function (id) { if (ID_RE.test(String(id))) { want[String(id)] = true; left++; } });
  var only = {}; only[String(site)] = true;
  return withLock_(function () {
    var book = siteBook_(String(site), true), live = tabByName_(book, TAB_NAMES[m]);
    var ts = nextTs_(tsKey_(book, String(site), live.getName())), moved = [];
    archiveBooks_(String(site), year).some(function (ab) {
      var sh = ab.getSheetByName(TAB_NAMES[m]);
      if (sh) moved = moved.concat(moveRows_(sh, live, 'arch-' + m, 'log-' + m, want, only, ts));
      return moved.length >= left;
    });
    var removed = central_().getSheetByName('Removed');
    if (removed && removed.getLastRow() > 1 && moved.length) {
      var back = {}; moved.forEach(function (id) { back[id] = true; });
      var vals = removed.getRange(2, 1, removed.getLastRow() - 1, 2).getValues(), rows = [];
      for (var i = 0; i < vals.length; i++) if (vals[i][0] === 'log-' + m && back[String(vals[i][1])]) rows.push(i + 2);
      deleteRowsAt_(removed, rows);
    }
    return { restored: moved.length };
  });
}

function archiveQuery(m, site, from, to) {
  var u = user_();
  need_(u, 'Supervisor', 'Only supervisors and managers can search the archive.');
  if (!TAB_NAMES[m]) throw new Error('DENIED: Unknown log.');
  if (!siteOk_(allowedIds_(u), String(site))) throw new Error('DENIED: Your account is not set up for that site.');
  var out = [], seen = {};
  archiveBooks_(String(site), '', from, to).forEach(function (book) {
    if (out.length >= 3000) return;
    var sh = book.getSheetByName(TAB_NAMES[m]);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
      if (r[0] !== 'arch-' + m || out.length >= 3000 || seen[String(r[1])]) return;
      var d; try { d = JSON.parse(r[4]); } catch (e) { return; }
      if (!d || String(d.site) !== String(site)) return;
      var date = d.date || String(d.createdAt || '').slice(0, 10);
      if ((from && date < from) || (to && date > to)) return;
      seen[String(r[1])] = true;
      out.push(stripRestricted_(u, 'arch-' + m, d));
    });
  });
  return out;
}

/** Copies matching rows between tabs (matching readable columns by header), then deletes the originals. */
function moveRows_(src, dst, fromC, toC, want, allowed, ts) {
  var n = src.getLastRow(), moved = [];
  if (n < 2) return moved;
  var srcHead = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0].map(String);
  var dstHead = ensureHeaders_(dst, srcHead.slice(FIXED.length));
  var have = idsIn_(dst, toC);
  var vals = src.getRange(2, 1, n - 1, srcHead.length).getValues(), out = [], rows = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (r[0] !== fromC || !want[String(r[1])]) continue;
    if (allowed) { var d = null; try { d = JSON.parse(r[4]); } catch (e) {} if (!siteOk_(allowed, d && d.site)) continue; }
    rows.push(i + 2); moved.push(String(r[1]));
    if (have[String(r[1])]) continue; // already copied by an earlier, interrupted run
    var row = dstHead.map(function () { return ''; });
    srcHead.forEach(function (h, j) { var k = dstHead.indexOf(h); if (k >= 0) row[k] = r[j]; });
    row[0] = toC; if (ts) row[2] = ts; row[3] = false;
    out.push(row);
  }
  if (out.length) dst.getRange(dst.getLastRow() + 1, 1, out.length, dstHead.length).setValues(out);
  SpreadsheetApp.flush(); // the copies are saved before any original is removed
  deleteRowsAt_(src, rows);
  return moved;
}

/* ---------------- Google Docs for formal reports (runs every 5 minutes) ---------------- */

/** Creates or updates a Google Doc for each formal report changed since its Doc was last written. */
function syncDocs() {
  var cache = CacheService.getScriptCache();
  if (cache.get('syncDocs')) return; // another run (for example a former owner's timer) is still working
  cache.put('syncDocs', '1', 300);
  try {
    var started = Date.now(), done = 0, cfg = readConfig_();
    books_(null).forEach(function (b) {
      Object.keys(FORMAL).forEach(function (m) {
        var sh = b.ss.getSheetByName(TAB_NAMES[m]);
        if (!sh || sh.getLastRow() < 2) return;
        var head = ensureHeaders_(sh, DOC_COLS);
        var iDoc = head.indexOf('Google Doc'), iUpd = head.indexOf('Doc Updated');
        var vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
        for (var i = 0; i < vals.length; i++) {
          if (Date.now() - started > 4.5 * 60 * 1000 || done >= 40) return;
          var r = vals[i], ts = Number(r[2]) || 0;
          if (!r[0] || ts <= (Number(r[iUpd]) || 0)) continue;
          var deleted = r[3] === true || String(r[3]).toUpperCase() === 'TRUE';
          if (deleted && !r[iDoc]) { writeDocCells_(sh, r[0], r[1], '', ts, iDoc, iUpd); continue; }
          try {
            var url = writeDoc_(m, head, r, deleted, cfg);
            writeDocCells_(sh, r[0], r[1], url, ts, iDoc, iUpd);
            done++;
          } catch (e) { console.error('Doc for ' + r[1] + ': ' + e); }
        }
      });
    });
  } finally { cache.remove('syncDocs'); }
}
function writeDoc_(m, head, r, deleted, cfg) {
  var iDoc = head.indexOf('Google Doc'), d = null;
  try { d = JSON.parse(r[4]); } catch (e) {}
  var doc = null;
  if (r[iDoc]) { try { doc = DocumentApp.openByUrl(String(r[iDoc])); } catch (e) { doc = null; } }
  var site = d && d.site ? siteName_(d.site, cfg) : '';
  var date = (d && (d.date || String(d.createdAt || '').slice(0, 10))) || '';
  var title = FORMAL[m].replace(/s$/, '') + (site ? ' – ' + site : '') + (date ? ' – ' + date : '');
  if (!doc) {
    if (!d) return '';
    doc = DocumentApp.create(title + ' (' + r[1] + ')');
    var folder = child_(child_(siteFolder_(d.site), date.slice(0, 4) || 'Undated'), FORMAL[m]);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
  }
  var body = doc.getBody();
  if (deleted) {
    body.insertParagraph(0, 'DELETED in NH Site Docs on ' + new Date(Number(r[2])).toLocaleString() + ' by ' + r[5] + '. The original record is kept below.')
      .setBold(true).setForegroundColor('#b23a32');
    doc.saveAndClose();
    return doc.getUrl();
  }
  body.clear();
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('12 Neighbours · Neighbourly Homes · NH Site Docs').setItalic(true);
  var rows = [];
  head.forEach(function (h, i) {
    if (i < FIXED.length || DOC_COLS.indexOf(h) >= 0) return;
    var v = r[i];
    if (v === '' || v === null || v === undefined) return;
    rows.push([h, String(v).replace(/^'/, '')]);
  });
  if (rows.length) {
    var t = body.appendTable(rows);
    for (var x = 0; x < t.getNumRows(); x++) t.getRow(x).getCell(0).setBackgroundColor('#f2ede6').editAsText().setBold(true);
  }
  body.appendParagraph('Record ID ' + r[1] + ' · last saved ' + new Date(Number(r[2])).toLocaleString() + ' by ' + r[5] + '. This document is updated automatically when the entry changes.').setItalic(true).setFontSize(9);
  doc.saveAndClose();
  return doc.getUrl();
}
function writeDocCells_(sh, c, id, url, ts, iDoc, iUpd) {
  withLock_(function () {
    var row = findRow_(sh, String(c), String(id));
    if (!row || Number(sh.getRange(row, 3).getValue()) !== ts) return; // changed again since; next run picks it up
    if (url) sh.getRange(row, iDoc + 1).setValue(url);
    sh.getRange(row, iUpd + 1).setValue(ts);
  });
}

/* =====================================================================
   WHERE THINGS ARE KEPT
   • This (central) spreadsheet: Access, Setup (sites and settings), Files, Removed, and the backups' and
     archives' parent folder. It belongs to the Housing Director (or a shared drive).
   • One spreadsheet per site ("NH Site Docs – <site>") in that site's folder, holding the site's live
     records. Each site's managers are given view access to their site's folder.
   • One archive spreadsheet per year for every site, in <Records>/Archive.
   The Files tab lists every file and folder by ID, so the setup survives an ownership transfer, a copy of
   the script, or pasting a new version of this code. If an ID stops working, the file is found again by
   name in its folder before a new one is made.
   ===================================================================== */

var CENTRAL_ONLY = { Access: true, Files: true, Devices: true }; // central tabs that are never sent to the app
var REG_ = null, BOOK_ = {};
function central_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function filesTab_() {
  var ss = central_(), sh = ss.getSheetByName('Files');
  if (!sh) {
    sh = ss.insertSheet('Files');
    sh.getRange(1, 1, 1, 6).setValues([['Kind', 'Key', 'File or folder ID', 'Name', 'Link', 'Updated']]).setFontWeight('bold').setBackground('#efe2d4');
    sh.setFrozenRows(1);
    warnProtect_(sh);
  }
  return sh;
}
function reg_() {
  if (REG_) return REG_;
  REG_ = {};
  var sh = central_().getSheetByName('Files');
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r, i) {
    if (r[0]) REG_[r[0] + '|' + r[1]] = { id: String(r[2] || ''), name: String(r[3] || ''), row: i + 2 };
  });
  return REG_;
}
function regGet_(kind, key) { var e = reg_()[kind + '|' + key]; return e ? e.id : ''; }
function regList_(kind) {
  var r = reg_(), out = [];
  Object.keys(r).forEach(function (k) { if (k.indexOf(kind + '|') === 0) out.push({ key: k.slice(kind.length + 1), id: r[k].id, name: r[k].name }); });
  return out;
}
function regSet_(kind, key, id, name, url) {
  var sh = filesTab_(), e = reg_()[kind + '|' + key], row = [kind, String(key), String(id || ''), name || '', url || '', new Date()];
  if (e) { sh.getRange(e.row, 1, 1, 6).setValues([row]); e.id = String(id || ''); e.name = name || ''; }
  else { sh.getRange(sh.getLastRow() + 1, 1, 1, 6).setValues([row]); REG_[kind + '|' + key] = { id: String(id || ''), name: name || '', row: sh.getLastRow() }; }
}
/** Earlier versions kept file IDs in script properties; copy them into the Files tab once. */
function importLegacyRegistry_() {
  var props = PropertiesService.getScriptProperties();
  var root = props.getProperty('rootFolderId');
  if (root && !regGet_('folder', 'root')) regSet_('folder', 'root', root, 'NH Site Docs – Records');
  var folders = JSON.parse(props.getProperty('siteFolders') || '{}');
  Object.keys(folders).forEach(function (k) { if (!regGet_('folder', k)) regSet_('folder', k, folders[k], siteName_(k)); });
  var books = JSON.parse(props.getProperty('archiveBooks') || '{}');
  Object.keys(books).forEach(function (s) { Object.keys(books[s]).forEach(function (y) {
    if (!regGet_('site-archive', s + '|' + y)) regSet_('site-archive', s + '|' + y, books[s][y], 'NH Site Docs Archive – ' + siteName_(s) + ' – ' + y);
  }); });
}

function folderById_(id) { if (!id) return null; try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; } }
function bookById_(id) {
  if (!id) return null;
  if (BOOK_[id]) return BOOK_[id];
  try { if (DriveApp.getFileById(id).isTrashed()) return null; BOOK_[id] = SpreadsheetApp.openById(id); return BOOK_[id]; } catch (e) { return null; }
}
function bookIn_(folder, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS) return bookById_(f.getId()); }
  return null;
}
function rootFolder_() {
  var f = folderById_(regGet_('folder', 'root')) || folderById_(PropertiesService.getScriptProperties().getProperty('rootFolderId'));
  if (!f) {
    var parents = DriveApp.getFileById(central_().getId()).getParents();
    f = child_(parents.hasNext() ? parents.next() : DriveApp.getRootFolder(), 'NH Site Docs – Records');
  }
  if (regGet_('folder', 'root') !== f.getId()) regSet_('folder', 'root', f.getId(), f.getName(), f.getUrl());
  return f;
}
function siteFolder_(siteId) {
  var name = siteName_(siteId), f = folderById_(regGet_('folder', siteId));
  if (f) { if (f.getName() !== name) f.setName(name); return f; }
  f = child_(rootFolder_(), name);
  regSet_('folder', siteId, f.getId(), name, f.getUrl());
  return f;
}
/** The spreadsheet holding one site's live records. create=false never makes anything new. */
function siteBook_(siteId, create) {
  var name = 'NH Site Docs – ' + siteName_(siteId), b = bookById_(regGet_('book', siteId));
  if (!b && !create) return null;
  if (!b) {
    var folder = siteFolder_(siteId);
    b = bookIn_(folder, name);
    if (!b) {
      b = SpreadsheetApp.create(name);
      DriveApp.getFileById(b.getId()).moveTo(folder);
      var first = b.getSheets()[0];
      first.setName('About');
      first.getRange(1, 1, 3, 1).setValues([['NH Site Docs: ' + siteName_(siteId)], ['This spreadsheet is written by the NH Site Docs app. Make changes in the app, not here.'], ['Site ID: ' + siteId]]);
      first.getRange(1, 1).setFontWeight('bold').setFontSize(14);
    }
    BOOK_[b.getId()] = b;
    regSet_('book', siteId, b.getId(), name, b.getUrl());
  } else if (create && b.getName() !== name) { b.rename(name); regSet_('book', siteId, b.getId(), name, b.getUrl()); }
  return b;
}
function archiveFolder_() { return child_(rootFolder_(), 'Archive'); }
function archiveBook_(year, create) {
  var name = 'NH Site Docs Archive – ' + year, b = bookById_(regGet_('archive', year));
  if (b || !create) return b;
  b = bookIn_(archiveFolder_(), name);
  if (!b) {
    b = SpreadsheetApp.create(name);
    DriveApp.getFileById(b.getId()).moveTo(archiveFolder_());
  }
  BOOK_[b.getId()] = b;
  regSet_('archive', year, b.getId(), name, b.getUrl());
  return b;
}
/** Archive spreadsheets for one site: the yearly ones, then any older per-site ones not yet merged. */
function archiveBooks_(site, year, from, to) {
  var out = [], yOk = function (y) {
    if (year) return y === String(year);
    if (!/^\d{4}$/.test(y)) return true;
    return !((from && y < String(from).slice(0, 4)) || (to && y > String(to).slice(0, 4)));
  };
  regList_('archive').sort(function (a, b) { return a.key < b.key ? 1 : -1; }).forEach(function (e) { if (yOk(e.key)) { var b = bookById_(e.id); if (b) out.push(b); } });
  regList_('site-archive').forEach(function (e) {
    var p = e.key.split('|');
    if (site && p[0] !== String(site)) return;
    if (yOk(p[1])) { var b = bookById_(e.id); if (b) out.push(b); }
  });
  return out;
}
/** The central sheet plus each site's file (only sites this account may see; null = all). Never creates files. */
function books_(allowed) {
  var out = [{ ss: central_(), site: '', key: '' }], cfg = readConfig_();
  Object.keys((cfg && cfg.sites) || {}).forEach(function (k) {
    if (!siteOk_(allowed, k)) return;
    var b = siteBook_(k, false);
    if (b) out.push({ ss: b, site: k, key: b.getId() + '|' });
  });
  return out;
}
/* Timestamps per tab, so changes() only reads tabs that changed. Central tabs keep their plain names. */
function tsKey_(ss, site, tabName) { return site ? ss.getId() + '|' + tabName : tabName; }

/** Finds a record: its site's file first, then the central sheet (entries saved before site files). */
function locate_(c, id, allowed) {
  var name = tabName_(c), site = siteOf_(c, id, null);
  var list = books_(allowed).filter(function (b) { return !site || !b.site || b.site === site; });
  list.sort(function (a, b) { return (a.site ? 0 : 1) - (b.site ? 0 : 1); });
  for (var i = 0; i < list.length; i++) {
    var sh = list[i].ss.getSheetByName(name);
    var row = sh ? findRow_(sh, c, id) : 0;
    if (row) return { sh: sh, row: row, site: list[i].site };
  }
  return null;
}
function locateCentral_(c, id) {
  var sh = central_().getSheetByName(tabName_(c)), row = sh ? findRow_(sh, c, id) : 0;
  return row ? { sh: sh, row: row } : null;
}
function readRecord_(c, id, d) {
  var site = siteOf_(c, id, d), hit = null;
  if (site) { var b = siteBook_(site, false), sh = b && b.getSheetByName(tabName_(c)), row = sh ? findRow_(sh, c, id) : 0; if (row) hit = { sh: sh, row: row }; }
  if (!hit) hit = locateCentral_(c, id);
  if (!hit) return null;
  try { return JSON.parse(hit.sh.getRange(hit.row, 5).getValue()); } catch (e) { return null; }
}
function rowByHeader_(sh, row) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], vals = sh.getRange(row, 1, 1, head.length).getValues()[0], o = {};
  head.forEach(function (h, i) { o[String(h)] = vals[i]; });
  return o;
}
function idsIn_(sh, c) {
  var have = {}, n = sh.getLastRow();
  if (n < 2) return have;
  sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) { if (String(r[0]) === c) have[String(r[1])] = true; });
  return have;
}
/** Rows changed after `since`: reads the small columns first, then the saved records only where needed. */
function readChanged_(sh, since) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  if (!since) return sh.getRange(2, 1, n - 1, 5).getValues().filter(function (r) { return r[0] && r[1]; });
  var meta = sh.getRange(2, 1, n - 1, 4).getValues(), idx = [];
  for (var i = 0; i < meta.length; i++) if (meta[i][0] && meta[i][1] && (Number(meta[i][2]) || 0) > since) idx.push(i);
  if (!idx.length) return [];
  var runs = [];
  idx.forEach(function (i) { var last = runs[runs.length - 1]; if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); });
  var json = {};
  if (runs.length > 25) sh.getRange(2, 5, n - 1, 1).getValues().forEach(function (v, i) { json[i] = v[0]; });
  else runs.forEach(function (r) { sh.getRange(2 + r[0], 5, r[1] - r[0] + 1, 1).getValues().forEach(function (v, j) { json[r[0] + j] = v[0]; }); });
  return idx.map(function (i) { return [meta[i][0], meta[i][1], meta[i][2], meta[i][3], json[i]]; });
}
/** Deletes rows in as few steps as possible (consecutive rows go together). */
function deleteRowsAt_(sh, rows) {
  if (!rows.length) return;
  rows = rows.slice().sort(function (a, b) { return b - a; });
  if (sh.getMaxRows() - rows.length <= sh.getFrozenRows()) sh.insertRowsAfter(sh.getMaxRows(), 1); // a sheet can't lose every unfrozen row
  var i = 0;
  while (i < rows.length) {
    var end = rows[i], start = end;
    i++;
    while (i < rows.length && rows[i] === start - 1) { start = rows[i]; i++; }
    sh.deleteRows(start, end - start + 1);
  }
}
/** A warning (not a lock) when someone edits app data by hand. The script itself is never blocked. */
function warnProtect_(sh) {
  var p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (p.length) return;
  sh.protect().setDescription('NH Site Docs: make changes in the app').setWarningOnly(true);
}

/* ---------------- One-time move to site files, and merging older per-site archives ---------------- */

/** Moves live records from the central sheet into each site's own file. Safe to run again: it skips anything
    already copied and stops before Apps Script's time limit (run again to continue). */
function moveToSiteFiles() {
  var started = Date.now(), moved = 0, left = false;
  importLegacyRegistry_();
  withLock_(function () {
    central_().getSheets().forEach(function (sh) {
      var name = sh.getName();
      if (left || /^(Access|Setup|Files|Removed|Devices|Other)$/.test(name) || sh.getLastRow() < 2) return;
      if (Date.now() - started > 4 * 60 * 1000) { left = true; return; }
      var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues(), bySite = {};
      vals.forEach(function (r, i) {
        if (!r[0] || !r[1]) return;
        var c = String(r[0]); if (c === 'config') return;
        var d = null; try { d = JSON.parse(r[4]); } catch (e) {}
        var site = siteOf_(c, String(r[1]), d);
        if (!site) return; // deleted entries from before site files stay here as the audit trail
        (bySite[site] = bySite[site] || []).push(i);
      });
      var gone = [];
      Object.keys(bySite).forEach(function (site) {
        var dst = tabByName_(siteBook_(site, true), name), dstHead = ensureHeaders_(dst, head.slice(FIXED.length));
        var have = {}, n = dst.getLastRow();
        if (n > 1) dst.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) { have[r[0] + '|' + r[1]] = true; });
        var out = [];
        bySite[site].forEach(function (i) {
          var r = vals[i];
          gone.push(i + 2);
          if (have[r[0] + '|' + r[1]]) return;
          var row = dstHead.map(function () { return ''; });
          head.forEach(function (h, j) { var k = dstHead.indexOf(h); if (k >= 0) row[k] = r[j]; });
          out.push(row);
        });
        if (out.length) dst.getRange(dst.getLastRow() + 1, 1, out.length, dstHead.length).setValues(out);
        moved += out.length;
      });
      SpreadsheetApp.flush();
      deleteRowsAt_(sh, gone);
    });
    if (!left) mergeSiteArchives_(started);
  });
  return left ? 'Moved ' + moved + ' entries so far. Run moveToSiteFiles again to continue.' : 'Done: moved ' + moved + ' entries into the site files.';
}
function mergeSiteArchives_(started) {
  regList_('site-archive').forEach(function (e) {
    if (Date.now() - started > 4.5 * 60 * 1000) return;
    var src = bookById_(e.id), year = e.key.split('|')[1];
    if (!src) return;
    src.getSheets().forEach(function (sh) {
      if (sh.getLastRow() < 2) return;
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(), byC = {};
      vals.forEach(function (r) { if (/^arch-/.test(String(r[0]))) (byC[r[0]] = byC[r[0]] || {})[String(r[1])] = true; });
      Object.keys(byC).forEach(function (c) { moveRows_(sh, tabByName_(archiveBook_(year, true), sh.getName()), c, c, byC[c], null); });
    });
  });
}

/* ---------------- Backups, sharing, ownership ---------------- */

/** Copies the central sheet and every site file into <Records>/Backups/<date>; archives on the first backup of a month.
    Keeps the 8 most recent backups (older ones go to the Drive bin, recoverable for 30 days). */
function backupNow() {
  var root = rootFolder_(), parent = child_(root, 'Backups'), tz = Session.getScriptTimeZone(), stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var dest = child_(parent, stamp), last = regGet_('backup', 'last'), cfg = readConfig_();
  var files = [[central_().getId(), central_().getName()]];
  Object.keys((cfg && cfg.sites) || {}).forEach(function (k) { var id = regGet_('book', k); if (id) files.push([id, 'NH Site Docs – ' + siteName_(k, cfg)]); });
  if (!last || String(last).slice(0, 7) !== stamp.slice(0, 7)) regList_('archive').forEach(function (e) { files.push([e.id, e.name]); });
  files.forEach(function (f) { try { DriveApp.getFileById(f[0]).makeCopy(f[1] + ' (backup ' + stamp + ')', dest); } catch (e) { console.error('Backup of ' + f[1] + ': ' + e); } });
  var all = [], it = parent.getFolders();
  while (it.hasNext()) { var x = it.next(); if (/^\d{4}-\d\d-\d\d$/.test(x.getName())) all.push(x); }
  all.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; }).slice(8).forEach(function (x) { x.setTrashed(true); });
  regSet_('backup', 'last', stamp, 'Last backup', dest.getUrl());
  return 'Backed up ' + files.length + ' files to ' + dest.getUrl();
}
/** Gives each site's managers (named on the Access tab) view access to their site's folder, and takes it away
    again from people this script added who are no longer managers there. Owners and others added by hand are left alone. */
function shareSiteFolders() {
  var cfg = readConfig_(), access = central_().getSheetByName('Access');
  var rows = access && access.getLastRow() > 1 ? access.getRange(2, 1, access.getLastRow() - 1, 3).getValues() : [];
  Object.keys((cfg && cfg.sites) || {}).forEach(function (k) {
    if (!regGet_('book', k)) return;
    var folder = siteFolder_(k), want = {};
    rows.forEach(function (r) {
      var who = String(r[0] || '').trim().toLowerCase();
      if (!who || who.indexOf('*') >= 0 || normRole_(r[1]) !== 'Manager') return;
      var sites = parseSites_(r[2]);
      if (!sites || sites.some(function (s) { s = s.toLowerCase(); return s === k.toLowerCase() || s === String(cfg.sites[k].name || '').trim().toLowerCase(); })) want[who] = true;
    });
    var had = {}, prevRaw = (reg_()['shared|' + k] || {}).name || '';
    prevRaw.split(',').filter(String).forEach(function (e) { had[e] = true; });
    var current = {};
    folder.getViewers().concat(folder.getEditors()).forEach(function (p) { current[String(p.getEmail()).toLowerCase()] = true; });
    try { current[String(folder.getOwner().getEmail()).toLowerCase()] = true; } catch (e) {}
    Object.keys(want).forEach(function (e) { if (!current[e]) { try { folder.addViewer(e); had[e] = true; } catch (x) { console.error('Share with ' + e + ': ' + x); } } });
    Object.keys(had).forEach(function (e) { if (!want[e]) { try { folder.removeViewer(e); } catch (x) {} delete had[e]; } });
    regSet_('shared', k, folder.getId(), Object.keys(had).join(','), folder.getUrl());
  });
  return 'Site folders shared with their managers.';
}
/** Runs once a day: keeps sharing current and makes the weekly backup. */
function dailyMaintenance() {
  try { shareSiteFolders(); } catch (e) { console.error('Sharing: ' + e); }
  var last = regGet_('backup', 'last');
  var due = !last || (Date.now() - new Date(last + 'T12:00:00').getTime()) >= 6.5 * 864e5;
  if (due) backupNow();
}
/** Hands every NH Site Docs file and folder to a new owner (same Google Workspace), for example the Housing Director.
    Run it from the current owner's account. It stops before the time limit; run again until it says Done.
    Files in a shared drive belong to the organization and are skipped. */
function transferOwnershipTo(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Set NEW_OWNER at the top of Code.gs to the email of the new owner, save, then run transferOwnership.');
  var me = String(Session.getEffectiveUser().getEmail()).toLowerCase(), started = Date.now(), n = 0, left = false;
  var give = function (item) {
    if (left) return;
    if (Date.now() - started > 4.5 * 60 * 1000) { left = true; return; }
    try { if (item.getOwner() && String(item.getOwner().getEmail()).toLowerCase() === me) { item.setOwner(email); n++; } } catch (e) {}
  };
  var walk = function (folder) {
    give(folder);
    var f = folder.getFiles(); while (f.hasNext() && !left) give(f.next());
    var d = folder.getFolders(); while (d.hasNext() && !left) walk(d.next());
  };
  give(DriveApp.getFileById(central_().getId()));
  walk(rootFolder_());
  return left ? 'Transferred ' + n + ' so far. Run again to continue.' : 'Done: transferred ' + n + ' files and folders to ' + email + '. Next, the new owner runs setup() and deploys a new version (see SETUP.md).';
}

/* ---------------- Helpers ---------------- */

function check_(c, id) {
  if (!COLLECTION_RE.test(String(c))) throw new Error('DENIED: Unknown record type.');
  if (!ID_RE.test(String(id))) throw new Error('DENIED: Invalid record id.');
}
function tabName_(c) {
  var m = String(c).replace(/^(log|arch)-/, '');
  return /^(log|arch)-/.test(c) && TAB_NAMES[m] ? TAB_NAMES[m]
    : c.indexOf('inv-') === 0 ? 'Inventory'
    : /\/staff$/.test(c) ? 'Staff'
    : /\/participants$/.test(c) ? 'Participants'
    : /\/schedule$/.test(c) ? 'Schedule'
    : c === 'config' ? 'Setup' : c === 'checks' ? 'Shift Checks' : 'Other';
}
function tabByName_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, FIXED.length).setValues([FIXED]).setFontWeight('bold').setBackground('#efe2d4');
    sh.setFrozenRows(1);
    sh.hideColumns(3, 3); // timestamps + raw JSON are for the app; people read the columns to the right
    if (name !== 'Access') warnProtect_(sh);
  }
  return sh;
}
function ensureHeaders_(sh, keys) {
  var lastCol = Math.max(sh.getLastColumn(), FIXED.length);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var missing = keys.filter(function (k) { return k && headers.indexOf(k) < 0; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#efe2d4');
    headers = headers.concat(missing);
  }
  return headers;
}
function findRow_(sh, c, id) {
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var hits = sh.getRange(2, 2, n - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findAll();
  for (var i = 0; i < hits.length; i++) {
    var row = hits[i].getRow();
    if (String(sh.getRange(row, 1).getValue()) === c) return row;
  }
  return 0;
}
function nextTs_(tabKey) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('ts')) || 0;
  var ts = Math.max(Date.now(), last + 1);
  var tabTs = JSON.parse(props.getProperty('tabTs') || '{}');
  tabTs[tabKey] = ts;
  props.setProperties({ ts: String(ts), tabTs: JSON.stringify(tabTs) });
  return ts;
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The log is busy. Try saving again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}
/** Stop typed text from being read as a spreadsheet formula. */
function safe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  v = String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function child_(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return parent.createFolder(name);
}

/* Functions the app may call (doPost). */
var API_ = { whoami: whoami, changes: changes, put: put, remove: remove, archiveMove: archiveMove, archiveRestore: archiveRestore, archiveQuery: archiveQuery,
  devices: devices, registerDevice: registerDevice, revokeDevice: revokeDevice };
