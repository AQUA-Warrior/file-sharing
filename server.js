const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const mime = require('mime-types');

const app = express();
const uploadRoot = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use('/', express.static(path.join(__dirname, 'public')));

// multer memory storage to manually write files preserving webkitRelativePath
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// helper: merge/overwrite metadata.json in destBase with newly added files
function updateMetadata(destBase, deviceName, addedFilesMeta) {
  const metaPath = path.join(destBase, 'metadata.json');
  let metadata = null;
  if (fs.existsSync(metaPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (err) {
      metadata = null;
    }
  }
  if (!metadata) {
    // first time: create initial metadata object
    metadata = {
      id: path.basename(destBase),
      deviceName: deviceName || 'unknown',
      timestamp: Date.now(),
      totalSize: 0,
      fileCount: 0,
      files: []
    };
  }
  // Build a map of existing files to allow overwrite/update
  const map = {};
  metadata.files.forEach(f => { map[f.relativePath] = f; });

  addedFilesMeta.forEach(f => {
    // replace or add
    map[f.relativePath] = { relativePath: f.relativePath, size: f.size };
  });

  // reconstruct files array from map (preserve insertion / sort by name)
  const filesArr = Object.keys(map).sort().map(k => map[k]);
  metadata.files = filesArr;
  metadata.fileCount = filesArr.length;
  metadata.totalSize = filesArr.reduce((s, x) => s + (x.size || 0), 0);
  // ensure timestamp remains the original creation time (keep earlier timestamp)
  if (!metadata.timestamp) metadata.timestamp = Date.now();

  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  return metadata;
}

// POST /upload -- Dropzone supplies files and for each file we append a 'relativePath' field
app.post('/upload', upload.array('file'), (req, res) => {
  try {
    const files = req.files || [];
    // req.body.relativePath may be single string or array of strings
    const rels = req.body.relativePath || [];
    const relArr = Array.isArray(rels) ? rels : (rels ? [rels] : []);
    // Use deviceName from body if available, else fallback
    const ua = req.body.deviceName || 'unknown';

    // Determine upload destination: use provided uploadId (session) so many file requests join one upload
    const incomingUploadId = req.body.uploadId || req.body.uploadSessionId || req.body.upload_id;
    const id = incomingUploadId ? String(incomingUploadId).replace(/[^a-zA-Z0-9-_\.]/g, '') : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const destBase = path.join(uploadRoot, id);
    fs.mkdirSync(destBase, { recursive: true });

    const filesMeta = [];

    files.forEach((file, i) => {
      const rel = relArr[i] || file.originalname;
      // protect against absolute paths
      const safeRel = rel.replace(/^[/\\]+/, '');
      const destPath = path.join(destBase, safeRel);
      const dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(destPath, file.buffer);
      const size = file.size || fs.statSync(destPath).size;
      filesMeta.push({ relativePath: safeRel.replace(/\\/g, '/'), size });
    });

    // Merge into existing metadata (so multiple file requests append to the same upload)
    const metadata = updateMetadata(destBase, ua, filesMeta);
    return res.json({ ok: true, metadata });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/uploads -- read all metadata.json files under uploads/
app.get('/api/uploads', (req, res) => {
  try {
    const ids = fs.readdirSync(uploadRoot).filter(name => {
      const full = path.join(uploadRoot, name);
      return fs.statSync(full).isDirectory();
    });
    const metas = ids.map(id => {
      try {
        const metaPath = path.join(uploadRoot, id, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          const raw = fs.readFileSync(metaPath, 'utf8');
          return JSON.parse(raw);
        }
      } catch (e) { /* ignore malformed */ }
      return null;
    }).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);
    res.json(metas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// helper to add a path (file or directory) to an archiver archive
function addPathToArchive(archive, baseDir, relPath) {
  const full = path.join(baseDir, relPath);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    // archive.directory preserves internal structure under relPath
    archive.directory(full, relPath);
  } else {
    archive.file(full, { name: relPath });
  }
}

// POST /api/download -- body: { uploadId, paths: [relative paths...] }
// If one path and it's a file -> return file directly; otherwise zip
app.post('/api/download', express.json(), (req, res) => {
  try {
    const { uploadId, paths } = req.body || {};
    if (!uploadId || !paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ ok: false, error: 'uploadId and paths required' });
    }
    const baseDir = path.join(uploadRoot, uploadId);
    if (!fs.existsSync(baseDir)) return res.status(404).json({ ok: false, error: 'upload not found' });

    // clean paths
    const cleanPaths = paths.map(p => p.replace(/^[/\\]+/, ''));

    // if single and is file -> sendFile
    if (cleanPaths.length === 1) {
      const candidate = path.join(baseDir, cleanPaths[0]);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const mimeType = mime.lookup(candidate) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(candidate)}"`);
        return res.sendFile(candidate);
      }
    }

    // multiple -> create zip and stream
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="download-${uploadId}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    cleanPaths.forEach(rel => {
      addPathToArchive(archive, baseDir, rel);
    });

    archive.finalize();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(err) });
  }
});

// DELETE /api/uploads/:id -- delete an upload and all its files
app.delete('/api/uploads/:id', (req, res) => {
  try {
    const id = req.params.id;
    const dir = path.join(uploadRoot, id);
    if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: 'Not found' });
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
