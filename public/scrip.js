/******************************************************
 * GLOBAL CONFIGURATION (SOURCE OF TRUTH)
 * No logic. No side effects.
 ******************************************************/
const CONFIG = Object.freeze({

  /***********************
 * SPREADSHEET
 ***********************/
SPREADSHEET: {
  ID: '18iEczWgmqnvPtrkTUgfiIpkgavryc62BLyQX5BGd-6A'
},

  /***********************
   * DRIVE STRUCTURE
   ***********************/
  DRIVE: {
    ROOT_FOLDER: 'UploadedForWeb',
    UNCATEGORIZED: 'Uncategorized',
    AUTO_CATEGORIZED: 'AutoCategorized',
    OTHER_CATEGORY: 'Other',
    ARCHIVED: 'Archived'
  },

  /***********************
   * SHEETS (DATABASE)
   ***********************/
  SHEETS: {
    ITEMS: 'ItemsDB',
    ARCHIVED: 'ArchivedItems',
    USERS: 'Users',
    COMMENTS: 'Comments',
    LIKES: 'Likes'
  },

  /***********************
   * ITEM STATUS
   ***********************/
  STATUS: {
    PUBLISHED: 'published',
    HIDDEN: 'hidden',
    ARCHIVED: 'archived'
  },

  /***********************
   * INGESTION & SYNC
   ***********************/
  INGESTION: {
    SCAN_INTERVAL_MINUTES: 1,
    HASH_ALGORITHM: Utilities.DigestAlgorithm.MD5
  },

  /***********************
   * CLASSIFICATION (AI / RULES)
   ***********************/
  CLASSIFICATION: {
    ENABLE_GEMINI: true,

    // Contractually locked
    CATEGORY_DEPTH: 1,            // single-level only
    FALLBACK_CATEGORY: 'Other',

    // Safety + quotas
    RATE_LIMIT_MS: 1200,          // ≈50/min
    MAX_RETRIES: 3,
    INITIAL_BACKOFF_MS: 1000
  },

  /***********************
   * IMAGE & CDN
   ***********************/
  IMAGE: {
    CDN_BASE: 'https://lh3.googleusercontent.com/d/',
    DEFAULT_QUALITY_SUFFIX: '=s2048'
  },

  /***********************
   * API (NEXT.JS)
   ***********************/
  API: {
    VERSION: 'v1',
    PAGE_SIZE_DEFAULT: 24,
    PAGE_SIZE_MAX: 100
  },

  /***********************
   * AUTHENTICATION
   ***********************/
  AUTH: {
    USER_IDENTITY_FIELD: 'email'
  },

  /***********************
   * NEXT.JS ISR
   ***********************/
  ISR: {
    ENABLED: true,
    REVALIDATE_URL: 'https://drivehit.vercel.app/api/v1/revalidate'
  }

});




/******************************************************
 * ABUSE DETECTION
 ******************************************************/

function flagAbuse_(identifier, reason) {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'AbuseLog',
    ['Identifier', 'Reason', 'Count', 'LastSeen']
  );

  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === identifier) {
      sheet.getRange(i + 1, 3).setValue(rows[i][2] + 1);
      sheet.getRange(i + 1, 4).setValue(new Date());
      return;
    }
  }

  sheet.appendRow([identifier, reason, 1, new Date()]);
}

function isAbusive_(identifier) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('AbuseLog');
  if (!sheet) return false;

  const rows = sheet.getDataRange().getValues();
  return rows.some(r => r[0] === identifier && r[2] >= 5);
}

/*
//Enforcement example

if (isAbusive_(body.email)) {
  return errorResponse_('Account temporarily restricted', 403);
}

*/



/******************************************************
 * ADMIN AUTH
 ******************************************************/

function verifyAdmin_(e) {
  verifyRequest_(e);

  const body = JSON.parse(e.postData.contents);
  const email = body.email;

  if (!isAdminEmail_(email)) {
    throw new Error('Admin access required');
  }
}

function isAdminEmail_(email) {
  const admins = PropertiesService.getScriptProperties()
    .getProperty('ADMIN_EMAILS');

  return admins && admins.split(',').includes(email);
}


/******************************************************
 * ADMIN API
 ******************************************************/

function adminAPI_(e) {
  verifyAdmin_(e);

  const body = JSON.parse(e.postData.contents);

  if (body.action === 'approve') {
    applyModeration_(body.row);
  }

  if (body.action === 'reindex') {
    indexItem_(body.assetId);
  }

  if (body.action === 'reclassify') {
    reclassifyFile_(body.fileId);
  }

  return jsonResponse_({ success: true });
}


/******************************************************
 * API AUTH SERVICE (HMAC)
 ******************************************************/

const API_SECRET_PROP = 'API_WEBHOOK_SECRET';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function verifyRequest_(e) {
  const secret = PropertiesService.getScriptProperties()
    .getProperty(API_SECRET_PROP);

  if (!secret) throw new Error('API secret not configured');

  const headers = e.headers || {};
  const timestamp = headers['X-Timestamp'];
  const signature = headers['X-Signature'];

  if (!timestamp || !signature) {
    throw new Error('Missing auth headers');
  }

  const age = Math.abs(Date.now() - Number(timestamp));
  if (age > MAX_CLOCK_SKEW_MS) {
    throw new Error('Request expired');
  }

  const method = e.method;
  const path = e.pathInfo || '/';
  const body = e.postData ? e.postData.contents : '';

  const base = `${timestamp}.${method}.${path}.${body}`;

  const computed = Utilities.computeHmacSha256Signature(
    base,
    secret
  );

  const computedHex = computed
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2))
    .join('');

  if (computedHex !== signature) {
    throw new Error('Invalid signature');
  }
}


/******************************************************
 * COMMENTS API
 ******************************************************/

function commentAPI_(e) {
  const body = JSON.parse(e.postData.contents);

  if (!body.email || !body.comment || !body.url) {
    return errorResponse_('Invalid payload', 400);
  }

  appendComment_(body);

  queueISR_(body.url);

  return jsonResponse_({ success: true });
}


/******************************************************
 * API CONTROLLER
 *
 * Responsibility:
 * - Public + signed API surface for Next.js
 * - Versioning (/v1)
 * - Rate limiting
 * - Webhook verification
 * - JSON-safe responses
 ******************************************************/

/**
 * Entry point (GET)
 */
function doGet(e) {
  try {
    return routeRequest_('GET', e);
  } catch (err) {
    return jsonError_(err);
  }
}

/**
 * Entry point (POST)
 */
function doPost(e) {
  try {
    return routeRequest_('POST', e);
  } catch (err) {
    return jsonError_(err);
  }
}

/**
 * Main router
 */
function routeRequest_(method, e) {
  const path = (e.pathInfo || '').replace(/^\/+/, '');
  const parts = path.split('/');

  // Enforce versioning
  if (parts[0] !== 'v1') {
    throw new Error('Unsupported API version');
  }

  // Security gates
  enforceRateLimit_(e);
  verifyWebhookIfPresent_(e);

  switch (parts[1]) {
    case 'items':
      return handleItems_(method, e);

    case 'engagement':
      return handleEngagement_(method, e);

    case 'users':
      return handleUsers_(method, e);

    case 'revalidate':
      return handleISR_(method, e);

    default:
      throw new Error('Unknown endpoint');
  }
}

/******************************************************
 * ITEMS
 ******************************************************/
function handleItems_(method, e) {
  if (method !== 'GET') throw new Error('Method not allowed');

  const params = e.parameter || {};
  const items = queryAssets_(params);

  return jsonResponse_({
    success: true,
    data: items
  });
}

/******************************************************
 * ENGAGEMENT (Likes / Comments)
 ******************************************************/
function handleEngagement_(method, e) {
  const body = parseJsonBody_(e);
  const user = requireUser_(e);

  if (method === 'POST') {
    switch (body.action) {
      case 'like':
        return jsonResponse_(toggleLike_(body.assetId, user));

      case 'comment':
        return jsonResponse_(
          addComment_(body.assetId, body.text, user)
        );

      default:
        throw new Error('Invalid engagement action');
    }
  }

  if (method === 'GET') {
    if (!e.parameter.assetId) {
      throw new Error('assetId required');
    }

    return jsonResponse_(
      getAssetEngagement_(e.parameter.assetId)
    );
  }

  throw new Error('Method not allowed');
}

/******************************************************
 * USERS
 ******************************************************/
function handleUsers_(method, e) {
  const user = requireUser_(e);

  if (method === 'GET') {
    return jsonResponse_({
      success: true,
      user: normalizeUser_(user)
    });
  }

  throw new Error('Method not allowed');
}

/******************************************************
 * ISR REVALIDATION (Next.js)
 ******************************************************/
function handleISR_(method, e) {
  if (method !== 'POST') throw new Error('Method not allowed');

  verifyWebhookSecret_(e);

  const body = parseJsonBody_(e);
  if (!body.paths || !Array.isArray(body.paths)) {
    throw new Error('paths[] required');
  }

  queueISRPaths_(body.paths);

  return jsonResponse_({ success: true });
}

/******************************************************
 * SECURITY
 ******************************************************/
function requireUser_(e) {
  const email =
    e.parameter.email ||
    e.headers?.['X-User-Email'];

  if (!email) throw new Error('Unauthenticated');

  const user = getUserByEmail_(email);
  if (!user) throw new Error('Unknown user');

  return user;
}

function enforceRateLimit_(e) {
  const ip =
    e.headers?.['X-Forwarded-For'] ||
    e.headers?.['x-forwarded-for'] ||
    'unknown';

  const key = `rate:${ip}`;
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key) || 0);

  if (count > 120) {
    throw new Error('Rate limit exceeded');
  }

  cache.put(key, count + 1, 60);
}

function verifyWebhookIfPresent_(e) {
  if (e.headers && e.headers['X-Webhook-Signature']) {
    verifyWebhookSecret_(e);
  }
}

function verifyWebhookSecret_(e) {
  const secret = getConfig_('WEBHOOK_SECRET');
  const signature = e.headers['X-Webhook-Signature'];

  if (signature !== secret) {
    throw new Error('Invalid webhook signature');
  }
}

/******************************************************
 * HELPERS
 ******************************************************/
function parseJsonBody_(e) {
  if (!e.postData || !e.postData.contents) {
    throw new Error('Missing JSON body');
  }

  return JSON.parse(e.postData.contents);
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(err) {
  return jsonResponse_({
    success: false,
    error: err.message || String(err)
  });
}

/******************************************************
 * ITEMS API (PUBLIC)
 ******************************************************/

function getItemsAPI_(e) {
  const params = e.parameter;

  const category = params.category || null;
  const q = params.q || null;
  const page = Number(params.page || 1);
  const limit = Math.min(Number(params.limit || 20), 50);

  const items = fetchItems_({
    category,
    q,
    page,
    limit
  });

  return jsonResponse_({
    page,
    limit,
    items
  });
}


    liked: result


/******************************************************
 * PREMIUM ITEMS API
 ******************************************************/

function getPremiumItemsAPI_(e) {
  const items = fetchItems_({
    includeHidden: true,
    includeArchived: true
  });

  return jsonResponse_({
    premium: true,
    items
  });
}


/******************************************************
 * API RESPONSE HELPERS
 ******************************************************/

function jsonResponse_(data, status = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
    .setResponseCode(status);
}

function errorResponse_(message, status = 400) {
  return jsonResponse_({
    error: true,
    message
  }, status);
}'


/******************************************************
 * API ROUTER
 ******************************************************/

function doGet(e) {
  return routeRequest_(e);
}

function doPost(e) {
  return routeRequest_(e);
}

function routeRequest_(e) {
  try {
    const path = e.pathInfo || '/';

    // Public (read-only)
    if (path === '/items') return getItemsAPI_(e);

    // Authenticated
    verifyRequest_(e);

    if (path === '/like') return likeAPI_(e);
    if (path === '/comment') return commentAPI_(e);

    return errorResponse_('Not found', 404);

  } catch (err) {
    return errorResponse_(err.message, 401);
  }
}

/******************************************************
 * SIGNED READ AUTH
 ******************************************************/

function verifySignedRead_(e) {
  const secret = PropertiesService.getScriptProperties()
    .getProperty('API_READ_SECRET');

  if (!secret) throw new Error('Read secret missing');

  const sig = e.parameter.sig;
  const ts = e.parameter.ts;

  if (!sig || !ts) throw new Error('Unsigned request');

  if (Math.abs(Date.now() - Number(ts)) > 300000) {
    throw new Error('Signed URL expired');
  }

  const base = `${ts}.${e.pathInfo}`;
  const computed = Utilities.computeHmacSha256Signature(base, secret)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2))
    .join('');

  if (computed !== sig) {
    throw new Error('Invalid signed read');
  }
}


/******************************************************
 * API ROUTER (VERSIONED)
 ******************************************************/

function doGet(e) {
  return routeRequest_(e);
}

function doPost(e) {
  return routeRequest_(e);
}

function routeRequest_(e) {
  try {
    const parsed = parseApiVersion_(e.pathInfo || '/');
    const route = parsed.route;

    // ---------- PUBLIC ----------
    if (route === '/items') return getItemsAPI_(e);
    if (route === '/premium/items') {
      verifySignedRead_(e);
      return getPremiumItemsAPI_(e);
    }

    // ---------- AUTH REQUIRED ----------
    verifyRequest_(e);

    if (route === '/like') return likeAPI_(e);
    if (route === '/comment') return commentAPI_(e);

    return errorResponse_('Not found', 404);

  } catch (err) {
    return errorResponse_(err.message, 401);
  }
}


/******************************************************
 * AUTH GUARD
 *
 * Responsibility:
 * - Signed read APIs (premium data)
 * - HMAC verification
 * - Replay protection
 * - IP / Email rate limiting
 * - Abuse detection primitives
 *
 * Notes:
 * - Designed for GAS WebApp + Next.js
 * - No Google Cloud required
 ******************************************************/

/**
 * Verify signed request (HMAC SHA256)
 *
 * Required headers:
 * - X-Signature (base64)
 * - X-Timestamp (ms)
 */
function verifySignedRequest_(e) {
  const headers = normalizeHeaders_(e);
  const signature = headers['x-signature'];
  const timestamp = headers['x-timestamp'];

  if (!signature || !timestamp) {
    throw new Error('Missing signature headers');
  }

  // Replay protection (±5 minutes)
  const now = Date.now();
  if (Math.abs(now - Number(timestamp)) > 5 * 60 * 1000) {
    throw new Error('Request expired');
  }

  const secret = getConfig_('API_SIGNING_SECRET');
  if (!secret) {
    throw new Error('API signing secret not configured');
  }

  const canonical = buildCanonicalPayload_(e, timestamp);
  const expected = computeHmac_(canonical, secret);

  if (signature !== expected) {
    throw new Error('Invalid request signature');
  }
}

/**
 * Require premium access (signed + premium user)
 */
function requirePremiumAccess_(e) {
  verifySignedRequest_(e);

  const email =
    e.parameter?.email ||
    normalizeHeaders_(e)['x-user-email'];

  if (!email) {
    throw new Error('Email required');
  }

  enforceUserRateLimit_(email, 120, 60); // 120 req / min

  const user = getUserByEmail_(email);
  if (!user || !user.isPremium) {
    throw new Error('Premium access required');
  }

  return user;
}

/**
 * Build canonical string for HMAC
 */
function buildCanonicalPayload_(e, timestamp) {
  const method = (e.method || 'GET').toUpperCase();
  const path = (e.pathInfo || '').toLowerCase();
  const query = canonicalizeObject_(e.parameter || {});

  return [method, path, query, timestamp].join('|');
}

/**
 * Canonicalize object for deterministic signing
 */
function canonicalizeObject_(obj) {
  return Object.keys(obj)
    .sort()
    .map(k => `${k}=${String(obj[k])}`)
    .join('&');
}

/**
 * Compute HMAC SHA256
 */
function computeHmac_(data, secret) {
  const raw = Utilities.computeHmacSha256Signature(data, secret);
  return Utilities.base64Encode(raw);
}

/**
 * Normalize GAS headers (case-insensitive)
 */
function normalizeHeaders_(e) {
  const headers = {};
  if (!e || !e.headers) return headers;

  Object.keys(e.headers).forEach(k => {
    headers[k.toLowerCase()] = e.headers[k];
  });
  return headers;
}

/**
 * Per-user rate limiting (email-based)
 */
function enforceUserRateLimit_(email, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const key = `rate:user:${email.toLowerCase()}`;

  const count = Number(cache.get(key) || 0);
  if (count >= limit) {
    throw new Error('Rate limit exceeded');
  }

  cache.put(key, count + 1, windowSeconds);
}

/**
 * IP-based abuse protection (optional)
 */
function enforceIpRateLimit_(ip, limit, windowSeconds) {
  if (!ip) return;

  const cache = CacheService.getScriptCache();
  const key = `rate:ip:${ip}`;

  const count = Number(cache.get(key) || 0);
  if (count >= limit) {
    throw new Error('IP rate limit exceeded');
  }

  cache.put(key, count + 1, windowSeconds);
}

/******************************************************
 * BOOTSTRAP
 *
 * Responsibility:
 * - One-time system initialization
 * - Create folders, sheets, triggers
 * - Safe re-runs (idempotent)
 * - Entry point for operators
 ******************************************************/

/**
 * Main bootstrap entry point
 * Safe to run multiple times
 */
function bootstrap() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    initializeFolders_();
    initializeSheets_();
    initializeTriggers_();
    initializeProperties_();
    warmUpCaches_();

    Logger.log('Bootstrap completed successfully');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Initialize Drive folder structure
 */

function initializeFolders_() {
  const root = DriveService.getOrCreateFolder(CONFIG.DRIVE.ROOT_FOLDER);

  DriveService.getOrCreateFolder(CONFIG.DRIVE.UNCATEGORIZED, root);
  DriveService.getOrCreateFolder(CONFIG.DRIVE.AUTO_CATEGORIZED, root);
  DriveService.getOrCreateFolder(CONFIG.DRIVE.ARCHIVED, root);
}
/**
 * Initialize all required Sheets
 */

function initializeSheets_() {
  SheetService.ensureAllSheets();
}

/**
 * Initialize triggers
 */

function initializeTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();

  if (!triggers.some(t => t.getHandlerFunction() === 'runIngestion_')) {
    ScriptApp.newTrigger('runIngestion_')
      .timeBased()
      .everyMinutes(Number(getConfig_('SCAN_INTERVAL_MINUTES', 1)))
      .create();
  }

  if (!triggers.some(t => t.getHandlerFunction() === 'flushISRQueue')) {
    ScriptApp.newTrigger('flushISRQueue')
      .timeBased()
      .everyMinutes(1)
      .create();
  }
}

/**
 * Initialize required script properties
 */
function initializeProperties_() {
  const props = PropertiesService.getScriptProperties();

  const defaults = {
    ROOT_FOLDER_NAME: 'UploadedForWeb',
    SCAN_INTERVAL_MINUTES: '1'
  };

  Object.keys(defaults).forEach(key => {
    if (!props.getProperty(key)) {
      props.setProperty(key, defaults[key]);
    }
  });
}

/**
 * Warm up caches (optional)
 */
function warmUpCaches_() {
  CacheService.getScriptCache().put('boot', '1', 60);
}

/**
 * Operator helper (manual run)
 */
function healthCheck() {
  return {
    status: 'ok',
    time: new Date(),
    version: 'v1'
  };
}

/******************************************************
 * EDGE CACHE SERVICE
 ******************************************************/

const EDGE_CACHE_TTL = 60; // seconds

function cachedResponse_(key, producer) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  const data = producer();
  cache.put(key, JSON.stringify(data), EDGE_CACHE_TTL);
  return data;
}

/*

//API usage example (read API)

function getItemsAPI_(e) {
  const key = `items_${JSON.stringify(e.parameter)}`;

  const data = cachedResponse_(key, () =>
    fetchItems_(e.parameter)
  );

  return jsonResponse_(data);
}

//Cache Invalidation Hooks

queueISR_('/items');
emitEvent_('cache.invalidate', { scope: 'items' });

*/

/******************************************************
 * CHECKPOINT SERVICE
 ******************************************************/

function getCheckpoint_(key) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(`checkpoint_${key}`);
}

function setCheckpoint_(key, value) {
  PropertiesService.getScriptProperties()
    .setProperty(`checkpoint_${key}`, value);
}

function clearCheckpoint_(key) {
  PropertiesService.getScriptProperties()
    .deleteProperty(`checkpoint_${key}`);
}

/*
example in ingestion engine
********
const lastFileId = getCheckpoint_('driveScan');

files.forEach(file => {
  if (lastFileId && file.getId() <= lastFileId) return;

  processFile_(file);

  setCheckpoint_('driveScan', file.getId());
});

clearCheckpoint_('driveScan');



*/

/******************************************************
 * CLASSIFICATION SERVICE
 * - Gemini image captioning (inlineData)
 * - Retry + rate limiting + batching
 ******************************************************/

const ClassificationService = {

  /******************************************************
   * PUBLIC: CLASSIFY SINGLE FILE
   ******************************************************/
  classifyFile: function (file) {
    if (!file) return null;

    let category = this.inferCategory_(file);
    if (!category) category = CONFIG.DRIVE.OTHER_CATEGORY;

    const caption = this.generateCaptionWithRetry_(file, category);

    const finalCategory = DriveService.moveFileToCategory(file, category);
    const meta = DriveService.getFileMetadata(file);

    const item = {
      FileID: meta.FileID,
      FileName: meta.FileName,
      ImageLinkCDN: buildImageCDN_(meta.FileID),
      Category: finalCategory,
      Caption: caption,
      Status: CONFIG.STATUS.PUBLISHED,
      UpdatedAt: meta.LastUpdated,
      Width: meta.Width,
      Length: meta.Height,
      AspectRatio: computeAspectRatio_(meta.Width, meta.Height),
      Size: formatFileSize_(meta.Size),
      Hash: computeHash_(meta.FileID),
      Slug: generateSlug_(meta.FileName),
      AltText: caption || meta.FileName,
      ViewCount: 0,
      LikeCount: 0,
      CommentCount: 0,
      LastIndexedAt: nowISO_()
    };

    SheetService.upsertItem(item);
    addToISRQueue(item.Slug);

    return item;
  },

  /******************************************************
   * PUBLIC: BATCH CLASSIFICATION
   * Processes files sequentially with rate limiting
   ******************************************************/
  classifyBatch: function (files) {
    if (!files || !files.length) return [];

    const results = [];
    for (let i = 0; i < files.length; i++) {
      results.push(this.classifyFile(files[i]));
      Utilities.sleep(CONFIG.CLASSIFICATION.RATE_LIMIT_MS);
    }
    return results;
  },

  /******************************************************
   * CATEGORY INFERENCE (FREE, RULE-BASED)
   ******************************************************/
  inferCategory_: function (file) {
    const name = file.getName().toLowerCase();
    if (/nature|forest|tree|mountain|river/.test(name)) return 'Nature';
    if (/business|office|meeting|corporate/.test(name)) return 'Business';
    if (/tech|computer|software|ai|code/.test(name)) return 'Technology';
    return null;
  },

  /******************************************************
   * CAPTION WITH RETRY + BACKOFF
   ******************************************************/
  generateCaptionWithRetry_: function (file, category) {
    const maxRetries = CONFIG.CLASSIFICATION.MAX_RETRIES;
    let attempt = 0;
    let delay = CONFIG.CLASSIFICATION.INITIAL_BACKOFF_MS;

    while (attempt <= maxRetries) {
      try {
        return this.callGemini_(file, category);
      } catch (e) {
        Logger.log(`Gemini attempt ${attempt + 1} failed for ${file.getName()}: ${e}`);
        if (attempt === maxRetries) break;
        Utilities.sleep(delay);
        delay *= 2; // exponential backoff
        attempt++;
      }
    }
    return 'no description';
  },

  /******************************************************
   * GEMINI IMAGE UNDERSTANDING (INLINE DATA)
   ******************************************************/
  callGemini_: function (file, category) {
    const apiKey = PropertiesService
      .getScriptProperties()
      .getProperty('GEMINI_API_KEY');

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }

    const blob = file.getBlob();
    const base64Image = Utilities.base64Encode(blob.getBytes());

    const prompt =
      `Caption this image for a public web gallery.\n` +
      `Filename: ${file.getName()}\n` +
      `Category: ${category}\n` +
      `Return a short, descriptive caption only.`;

    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: blob.getContentType(),
                data: base64Image
              }
            },
            { text: prompt }
          ]
        }
      ]
    };

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(response.getContentText());
    }

    const result = JSON.parse(response.getContentText());
    const parts = result?.candidates?.[0]?.content?.parts || [];

    for (let p of parts) {
      if (p.text) return p.text.trim();
    }

    throw new Error('No caption returned');
  }
};


/******************************************************
 * EXECUTION CONTEXT
 * - Cached per execution
 * - No side effects
 * - Trigger & API safe
 ******************************************************/
const CONTEXT = {
  ss: null,

  sheets: {
    items: null,
    archived: null,
    users: null,
    comments: null,
    likes: null
  },

  indexes: {
    items: {},
    archived: {},
    users: {}
  },

  isrQueue: new Set(),
  editInProgress: false
};

/******************************************************
 * SPREADSHEET ACCESS (AUTHORITATIVE)
 ******************************************************/
function getSpreadsheet_() {
  if (!CONTEXT.ss) {
    CONTEXT.ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET.ID);
  }
  return CONTEXT.ss;
}

/******************************************************
 * CONTEXT INITIALIZATION
 * Assumes bootstrap already ensured schema
 ******************************************************/
function initContext_() {
  const ss = getSpreadsheet_();

  CONTEXT.sheets.items = ss.getSheetByName(CONFIG.SHEETS.ITEMS);
  CONTEXT.sheets.archived = ss.getSheetByName(CONFIG.SHEETS.ARCHIVED);
  CONTEXT.sheets.users = ss.getSheetByName(CONFIG.SHEETS.USERS);
  CONTEXT.sheets.comments = ss.getSheetByName(CONFIG.SHEETS.COMMENTS);
  CONTEXT.sheets.likes = ss.getSheetByName(CONFIG.SHEETS.LIKES);

  CONTEXT.indexes.items = buildIndexSafe_(CONTEXT.sheets.items, 'FileID');
  CONTEXT.indexes.archived = buildIndexSafe_(CONTEXT.sheets.archived, 'FileID');
  CONTEXT.indexes.users = buildIndexSafe_(CONTEXT.sheets.users, 'Email');
}

/******************************************************
 * SAFE INDEX BUILDER
 ******************************************************/
function buildIndexSafe_(sheet, keyColumnName) {
  if (!sheet) return {};

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return {};

  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = data[0];
  const keyIndex = header.indexOf(keyColumnName);

  if (keyIndex === -1) {
    throw new Error(`Column ${keyColumnName} not found in ${sheet.getName()}`);
  }

  const index = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][keyIndex];
    if (key) index[key] = i + 1;
  }
  return index;
}

/******************************************************
 * ISR QUEUE
 ******************************************************/
function addToISRQueue(slug) {
  if (slug) CONTEXT.isrQueue.add(slug);
}

function flushISRQueue() {
  if (!CONFIG.ISR.ENABLED || CONTEXT.isrQueue.size === 0) return;

  const payloads = Array.from(CONTEXT.isrQueue).map(slug => ({ slug }));

  try {
    UrlFetchApp.fetch(CONFIG.ISR.REVALIDATE_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ slugs: payloads })
    });
  } catch (e) {
    Logger.log(`ISR batch flush failed: ${e}`);
  }

  CONTEXT.isrQueue.clear();
}

/******************************************************
 * EDIT LOCK (SINGLE EXECUTION)
 ******************************************************/
function lockEdit_() {
  if (CONTEXT.editInProgress) return false;
  CONTEXT.editInProgress = true;
  return true;
}

function unlockEdit_() {
  CONTEXT.editInProgress = false;
}



/******************************************************
 * DEAD LETTER QUEUE SERVICE
 ******************************************************/

const DEADLETTER_SHEET = 'DeadLetterQueue';
const MAX_RETRIES = 5;

function logDeadLetter_(entry) {
  const ss = SpreadsheetApp.getActive();
  const sheet = getOrCreateSheet_(ss, DEADLETTER_SHEET, [
    'Timestamp',
    'AssetId',
    'FileId',
    'Stage',
    'ErrorMessage',
    'RetryCount',
    'LastTriedAt',
    'Payload'
  ]);

  sheet.appendRow([
    new Date(),
    entry.assetId || '',
    entry.fileId || '',
    entry.stage || '',
    entry.error || '',
    entry.retryCount || 0,
    new Date(),
    JSON.stringify(entry.payload || {})
  ]);
}

/**
 * Retry failed rows (batched & safe)
 */
function retryDeadLetters_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(DEADLETTER_SHEET);
  if (!sheet) return;

  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();

  rows.forEach((row, i) => {
    const retryCount = row[5];
    if (retryCount >= MAX_RETRIES) return;

    try {
      const payload = JSON.parse(row[7] || '{}');
      retryFailedPayload_(payload);

      sheet.deleteRow(i + 2);
    } catch (err) {
      sheet.getRange(i + 2, 6).setValue(retryCount + 1);
      sheet.getRange(i + 2, 7).setValue(new Date());
    }
  });
}



/******************************************************
 * DRIVE SERVICE
 * Handles all Google Drive interactions
 * - File metadata
 * - Moves & renames
 * - Folder creation
 * - Auto-categorized fallback handling
 ******************************************************/

const DriveService = {

  /******************************************************
   * GET OR CREATE ROOT / SUBFOLDER
   ******************************************************/
  getOrCreateFolder: function(name, parent) {
    parent = parent || DriveApp.getRootFolder();
    const folders = parent.getFoldersByName(name);
    if (folders.hasNext()) return folders.next();
    return parent.createFolder(name);
  },

  /******************************************************
   * GET AUTO-CATEGORIZED FOLDER
   ******************************************************/
  getAutoCategorizedFolder: function(categoryName) {
    const root = this.getOrCreateFolder(CONFIG.DRIVE.ROOT_FOLDER);
    const autoFolder = this.getOrCreateFolder(CONFIG.DRIVE.AUTO_CATEGORIZED, root);

    // If category is empty or fails, fallback to "Other"
    if (!categoryName || categoryName === '') categoryName = CONFIG.DRIVE.OTHER_CATEGORY;
    return this.getOrCreateFolder(categoryName, autoFolder);
  },

  /******************************************************
   * GET UNCATEGORIZED FOLDER
   ******************************************************/
  getUncategorizedFolder: function() {
    const root = this.getOrCreateFolder(CONFIG.DRIVE.ROOT_FOLDER);
    return this.getOrCreateFolder(CONFIG.DRIVE.UNCATEGORIZED, root);
  },

  /******************************************************
   * GET ARCHIVED FOLDER
   ******************************************************/
  getArchivedFolder: function() {
    const root = this.getOrCreateFolder(CONFIG.DRIVE.ROOT_FOLDER);
    return this.getOrCreateFolder(CONFIG.DRIVE.ARCHIVED, root);
  },

  /******************************************************
   * GET FILE METADATA
   ******************************************************/
  getFileMetadata: function(file) {
    return {
      FileID: file.getId(),
      FileName: file.getName(),
      Size: file.getSize(),
      MimeType: file.getMimeType(),
      LastUpdated: file.getLastUpdated(),
      Width: file.getWidth ? file.getWidth() : null,   // optional for images
      Height: file.getHeight ? file.getHeight() : null
    };
  },

  /******************************************************
   * MOVE FILE TO CATEGORY
   * Creates folder if missing
   * Handles fallback to Other
   ******************************************************/
  moveFileToCategory: function(file, categoryName) {
    if (!file) return null;

    // Get destination folder
    const destFolder = this.getAutoCategorizedFolder(categoryName);

    // Move file
    const parents = file.getParents();
    while (parents.hasNext()) {
      const parent = parents.next();
      parent.removeFile(file);
    }
    destFolder.addFile(file);

    return destFolder.getName();
  },

  /******************************************************
   * MOVE FILE TO UNCATEGORIZED
   ******************************************************/
  moveFileToUncategorized: function(file) {
    if (!file) return null;
    const folder = this.getUncategorizedFolder();

    const parents = file.getParents();
    while (parents.hasNext()) {
      const parent = parents.next();
      parent.removeFile(file);
    }
    folder.addFile(file);

    return folder.getName();
  },

  /******************************************************
   * MOVE FILE TO ARCHIVED
   ******************************************************/
  moveFileToArchived: function(file) {
    if (!file) return null;
    const folder = this.getArchivedFolder();

    const parents = file.getParents();
    while (parents.hasNext()) {
      const parent = parents.next();
      parent.removeFile(file);
    }
    folder.addFile(file);

    return folder.getName();
  },

  /******************************************************
   * RENAME FILE
   * Updates Drive file name
   ******************************************************/
  renameFile: function(file, newName) {
    if (!file || !newName) return null;
    file.setName(newName);
    return file.getName();
  },

  /******************************************************
   * GET ALL FILES IN FOLDER (recursive optional)
   ******************************************************/
  getFilesInFolder: function(folder, recursive = false) {
    const files = [];
    const folderFiles = folder.getFiles();
    while (folderFiles.hasNext()) files.push(folderFiles.next());

    if (recursive) {
      const subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        const subFolder = subFolders.next();
        files.push(...this.getFilesInFolder(subFolder, true));
      }
    }

    return files;
  }
};

/******************************************************
 * GLOBAL ADAPTERS (SYSTEM CONTRACT)
 * Do NOT call DriveService directly elsewhere
 ******************************************************/

function getOrCreateFolder_(parent, name) {
  return DriveService.getOrCreateFolder(name, parent);
}

function getOrCreateSubfolder_(parent, name) {
  return DriveService.getOrCreateFolder(name, parent);
}


/******************************************************
 * DRIVE WATCHER SERVICE
 *
 * Responsibility:
 * - Detect Drive-side changes
 * - Reconcile them into Sheets
 * - Never mutate Drive unless explicitly required
 *
 * Drive is treated as EVENT SOURCE
 * Sheets remain SOURCE OF TRUTH
 ******************************************************/

/**
 * Entry point (time-driven trigger)
 * Runs frequently, lightweight, resumable
 */
function driveWatcher_() {
  const root = getRootFolder_();
  const autoRoot = getAutoCategorizedFolder_(root);
  const archivedRoot = getArchivedFolder_(root);
  const uncategorized = getUncategorizedFolder_(root);

  const sheetIndex = buildItemsIndex_(); // FileID → row snapshot

  scanFolder_(uncategorized, file =>
    handleDriveFile_(file, 'uncategorized', sheetIndex)
  );

  scanFolder_(autoRoot, file =>
    handleDriveFile_(file, 'autocategorized', sheetIndex)
  );

  scanFolder_(archivedRoot, file =>
    handleDriveFile_(file, 'archived', sheetIndex)
  );

  reconcileMissingFiles_(sheetIndex);
}

/**
 * Recursively scans a folder (single depth per your spec)
 */
function scanFolder_(folder, handler) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    handler(files.next());
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    scanFolder_(subfolders.next(), handler);
  }
}

/**
 * Handles a single Drive file detected during scan
 */
function handleDriveFile_(file, driveState, sheetIndex) {
  const fileId = file.getId();
  const row = sheetIndex[fileId];

  // ---------- CASE 1: File exists in Drive but NOT in Sheets ----------
  if (!row) {
    if (driveState === 'uncategorized') {
      ingestSingleFile_(file); // full ingestion pipeline
    }
    return;
  }

  // ---------- CASE 2: File moved between folders ----------
  const currentCategory = getImmediateParentName_(file);
  const sheetCategory = row.Category;
  const sheetStatus = row.Status;

  if (driveState === 'archived' && sheetStatus !== 'archived') {
    moveRowToArchive_(row);
    return;
  }

  if (driveState !== 'archived' && sheetStatus === 'archived') {
    restoreFromArchive_(row, file, currentCategory);
    return;
  }

  if (
    driveState === 'autocategorized' &&
    sheetCategory !== currentCategory
  ) {
    updateCategoryInSheet_(row, currentCategory);
  }

  // ---------- CASE 3: File renamed directly in Drive ----------
  if (row.FileName !== file.getName()) {
    updateFilenameInSheet_(row, file.getName());
  }

  // ---------- CASE 4: Metadata drift ----------
  if (row.Hash !== computeFileHash_(file)) {
    updateMetadataInSheet_(row, file);
  }

  // Mark reconciled
  delete sheetIndex[fileId];
}

/**
 * Any remaining sheet rows reference files no longer in Drive
 */
function reconcileMissingFiles_(remainingIndex) {
  Object.values(remainingIndex).forEach(row => {
    archiveMissingFileRow_(row);
  });
}

/******************************************************
 * HELPERS (Drive → Sheet focused)
 ******************************************************/

function getImmediateParentName_(file) {
  const parents = file.getParents();
  return parents.hasNext() ? parents.next().getName() : '';
}

function archiveMissingFileRow_(row) {
  updateStatusInSheet_(row, 'archived');
  moveRowToArchive_(row);
}

/******************************************************
 * EDIT HANDLER SERVICE
 *
 * Responsibility:
 * - Detect manual edits in Sheets
 * - Update Drive accordingly
 * - Handle:
 *     • FileName changes
 *     • Category changes
 *     • Status changes (Published | Hidden | Archived)
 * - Ensure folders exist
 * - Safe moves (never break hierarchy)
 ******************************************************/

/**
 * Trigger entry point
 * Runs on Edit in ItemsDB sheet
 */
function onItemsSheetEdit_(e) {
  const range = e.range;
  const sheet = range.getSheet();
  const col = range.getColumn();
  const row = range.getRow();

  if (sheet.getName() !== 'ItemsDB' || row === 1) return;

  const editedField = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const fileId = editedField[sheetColumnIndex_('FileID')];
  const fileName = editedField[sheetColumnIndex_('FileName')];
  const category = editedField[sheetColumnIndex_('Category')];
  const status = editedField[sheetColumnIndex_('Status')];

  const file = DriveApp.getFileById(fileId);
  if (!file) return;

  // ---------- FileName change ----------
  if (file.getName() !== fileName) {
    file.setName(fileName);
  }

  // ---------- Category change ----------
  const parentFolder = getImmediateParent_(file);
  const autoRoot = getAutoCategorizedFolder_(getRootFolder_());

  if (category && parentFolder.getName() !== category) {
    const targetFolder = getOrCreateSubfolder_(autoRoot, category);
    moveFile_(file, targetFolder);
  }

  // ---------- Status change ----------
  handleStatusChange_(file, status);
}

/******************************************************
 * Status handler
 ******************************************************/
function handleStatusChange_(file, status) {
  const root = getRootFolder_();
  const archivedRoot = getArchivedFolder_(root);
  const autoRoot = getAutoCategorizedFolder_(root);
  const uncategorized = getUncategorizedFolder_(root);

  const row = getRowByFileId_(file.getId());

  if (!row) return;

  switch (status.toLowerCase()) {
    case 'published':
      // ensure file is in auto-categorized folder
      const cat = row.Category || 'Other';
      const targetFolder = getOrCreateSubfolder_(autoRoot, cat);
      moveFile_(file, targetFolder);
      updateRowStatus_(row, 'published');
      break;

    case 'hidden':
      // file stays in place, just hide in API
      updateRowStatus_(row, 'hidden');
      break;

    case 'archived':
      moveFile_(file, archivedRoot);
      updateRowStatus_(row, 'archived');
      moveRowToArchive_(row);
      break;

    default:
      // unknown → do nothing
      break;
  }
}

/******************************************************
 * File helpers
 ******************************************************/
function moveFile_(file, folder) {
  // Remove from all current parents except target
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    if (p.getId() !== folder.getId()) {
      p.removeFile(file);
    }
  }
  folder.addFile(file);
}

function getImmediateParent_(file) {
  const parents = file.getParents();
  return parents.hasNext() ? parents.next() : getRootFolder_();
}



/******************************************************
 * INGESTION SERVICE
 * - Drive scanning
 * - Classification & reclassification
 * - Sheet ↔ Drive synchronization
 ******************************************************/

const IngestionService = {

  /******************************************************
   * ENTRY POINT
   * Can be run by time trigger or manually
   ******************************************************/
  run: function () {
    this.processUncategorized_();
    this.processAutoCategorized_();
    this.processArchived_();
  },

  /******************************************************
   * PROCESS UNCATEGORIZED
   * New or reintroduced files
   ******************************************************/
  processUncategorized_: function () {
    const folder = DriveService.getUncategorizedFolder();
    const files = DriveService.getFilesInFolder(folder, false);

    if (!files.length) return;

    ClassificationService.classifyBatch(files);
  },

  /******************************************************
   * PROCESS AUTO-CATEGORIZED
   * Detects:
   * - Renames
   * - Manual category edits in Sheets
   ******************************************************/
  processAutoCategorized_: function () {
    const root = DriveService.getOrCreateFolder(CONFIG.DRIVE.ROOT_FOLDER);
    const autoRoot = DriveService.getOrCreateFolder(CONFIG.DRIVE.AUTO_CATEGORIZED, root);

    const categoryFolders = autoRoot.getFolders();
    while (categoryFolders.hasNext()) {
      const categoryFolder = categoryFolders.next();
      const categoryName = categoryFolder.getName();

      const files = DriveService.getFilesInFolder(categoryFolder, false);
      files.forEach(file => {
        this.syncAutoCategorizedFile_(file, categoryName);
      });
    }
  },

  /******************************************************
   * SYNC AUTO-CATEGORIZED FILE
   ******************************************************/
  syncAutoCategorizedFile_: function (file, actualCategory) {
    const fileId = file.getId();
    let item = SheetService.getItem(fileId, false);

    // File exists in Drive but not in ItemsDB → re-ingest
    if (!item) {
      ClassificationService.classifyFile(file);
      return;
    }

    // Filename changed in Drive
    if (item.FileName !== file.getName()) {
      item.FileName = file.getName();
      item.Slug = generateSlug_(file.getName());
      item.UpdatedAt = file.getLastUpdated();
      SheetService.upsertItem(item);
      addToISRQueue(item.Slug);
    }

    // Category mismatch (manual move in Drive)
    if (item.Category !== actualCategory) {
      item.Category = actualCategory;
      item.Status = CONFIG.STATUS.PUBLISHED;
      SheetService.upsertItem(item);
      addToISRQueue(item.Slug);
    }
  },

  /******************************************************
   * PROCESS ARCHIVED
   * Keeps ArchivedItems in sync
   ******************************************************/
  processArchived_: function () {
    const folder = DriveService.getArchivedFolder();
    const files = DriveService.getFilesInFolder(folder, false);

    files.forEach(file => {
      const fileId = file.getId();

      let archivedItem = SheetService.getItem(fileId, true);
      let activeItem = SheetService.getItem(fileId, false);

      // Move from ItemsDB → ArchivedItems
      if (activeItem && !archivedItem) {
        activeItem.Status = CONFIG.STATUS.ARCHIVED;
        SheetService.deleteItem(fileId, false);
        SheetService.upsertItem(activeItem, true);
        addToISRQueue(activeItem.Slug);
      }
    });
  },

  /******************************************************
   * MANUAL STATUS CHANGE HANDLER
   * Called from onEdit trigger
   ******************************************************/
  handleStatusChange: function (fileId, newStatus) {
    const file = DriveApp.getFileById(fileId);
    if (!file) return;

    if (newStatus === CONFIG.STATUS.ARCHIVED) {
      DriveService.moveFileToArchived(file);
      const item = SheetService.getItem(fileId, false);
      if (item) {
        SheetService.deleteItem(fileId, false);
        SheetService.upsertItem(item, true);
        addToISRQueue(item.Slug);
      }
      return;
    }

    if (newStatus === CONFIG.STATUS.PUBLISHED || newStatus === CONFIG.STATUS.HIDDEN) {
      const archivedItem = SheetService.getItem(fileId, true);
      if (archivedItem) {
        DriveService.moveFileToCategory(file, archivedItem.Category);
        archivedItem.Status = newStatus;
        SheetService.deleteItem(fileId, true);
        SheetService.upsertItem(archivedItem, false);
        addToISRQueue(archivedItem.Slug);
      }
    }
  }
};


/******************************************************
 * ISR SERVICE
 *
 * Responsibility:
 * - Batch ISR revalidation for Next.js
 * - Deduplicate & debounce requests
 * - Secure webhook calls
 * - Safe retry + dead-letter fallback
 *
 * Designed for:
 * - Google Apps Script WebApp
 * - Next.js App Router / Pages Router
 ******************************************************/

const ISR_BATCH_WINDOW_SEC = 30;
const ISR_MAX_BATCH_SIZE = 50;
const ISR_MAX_RETRIES = 3;

/**
 * Queue ISR revalidation for a path
 */
function queueIsrRevalidation_(path) {
  if (!path) return;

  const cache = CacheService.getScriptCache();
  const key = 'isr:queue';

  const existing = JSON.parse(cache.get(key) || '[]');
  if (!existing.includes(path)) {
    existing.push(path);
  }

  cache.put(key, JSON.stringify(existing), ISR_BATCH_WINDOW_SEC);
}

/**
 * Flush ISR queue (batched)
 * Called via time-driven trigger
 */
function flushIsrQueue_() {
  const cache = CacheService.getScriptCache();
  const key = 'isr:queue';

  const paths = JSON.parse(cache.get(key) || '[]');
  if (!paths.length) return;

  const batch = paths.slice(0, ISR_MAX_BATCH_SIZE);
  cache.put(key, JSON.stringify(paths.slice(batch.length)), ISR_BATCH_WINDOW_SEC);

  sendIsrBatch_(batch);
}

/**
 * Send ISR revalidation batch to Next.js
 */
function sendIsrBatch_(paths) {
  const url = getConfig_('NEXTJS_ISR_ENDPOINT');
  const secret = getConfig_('NEXTJS_ISR_SECRET');

  if (!url || !secret) {
    logDeadLetter_('ISR_CONFIG_MISSING', paths);
    return;
  }

  const timestamp = Date.now();
  const payload = {
    paths: paths,
    timestamp: timestamp
  };

  const signature = computeHmac_(
    JSON.stringify(payload),
    secret
  );

  const options = {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
    headers: {
      'X-Signature': signature,
      'X-Timestamp': timestamp
    }
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();

    if (code < 200 || code >= 300) {
      retryIsrBatch_(paths, res.getContentText());
    }
  } catch (err) {
    retryIsrBatch_(paths, err.toString());
  }
}

/**
 * Retry logic with dead-letter fallback
 */
function retryIsrBatch_(paths, error) {
  const props = PropertiesService.getScriptProperties();
  const key = 'isr:retry';

  const retries = JSON.parse(props.getProperty(key) || '{}');

  paths.forEach(path => {
    retries[path] = (retries[path] || 0) + 1;

    if (retries[path] >= ISR_MAX_RETRIES) {
      logDeadLetter_('ISR_FAILED', { path, error });
      delete retries[path];
    }
  });

  props.setProperty(key, JSON.stringify(retries));
}

/**
 * Trigger ISR from content changes
 */
function triggerIsrForItem_(item) {
  // Item page
  queueIsrRevalidation_(`/items/${item.FileID}`);

  // Category listing
  if (item.Category) {
    queueIsrRevalidation_(`/category/${slugify_(item.Category)}`);
  }

  // Homepage / feeds
  queueIsrRevalidation_('/');
}

/**
 * Dead-letter logging
 */
function logDeadLetter_(type, payload) {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'DeadLetters',
    ['Type', 'Payload', 'Time']
  );

  sheet.appendRow([
    type,
    JSON.stringify(payload),
    new Date()
  ]);
}


/******************************************************
 * LIKES SERVICE
 ******************************************************/

function toggleLike_(userEmail, assetId) {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'LikesDB',
    ['UserEmail', 'AssetId', 'Liked', 'UpdatedAt']
  );

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === userEmail && rows[i][1] === assetId) {
      const newValue = !rows[i][2];
      sheet.getRange(i + 1, 3).setValue(newValue);
      sheet.getRange(i + 1, 4).setValue(new Date());
      return newValue;
    }
  }

  sheet.appendRow([userEmail, assetId, true, new Date()]);
  return true;
}



/******************************************************
 * MODERATION APPLY
 ******************************************************/

function applyModeration_(row) {
  if (row.Type === 'comment') {
    approveComment_(row.EntityId, row.ProposedValue);
  }

  if (row.Type === 'caption') {
    updateCaption_(row.EntityId, row.ProposedValue);
  }

  if (row.Type === 'category') {
    updateCategory_(row.EntityId, row.ProposedValue);
  }
}


/******************************************************
 * MODERATION SERVICE
 ******************************************************/

function enqueueModeration_(entry) {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'ModerationQueue',
    [
      'Type',
      'EntityId',
      'ProposedValue',
      'CurrentValue',
      'Status',
      'SubmittedBy',
      'SubmittedAt',
      'ReviewedBy',
      'ReviewedAt'
    ]
  );

  sheet.appendRow([
    entry.type,
    entry.entityId,
    entry.proposedValue,
    entry.currentValue || '',
    'pending',
    entry.submittedBy || '',
    new Date(),
    '',
    ''
  ]);
}



/******************************************************
 * RATE LIMIT SERVICE
 ******************************************************/

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function rateLimit_(key) {
  const cache = CacheService.getScriptCache();
  const now = Date.now();

  const data = JSON.parse(cache.get(key) || '{"count":0,"ts":0}');

  if (now - data.ts > RATE_LIMIT_WINDOW_MS) {
    data.count = 0;
    data.ts = now;
  }

  data.count++;

  cache.put(key, JSON.stringify(data), 90);

  if (data.count > RATE_LIMIT_MAX) {
    throw new Error('Rate limit exceeded');
  }
}

/* Usage (automatic)

//Inside routeRequest_ (already verified user):

rateLimit_(e.headers['X-Forwarded-For'] || 'unknown');

//For likes/comments:

rateLimit_(body.email);

*/


/******************************************************
 * SEARCH INDEXER
 ******************************************************/

function indexItem_(item) {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'SearchIndex',
    ['Token', 'AssetId', 'Category', 'Weight']
  );

  const tokens = tokenize_(
    `${item.FileName} ${item.Caption}`
  );

  tokens.forEach(token => {
    sheet.appendRow([
      token,
      item.AssetId,
      item.Category,
      1
    ]);
  });
}

function tokenize_(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean);
}

/******************************************************
 * SEARCH QUERY
 ******************************************************/

function searchItems_(q, limit = 20) {
  const sheet = SpreadsheetApp.getActive()
    .getSheetByName('SearchIndex');
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const tokens = tokenize_(q);

  const hits = rows.filter(r => tokens.includes(r[0]));

  const scored = {};
  hits.forEach(r => {
    scored[r[1]] = (scored[r[1]] || 0) + r[3];
  });

  return Object.keys(scored)
    .sort((a, b) => scored[b] - scored[a])
    .slice(0, limit);
}

/******************************************************
 * SHEET SCHEMA
 * - Defines all database tables
 * - Controls column order
 * - Idempotent & migration-safe
 ******************************************************/

const SheetSchema = {

  /***********************
   * ITEM TABLE (ACTIVE)
   ***********************/
  ITEMS: [
    'FileName',          // Editing renames Drive file
    'Caption',           // Auto (Gemini/fallback) or manual
    'ImageLinkCDN',      // Google CDN link (derived from FileID)
    'Category',          // Immediate child of AutoCategorized
    'Status',            // published | hidden | archived
    'UpdatedAt',         // Drive last modified
    'Length',            // For Next.js <Image>
    'Width',             // For Next.js <Image>
    'AspectRatio',       // Width / Height
    'Size',              // Human-readable
    'Hash',              // Change detection
    'FileID',            // Drive ID (primary key)
    'Slug',              // Stable routing
    'AltText',           // SEO / accessibility
    'ViewCount',         // Cached aggregate
    'LikeCount',         // Cached aggregate
    'CommentCount',      // Cached aggregate
    'LastIndexedAt'      // Debugging + ISR
  ],

  /***********************
   * USERS TABLE
   ***********************/
  USERS: [
    'Name',
    'Email',             // Primary identity (authoritative)
    'Phone',
    'ProfilePic',
    'CreatedAt',
    'LastSeenAt'
  ],

  /***********************
   * COMMENTS TABLE
   ***********************/
  COMMENTS: [
    'UserName',
    'Email',
    'Phone',
    'Comment',
    'URL',
    'Time'
  ],

  /***********************
   * LIKES TABLE
   ***********************/
  LIKES: [
    'UserName',
    'Email',
    'Phone',
    'URL',
    'Time'
  ]
};




/******************************************************
 * SHEET SERVICE
 * Handles all CRUD operations on spreadsheets
 * - ItemsDB / ArchivedItems / Users / Likes / Comments
 * - Row lookups & updates
 * - Keeps Sheets as source of truth
 ************************************************

/******************************************************
 * SHEET BOOTSTRAP & SCHEMA
 * Creation + header enforcement
 ******************************************************/
const SheetService = {

  ensureAllSheets() {
    this.ensureSheet_(CONFIG.SHEETS.ITEMS, SheetSchema.ITEMS);
    this.ensureSheet_(CONFIG.SHEETS.ARCHIVED, SheetSchema.ITEMS);
    this.ensureSheet_(CONFIG.SHEETS.USERS, SheetSchema.USERS);
    this.ensureSheet_(CONFIG.SHEETS.COMMENTS, SheetSchema.COMMENTS);
    this.ensureSheet_(CONFIG.SHEETS.LIKES, SheetSchema.LIKES);
  },

  ensureSheet_(sheetName, headers) {
  if (!headers || !headers.length) {
    throw new Error(`Schema missing for sheet: ${sheetName}`);
  }

  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(sheetName);

  // Create brand-new sheet
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Sheet exists but may be empty
  const lastCol = sheet.getLastColumn();

  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Non-destructive header migration
  const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let writeCol = lastCol + 1;

  headers.forEach(h => {
    if (!existingHeaders.includes(h)) {
      sheet.getRange(1, writeCol++).setValue(h);
    }
  });

  sheet.setFrozenRows(1);
  return sheet;
},
  /******************************************************
   * GET ROW BY KEY
   * Returns row number
   ******************************************************/
  getRowByKey: function(sheet, keyColumn, keyValue) {
    const data = sheet.getDataRange().getValues();
    const header = data[0];
    const keyIndex = header.indexOf(keyColumn);
    if (keyIndex === -1) throw new Error(`Column ${keyColumn} not found in sheet ${sheet.getName()}`);

    for (let i = 1; i < data.length; i++) {
      if (data[i][keyIndex] === keyValue) return i + 1; // sheet rows are 1-indexed
    }
    return null;
  },

  /******************************************************
   * GET ROW DATA AS OBJECT
   ******************************************************/
  getRowData: function(sheet, row) {
    if (!row) return null;
    const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const obj = {};
    header.forEach((col, i) => {
      obj[col] = values[i];
    });
    return obj;
  },

  /******************************************************
   * UPSERT ROW
   * Inserts new row if not exists, updates if exists
   ******************************************************/
  upsertRow: function(sheet, keyColumn, keyValue, dataObj) {
    let row = this.getRowByKey(sheet, keyColumn, keyValue);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowData = header.map(col => safeGet_(dataObj, col, ''));

    if (row) {
      sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
      row = sheet.getLastRow();
    }
    return row;
  },

  /******************************************************
   * DELETE ROW BY KEY
   ******************************************************/
  deleteRowByKey: function(sheet, keyColumn, keyValue) {
    const row = this.getRowByKey(sheet, keyColumn, keyValue);
    if (row) sheet.deleteRow(row);
    return !!row;
  },

  /******************************************************
   * ADD OR UPDATE ITEM
   * Maintains ItemsDB / ArchivedItems
   ******************************************************/
  upsertItem: function(itemObj, archived = false) {
    const sheet = archived ? CONTEXT.sheets.archived : CONTEXT.sheets.items;
    return this.upsertRow(sheet, 'FileID', itemObj.FileID, itemObj);
  },

  getItem: function(fileId, archived = false) {
    const sheet = archived ? CONTEXT.sheets.archived : CONTEXT.sheets.items;
    const row = this.getRowByKey(sheet, 'FileID', fileId);
    return this.getRowData(sheet, row);
  },

  deleteItem: function(fileId, archived = false) {
    const sheet = archived ? CONTEXT.sheets.archived : CONTEXT.sheets.items;
    return this.deleteRowByKey(sheet, 'FileID', fileId);
  },

  /******************************************************
   * ADD OR UPDATE USER
   ******************************************************/
  upsertUser: function(userObj) {
    return this.upsertRow(CONTEXT.sheets.users, 'Email', userObj.Email, userObj);
  },

  getUser: function(email) {
    const row = this.getRowByKey(CONTEXT.sheets.users, 'Email', email);
    return this.getRowData(CONTEXT.sheets.users, row);
  },

  deleteUser: function(email) {
    return this.deleteRowByKey(CONTEXT.sheets.users, 'Email', email);
  },

  /******************************************************
   * ADD COMMENT
   ******************************************************/
  addComment: function(commentObj) {
    return this.upsertRow(CONTEXT.sheets.comments, 'Time', commentObj.Time, commentObj);
  },

  /******************************************************
   * ADD LIKE
   ******************************************************/
  addLike: function(likeObj) {
    return this.upsertRow(CONTEXT.sheets.likes, 'Time', likeObj.Time, likeObj);
  },

  /******************************************************
   * REMOVE LIKE
   ******************************************************/
  removeLike: function(time) {
    return this.deleteRowByKey(CONTEXT.sheets.likes, 'Time', time);
  }
};


/******************************************************
 * SOCIAL SERVICE
 *
 * Responsibility:
 * - Likes & Comments system
 * - User binding via email authority
 * - Idempotent like handling
 * - Confidence-weighted engagement
 ******************************************************/

/**
 * Ensure SocialDB sheet exists
 */
function getSocialSheet_() {
  return getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'SocialDB',
    [
      'AssetId',
      'UserEmail',
      'Action',       // like | comment
      'CommentText',
      'Confidence',
      'CreatedAt'
    ]
  );
}

/**
 * Like or Unlike an asset (idempotent)
 */
function toggleLike_(assetId, userData) {
  if (!assetId) throw new Error('AssetId required');

  const sheet = getSocialSheet_();
  const email = (userData.email || '').toLowerCase().trim();
  if (!email) throw new Error('User email required');

  // Ensure user exists
  getOrCreateUserByEmail_(userData);

  const rows = sheet.getDataRange().getValues();
  let existingRow = null;

  for (let i = 1; i < rows.length; i++) {
    if (
      rows[i][0] === assetId &&
      rows[i][1].toLowerCase() === email &&
      rows[i][2] === 'like'
    ) {
      existingRow = i + 1;
      break;
    }
  }

  if (existingRow) {
    // Unlike (remove row)
    sheet.deleteRow(existingRow);
    return { liked: false };
  }

  // Like
  sheet.appendRow([
    assetId,
    email,
    'like',
    '',
    calculateConfidence_(assetId, 'like'),
    new Date()
  ]);

  return { liked: true };
}

/**
 * Add a comment to an asset
 */
function addComment_(assetId, commentText, userData) {
  if (!assetId) throw new Error('AssetId required');
  if (!commentText) throw new Error('Comment text required');

  const sheet = getSocialSheet_();
  const email = (userData.email || '').toLowerCase().trim();
  if (!email) throw new Error('User email required');

  // Ensure user exists
  getOrCreateUserByEmail_(userData);

  const confidence = calculateConfidence_(assetId, 'comment', commentText);

  sheet.appendRow([
    assetId,
    email,
    'comment',
    commentText,
    confidence,
    new Date()
  ]);

  return { success: true };
}

/**
 * Get engagement for an asset
 */
function getAssetEngagement_(assetId) {
  const sheet = getSocialSheet_();
  const rows = sheet.getDataRange().getValues();

  let likes = 0;
  let comments = [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== assetId) continue;

    if (rows[i][2] === 'like') likes++;

    if (rows[i][2] === 'comment') {
      const user = getUserByEmail_(rows[i][1]);
      comments.push({
        text: rows[i][3],
        confidence: rows[i][4],
        createdAt: rows[i][5],
        user: user ? normalizeUser_(user) : null
      });
    }
  }

  return {
    likes,
    comments
  };
}

/**
 * Confidence scoring logic
 * Used for ranking, AI surfacing, trending
 */
function calculateConfidence_(assetId, type, content) {
  let score = 50;

  // Comment quality
  if (type === 'comment') {
    if (content && content.length > 20) score += 10;
    if (content && content.length > 80) score += 15;
  }

  // Engagement volume bonus
  const engagement = getAssetEngagement_(assetId);
  score += Math.min(engagement.likes * 2, 20);
  score += Math.min(engagement.comments.length * 3, 30);

  return Math.min(score, 100);
}


/******************************************************
 * TRIGGERS — orchestration & safety
 * Runs natively in Google Apps Script
 ******************************************************/

/**
 * Install all required triggers.
 * Safe to run multiple times (idempotent).
 */
function installTriggers() {
  removeAllProjectTriggers_();

  // Time-based ingestion trigger
  ScriptApp.newTrigger('triggerIngestion')
    .timeBased()
    .everyMinutes(SCAN_INTERVAL_MINUTES)
    .create();

  // Sheet edit trigger (manual overrides)
  ScriptApp.newTrigger('triggerSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  Logger.log('✅ Triggers installed');
}

/**
 * Remove all triggers for this project
 */
function removeAllProjectTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    ScriptApp.deleteTrigger(t);
  });
}

/******************************************************
 * INGESTION TRIGGER
 ******************************************************/

/**
 * Time-based trigger entrypoint
 * - lock protected
 * - rate-limited
 * - resumable
 */
function triggerIngestion() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    Logger.log('⏭️ Ingestion skipped — lock busy');
    return;
  }

  try {
    if (!rateLimitCheck_('ingestion')) {
      Logger.log('⏭️ Ingestion skipped — rate limited');
      return;
    }

    runIngestion_();

  } catch (err) {
    console.error('❌ triggerIngestion failed', err);
  } finally {
    lock.releaseLock();
  }
}

/******************************************************
 * SHEET EDIT TRIGGER
 ******************************************************/

/**
 * Spreadsheet edit trigger
 * Handles:
 * - manual Category override
 * - Status changes
 */
function triggerSheetEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  try {
    handleSheetEdit_(e);
  } catch (err) {
    console.error('❌ triggerSheetEdit failed', err);
  }
}

/******************************************************
 * INTERNAL HELPERS
 ******************************************************/

/**
 * Basic token-bucket rate limiter per trigger type
 */
function rateLimitCheck_(key) {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();

  const lastRun = Number(props.getProperty(`rate_${key}`) || 0);
  const minIntervalMs = 30 * 1000; // 30s safety window

  if (now - lastRun < minIntervalMs) {
    return false;
  }

  props.setProperty(`rate_${key}`, String(now));
  return true;
}

/**
 * Delegates ingestion to ingestion.service.gs
 */
function runIngestion_() {
  ingestDriveAssets(); // defined in ingestion.service.gs
}

/**
 * Delegates edit handling to sheet.service.gs
 */
function handleSheetEdit_(e) {
  onAssetsSheetEdit(e); // defined in sheet.service.gs
}


/******************************************************
 * USERS SERVICE
 *
 * Responsibility:
 * - CRUD operations for UsersDB
 * - Ensure email uniqueness (authority)
 * - Capture profile pic or fallback
 * - Integration point for Likes & Comments
 ******************************************************/

/**
 * Get or create user by email
 */
function getOrCreateUserByEmail_(userData) {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.getActive(),
    'UsersDB',
    ['Name', 'Email', 'Phone', 'ProfilePic', 'CreatedAt', 'UpdatedAt']
  );

  const email = (userData.email || '').toLowerCase().trim();
  if (!email) throw new Error('Email required');

  const rows = sheet.getDataRange().getValues();
  let rowIndex = null;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1].toLowerCase().trim() === email) {
      rowIndex = i + 1;
      break;
    }
  }

  const now = new Date();
  const profilePic = userData.profilePic || generatePlaceholderPic_(userData.name);

  if (rowIndex) {
    // Update existing
    sheet.getRange(rowIndex, 1, 1, 5).setValues([[
      userData.name || rows[rowIndex - 1][0],
      email,
      userData.phone || rows[rowIndex - 1][2],
      profilePic,
      now
    ]]);
    return sheet.getRange(rowIndex, 1, 1, 5).getValues()[0];
  } else {
    // Create new
    sheet.appendRow([
      userData.name || 'Anonymous',
      email,
      userData.phone || '',
      profilePic,
      now,
      now
    ]);

    return [userData.name || 'Anonymous', email, userData.phone || '', profilePic, now, now];
  }
}

/**
 * Generate placeholder profile pic
 */
function generatePlaceholderPic_(name) {
  if (!name) return 'https://via.placeholder.com/150?text=?';
  const initial = name.trim()[0].toUpperCase();
  return `https://via.placeholder.com/150?text=${encodeURIComponent(initial)}`;
}

/**
 * Fetch user by email
 */
function getUserByEmail_(email) {
  email = (email || '').toLowerCase().trim();
  if (!email) return null;

  const sheet = SpreadsheetApp.getActive().getSheetByName('UsersDB');
  if (!sheet) return null;

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1].toLowerCase().trim() === email) return rows[i];
  }
  return null;
}

/**
 * Fetch all users (optional for admin endpoints)
 */
function getAllUsers_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('UsersDB');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1);
}

/**
 * Normalize user data for API consumption
 */
function normalizeUser_(userRow) {
  return {
    name: userRow[0],
    email: userRow[1],
    phone: userRow[2],
    profilePic: userRow[3],
    createdAt: userRow[4],
    updatedAt: userRow[5]
  };
}


/******************************************************
 * UTILITY FUNCTIONS
 * Pure helpers for hashing, slugs, URLs, sizes, etc.
 ******************************************************/

/******************************************************
 * HASHING
 * Compute MD5 hash of a string or byte array
 ******************************************************/
function computeHash_(input) {
  if (!input) return '';
  
  if (typeof input === 'string') {
    return Utilities.computeDigest(CONFIG.INGESTION.HASH_ALGORITHM, input)
      .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
      .join('');
  }
  
  // Assume byte array
  return Utilities.computeDigest(CONFIG.INGESTION.HASH_ALGORITHM, input)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}

/******************************************************
 * SLUG GENERATION
 * Converts string into URL-friendly slug
 ******************************************************/
function generateSlug_(text) {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD')                     // normalize diacritics
    .replace(/[\u0300-\u036f]/g, '')     // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')         // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')             // trim leading/trailing hyphens
    .replace(/--+/g, '-')                 // collapse multiple hyphens
    ;
}

/******************************************************
 * IMAGE URL GENERATION
 * Build Google CDN image URL from FileID
 ******************************************************/
function buildImageCDN_(fileId, sizeSuffix) {
  if (!fileId) return '';
  sizeSuffix = sizeSuffix || CONFIG.IMAGE.DEFAULT_QUALITY_SUFFIX;
  return `${CONFIG.IMAGE.CDN_BASE}${fileId}${sizeSuffix}`;
}

/******************************************************
 * ASPECT RATIO
 ******************************************************/
function computeAspectRatio_(width, height) {
  width = Number(width);
  height = Number(height);
  if (!width || !height) return 1; // default fallback
  return width / height;
}

/******************************************************
 * SIZE CONVERSION
 * Converts bytes → human-readable string
 ******************************************************/
function formatFileSize_(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(2) + ' ' + units[i];
}

/******************************************************
 * TIMESTAMP HELPERS
 ******************************************************/
function nowISO_() {
  return new Date().toISOString();
}

/******************************************************
 * ARRAY & OBJECT HELPERS
 ******************************************************/
function uniqueArray_(arr) {
  return Array.from(new Set(arr));
}

function isEmpty_(val) {
  return val == null || val === '';
}

/******************************************************
 * SAFE GET
 * Returns val or default
 ******************************************************/
function safeGet_(obj, key, defaultValue) {
  return (obj && key in obj) ? obj[key] : defaultValue;
}

/******************************************************
 * OUTBOUND WEBHOOK EVENTS
 ******************************************************/

const WEBHOOK_URL = 'https://your-nextjs-site.com/api/webhook';

function emitEvent_(type, payload) {
  try {
    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        type,
        payload,
        ts: Date.now()
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    logDeadLetter_({
      stage: 'webhook',
      error: err.toString(),
      payload
    });
  }
}


/*

//Example triggers

emitEvent_('item.published', { assetId });
emitEvent_('comment.created', body);
emitEvent_('like.toggled', { assetId, email })

*/


function getConfig_(key, fallback) {
  const props = PropertiesService.getScriptProperties();
  const val = props.getProperty(key);
  return val !== null ? val : fallback;
}


