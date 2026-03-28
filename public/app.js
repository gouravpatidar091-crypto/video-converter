/* ══════════════════════════════════════════════
   Convertly — Frontend Logic
   ══════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── DOM refs ──────────────────────────────────
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const dropContent = document.getElementById("dropContent");
  const fileInfo = document.getElementById("fileInfo");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");
  const clearFileBtn = document.getElementById("clearFile");

  const formatBtns = document.querySelectorAll(".format-btn");
  const resBtns = document.querySelectorAll(".res-btn");

  const convertBtn = document.getElementById("convertBtn");
  const convertIcon = document.getElementById("convertIcon");
  const convertLabel = document.getElementById("convertLabel");

  const progressSection = document.getElementById("progressSection");
  const progressBar = document.getElementById("progressBar");
  const progressPct = document.getElementById("progressPct");
  const progressLabel = document.getElementById("progressLabel");
  const progressHint = document.getElementById("progressHint");

  const downloadSection = document.getElementById("downloadSection");
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadLabel = document.getElementById("downloadLabel");
  const convertAnother = document.getElementById("convertAnother");

  const errorSection = document.getElementById("errorSection");
  const errorMsg = document.getElementById("errorMsg");
  const retryBtn = document.getElementById("retryBtn");

  // ── State ─────────────────────────────────────
  let selectedFile = null;
  let selectedFormat = "mp4";
  let selectedResolution = "original";
  let pollTimer = null;
  let currentJobId = null;

  // ── File Helpers ──────────────────────────────

  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function isValidVideo(file) {
    const allowedTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/webm", "video/avi"];
    const allowedExts = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
    const ext = "." + file.name.split(".").pop().toLowerCase();
    return allowedTypes.includes(file.type) || allowedExts.includes(ext);
  }

  function setFile(file) {
    if (!isValidVideo(file)) {
      showError("Unsupported file type. Please upload MP4, MOV, AVI, MKV, or WebM.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      showError("File is too large. Maximum size is 500MB.");
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);

    dropContent.classList.add("hidden");
    fileInfo.classList.remove("hidden");

    convertBtn.disabled = false;
    convertLabel.textContent = `Convert to ${selectedFormat.toUpperCase()}`;
    hideError();
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = "";
    dropContent.classList.remove("hidden");
    fileInfo.classList.add("hidden");
    convertBtn.disabled = true;
    convertLabel.textContent = "Select a video first";
  }

  // ── Drop Zone Events ──────────────────────────

  dropZone.addEventListener("click", (e) => {
    if (e.target === clearFileBtn || clearFileBtn.contains(e.target)) return;
    fileInput.click();
  });

  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });

  clearFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearFile();
  });

  // Drag & Drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", (e) => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove("drag-over");
    }
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  // ── Format & Resolution Toggles ──────────────

  formatBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      formatBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedFormat = btn.dataset.format;
      if (selectedFile) convertLabel.textContent = `Convert to ${selectedFormat.toUpperCase()}`;
    });
  });

  resBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      resBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedResolution = btn.dataset.res;
    });
  });

  // ── Conversion ────────────────────────────────

  convertBtn.addEventListener("click", startConversion);

  async function startConversion() {
    if (!selectedFile) return;

    // Reset UI
    hideError();
    downloadSection.classList.add("hidden");
    progressSection.classList.remove("hidden");
    setProgress(0, "Uploading…");
    setConvertBtnLoading(true);

    try {
      const formData = new FormData();
      formData.append("video", selectedFile);
      formData.append("format", selectedFormat);
      formData.append("resolution", selectedResolution);

      // Upload
      const uploadRes = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        throw new Error(uploadData.error || "Upload failed");
      }

      currentJobId = uploadData.jobId;
      setProgress(5, "Queued for conversion…");

      // Start polling
      startPolling(currentJobId);
    } catch (err) {
      handleConversionError(err.message);
    }
  }

  function startPolling(jobId) {
    clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        const data = await res.json();

        if (!res.ok) {
          clearInterval(pollTimer);
          throw new Error(data.error || "Status check failed");
        }

        const status = data.status;

        if (status === "queued") {
          setProgress(3, "Queued…");
        } else if (status === "processing") {
          const pct = Math.max(5, data.progress || 0);
          setProgress(pct, `Converting… ${pct}%`);
        } else if (status === "done") {
          clearInterval(pollTimer);
          setProgress(100, "Done!");
          setTimeout(() => showDownload(data.downloadUrl, data.filename), 400);
        } else if (status === "error") {
          clearInterval(pollTimer);
          throw new Error(data.error || "Conversion failed");
        }
      } catch (err) {
        clearInterval(pollTimer);
        handleConversionError(err.message);
      }
    }, 1200); // poll every 1.2s
  }

  function setProgress(pct, label) {
    progressBar.style.width = pct + "%";
    progressPct.textContent = pct + "%";
    if (label) progressLabel.textContent = label;
  }

  function showDownload(url, filename) {
    progressSection.classList.add("hidden");
    setConvertBtnLoading(false);

    downloadBtn.href = `/api/download/${filename}`;
    downloadBtn.setAttribute("download", filename);
    downloadLabel.textContent = `Download ${filename}`;

    downloadSection.classList.remove("hidden");
  }

  function handleConversionError(msg) {
    progressSection.classList.add("hidden");
    setConvertBtnLoading(false);
    showError(msg);
  }

  function setConvertBtnLoading(loading) {
    if (loading) {
      convertBtn.classList.add("loading");
      convertIcon.innerHTML = `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" stroke-dasharray="31.4" stroke-dashoffset="10" fill="none" class="spin" style="transform-origin:center"/>`;
      convertIcon.setAttribute("viewBox", "0 0 24 24");
      // Use SVG spinner
      convertIcon.innerHTML = '';
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12');
      circle.setAttribute('r', '9');
      circle.setAttribute('stroke', 'rgba(255,255,255,0.3)');
      circle.setAttribute('stroke-width', '2.5'); circle.setAttribute('fill', 'none');
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arc.setAttribute('d', 'M12 3a9 9 0 019 9');
      arc.setAttribute('stroke', 'white'); arc.setAttribute('stroke-width', '2.5');
      arc.setAttribute('stroke-linecap', 'round'); arc.setAttribute('fill', 'none');
      convertIcon.appendChild(circle); convertIcon.appendChild(arc);
      convertIcon.classList.add('spin');
      convertLabel.textContent = "Converting…";
      convertBtn.disabled = true;
    } else {
      convertBtn.classList.remove("loading");
      convertIcon.classList.remove('spin');
      convertIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />`;
      convertBtn.disabled = !selectedFile;
      if (selectedFile) convertLabel.textContent = `Convert to ${selectedFormat.toUpperCase()}`;
    }
  }

  // ── Error / Reset ─────────────────────────────

  function showError(msg) {
    errorMsg.textContent = msg;
    errorSection.classList.remove("hidden");
  }

  function hideError() {
    errorSection.classList.add("hidden");
  }

  retryBtn.addEventListener("click", () => {
    hideError();
  });

  convertAnother.addEventListener("click", () => {
    downloadSection.classList.add("hidden");
    clearFile();
    currentJobId = null;
    clearInterval(pollTimer);
  });

  // ── Init ──────────────────────────────────────

  // Verify server health on load
  fetch("/health")
    .then((r) => r.json())
    .then((d) => {
      if (d.status !== "ok") console.warn("Server health check failed", d);
    })
    .catch(() => {
      showError("Cannot reach conversion server. Make sure it is running.");
    });
})();

