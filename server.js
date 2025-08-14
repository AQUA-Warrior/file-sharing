const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadSessions = [];

const SESSIONS_FILE = path.join(__dirname, 'uploads', 'sessions.json');

function saveSessionsToDisk() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(uploadSessions, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save sessions:', err);
  }
}

function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([], null, 2), 'utf8');
      return;
    }
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      const uploadsDir = path.join(__dirname, 'uploads');
      const validSessions = parsed.map((s) => {
        const files = Array.isArray(s.files) ? s.files.filter((f) => {
          const p = path.resolve(path.join(uploadsDir, String(f.storedName || '')));
          return p.startsWith(path.resolve(uploadsDir)) && fs.existsSync(p);
        }) : [];
        const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
        return Object.assign({}, s, { files, totalSize });
      }).filter((s) => Array.isArray(s.files) && s.files.length > 0);
      uploadSessions.splice(0, uploadSessions.length, ...validSessions);
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

loadSessionsFromDisk();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, './uploads');
  },
  filename(req, file, cb) {
    cb(null, Date.now() + '_' + file.originalname);
  },
});

const upload = multer({ storage });

app.get('/api/uploads', (req, res) => {
  res.json(uploadSessions);
});

app.post('/api/upload', upload.array('files'), (req, res) => {
  let deviceName = req.body.deviceName || os.hostname() || 'Unknown-Device';
  const sessionId = Date.now().toString();
  const filesUploaded = req.files.map((file) => {
    return {
      originalName: file.originalname,
      storedName: path.basename(file.path),
      size: file.size,
    };
  });
  const totalSize = filesUploaded.reduce((sum, f) => sum + (f.size || 0), 0);
  const newSession = {
    sessionId,
    deviceName,
    timestamp: new Date().toLocaleString(),
    files: filesUploaded,
    totalSize,
    description: `Uploaded ${filesUploaded.length} file${filesUploaded.length !== 1 ? 's' : ''}`,
  };
  uploadSessions.unshift(newSession);
  saveSessionsToDisk();
  return res.json({
    message: 'Files uploaded successfully',
    session: newSession,
  });
});

app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.post('/api/download-zip', (req, res) => {
  const files = req.body && req.body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  const uploadsDir = path.join(__dirname, 'uploads');
  const zipName = `files_${Date.now()}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    try { res.status(500).end(); } catch (e) {}
  });

  archive.pipe(res);

  files.forEach((f) => {
    const storedName = String(f.storedName || f.stored || '');
    const originalName = String(f.originalName || path.basename(storedName) || storedName);
    const filePath = path.join(uploadsDir, storedName);
    const resolved = path.resolve(filePath);
    if (resolved.startsWith(path.resolve(uploadsDir)) && fs.existsSync(resolved)) {
      archive.file(resolved, { name: originalName });
    }
  });

  archive.finalize();
});

app.delete('/api/uploads/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const uploadsDir = path.join(__dirname, 'uploads');

  const idx = uploadSessions.findIndex(s => String(s.sessionId) === String(sessionId));
  if (idx === -1) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const session = uploadSessions[idx];

  try {
    (Array.isArray(session.files) ? session.files : []).forEach((f) => {
      const storedName = String(f.storedName || '');
      if (!storedName) return;
      const filePath = path.join(uploadsDir, storedName);
      const resolved = path.resolve(filePath);
      if (resolved.startsWith(path.resolve(uploadsDir)) && fs.existsSync(resolved)) {
        try { fs.unlinkSync(resolved); } catch (e) { console.warn('Failed to delete file', resolved, e); }
      }
    });

    uploadSessions.splice(idx, 1);
    saveSessionsToDisk();

    return res.json({ message: 'Session deleted', sessionId });
  } catch (err) {
    console.error('Failed to delete session:', err);
    return res.status(500).json({ error: 'Failed to delete session' });
  }
});

app.listen(port, () => {
  console.log(`File-share server running on http://localhost:${port}`);
});