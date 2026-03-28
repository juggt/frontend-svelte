<script>
  import { api } from "../constants.mjs";
  import { session } from "../util.mjs";

  /**
   * @param {string} category  - category name (for API endpoint)
   * @param {Function} onValue - called with (value: string, date: Date|null) on success
   */
  let { category, onValue } = $props();

  let open = $state(false);
  let phase = $state("idle"); // idle | processing | done | error
  let photoEnabled = $state(/** @type {boolean|null} */ (null)); // null = noch nicht geladen
  let previewUrl = $state(null);
  let recognized = $state("");
  let recognizedDate = $state(/** @type {Date|null} */ (null));
  let errorMsg = $state("");
  let videoStream = $state(null);
  let videoEl = $state(null);
  let cameraActive = $state(false);
  let canvasEl = $state(null);
  let captureDate = $state(/** @type {Date|null} */ (null));
  let dateSource = $state(/** @type {"exif"|"capture"|null} */ (null));

  // Status einmalig beim ersten Rendern holen
  $effect(() => {
    fetch(`${api}/meter-photo/status`, {
      headers: session.authorizationHeader
    })
      .then(r => r.ok ? r.json() : { enabled: false })
      .then(d => { photoEnabled = d.enabled; })
      .catch(() => { photoEnabled = false; });
  });

  function show() {
    open = true;
    phase = "idle";
    previewUrl = null;
    recognized = "";
    errorMsg = "";
    captureDate = null;
    dateSource = null;
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
    captureDate = new Date(); // camera has no EXIF → use capture time
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    canvasEl.getContext("2d").drawImage(videoEl, 0, 0);
    previewUrl = canvasEl.toDataURL("image/jpeg", 0.92);
    stopCamera();
    runRecognition(previewUrl, "image/jpeg");
  }

  // ── File upload ──────────────────────────────────────────────

  /**
   * Resize image to max 1280px on the long side and re-encode as JPEG 0.85.
   * Handy-Fotos können 5–10MB sein — für OCR reicht 1280px völlig.
   */
  function resizeImage(file, maxPx = 1280, quality = 0.85) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        const scale = Math.min(1, maxPx / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.split(",")[1]);
      };
      img.src = url;
    });
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    previewUrl = URL.createObjectURL(file);
    captureDate = null; // backend extracts EXIF date

    phase = "processing";
    const base64 = await resizeImage(file);
    runRecognition(base64, "image/jpeg", true);
  }

  // ── Backend API recognition ──────────────────────────────────
  async function runRecognition(imageData, mimeType, isBase64 = false) {
    phase = "processing";
    errorMsg = "";
    recognized = "";
    recognizedDate = null;

    try {
      // If imageData is a data URL (from camera canvas), extract base64
      const base64 = isBase64
        ? imageData
        : imageData.startsWith("data:")
          ? imageData.split(",")[1]
          : imageData;

      const response = await fetch(
        `${api}/category/${category}/meter-photo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...session.authorizationHeader
          },
          body: JSON.stringify({ image: base64, mimeType })
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API ${response.status}: ${text}`);
      }

      const result = await response.json();

      if (!result.value) {
        throw new Error(`Keine Zahl erkannt (Antwort: "${result.raw}")`);
      }

      recognized = result.value;

      // Use backend EXIF date, or fall back to camera capture time
      if (result.date) {
        recognizedDate = new Date(result.date);
        dateSource = "exif";
      } else if (captureDate) {
        recognizedDate = captureDate;
        dateSource = "capture";
      }

      phase = "done";
    } catch (e) {
      errorMsg = e.message;
      phase = "error";
    }
  }

  function accept() {
    onValue(recognized, recognizedDate);
    close();
  }
</script>

<!-- Trigger button -->
<button
  type="button"
  class="photo-btn"
  class:disabled={photoEnabled === false}
  title={photoEnabled === false ? "Foto-Erkennung nicht verfügbar: API-Key nicht konfiguriert" : "Wert per Foto erkennen"}
  disabled={photoEnabled === false}
  onclick={show}
>
  📷
</button>

<!-- Modal -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="backdrop" role="presentation" onclick={close}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Wert per Foto erkennen">
    <div class="modal-header">
      <h2>Wert per Foto erkennen</h2>
      <button type="button" class="close-btn" onclick={close} aria-label="Schließen">✕</button>
    </div>

    {#if phase === "idle" && !cameraActive}
      <div class="actions">
        <label class="action-btn primary">
          📷 Foto aufnehmen
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onchange={handleFile}
          />
        </label>

        <label class="action-btn">
          📁 Aus Galerie
          <input
            type="file"
            accept="image/*"
            hidden
            onchange={handleFile}
          />
        </label>

        {#if typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia}
          <button type="button" class="action-btn" onclick={startCamera}>
            🎥 Live-Kamera
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
            <span class="date-source">
              {dateSource === "exif" ? "(aus EXIF)" : "(Aufnahmezeit)"}
            </span>
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
  .photo-btn:hover:not(:disabled) { background: var(--hover-bg, #f0f0f0); }
  .photo-btn:disabled,
  .photo-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

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

  @media (max-width: 640px) {
    .modal {
      top: auto;
      bottom: 0;
      left: 0;
      transform: none;
      width: 100vw;
      border-radius: 12px 12px 0 0;
      max-height: 92vh;
    }
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
    padding: 0.6rem 1rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    cursor: pointer;
    background: var(--background-color, #fff);
    color: var(--color, inherit);
    font-size: 0.95rem;
    min-height: 44px;
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
