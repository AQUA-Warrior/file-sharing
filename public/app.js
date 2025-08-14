Dropzone.autoDiscover = false

const dz = new Dropzone("#my-dropzone", {
  url: '/upload',
  paramName: 'file',
  uploadMultiple: false,
  parallelUploads: 10,
  clickable: true,
  init: function () {
    this.uploadSessionId = null

    this.on("addedfile", (file) => {
      if (!this.uploadSessionId) {
        this.uploadSessionId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`
      }
    })

    this.on("sending", function (file, xhr, formData) {
      formData.append('relativePath', file.webkitRelativePath || file.name)
      formData.append('deviceName', navigator.userAgent || 'browser')
      if (this.uploadSessionId) formData.append('uploadId', this.uploadSessionId)
    })
    this.on("queuecomplete", function () {
      loadUploads()
      this.removeAllFiles()
      this.uploadSessionId = null
    })
  }
})

const chooseBtn = document.getElementById('chooseBtn')
const folderInput = document.getElementById('folderInput')
if (chooseBtn && folderInput) {
  chooseBtn.addEventListener('click', () => folderInput.click())
  folderInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || [])
    files.forEach(f => dz.addFile(f))
    folderInput.value = ''
  })
}

const uploadsGrid = document.getElementById('uploads-grid')
const modal = document.getElementById('modal')
const modalTitle = document.getElementById('modal-title')
const fileTree = document.getElementById('file-tree')
const modalClose = document.getElementById('modal-close')
const downloadSelectedBtn = document.getElementById('download-selected')
const downloadAllBtn = document.getElementById('download-all')

let currentUpload = null

function humanBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB'
  if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + ' MB'
  return (n/1024/1024/1024).toFixed(1) + ' GB'
}

function buildTree(files) {
  const root = {}
  files.forEach(f => {
    const parts = f.relativePath.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!node[part]) {
        node[part] = { __children: {}, __meta: null }
      }
      if (i === parts.length - 1) {
        node[part].__meta = f
      }
      node = node[part].__children
    }
  })
  Object.keys(root).forEach(k => {
    root[k].__children = root[k].__children || {}
  })
  return root
}

async function loadUploads() {
  uploadsGrid.innerHTML = ''
  const resp = await fetch('/api/uploads')
  const list = await resp.json()
  list.forEach(meta => {
    const div = document.createElement('div')
    div.className = 'tile'
    div.innerHTML = `
      <h3>${meta.deviceName}</h3>
      <div class="meta">Files: ${meta.fileCount} • Size: ${humanBytes(meta.totalSize)}</div>
      <div class="meta small">Uploaded: ${new Date(meta.timestamp).toLocaleString()}</div>
      <button class="delete-btn" style="margin-top:8px;">Delete</button>
    `
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return
      openModal(meta)
    })
    div.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (confirm('Delete this upload?')) {
        await fetch(`/api/uploads/${meta.id}`, { method: 'DELETE' })
        loadUploads()
      }
    })
    uploadsGrid.appendChild(div)
  })
}

function propagateCheckboxToChildren(container, checked) {
  const boxes = container.querySelectorAll('input[type=checkbox]')
  boxes.forEach(b => { b.checked = checked })
}

function renderTree(node, base = '') {
  const ul = document.createElement('ul')
  Object.keys(node).forEach(key => {
    const entry = node[key]
    const li = document.createElement('li')
    const hasChildren = Object.keys(entry.__children).length > 0
    li.className = hasChildren ? 'file-item folder' : 'file-item file'

    const row = document.createElement('div')
    row.className = 'file-row'

    const caret = document.createElement('span')
    caret.className = 'caret'
    caret.textContent = hasChildren ? '▶' : ''
    row.appendChild(caret)

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const relPath = entry.__meta ? entry.__meta.relativePath : (base ? base + '/' + key : key)
    checkbox.dataset.path = relPath
    row.appendChild(checkbox)

    const icon = document.createElement('span')
    icon.className = 'icon ' + (hasChildren ? 'folder' : 'file')
    row.appendChild(icon)

    const nameSpan = document.createElement('span')
    nameSpan.className = 'name'
    nameSpan.textContent = key + (hasChildren ? '/' : '')
    row.appendChild(nameSpan)

    const info = document.createElement('span')
    info.className = 'small'
    if (entry.__meta) info.textContent = ` ${humanBytes(entry.__meta.size)}`
    row.appendChild(info)

    if (entry.__meta && !hasChildren) {
      const singleBtn = document.createElement('button')
      singleBtn.textContent = 'Download'
      singleBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const p = checkbox.dataset.path
        downloadPaths([p], baseUploadId())
      })
      row.appendChild(singleBtn)
    }

    li.appendChild(row)

    if (hasChildren) {
      const childrenWrap = document.createElement('div')
      childrenWrap.className = 'children'
      const subtree = renderTree(entry.__children, (base ? base + '/' + key : key))
      childrenWrap.appendChild(subtree)
      li.appendChild(childrenWrap)

      function openChildren() {
        const isOpen = childrenWrap.classList.toggle('open')
        caret.classList.toggle('open', isOpen)
        caret.textContent = isOpen ? '▾' : '▶'
      }
      caret.addEventListener('click', (e) => { e.stopPropagation(); openChildren() })
      nameSpan.addEventListener('click', (e) => { e.stopPropagation(); openChildren() })

      checkbox.addEventListener('change', () => {
        propagateCheckboxToChildren(childrenWrap, checkbox.checked)
      })

      childrenWrap.addEventListener('change', () => {
        const childBoxes = childrenWrap.querySelectorAll('input[type=checkbox]')
        const checkedCount = Array.from(childBoxes).filter(b => b.checked).length
        if (checkedCount === 0) checkbox.checked = false
        else if (checkedCount === childBoxes.length) checkbox.checked = true
        else checkbox.indeterminate = true
      })
    } else {
      nameSpan.addEventListener('click', () => { checkbox.checked = !checkbox.checked })
    }

    ul.appendChild(li)
  })
  return ul
}

function baseUploadId() {
  return currentUpload ? currentUpload.id : null
}

function openModal(meta) {
  currentUpload = meta
  modalTitle.textContent = `${meta.deviceName} • ${meta.fileCount} files • ${humanBytes(meta.totalSize)}`
  fileTree.innerHTML = ''
  const treeRoot = buildTree(meta.files)
  fileTree.appendChild(renderTree(treeRoot))
  modal.classList.remove('hidden')
}

modalClose.addEventListener('click', () => modal.classList.add('hidden'))
downloadSelectedBtn.addEventListener('click', () => {
  const checked = Array.from(fileTree.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.dataset.path)
  if (!checked.length) return alert('Select at least one file or folder')
  downloadPaths(checked, baseUploadId())
})
downloadAllBtn.addEventListener('click', () => {
  const all = currentUpload.files.map(f => f.relativePath)
  downloadPaths(all, baseUploadId())
})

async function downloadPaths(paths, uploadId) {
  if (!uploadId) return
  const res = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, paths })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download failed' }))
    return alert('Download failed: ' + (err.error || 'unknown'))
  }
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename="([^"]+)"/.exec(cd)
  const filename = m ? m[1] : (paths.length === 1 ? (paths[0].split('/').pop()) : `download-${uploadId}.zip`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

loadUploads()

async function downloadPaths(paths, uploadId) {
  if (!uploadId) return;
  const res = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, paths })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download failed' }));
    return alert('Download failed: ' + (err.error || 'unknown'));
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename="([^"]+)"/.exec(cd);
  const filename = m ? m[1] : (paths.length === 1 ? (paths[0].split('/').pop()) : `download-${uploadId}.zip`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

loadUploads();
