/**
 * NH Site Docs — server (Google Apps Script)
 * 12 Neighbours · Neighbourly Homes
 *
 * The NH Site Docs app (installed on each site's devices) signs staff in with
 * their 12 Neighbours Google account and sends changes here. This script:
 *   • checks every request's Google sign-in and the Access tab,
 *   • stores every record in this Google Sheet (one tab per log),
 *   • keeps a Google Doc for each formal report (incident reports, wellness
 *     checks, work orders, shift handoffs) in Drive, filed by site, year and type,
 *   • moves archived entries into a yearly archive spreadsheet in each site's folder.
 * Nothing is ever erased: deletes are marked, archived entries stay searchable.
 *
 * Setup: see SETUP.md. Check the three settings below, run setup() once,
 * then Deploy > New deployment > Web app (Execute as: Me · Who has access: Anyone).
 * "Anyone" is required: the app calls this script from its own address, and Google's
 * own sign-in wall would block those calls. Access is enforced here instead: every
 * request needs a Google sign-in from ALLOWED_DOMAIN plus a row on the Access tab.
 */

/* ===== SETTINGS (see SETUP.md). These match app/config.js, so pasting a new version keeps them. ===== */
var OAUTH_CLIENT_ID = '451384662035-bg8i5o78qphr0ufq8lan906khdeid4c9.apps.googleusercontent.com'; // Web client ID from Google Cloud
var ALLOWED_DOMAIN = '12neighbours.com';    // only accounts from this Google Workspace domain may use the app
var APP_URL = 'https://12ncameron.github.io/12Napp/'; // where the installed app is hosted

var FIXED = ['Collection', 'ID', 'Server Updated', 'Deleted', 'Record (JSON)', 'Saved By'];
var DOC_COLS = ['Google Doc', 'Doc Updated'];
var TAB_NAMES = {
  notes: 'Notes Data', handoff: 'Shift Handoff Log', patrols: 'Perimeter Check Data', incidents: 'Incident Reports',
  visitors: 'Visitor Log', roomchecks: 'Room Operations Data', wellness: 'Room Wellness Checks',
  requests: 'Participant Requests', intakes: 'Intake Data', engagement: 'Participant Engagement Data',
  workorders: 'Work Orders', requisitions: 'Requisitions', inout: 'Participant In-Out Log',
  guestunit: 'Guest Unit Bookings', safetyaudit: 'Safety Audits', firstaid: 'First Aid Kit Checks',
  trespass: 'No-Trespass List', notices: 'Community Notices', inspections: 'Home Inspections', plans: 'Stabilization & Improvement Plans',
  rent: 'Rent Checks', pets: 'Pet Registrations', parking: 'Parking Concerns', entries: 'Emergency Entry Records',
  escalations: 'Resident Escalations', foodbank: 'Foodbank Orders'
};
/* Logs that also get a Google Doc per entry, and the Drive folder each goes in. */
var FORMAL = { incidents: 'Incident Reports', wellness: 'Room Wellness Checks', workorders: 'Work Orders', handoff: 'Shift Handoffs', safetyaudit: 'Safety Audits',
  notices: 'Community Notices', inspections: 'Home Inspections', plans: 'Support Plans', entries: 'Emergency Entry Records',
  escalations: 'Resident Escalations' };
var COLLECTION_RE = /^((log|arch)-[a-z]+|inv-[A-Za-z0-9_-]+|config|checks|sites\/[A-Za-z0-9_-]+\/(staff|participants|schedule))$/;
var ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
var REQ_EMAIL = null; // set per request from the verified Google sign-in

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
    access.getRange(1, 1, 1, 4).setValues([['Email', 'Role', 'Sites', 'Notes']]).setFontWeight('bold');
    var rows = [[owner, 'Administrator', '', 'Owner of the data sheet · blank Sites = every site']];
    var domain = owner.split('@')[1] || '';
    if (domain && !/^(gmail|googlemail)\.com$/.test(domain)) rows.push(['*@' + domain, 'Facilitator', '', 'Everyone with a ' + domain + ' account can log entries at any site']);
    access.getRange(2, 1, rows.length, 4).setValues(rows);
    access.setFrozenRows(1);
    access.setColumnWidths(1, 4, 240);
  }
  // Roles, lowest to highest: Viewer, Facilitator, Supervisor, Manager, Administrator. Re-applied on every run.
  access.getRange('B2:B500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Administrator', 'Manager', 'Supervisor', 'Facilitator', 'Viewer'], true).build());
  Object.keys(TAB_NAMES).forEach(function (m) {
    var sh = tab_('log-' + m);
    if (FORMAL[m]) ensureHeaders_(sh, DOC_COLS);
  });
  ['Inventory', 'Setup', 'Shift Checks', 'Staff', 'Participants', 'Schedule', 'Removed'].forEach(function (n) { tabByName_(ss, n); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  var root = rootFolder_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncDocs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncDocs').timeBased().everyMinutes(5).create();
  var missing = [];
  if (!OAUTH_CLIENT_ID) missing.push('OAUTH_CLIENT_ID');
  if (!ALLOWED_DOMAIN) missing.push('ALLOWED_DOMAIN');
  return 'Setup complete. Records folder: ' + root.getUrl() +
    (missing.length ? '  Still to fill in at the top of Code.gs: ' + missing.join(', ') + '.' : '') +
    '  Next: Deploy > New deployment > Web app.';
}

/* ---------------- Access control ---------------- */

/** Returns {email, role, sites}. sites = null (every site) or a list of site names / ids from the Access tab. */
function user_() {
  var email = String(REQ_EMAIL || Session.getActiveUser().getEmail() || '').toLowerCase();
  var owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
  var rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  var own = null, wild = null;
  rows.forEach(function (r) {
    var who = String(r[0] || '').trim().toLowerCase(), role = normRole_(r[1]);
    if (!who || !role) return;
    var entry = { role: role, sites: parseSites_(r[2]) };
    if (email && who === email) own = entry;
    else if (!wild && email && who.indexOf('*@') === 0 && email.split('@')[1] === who.slice(2)) wild = entry;
  });
  if (!email) throw new Error('AUTH: Sign in with your 12 Neighbours account.');
  if (email === owner) return { email: email, role: 'Administrator', sites: own ? own.sites : null };
  var e = own || wild;
  if (!e) throw new Error('DENIED: ' + email + ' is not on the NH Site Docs access list. Ask a manager to add you.');
  return { email: email, role: e.role, sites: e.sites };
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
function readRecord_(c, id) {
  var sh = tab_(c), row = findRow_(sh, c, id);
  if (!row) return null;
  try { return JSON.parse(sh.getRange(row, 5).getValue()); } catch (e) { return null; }
}
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
    if ((o.kind || 'shelter') !== (n.kind || 'shelter')) throw new Error('DENIED: Only administrators can change the type of site.');
  });
}
/* Resident Escalation forms: who may complete each one (NH Behaviour Escalation Framework). */
var ESC_MIN = { 'Room Status Update': 'Supervisor', 'Community Accountability Review (CAR)': 'Supervisor', '10-Day Final Improvement Notice': 'Supervisor',
  'Debrief & lessons learned': 'Supervisor', 'Urgent Warning (Final Written Notice)': 'Manager', 'Eviction Request': 'Manager' };
function checkEscalation_(u, c, id, data) {
  if (ESC_MIN[data.step]) need_(u, ESC_MIN[data.step], 'The ' + data.step + ' is completed by a ' + ESC_MIN[data.step].toLowerCase() + ' or above.');
  var old = readRecord_(c, id) || {};
  if ((old.decision || 'Pending') !== (data.decision || 'Pending')) need_(u, 'Manager', 'Only managers record the Program Review decision.');
}
/* Supervisors build drafts and submit them; publishing (what facilitators see) needs a Manager. */
var PUBLISH_FIELDS = ['publishedDays', 'publishedAt', 'publishedBy', 'published'];
function checkScheduleChange_(u, c, id, data) {
  if (atLeast_(u, 'Manager')) return;
  need_(u, 'Supervisor', 'Only supervisors and managers can work on the schedule.');
  var old = readRecord_(c, id) || {};
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
  var u = user_(), admin = atLeast_(u, 'Manager');
  return {
    email: u.email, role: u.role, sites: u.sites,
    sheetUrl: admin ? SpreadsheetApp.getActiveSpreadsheet().getUrl() : '',
    recordsUrl: admin ? rootFolder_().getUrl() : ''
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
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === 'Access') return;
    if (since && (Number(tabTs[name]) || 0) <= since) return;
    var n = sh.getLastRow();
    if (n < 2) return;
    var vals = sh.getRange(2, 1, n - 1, 5).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i], ts = Number(r[2]) || 0;
      if (!r[0] || !r[1] || ts <= since) continue;
      var c = String(r[0]), id = String(r[1]);
      var del = r[3] === true || String(r[3]).toUpperCase() === 'TRUE';
      var d = null;
      if (!del) { try { d = JSON.parse(r[4]); } catch (e) { continue; } }
      if (!del && !siteOk_(allowed, siteOf_(c, id, d))) continue;
      docs.push({ c: c, id: id, del: del, d: d });
    }
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
  else if (c.indexOf('sites/') === 0) need_(u, 'Manager', 'Only managers can change staff rosters and participants.');
  if (!siteOk_(allowedIds_(u), siteOf_(c, id, data))) throw new Error('DENIED: Your account is not set up for that site.');
  var flat = {};
  try { flat = flatJson ? JSON.parse(flatJson) : {}; } catch (e) { flat = {}; }
  DOC_COLS.forEach(function (k) { delete flat[k]; });
  return withLock_(function () {
    var sh = tab_(c), ts = nextTs_(sh.getName());
    var headers = ensureHeaders_(sh, Object.keys(flat));
    var row = findRow_(sh, c, id);
    var old = row ? sh.getRange(row, 1, 1, headers.length).getValues()[0] : null;
    var vals = headers.map(function (h, i) { return old && DOC_COLS.indexOf(h) >= 0 ? old[i] : ''; });
    vals[0] = c; vals[1] = id; vals[2] = ts; vals[3] = false; vals[4] = json; vals[5] = u.email;
    Object.keys(flat).forEach(function (k) {
      var i = headers.indexOf(k);
      if (i >= FIXED.length) vals[i] = safe_(flat[k]);
    });
    if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, vals.length).setValues([vals]);
    return { ts: ts };
  });
}

/** Deleting keeps the row (marked Deleted) and its Google Doc, so there is always an audit trail. */
function remove(c, id) {
  var u = user_();
  check_(c, id);
  need_(u, 'Manager', 'Only managers can delete entries.');
  return withLock_(function () {
    var sh = tab_(c), row = findRow_(sh, c, id);
    if (!row) return { ts: Number(PropertiesService.getScriptProperties().getProperty('ts')) || 0 };
    var ts = nextTs_(sh.getName());
    sh.getRange(row, 3, 1, 4).setValues([[ts, true, '', u.email]]);
    sh.getRange(row, 1, 1, sh.getLastColumn()).setFontLine('line-through').setFontColor('#999999');
    return { ts: ts };
  });
}

/* ---------------- Archive: yearly spreadsheets per site ---------------- */

function archiveMove(m, ids) {
  var u = user_();
  need_(u, 'Manager', 'Only managers can archive entries.');
  if (!TAB_NAMES[m]) throw new Error('DENIED: Unknown log.');
  var want = {};
  (ids || []).forEach(function (id) { if (ID_RE.test(String(id))) want[String(id)] = true; });
  var allowed = allowedIds_(u);
  return withLock_(function () {
    var live = tab_('log-' + m), n = live.getLastRow(), groups = {};
    if (n < 2) return { moved: 0 };
    live.getRange(2, 1, n - 1, 5).getValues().forEach(function (r) {
      if (r[0] !== 'log-' + m || !want[String(r[1])]) return;
      var d = null; try { d = JSON.parse(r[4]); } catch (e) { return; }
      if (!d || !d.site || !siteOk_(allowed, d.site)) return;
      var year = String(d.date || d.createdAt || '').slice(0, 4) || 'Undated';
      var key = d.site + '|' + year;
      (groups[key] = groups[key] || {})[String(r[1])] = true;
    });
    var moved = [];
    Object.keys(groups).forEach(function (key) {
      var parts = key.split('|');
      var dst = tabByName_(archiveBook_(parts[0], parts[1]), TAB_NAMES[m]);
      moved = moved.concat(moveRows_(live, dst, 'log-' + m, 'arch-' + m, groups[key], allowed));
    });
    if (moved.length) {
      var ts = nextTs_('Removed'), removed = tabByName_(SpreadsheetApp.getActiveSpreadsheet(), 'Removed');
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
  var want = {}, left = 0;
  (ids || []).forEach(function (id) { if (ID_RE.test(String(id))) { want[String(id)] = true; left++; } });
  var allowed = allowedIds_(u);
  return withLock_(function () {
    var live = tab_('log-' + m), ts = nextTs_(live.getName()), moved = [];
    archiveBooks_(site, year, allowed).some(function (book) {
      var sh = book.getSheetByName(TAB_NAMES[m]);
      if (sh) moved = moved.concat(moveRows_(sh, live, 'arch-' + m, 'log-' + m, want, allowed, ts));
      return moved.length >= left;
    });
    var removed = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Removed');
    if (removed && removed.getLastRow() > 1) {
      var vals = removed.getRange(2, 1, removed.getLastRow() - 1, 2).getValues();
      for (var i = vals.length - 1; i >= 0; i--) if (vals[i][0] === 'log-' + m && want[String(vals[i][1])]) removed.deleteRow(i + 2);
    }
    return { restored: moved.length };
  });
}

function archiveQuery(m, site, from, to) {
  var u = user_();
  need_(u, 'Supervisor', 'Only supervisors and managers can search the archive.');
  if (!TAB_NAMES[m]) throw new Error('DENIED: Unknown log.');
  if (!siteOk_(allowedIds_(u), String(site))) throw new Error('DENIED: Your account is not set up for that site.');
  var out = [], reg = archiveRegistry_()[site] || {};
  Object.keys(reg).sort().reverse().forEach(function (year) {
    if (out.length >= 3000) return;
    if (/^\d{4}$/.test(year) && ((from && year < from.slice(0, 4)) || (to && year > to.slice(0, 4)))) return;
    var book; try { book = SpreadsheetApp.openById(reg[year]); } catch (e) { return; }
    var sh = book.getSheetByName(TAB_NAMES[m]);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
      if (r[0] !== 'arch-' + m || out.length >= 3000) return;
      var d; try { d = JSON.parse(r[4]); } catch (e) { return; }
      if (String(d.site) !== String(site)) return;
      var date = d.date || String(d.createdAt || '').slice(0, 10);
      if ((from && date < from) || (to && date > to)) return;
      out.push(d);
    });
  });
  return out;
}

function archiveRegistry_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('archiveBooks') || '{}'); }
function archiveBook_(siteId, year) {
  var props = PropertiesService.getScriptProperties(), reg = archiveRegistry_();
  var id = reg[siteId] && reg[siteId][year];
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ } }
  var ss = SpreadsheetApp.create('NH Site Docs Archive – ' + siteName_(siteId) + ' – ' + year);
  DriveApp.getFileById(ss.getId()).moveTo(child_(siteFolder_(siteId), 'Archive'));
  reg[siteId] = reg[siteId] || {};
  reg[siteId][year] = ss.getId();
  props.setProperty('archiveBooks', JSON.stringify(reg));
  return ss;
}
function archiveBooks_(site, year, allowed) {
  var reg = archiveRegistry_(), out = [];
  Object.keys(reg).forEach(function (s) {
    if (site && s !== String(site)) return;
    if (!siteOk_(allowed, s)) return;
    Object.keys(reg[s]).forEach(function (y) {
      if (year && y !== String(year)) return;
      try { out.push(SpreadsheetApp.openById(reg[s][y])); } catch (e) {}
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
  var vals = src.getRange(2, 1, n - 1, srcHead.length).getValues(), out = [], rows = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (r[0] !== fromC || !want[String(r[1])]) continue;
    if (allowed) { var d = null; try { d = JSON.parse(r[4]); } catch (e) {} if (!siteOk_(allowed, d && d.site)) continue; }
    var row = dstHead.map(function () { return ''; });
    srcHead.forEach(function (h, j) { var k = dstHead.indexOf(h); if (k >= 0) row[k] = r[j]; });
    row[0] = toC; if (ts) row[2] = ts; row[3] = false;
    out.push(row); rows.push(i + 2); moved.push(String(r[1]));
  }
  if (out.length) dst.getRange(dst.getLastRow() + 1, 1, out.length, dstHead.length).setValues(out);
  for (var x = rows.length - 1; x >= 0; x--) src.deleteRow(rows[x]);
  return moved;
}

/* ---------------- Google Docs for formal reports (runs every 5 minutes) ---------------- */

/** Creates or updates a Google Doc for each formal report changed since its Doc was last written. */
function syncDocs() {
  var started = Date.now(), done = 0, cfg = readConfig_();
  Object.keys(FORMAL).forEach(function (m) {
    var sh = tab_('log-' + m), n = sh.getLastRow();
    if (n < 2) return;
    var head = ensureHeaders_(sh, DOC_COLS);
    var iDoc = head.indexOf('Google Doc'), iUpd = head.indexOf('Doc Updated');
    var vals = sh.getRange(2, 1, n - 1, head.length).getValues();
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

/* ---------------- Drive folders: <records>/<Site>/<Year>/<Report type>, <records>/<Site>/Archive ---------------- */

function rootFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('rootFolderId');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ } }
  var parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  var base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var f = child_(base, 'NH Site Docs – Records');
  props.setProperty('rootFolderId', f.getId());
  return f;
}
function siteFolder_(siteId) {
  var props = PropertiesService.getScriptProperties(), map = JSON.parse(props.getProperty('siteFolders') || '{}');
  var name = siteName_(siteId);
  if (map[siteId]) {
    try { var f = DriveApp.getFolderById(map[siteId]); if (f.getName() !== name) f.setName(name); return f; } catch (e) { /* recreate below */ }
  }
  var nf = rootFolder_().createFolder(name);
  map[siteId] = nf.getId();
  props.setProperty('siteFolders', JSON.stringify(map));
  return nf;
}
function child_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ---------------- Helpers ---------------- */

function check_(c, id) {
  if (!COLLECTION_RE.test(String(c))) throw new Error('DENIED: Unknown record type.');
  if (!ID_RE.test(String(id))) throw new Error('DENIED: Invalid record id.');
}
function tab_(c) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), m = String(c).replace(/^log-/, '');
  var name = c.indexOf('log-') === 0 && TAB_NAMES[m] ? TAB_NAMES[m]
    : c.indexOf('inv-') === 0 ? 'Inventory'
    : /\/staff$/.test(c) ? 'Staff'
    : /\/participants$/.test(c) ? 'Participants'
    : /\/schedule$/.test(c) ? 'Schedule'
    : c === 'config' ? 'Setup' : c === 'checks' ? 'Shift Checks' : 'Other';
  return tabByName_(ss, name);
}
function tabByName_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, FIXED.length).setValues([FIXED]).setFontWeight('bold').setBackground('#efe2d4');
    sh.setFrozenRows(1);
    sh.hideColumns(3, 3); // timestamps + raw JSON are for the app; people read the columns to the right
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
function nextTs_(tabName) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('ts')) || 0;
  var ts = Math.max(Date.now(), last + 1);
  var tabTs = JSON.parse(props.getProperty('tabTs') || '{}');
  tabTs[tabName] = ts;
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

/* Functions the app may call (doPost). */
var API_ = { whoami: whoami, changes: changes, put: put, remove: remove, archiveMove: archiveMove, archiveRestore: archiveRestore, archiveQuery: archiveQuery };
