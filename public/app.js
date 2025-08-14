document.addEventListener('DOMContentLoaded', () => {
  loadSessions();

  const uploadBtn = document.getElementById('uploadBtn');
  uploadBtn.addEventListener('click', uploadFiles);

  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('downloadSelectedBtn').addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('.modal-files-list input[type="checkbox"]:checked'));
    const files = checked.map(c => JSON.parse(c.dataset.file));
    if (files.length) downloadFiles(files);
  });
  document.getElementById('downloadAllBtn').addEventListener('click', () => {
    const all = Array.from(document.querySelectorAll('.modal-files-list input[type="checkbox"]'));
    const files = all.map(c => JSON.parse(c.dataset.file));
    if (files.length) downloadFiles(files);
  });
});

function loadSessions() {
  fetch('/api/uploads')
    .then((res) => res.json())
    .then((data) => {
      renderSessions(data);
    })
    .catch((err) => console.error(err));
}

function renderSessions(sessionsData) {
  const sessionsContainer = document.getElementById('sessionsContainer');
  sessionsContainer.innerHTML = '';

  sessionsData.forEach((session) => {
    const card = document.createElement('div');
    card.classList.add('session-card');

    const delBtn = document.createElement('button');
    delBtn.classList.add('delete-btn');
    delBtn.title = 'Delete session';
    delBtn.setAttribute('aria-label', 'Delete session');
    delBtn.innerHTML = '✖';

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this session and its files? This cannot be undone.')) return;
      fetch(`/api/uploads/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE' })
        .then((res) => {
          if (!res.ok) throw new Error('Delete failed');
          return res.json();
        })
        .then(() => {
          loadSessions();
        })
        .catch((err) => {
          console.error('Delete error:', err);
          alert('Failed to delete session.');
        });
    });

    const header = document.createElement('div');
    header.classList.add('session-header');
    header.textContent = `${session.deviceName}`;

    const meta = document.createElement('div');
    meta.classList.add('session-meta');
    meta.textContent = `Time: ${session.timestamp} • Total: ${formatBytes(session.totalSize)} • ${session.description}`;

    card.addEventListener('click', () => openSessionModal(session));

    card.appendChild(delBtn);
    card.appendChild(header);
    card.appendChild(meta);
    sessionsContainer.appendChild(card);
  });
}

function openSessionModal(session) {
  const modal = document.getElementById('sessionModal');
  document.getElementById('modalTitle').textContent = `Files — ${session.deviceName}`;
  const info = document.getElementById('modalSessionInfo');
  info.textContent = `Time: ${session.timestamp} • Total Size: ${formatBytes(session.totalSize)} • ${session.description}`;

  const list = document.getElementById('modalFilesList');
  list.innerHTML = '';

  session.files.forEach((file) => {
    const item = document.createElement('div');
    item.classList.add('file-item');

    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.file = JSON.stringify(file);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = file.originalName;

    const metaSpan = document.createElement('span');
    metaSpan.classList.add('file-meta');
    metaSpan.textContent = formatBytes(file.size);

    label.appendChild(checkbox);
    label.appendChild(nameSpan);
    label.appendChild(metaSpan);

    item.appendChild(label);

    nameSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadFiles([file]);
    });

    list.appendChild(item);
  });

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const modal = document.getElementById('sessionModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function downloadFiles(files) {
  if (!files || !files.length) return;

  if (files.length === 1) {
    const file = files[0];
    const url = `/uploads/${encodeURIComponent(file.storedName)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.originalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  fetch('/api/download-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('Failed to create zip');
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = Date.now();
      a.href = url;
      a.download = `files_${timestamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch((err) => {
      console.error('Zip download error:', err);
      alert('Failed to download files as zip.');
    });
}

function uploadFiles() {
  const fileInput = document.getElementById('fileInput');
  const progressStatus = document.getElementById('progressStatus');

  if (!fileInput.files.length) {
    alert('Please select one or more files/folders to upload.');
    return;
  }

  const formData = new FormData();

  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append('files', fileInput.files[i]);
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload', true);

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percentComplete = Math.round((event.loaded / event.total) * 100);
      progressStatus.textContent = `Upload Progress: ${percentComplete}%`;
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      progressStatus.textContent = 'Upload complete!';
      fileInput.value = '';
      loadSessions();
    } else {
      progressStatus.textContent = 'Error uploading files.';
    }
  };

  xhr.send(formData);
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}