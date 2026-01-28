/***********************************************************
 * DriveHit Backend - code.gs
 * Enterprise SaaS Backend (Google Apps Script)
 * Version: 1.0.0
 ***********************************************************/

/* =========================================================
   GLOBAL CONFIG
========================================================= */

const CFG = {
  API_VER: "v1",
  MAX_PAGE: 100,
  DEF_PAGE: 24,
  REQ_TTL: 300000, // 5 min
  CACHE_TTL: 300, // seconds
  RATE_LIMIT: 300, // per hour
  LOG: true
};


/* =========================================================
   ENTRYPOINTS
========================================================= */

/**
 * HTTP GET
 */
function doGet(e) {
  return main_(e, "GET");
}

/**
 * HTTP POST
 */
function doPost(e) {
  return main_(e, "POST");
}


/**
 * Main dispatcher
 */
function main_(e, method) {
  try {
    const req = parseReq_(e, method);
    const res = routeReq_(req);

    return jsonOut_(res);

  } catch (err) {
    logErr_(err);

    return jsonOut_({
      ok: false,
      error: err.message || "SERVER_ERROR"
    }, 500);
  }
}


/* =========================================================
   REQUEST PARSER
========================================================= */

function parseReq_(e, method) {

  const p = e.parameter || {};
  const h = e.headers || {};
  const b = e.postData ? e.postData.contents : null;

  let body = null;

  if (b) {
    try {
      body = JSON.parse(b);
    } catch (err) {
      body = null;
    }
  }

  return {
    method: method,
    path: (p.path || "").replace(/^\/+/, ""),
    query: p,
    headers: h,
    body: body,
    raw: e
  };
}


/* =========================================================
   ROUTER
========================================================= */

function routeReq_(req) {

  const seg = req.path.split("/").filter(Boolean);

  if (!seg.length) {
    return apiInfo_();
  }

  const ver = seg[0];

  if (ver !== CFG.API_VER) {
    return err_("INVALID_VERSION");
  }

  const mod = seg[1] || "";

  switch (mod) {

    case "items":
      return itemsApi_(req, seg);

    case "engagement":
      return engageApi_(req, seg);

    case "admin":
      return adminApi_(req, seg);

    case "revalidate":
      return isrApi_(req, seg);

    case "users":
      return usersApi_(req, seg);

    default:
      return err_("NOT_FOUND");
  }
}


/* =========================================================
   API ROOT
========================================================= */

function apiInfo_() {

  return {
    ok: true,
    name: "DriveHit API",
    version: CFG.API_VER,
    ts: Date.now()
  };
}


/* =========================================================
   ITEMS API (PUBLIC)
========================================================= */

function itemsApi_(req, seg) {

  if (req.method !== "GET") {
    return err_("METHOD_NOT_ALLOWED");
  }

  return listItems_(req);
}


/* =========================================================
   ENGAGEMENT API
========================================================= */

function engageApi_(req) {

  if (req.method !== "POST") {
    return err_("METHOD_NOT_ALLOWED");
  }

  verifySig_(req);

  return handleEngage_(req);
}


/* =========================================================
   ADMIN API
========================================================= */

function adminApi_(req) {

  verifyAdmin_(req);

  return handleAdmin_(req);
}


/* =========================================================
   ISR API
========================================================= */

function isrApi_(req) {

  verifyIsr_(req);

  return handleIsr_(req);
}


/* =========================================================
   USERS API
========================================================= */

function usersApi_(req) {

  if (req.method !== "POST") {
    return err_("METHOD_NOT_ALLOWED");
  }

  verifySig_(req);

  return handleUser_(req);
}


/* =========================================================
   RESPONSE HELPERS
========================================================= */

function jsonOut_(obj, code) {

  const out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);

  if (code) {
    out.setResponseCode(code);
  }

  return out;
}


function err_(msg) {

  return {
    ok: false,
    error: msg
  };
}


/* =========================================================
   PROPERTY HELPERS
========================================================= */

function prop_(k) {

  return PropertiesService
    .getScriptProperties()
    .getProperty(k);
}


function propReq_(k) {

  const v = prop_(k);

  if (!v) {
    throw new Error("MISSING_PROP_" + k);
  }

  return v;
}


/* =========================================================
   LOGGING
========================================================= */

function log_(msg) {

  if (!CFG.LOG) return;

  console.log("[DriveHit]", msg);
}


function logErr_(e) {

  console.error("[DriveHit ERR]", e, e.stack);
}


/* =========================================================
   UTILS
========================================================= */

function now_() {
  return Date.now();
}


function uid_() {
  return Utilities.getUuid();
}


function hash_(s) {

  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    s
  ).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}


function hmac_(s, key) {

  return Utilities.computeHmacSha256Signature(
    s,
    key
  ).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}


function sleep_(ms) {
  Utilities.sleep(ms);
}


function clamp_(v, min, max) {
  return Math.min(Math.max(v, min), max);
}


function toInt_(v, d) {

  v = parseInt(v, 10);

  return isNaN(v) ? d : v;
}

/* =========================================================
   AUTH / SECURITY CORE
========================================================= */


/* =========================================================
   SIGNATURE VERIFICATION
========================================================= */

/**
 * Verify signed client request (Next.js, SDK, etc)
 * Headers:
 *  x-ts
 *  x-sig
 */
function verifySig_(req) {

  const ts = req.headers["x-ts"];
  const sig = req.headers["x-sig"];

  if (!ts || !sig) {
    throw new Error("MISSING_SIGNATURE");
  }

  const now = now_();

  if (Math.abs(now - Number(ts)) > CFG.REQ_TTL) {
    throw new Error("EXPIRED_REQUEST");
  }

  const secret = propReq_("API_SIGNING_SECRET");

  const base = [
    req.method,
    req.path,
    ts,
    JSON.stringify(req.body || {})
  ].join("|");

  const calc = hmac_(base, secret);

  if (calc !== sig) {
    throw new Error("INVALID_SIGNATURE");
  }

  rateCheck_(req);
}


/* =========================================================
   READ SIGNATURE (PREMIUM READ)
========================================================= */

function verifyReadSig_(req) {

  const sig = req.headers["x-read-sig"];
  const ts = req.headers["x-read-ts"];

  if (!sig || !ts) {
    throw new Error("MISSING_READ_SIG");
  }

  if (Math.abs(now_() - ts) > CFG.REQ_TTL) {
    throw new Error("EXPIRED_READ");
  }

  const sec = propReq_("API_READ_SECRET");

  const base = req.path + "|" + ts;

  if (hmac_(base, sec) !== sig) {
    throw new Error("INVALID_READ_SIG");
  }
}


/* =========================================================
   ADMIN AUTH
========================================================= */

function verifyAdmin_(req) {

  verifySig_(req);

  const email = req.headers["x-user-email"];

  if (!email) {
    throw new Error("NO_ADMIN_EMAIL");
  }

  const admins = propReq_("ADMIN_EMAILS")
    .split(",")
    .map(e => e.trim());

  if (admins.indexOf(email) === -1) {
    throw new Error("NOT_ADMIN");
  }
}


/* =========================================================
   ISR AUTH
========================================================= */

function verifyIsr_(req) {

  const sec = propReq_("NEXTJS_ISR_SECRET");

  const s = req.headers["x-isr-secret"];

  if (!s || s !== sec) {
    throw new Error("INVALID_ISR_SECRET");
  }
}


/* =========================================================
   RATE LIMITING
========================================================= */

function rateCheck_(req) {

  const ip =
    req.headers["x-forwarded-for"] ||
    req.headers["client-ip"] ||
    "na";

  const key = "rl:" + ip;

  const cache = CacheService.getScriptCache();

  let v = cache.get(key);

  if (!v) {
    cache.put(key, "1", 3600);
    return;
  }

  v = Number(v) + 1;

  if (v > CFG.RATE_LIMIT) {
    throw new Error("RATE_LIMIT");
  }

  cache.put(key, String(v), 3600);
}


/* =========================================================
   ABUSE TRACKING
========================================================= */

function abuseLog_(req, reason) {

  try {

    const sh = getSysSheet_("abuse");

    sh.appendRow([
      now_(),
      req.headers["x-forwarded-for"] || "",
      req.headers["user-agent"] || "",
      reason,
      JSON.stringify(req.body || {})
    ]);

  } catch (e) {
    logErr_(e);
  }
}


/* =========================================================
   VALIDATION
========================================================= */

function need_(v, name) {

  if (v === undefined || v === null || v === "") {
    throw new Error("MISSING_" + name);
  }

  return v;
}


function needNum_(v, name) {

  v = Number(v);

  if (isNaN(v)) {
    throw new Error("INVALID_" + name);
  }

  return v;
}


function needStr_(v, name, max) {

  if (!v || typeof v !== "string") {
    throw new Error("INVALID_" + name);
  }

  if (max && v.length > max) {
    throw new Error("TOO_LONG_" + name);
  }

  return v.trim();
}


/* =========================================================
   REQUEST FINGERPRINT
========================================================= */

function fp_(req) {

  return hash_([
    req.headers["user-agent"] || "",
    req.headers["x-forwarded-for"] || "",
    req.headers["accept-language"] || ""
  ].join("|"));
}





/* =========================================================
   SHEETS DATABASE LAYER
========================================================= */


/* =========================================================
   TABLE DEFINITIONS
========================================================= */

const DB = {

  items: {
    sheet: "items",
    cols: [
      "id",
      "name",
      "slug",
      "type",
      "mime",
      "url",
      "thumb",
      "size",
      "cat",
      "tags",
      "likes",
      "comments",
      "views",
      "created",
      "updated",
      "status",
      "hash"
    ]
  },

  users: {
    sheet: "users",
    cols: [
      "id",
      "email",
      "name",
      "created",
      "last",
      "meta"
    ]
  },

  engage: {
    sheet: "engagement",
    cols: [
      "id",
      "item",
      "type",
      "user",
      "val",
      "created"
    ]
  },

  abuse: {
    sheet: "abuse",
    cols: [
      "ts",
      "ip",
      "ua",
      "reason",
      "data"
    ]
  },

  jobs: {
    sheet: "jobs",
    cols: [
      "id",
      "type",
      "status",
      "data",
      "created",
      "updated"
    ]
  }

};


/* =========================================================
   SPREADSHEET ACCESS
========================================================= */

function db_() {

  const props = PropertiesService.getScriptProperties();

  let id = props.getProperty("DB_ID");

  let ss;

  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {

    ss = SpreadsheetApp.create("DriveHit-DB");

    props.setProperty("DB_ID", ss.getId());
  }

  return ss;
}


/* =========================================================
   GET OR CREATE SHEET
========================================================= */

function getSysSheet_(name) {

  const ss = db_();

  let sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);
  }

  bootSheet_(sh, name);

  return sh;
}


/* =========================================================
   BOOTSTRAP SHEET
========================================================= */

function bootSheet_(sh, name) {

  const def = DB[name];

  if (!def) {
    throw new Error("UNKNOWN_TABLE_" + name);
  }

  const rng = sh.getRange(1, 1, 1, def.cols.length);

  const vals = rng.getValues()[0];

  let ok = true;

  for (let i = 0; i < def.cols.length; i++) {

    if (vals[i] !== def.cols[i]) {
      ok = false;
      break;
    }
  }

  if (!ok) {

    sh.clear();

    sh.getRange(1, 1, 1, def.cols.length)
      .setValues([def.cols]);

    sh.setFrozenRows(1);
  }
}


/* =========================================================
   LOCK
========================================================= */

function dbLock_(fn) {

  const lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}


/* =========================================================
   INDEX CACHE
========================================================= */

function idxKey_(tbl) {
  return "idx:" + tbl;
}


function getIdx_(tbl) {

  const cache = CacheService.getScriptCache();

  const k = idxKey_(tbl);

  let v = cache.get(k);

  if (v) {
    return JSON.parse(v);
  }

  const idx = buildIdx_(tbl);

  cache.put(k, JSON.stringify(idx), CFG.CACHE_TTL);

  return idx;
}


function clearIdx_(tbl) {

  CacheService
    .getScriptCache()
    .remove(idxKey_(tbl));
}


function buildIdx_(tbl) {

  const sh = getSysSheet_(tbl);

  const data = sh.getDataRange().getValues();

  const idx = {};

  for (let i = 1; i < data.length; i++) {

    const id = data[i][0];

    if (id) {
      idx[id] = i + 1;
    }
  }

  return idx;
}


/* =========================================================
   CRUD CORE
========================================================= */

function dbGet_(tbl, id) {

  const idx = getIdx_(tbl);

  const row = idx[id];

  if (!row) return null;

  const sh = getSysSheet_(tbl);

  const def = DB[tbl];

  const v = sh
    .getRange(row, 1, 1, def.cols.length)
    .getValues()[0];

  return rowToObj_(def, v);
}


function dbList_(tbl) {

  const sh = getSysSheet_(tbl);

  const def = DB[tbl];

  const data = sh.getDataRange().getValues();

  const res = [];

  for (let i = 1; i < data.length; i++) {

    if (!data[i][0]) continue;

    res.push(rowToObj_(def, data[i]));
  }

  return res;
}


function dbPut_(tbl, obj) {

  return dbLock_(function () {

    const sh = getSysSheet_(tbl);

    const def = DB[tbl];

    const idx = getIdx_(tbl);

    let row = idx[obj.id];

    const vals = def.cols.map(c => obj[c] || "");

    if (row) {

      sh.getRange(row, 1, 1, vals.length)
        .setValues([vals]);

    } else {

      sh.appendRow(vals);
    }

    clearIdx_(tbl);

    return obj;
  });
}


function dbDel_(tbl, id) {

  return dbLock_(function () {

    const idx = getIdx_(tbl);

    const row = idx[id];

    if (!row) return false;

    const sh = getSysSheet_(tbl);

    sh.deleteRow(row);

    clearIdx_(tbl);

    return true;
  });
}


/* =========================================================
   ROW HELPERS
========================================================= */

function rowToObj_(def, row) {

  const o = {};

  for (let i = 0; i < def.cols.length; i++) {
    o[def.cols[i]] = row[i];
  }

  return o;
}


/* =========================================================
   SEARCH TOKENIZER
========================================================= */

function tokenize_(s) {

  if (!s) return [];

  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}




/* =========================================================
   DRIVE INGESTION PIPELINE
========================================================= */


/* =========================================================
   JOB QUEUE
========================================================= */

function newJob_(type, data) {

  const job = {
    id: uid_(),
    type: type,
    status: "pending",
    data: JSON.stringify(data || {}),
    created: now_(),
    updated: now_()
  };

  dbPut_("jobs", job);

  return job;
}


function nextJob_() {

  const jobs = dbList_("jobs");

  for (let j of jobs) {

    if (j.status === "pending") {
      return j;
    }
  }

  return null;
}


function setJob_(id, status, data) {

  const j = dbGet_("jobs", id);

  if (!j) return;

  j.status = status;
  j.updated = now_();

  if (data) {
    j.data = JSON.stringify(data);
  }

  dbPut_("jobs", j);
}


/* =========================================================
   DRIVE SCAN
========================================================= */

function scanDrive_(folderId) {

  const root = folderId
    ? DriveApp.getFolderById(folderId)
    : DriveApp.getRootFolder();

  walkFolder_(root);
}


function walkFolder_(folder) {

  const files = folder.getFiles();

  while (files.hasNext()) {

    const f = files.next();

    enqueueFile_(f);
  }

  const subs = folder.getFolders();

  while (subs.hasNext()) {

    walkFolder_(subs.next());
  }
}


/* =========================================================
   FILE QUEUE
========================================================= */

function enqueueFile_(file) {

  const job = newJob_("ingest", {
    id: file.getId(),
    name: file.getName(),
    mime: file.getMimeType()
  });

  log_("Queued file " + job.id);
}


/* =========================================================
   WORKER
========================================================= */

function runWorker_() {

  const j = nextJob_();

  if (!j) return;

  try {

    setJob_(j.id, "running");

    const data = JSON.parse(j.data || "{}");

    switch (j.type) {

      case "ingest":
        ingestFile_(data);
        break;

      case "reindex":
        reindexAll_();
        break;
    }

    setJob_(j.id, "done");

  } catch (e) {

    setJob_(j.id, "error", {
      msg: e.message,
      stack: e.stack
    });

    logErr_(e);
  }
}


/* =========================================================
   FILE INGESTION
========================================================= */

function ingestFile_(data) {

  const fid = data.id;

  const f = DriveApp.getFileById(fid);

  const hash = hash_(f.getBlob().getBytes());

  const existing = findByHash_(hash);

  if (existing) {
    return;
  }

  const item = {

    id: uid_(),

    name: f.getName(),

    slug: slug_(f.getName()),

    type: classify_(f),

    mime: f.getMimeType(),

    url: f.getUrl(),

    thumb: getThumb_(f),

    size: f.getSize(),

    cat: "",

    tags: "",

    likes: 0,

    comments: 0,

    views: 0,

    created: now_(),

    updated: now_(),

    status: "active",

    hash: hash
  };


  const meta = aiMeta_(item);

  if (meta) {

    item.cat = meta.cat;
    item.tags = meta.tags;
  }

  dbPut_("items", item);

  queueIsr_(item.slug);
}


/* =========================================================
   DEDUP
========================================================= */

function findByHash_(h) {

  const list = dbList_("items");

  for (let it of list) {

    if (it.hash === h) {
      return it;
    }
  }

  return null;
}


/* =========================================================
   CLASSIFICATION
========================================================= */

function classify_(file) {

  const m = file.getMimeType();

  if (m.indexOf("image") === 0) return "image";
  if (m.indexOf("video") === 0) return "video";
  if (m.indexOf("pdf") !== -1) return "pdf";

  return "file";
}


/* =========================================================
   THUMBNAIL
========================================================= */

function getThumb_(file) {

  try {

    const t = Drive.Files.get(file.getId(), {
      fields: "thumbnailLink"
    });

    return t.thumbnailLink || "";

  } catch (e) {

    return "";
  }
}


/* =========================================================
   AI METADATA (GEMINI)
========================================================= */

function aiMeta_(item) {

  const key = prop_("GEMINI_API_KEY");

  if (!key) return null;

  try {

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=" +
      key;

    const payload = {
      contents: [{
        parts: [{
          text:
            "Describe and categorize this file: " +
            item.name
        }]
      }]
    };

    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const json = JSON.parse(res.getContentText());

    const txt =
      json.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return parseMeta_(txt);

  } catch (e) {

    logErr_(e);

    return null;
  }
}


function parseMeta_(txt) {

  if (!txt) return null;

  const parts = txt.split("\n");

  return {
    cat: parts[0] || "",
    tags: parts.slice(1).join(",")
  };
}


/* =========================================================
   SLUG
========================================================= */

function slug_(s) {

  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


/* =========================================================
   REINDEX
========================================================= */

function reindexAll_() {

  const list = dbList_("items");

  for (let it of list) {

    it.slug = slug_(it.name);

    dbPut_("items", it);
  }
}




/* =========================================================
   PUBLIC ITEMS API
========================================================= */

function listItems_(req) {

  const q = req.query;

  const page = clamp_(toInt_(q.page, 1), 1, 10000);
  const size = clamp_(toInt_(q.size, CFG.DEF_PAGE), 1, CFG.MAX_PAGE);

  const cat = q.cat || "";
  const search = q.q || "";

  let list = dbList_("items");

  // status filter
  list = list.filter(i => i.status === "active");

  // category filter
  if (cat) {
    list = list.filter(i => i.cat === cat);
  }

  // search
  if (search) {

    const tok = tokenize_(search);

    list = list.filter(i => {

      const s = [
        i.name,
        i.tags,
        i.cat
      ].join(" ").toLowerCase();

      return tok.every(t => s.indexOf(t) !== -1);
    });
  }

  // sort newest first
  list.sort((a, b) => b.created - a.created);

  const total = list.length;

  const from = (page - 1) * size;

  const items = list.slice(from, from + size);

  return {
    ok: true,
    page: page,
    size: size,
    total: total,
    items: items
  };
}


/* =========================================================
   ENGAGEMENT
========================================================= */

function handleEngage_(req) {

  const b = req.body || {};

  const type = needStr_(b.type, "type", 20);
  const item = needStr_(b.item, "item", 40);

  const uid = needStr_(b.user, "user", 40);

  const fp = fp_(req);

  const id = hash_([item, uid, type, fp].join("|"));

  let rec = dbGet_("engage", id);

  if (rec) {
    return { ok: true };
  }

  rec = {
    id: id,
    item: item,
    type: type,
    user: uid,
    val: 1,
    created: now_()
  };

  dbPut_("engage", rec);

  updateCounts_(item, type);

  return { ok: true };
}


function updateCounts_(itemId, type) {

  const it = dbGet_("items", itemId);

  if (!it) return;

  if (type === "like") it.likes++;
  if (type === "comment") it.comments++;
  if (type === "view") it.views++;

  it.updated = now_();

  dbPut_("items", it);
}


/* =========================================================
   USERS
========================================================= */

function handleUser_(req) {

  const b = req.body || {};

  const email = needStr_(b.email, "email", 100);

  let u = findUser_(email);

  if (!u) {

    u = {
      id: uid_(),
      email: email,
      name: b.name || "",
      created: now_(),
      last: now_(),
      meta: JSON.stringify(b.meta || {})
    };

  } else {

    u.last = now_();
  }

  dbPut_("users", u);

  return {
    ok: true,
    id: u.id
  };
}


function findUser_(email) {

  const list = dbList_("users");

  for (let u of list) {

    if (u.email === email) {
      return u;
    }
  }

  return null;
}


/* =========================================================
   ISR (NEXT.JS REVALIDATION)
========================================================= */

const ISR_Q = [];


function queueIsr_(slug) {

  if (!slug) return;

  ISR_Q.push(slug);

  if (ISR_Q.length >= 10) {
    flushIsr_();
  }
}


function flushIsr_() {

  if (!ISR_Q.length) return;

  const url = prop_("NEXTJS_ISR_ENDPOINT");

  if (!url) return;

  const sec = propReq_("NEXTJS_ISR_SECRET");

  const batch = ISR_Q.splice(0, ISR_Q.length);

  try {

    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-isr-secret": sec
      },
      payload: JSON.stringify({
        slugs: batch
      }),
      muteHttpExceptions: true
    });

  } catch (e) {

    logErr_(e);
  }
}


function handleIsr_() {

  flushIsr_();

  return { ok: true };
}


/* =========================================================
   ADMIN API
========================================================= */

function handleAdmin_(req) {

  const b = req.body || {};

  const act = needStr_(b.action, "action", 40);

  switch (act) {

    case "scan":
      scanDrive_(b.folder || null);
      return { ok: true };

    case "worker":
      runWorker_();
      return { ok: true };

    case "reindex":
      newJob_("reindex", {});
      return { ok: true };

    case "disable":
      return adminDisable_(b.id);

    case "enable":
      return adminEnable_(b.id);

    case "purge":
      return adminPurge_(b.id);

    default:
      throw new Error("UNKNOWN_ADMIN_ACTION");
  }
}


function adminDisable_(id) {

  needStr_(id, "id", 40);

  const it = dbGet_("items", id);

  if (!it) throw new Error("NOT_FOUND");

  it.status = "disabled";
  it.updated = now_();

  dbPut_("items", it);

  queueIsr_(it.slug);

  return { ok: true };
}


function adminEnable_(id) {

  needStr_(id, "id", 40);

  const it = dbGet_("items", id);

  if (!it) throw new Error("NOT_FOUND");

  it.status = "active";
  it.updated = now_();

  dbPut_("items", it);

  queueIsr_(it.slug);

  return { ok: true };
}


function adminPurge_(id) {

  needStr_(id, "id", 40);

  dbDel_("items", id);

  return { ok: true };
}


/* =========================================================
   BOOTSTRAP / TRIGGERS
========================================================= */

function bootstrap_() {

  // ensure sheets
  Object.keys(DB).forEach(getSysSheet_);

  // worker every 5 min
  ScriptApp.newTrigger("runWorker_")
    .timeBased()
    .everyMinutes(5)
    .create();

  // ISR flush every 10 min
  ScriptApp.newTrigger("flushIsr_")
    .timeBased()
    .everyMinutes(10)
    .create();
}


function resetTriggers_() {

  ScriptApp.getProjectTriggers()
    .forEach(t => ScriptApp.deleteTrigger(t));

  bootstrap_();
}



