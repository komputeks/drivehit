/******************************************************
 * APPS SCRIPT GALLERY SYSTEM v1.0.0 - 
 ******************************************************/
// =============================
// CONFIGURATION
// =============================
const ROOT_FOLDER_NAME = 'UploadedForWeb';
const UNCATEGORIZED = 'Uncategorized';
const AUTO_CATEGORIZED = 'AutoCategorized';
const ARCHIVE = 'Archive';
const SHEET_NAME = 'AssetsDB';
const STATUS_VALUES = ['published', 'hidden', 'archived'];
const SCAN_INTERVAL_MINUTES = 1;
// SECURITY TOKENS
const INTERNAL_TOKEN = PropertiesService.getScriptProperties().getProperty('INTERNAL_TOKEN');
const ISR_SECRET = PropertiesService.getScriptProperties().getProperty('ISR_SECRET');
const NEXTJS_REVALIDATE_URL = PropertiesService.getScriptProperties().getProperty('NEXTJS_REVALIDATE_URL');
const THUMB_WIDTH = 400;
const THUMB_HEIGHT = 300;
let editInProgress = false;
let ISR_QUEUE = new Set();

// =============================
// ENTRY POINT
// =============================
function bootstrap() {
  const root = getOrCreateFolder_(ROOT_FOLDER_NAME);
  const uncategorized = getOrCreateSubfolder_(root, UNCATEGORIZED);
  const auto = getOrCreateSubfolder_(root, AUTO_CATEGORIZED);
  getOrCreateSubfolder_(root, ARCHIVE);
  ensurePublic_(root);
  ensurePublic_(uncategorized);
  ensurePublic_(auto);
  const sheet = getOrCreateSheet_();
  setupSheet_(sheet); // will auto-add Likes & Comments columns if missing
  installTimeTrigger_();
  runIngestion_(); // internal run, token not required
}

/******************************************************
 * 🚀  * Ingestion Pipeline (REQUIRED)
 ******************************************************/
function runIngestion_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    const sheet = getOrCreateSheet_();
    const index = buildSheetIndex_(sheet);
    const updatedRows = [];

    // Scan Uncategorized
    scanFolderIncremental_(
      getFolder_(UNCATEGORIZED),
      UNCATEGORIZED,
      index,
      updatedRows
    );

    // Scan AutoCategorized recursively
    scanAutoCategoriesIncremental_(
      getFolder_(AUTO_CATEGORIZED),
      index,
      updatedRows,
      ''
    );

    // Write updates
    if (updatedRows.length) {
      sheet
        .getRange(2, 1, updatedRows.length, updatedRows[0].length)
        .setValues(updatedRows);
    }

    // ISR revalidation
    ISR_QUEUE.forEach(slug => pushNextJSRevalidate_(slug));
    ISR_QUEUE.clear();

  } finally {
    lock.releaseLock();
  }
}

// =============================
// ON EDIT HANDLER (TOKEN-PROTECTED FOR EXTERNAL EDITS)
// =============================
function onEdit(e) {
  assertToken_(e); // enforce token for all edits
  if (editInProgress) return;
  editInProgress = true;
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEET_NAME || e.range.getRow() === 1) return;
    const row = e.range.getRow();
    const col = e.range.getColumn();
    const data = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0]; // use dynamic last column
    const [id, name, categoryPath, categorySlug, slug, status] = data;
    if (!id) return;
    const file = DriveApp.getFileById(id);
    // Rename in Drive
    if (col === 2 && file.getName() !== name) {
      file.setName(name);
      ISR_QUEUE.add(slug);
    }
    // Move to category
    if (col === 3) {
      moveFileToCategory_(file, categoryPath);
      ISR_QUEUE.add(slug);
    }
    // Status changes (archive / restore)
    if (col === 6) {
      if (status === 'archived') softDeleteFile_(file);
      if (status === 'published') restoreFile_(file, categoryPath);
      ISR_QUEUE.add(slug);
    }
    ISR_QUEUE.forEach(s => pushNextJSRevalidate_(s));
    ISR_QUEUE.clear();
  } finally {
    editInProgress = false;
  }
}

// =============================
// DRIVE FOLDER HELPERS
// =============================
function getOrCreateFolder_(name) {
  const f = DriveApp.getFoldersByName(name);
  return f.hasNext() ? f.next() : DriveApp.createFolder(name);
}
function getOrCreateSubfolder_(parent, name) {
  const f = parent.getFoldersByName(name);
  return f.hasNext() ? f.next() : parent.createFolder(name);
}
function getFolder_(name) {
  return DriveApp.getFoldersByName(name).next();
}
function ensurePublic_(item) {
  if (item.getSharingAccess() !== DriveApp.Access.ANYONE) {
    item.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
  }
}
function moveFileToCategory_(file, category) {
  const root = getFolder_(AUTO_CATEGORIZED);
  const target = getOrCreateSubfolder_(root, category);
  const parents = file.getParents();
  while (parents.hasNext()) parents.next().removeFile(file);
  target.addFile(file);
}
function softDeleteFile_(file) {
  const archive = getOrCreateSubfolder_(getFolder_(ROOT_FOLDER_NAME), ARCHIVE);
  const parents = file.getParents();
  while (parents.hasNext()) parents.next().removeFile(file);
  archive.addFile(file);
}
function restoreFile_(file, category) {
  moveFileToCategory_(file, category);
}

// =============================
// SHEET HELPERS
// =============================
function getOrCreateSheet_() {
  let ss;
  const files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
    ensurePublic_(DriveApp.getFileById(ss.getId()));
  }
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(SHEET_NAME);
  }
  return sh;
}

// 🚀 Ensure Likes & Comments columns exist
function setupSheet_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  let modified = false;

  if (!headers.includes('Likes')) {
    sh.insertColumnAfter(headers.length);
    sh.getRange(1, headers.length + 1).setValue('Likes');
    modified = true;
  }
  if (!headers.includes('Comments')) {
    sh.insertColumnAfter(sh.getLastColumn());
    sh.getRange(1, sh.getLastColumn()).setValue('Comments');
    modified = true;
  }

  // Fill missing Likes/Comments in existing rows
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (modified && lastRow > 1) {
    const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const likesIndex = sh.getRange(1, 1, 1, lastCol).getValues()[0].indexOf('Likes');
    const commentsIndex = sh.getRange(1, 1, 1, lastCol).getValues()[0].indexOf('Comments');

    for (let i = 0; i < data.length; i++) {
      if (likesIndex >= 0 && (data[i][likesIndex] === '' || data[i][likesIndex] === null)) data[i][likesIndex] = 0;
      if (commentsIndex >= 0 && (data[i][commentsIndex] === '' || data[i][commentsIndex] === null)) data[i][commentsIndex] = '[]';
    }
    sh.getRange(2, 1, data.length, lastCol).setValues(data);
  }

  // Original headers setup
  if (sh.getLastRow() === 0) {
    sh.appendRow([
      'FileId','FileName','Category','Slug','Status','FileSize','MimeType','Width','Height',
      'Confidence','Caption','UpdatedAt','FileUrl','Thumbnail','Hash','AspectRatio','Likes','Comments'
    ]);
    sh.getRange('E2:E').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS_VALUES).build()
    );
  }
}

// =============================
// BUILD SHEET INDEX
// =============================
function buildSheetIndex_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const idx = {};
  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i][0];
    const hash = rows[i][14];
    const caption = rows[i][10];
    const likesCol = headers.indexOf('Likes');        
    const commentsCol = headers.indexOf('Comments');  
    idx[id] = { 
      row: i + 1, 
      hash, 
      caption,
      likes: likesCol >= 0 ? rows[i][likesCol] : 0,             
      comments: commentsCol >= 0 ? rows[i][commentsCol] : []   
    };
  }
  return idx;
}

// =============================
// SCAN FOLDERS & UPSERT FILES
// =============================
function scanFolderIncremental_(folder, category, index, updatedRows) {
  const files = folder.getFiles();
  while (files.hasNext()) upsertFileIncremental_(files.next(), category, index, updatedRows);
}
function scanAutoCategoriesIncremental_(folder, index, updatedRows, path) {
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const sub = subfolders.next();
    const newPath = path ? `${path}/${sub.getName()}` : sub.getName();
    scanFolderIncremental_(sub, newPath, index, updatedRows);
    scanAutoCategoriesIncremental_(sub, index, updatedRows, newPath);
  }
}

// =============================
// UPSERT FILE
// =============================
function upsertFileIncremental_(file, category, index, updatedRows) {
  const id = file.getId();
  const hash = makeHash_(file);
  if (index[id] && index[id].hash === hash) return;

  const resolution = getResolution_(file);
  const aspect = calculateAspect_(resolution.width, resolution.height);
  const size = humanSize_(file.getSize());
  const slug = slugify_(file.getName());
  const inferredCategory = inferCategorySmart_(file, category, resolution);
  const confidence = scoreConfidence_(file, inferredCategory, resolution);
  
  const row = index[id] ? index[id].row : Object.keys(index).length + 2;
  const manualCaption = index[id]?.caption || '';
  const likes = index[id]?.likes || 0;            
  const comments = index[id]?.comments || '[]';   

  const values = [
    id,
    file.getName(),
    inferredCategory,
    slug,
    index[id]?.status || 'published',
    size,
    file.getMimeType(),
    resolution.width,
    resolution.height,
    confidence,
    manualCaption,
    new Date().toISOString(),
    directLink_(id),
    thumbnailUrl_(file),
    hash,
    aspect,
    likes,       
    comments     
  ];

  updatedRows.push(values);
  index[id] = { row, hash, caption: manualCaption, likes, comments }; 
  ISR_QUEUE.add(slug);
}

/******************************************************
 * Web API endpoint for Next.js gallery consumption
 ******************************************************/

function doGet(e) {
  const sheet = getOrCreateSheet_(); // ✅ use existing helper
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return createEmptyResponse_(); // no assets

  const headers = data[0];
  const rows = data.slice(1);

  const json = rows
    .filter(row => row[headers.indexOf('FileId')]) // 🚀 ignore rows without FileId
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== "" && row[i] != null ? row[i] : null;
      });

      // 🚀 ensure safe defaults for new columns
      if (!obj.Likes) obj.Likes = 0;
      if (!obj.Comments) obj.Comments = [];
      else obj.Comments = safeParseJSON(obj.Comments, []); // parse existing comments safely

      // 🚀 infer Type from MimeType if missing
      if (!obj.Type && obj.MimeType) obj.Type = inferTypeFromMime_(obj.MimeType);

      // 🚀 ensure URL/Thumbnail
      obj.FileUrl = obj.FileUrl || directLink_(obj.FileId);
      obj.Thumbnail = obj.Thumbnail || thumbnailUrl_(obj);

      return obj;
    });

  return ContentService
    .createTextOutput(JSON.stringify(json))
    .setMimeType(ContentService.MimeType.JSON);
}

// 🚀 return empty JSON safely
function createEmptyResponse_() {
  return ContentService.createTextOutput('[]')
    .setMimeType(ContentService.MimeType.JSON);
}

// 🚀 infer type from mime type
function inferTypeFromMime_(mime) {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf') return 'pdf';
  return 'image';
}

// 🚀 safe JSON parse
function safeParseJSON(str, defaultValue) {
  try { return JSON.parse(str); } 
  catch(e) { return defaultValue; }
}

/******************************************************
 * Utilities & Enhancements for Production
 ******************************************************/

// 🚀 Get Drive file metadata (size, width, height)
function getDriveFileMetadata(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    let width = null, height = null;
    try {
      const meta = Drive.Files.get(fileId, { fields: 'imageMediaMetadata' });
      if (meta.imageMediaMetadata) {
        width = meta.imageMediaMetadata.width || null;
        height = meta.imageMediaMetadata.height || null;
      }
    } catch(e) { /* ignore for non-images */ }
    return { size: file.getSize(), width, height };
  } catch (err) {
    console.error("Drive metadata error for fileId", fileId, err);
    return { size: null, width: null, height: null };
  }
}

// 🚀 Thumbnail helper for videos/images/PDF
function thumbnailUrl_(file) {
  if (file.getMimeType().startsWith('image/')) {
    // 🆕 Stable, public, CDN-backed image URL
    return `https://lh3.googleusercontent.com/d/${file.getId()}=w${THUMB_WIDTH}`
  }
  
  // 🆕 Safe placeholder for non-images
  return `https://via.placeholder.com/${THUMB_WIDTH}x${THUMB_HEIGHT}?text=Video`
}

// 🚀 Hash for file change detection
function makeHash_(file) {
  const id = file.getId();
  const modified = file.getLastUpdated().getTime();
  const size = file.getSize();
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, `${id}-${modified}-${size}`)
    .map(b => (b & 0xFF).toString(16).padStart(2, '0')).join('');
}

// 🚀 Get resolution safely (used in ingestion)
function getResolution_(file) {
  try {
    const meta = Drive.Files.get(file.getId(), { fields: 'imageMediaMetadata' });
    const img = meta.imageMediaMetadata;
    if (img && img.width && img.height) return { width: img.width, height: img.height };
  } catch(e) {}
  return { width: null, height: null };
}

// 🚀 Slugify helper
function slugify_(s) {
  return s.toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// 🚀 Human readable file size
function humanSize_(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// 🚀 Calculate aspect ratio
function calculateAspect_(width, height) {
  if (!width || !height) return '';
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 1.78) < 0.05) return '16:9';
  if (Math.abs(ratio - 0.56) < 0.05) return '9:16';
  if (Math.abs(ratio - 1.33) < 0.05) return '4:3';
  return 'Other';
}

// 🚀 Confidence scoring (existing logic)
function scoreConfidence_(file, category, resolution) {
  let score = 30;
  const name = file.getName().toLowerCase();
  if (category !== 'Uncategorized') score += 30;
  if (name.match(/banner|icon|hero|screenshot|logo/)) score += 20;
  if (resolution.width && resolution.height) score += 20;
  return Math.min(100, score);
}

// 🚀 Apply background color based on confidence
function applyConfidenceColor_(cell, value) {
  if (value >= 80) cell.setBackground('#4CAF50');       // Green
  else if (value >= 50) cell.setBackground('#FFC107');  // Gold
  else cell.setBackground('#F44336');                   // Red
}
/******************************************************
 * 🚀  * Time-based ingestion trigger installer
 * (REQUIRED by bootstrap)
 ******************************************************/
function installTimeTrigger_() {
  // Remove existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runIngestion_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create fresh time-based trigger
  ScriptApp.newTrigger('runIngestion_')
    .timeBased()
    .everyMinutes(SCAN_INTERVAL_MINUTES)
    .create();
}

/******************************************************
 * Bulk Download & Comments
 ******************************************************/

// =============================
// 🚀 BULK DOWNLOAD (ZIP a folder) 
// Usage: provide folderId, returns a downloadable Blob
// Note: may timeout for >~500 files; for large sets, use paginated batching
// =============================
function bulkDownloadFolder(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const blobs = [];
  while (files.hasNext()) {
    const file = files.next();
    blobs.push(file.getBlob());
  }
  const zip = Utilities.zip(blobs, folder.getName() + '.zip');
  return zip; // Blob can be sent via web app response
}

// =============================
// 🚀 COMMENTS HANDLING
// - Read/Write comments stored as JSON in "Comments" column
// - Each comment: { user: "Name or email", text: "Comment", date: ISOString }
// =============================
function getComments(fileId) {
  const sheet = getOrCreateSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowIndex = data.findIndex(r => r[0] === fileId);
  if (rowIndex < 1) return [];
  const commentsCol = headers.indexOf('Comments');
  if (commentsCol < 0) return [];
  return safeParseJSON(data[rowIndex][commentsCol], []);
}

function addComment(fileId, user, text) {
  const sheet = getOrCreateSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowIndex = data.findIndex(r => r[0] === fileId);
  if (rowIndex < 1) return false;
  const commentsCol = headers.indexOf('Comments');
  if (commentsCol < 0) return false;
  
  const existingComments = safeParseJSON(data[rowIndex][commentsCol], []);
  existingComments.push({ user, text, date: new Date().toISOString() });
  sheet.getRange(rowIndex + 1, commentsCol + 1).setValue(JSON.stringify(existingComments));
  return true;
}

// =============================
// 🚀 ISR QUEUE ENHANCEMENTS FOR HIGH VOLUME
// =============================
function pushNextJSRevalidate_(slug) {
  assertInternalCall_(); // cannot be called externally
  if (!NEXTJS_REVALIDATE_URL || !slug) return;
  try {
    // Add small delay to avoid overloading Next.js on large batches
    Utilities.sleep(50);
    UrlFetchApp.fetch(
      `${NEXTJS_REVALIDATE_URL}?slug=${encodeURIComponent(slug)}&secret=${encodeURIComponent(ISR_SECRET)}`,
      { method: 'post', muteHttpExceptions: true }
    );
  } catch (err) {
    Logger.log('Next.js revalidate error: ' + err);
  }
}

// =============================
// 🚀 SAFE PARSING UTIL (already used in previous chunks, included here for reference)
function safeParseJSON(str, defaultValue) {
  try { return JSON.parse(str); } 
  catch(e) { return defaultValue; }
}
