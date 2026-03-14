<script>
  import { createWorker } from "tesseract.js";
  import exifr from "exifr";

  /**
   * Called when OCR succeeds.
   * @param {string} value  - recognized numeric string
   * @param {Date|null} date - EXIF date from file, or Date.now() from camera, or null
   */
  let { onValue } = $props();

  let open = $state(false);
  let phase = $state("idle"); // idle | processing | done | error
  let previewUrl = $state(null);
  let recognized = $state("");
  let recognizedDate = $state(/** @type {Date|null} */ (null));
  let errorMsg = $state("");
  let videoStream = $state(null);
  let videoEl = $state(null);
  let cameraActive = $state(false);
  let canvasEl = $state(null);
  let fileInput = $state(null);

  function show() {
    open = true;
    phase = "idle";
    previewUrl = null;
    recognized = "";
    errorMsg = "";
  }

  function close() {
    stopCamera();
    open = false;
  }

  // ── Camera ──────────────────────────────────────────────────
  async function startCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 } }
      });
      cameraActive = true;
      // bind stream after videoEl is mounted
    } catch (e) {
      errorMsg = "Kamera nicht verfügbar: " + e.message;
      phase = "error";
    }
  }

  $effect(() => {
    if (cameraActive && videoEl && videoStream) {
      videoEl.srcObject = videoStream;
    }
  });

  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
    cameraActive = false;
  }

  function captureSnapshot() {
    if (!videoEl || !canvasEl) return;
    const now = new Date(); // capture time before any async work
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    canvasEl.getContext("2d").drawImage(videoEl, 0, 0);
    previewUrl = canvasEl.toDataURL("image/png");
    stopCamera();
    runOcr(previewUrl, now);
  }

  // ── File upload ──────────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    previewUrl = URL.createObjectURL(file);

    // Extract EXIF date (DateTimeOriginal → DateTime → file lastModified)
    let fileDate = null;
    try {
      const exif = await exifr.parse(file, ["DateTimeOriginal", "DateTime"]);
      fileDate = exif?.DateTimeOriginal ?? exif?.DateTime ?? null;
    } catch {
      // no EXIF → fall back to file modification time
    }
    if (!fileDate && file.lastModified) {
      fileDate = new Date(file.lastModified);
    }

    runOcr(file, fileDate);
  }

  // ── Image pre-processing for better 7-segment OCR ───────────
  async function preprocessImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        // Crop to the lower-center third where meter display typically sits
        // (roughly 55%–85% vertical, center 70% horizontal)
        const cx = Math.floor(w * 0.15);
        const cy = Math.floor(h * 0.55);
        const cw = Math.floor(w * 0.70);
        const ch = Math.floor(h * 0.30);

        // Scale up 2× for better OCR
        const scale = 2;
        const out = document.createElement("canvas");
        out.width  = cw * scale;
        out.height = ch * scale;
        const ctx = out.getContext("2d");

        ctx.drawImage(img, cx, cy, cw, ch, 0, 0, out.width, out.height);

        // Grayscale + contrast boost
        const id = ctx.getImageData(0, 0, out.width, out.height);
        const d  = id.data;
        for (let i = 0; i < d.length; i += 4) {
          // Luminance → grayscale
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // High-contrast: push toward black/white
          const contrast = Math.min(255, Math.max(0, (gray - 128) * 2.5 + 128));
          d[i] = d[i + 1] = d[i + 2] = contrast;
        }
        ctx.putImageData(id, 0, 0);
        resolve(out.toDataURL("image/png"));
      };
      img.onerror = reject;

      if (source instanceof File || source instanceof Blob) {
        img.src = URL.createObjectURL(source);
      } else {
        img.src = source;
      }
    });
  }

  // ── OCR ─────────────────────────────────────────────────────
  async function runOcr(source, date = null) {
    phase = "processing";
    errorMsg = "";
    recognized = "";
    recognizedDate = date instanceof Date ? date : null;

    // Test hook: set window.__OCR_MOCK__ = "1234.5" to bypass real OCR
    if (typeof window !== "undefined" && window.__OCR_MOCK__ != null) {
      recognized = String(window.__OCR_MOCK__);
      phase = "done";
      return;
    }

    try {
      // Pre-process image to improve 7-segment recognition
      const processed = await preprocessImage(source);

      const worker = await createWorker("eng", 1, { logger: () => {} });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789.,",
        tessedit_pageseg_mode: "7" // SINGLE_LINE
      });
      const { data } = await worker.recognize(processed);
      await worker.terminate();

      const raw = data.text.trim();
      const match = raw.match(/\d+([.,]\d+)?/);
      if (match) {
        recognized = match[0].replace(",", ".");
        phase = "done";
      } else {
        errorMsg = `Keine Zahl erkannt. (OCR-Text: "${raw}")`;
        phase = "error";
      }
    } catch (e) {
      errorMsg = "OCR-Fehler: " + e.message;
      phase = "error";
    }
  }

  function accept() {
    onValue(recognized, recognizedDate);
    close();
  }
</script>

<!-- Trigger button -->
<button type="button" class="photo-btn" title="Wert per Foto erkennen" onclick={show}>
  📷
</button>

<!-- Modal -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={close}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Wert per Foto erkennen">
    <div class="modal-header">
      <h2>Wert per Foto erkennen</h2>
      <button type="button" class="close-btn" onclick={close} aria-label="Schließen">✕</button>
    </div>

    {#if phase === "idle" && !cameraActive}
      <div class="actions">
        <label class="action-btn">
          📁 Foto hochladen
          <input
            bind:this={fileInput}
            type="file"
            accept="image/*"
            hidden
            onchange={handleFile}
          />
        </label>

        {#if typeof navigator !== "undefined" && navigator.mediaDevices}
          <button type="button" class="action-btn" onclick={startCamera}>
            📸 Kamera öffnen
          </button>
        {/if}
      </div>
    {/if}

    <!-- Live camera view -->
    {#if cameraActive}
      <div class="camera-view">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoEl} autoplay playsinline></video>
        <canvas bind:this={canvasEl} hidden></canvas>
        <div class="camera-controls">
          <button type="button" class="action-btn primary" onclick={captureSnapshot}>
            📷 Aufnehmen
          </button>
          <button type="button" class="action-btn" onclick={stopCamera}>
            Abbrechen
          </button>
        </div>
      </div>
    {/if}

    <!-- Preview -->
    {#if previewUrl && !cameraActive}
      <div class="preview">
        <img src={previewUrl} alt="Vorschau" />
      </div>
    {/if}

    <!-- Processing -->
    {#if phase === "processing"}
      <p class="status processing">⏳ Erkenne Wert…</p>
    {/if}

    <!-- Result -->
    {#if phase === "done"}
      <div class="result">
        <p class="status success">✅ Erkannt: <strong>{recognized}</strong></p>
        {#if recognizedDate}
          <p class="status date-hint">
            🕐 Datum: <strong>{recognizedDate.toLocaleString("de-DE")}</strong>
            {#if !previewUrl?.startsWith("data:")}
              <span class="date-source">(aus EXIF)</span>
            {:else}
              <span class="date-source">(Aufnahmezeit)</span>
            {/if}
          </p>
        {/if}
        <div class="result-actions">
          <button type="button" class="action-btn primary" onclick={accept}>
            Wert übernehmen
          </button>
          <button type="button" class="action-btn" onclick={() => { phase = "idle"; previewUrl = null; }}>
            Nochmal
          </button>
        </div>
      </div>
    {/if}

    <!-- Error -->
    {#if phase === "error"}
      <p class="status error">❌ {errorMsg}</p>
      <button type="button" class="action-btn" onclick={() => { phase = "idle"; previewUrl = null; }}>
        Nochmal versuchen
      </button>
    {/if}
  </div>
{/if}

<style>
  .photo-btn {
    font-size: 1.2rem;
    background: none;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    vertical-align: middle;
  }
  .photo-btn:hover { background: var(--hover-bg, #f0f0f0); }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0 0 0 / 0.5);
    z-index: 100;
  }

  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--background-color, #fff);
    border: 1px solid var(--border-color, #ccc);
    border-radius: 8px;
    padding: 1.5rem;
    z-index: 101;
    width: min(480px, 95vw);
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .modal-header h2 { margin: 0; font-size: 1.1rem; }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    color: var(--color, inherit);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .action-btn {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    cursor: pointer;
    background: var(--background-color, #fff);
    color: var(--color, inherit);
    font-size: 0.95rem;
  }
  .action-btn:hover { background: var(--hover-bg, #f0f0f0); }
  .action-btn.primary {
    background: var(--primary-color, #007bff);
    color: #fff;
    border-color: var(--primary-color, #007bff);
  }
  .action-btn.primary:hover { filter: brightness(0.9); }

  .camera-view {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .camera-view video {
    width: 100%;
    border-radius: 4px;
    max-height: 50vh;
    object-fit: cover;
  }
  .camera-controls { display: flex; gap: 0.5rem; }

  .preview img {
    width: 100%;
    max-height: 50vh;
    object-fit: contain;
    border-radius: 4px;
    margin-bottom: 0.75rem;
  }

  .status {
    margin: 0.5rem 0;
    font-size: 0.95rem;
  }
  .processing  { color: var(--color-muted, #666); }
  .success     { color: #2e7d32; }
  .error       { color: #c62828; }
  .date-hint   { color: var(--color-muted, #555); margin-top: 0.25rem; }
  .date-source { font-size: 0.8rem; opacity: 0.7; margin-left: 0.25rem; }

  .result { margin-top: 0.5rem; }
  .result-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
</style>
