<script>
  import { createWorker } from "tesseract.js";

  /** Called with the recognized numeric string when OCR succeeds */
  let { onValue } = $props();

  let open = $state(false);
  let phase = $state("idle"); // idle | processing | done | error
  let previewUrl = $state(null);
  let recognized = $state("");
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
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    canvasEl.getContext("2d").drawImage(videoEl, 0, 0);
    previewUrl = canvasEl.toDataURL("image/png");
    stopCamera();
    runOcr(previewUrl);
  }

  // ── File upload ──────────────────────────────────────────────
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    previewUrl = URL.createObjectURL(file);
    runOcr(file);
  }

  // ── OCR ─────────────────────────────────────────────────────
  async function runOcr(source) {
    phase = "processing";
    errorMsg = "";
    recognized = "";
    try {
      const worker = await createWorker("eng", 1, {
        // Suppress verbose Tesseract logs
        logger: () => {}
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789.,",
        tessedit_pageseg_mode: "7" // SINGLE_LINE
      });
      const { data } = await worker.recognize(source);
      await worker.terminate();

      // Extract first plausible number
      const raw = data.text.trim();
      const match = raw.match(/[\d]+([.,]\d+)?/);
      if (match) {
        // Normalize comma → dot for decimal
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
    onValue(recognized);
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
  .processing { color: var(--color-muted, #666); }
  .success    { color: #2e7d32; }
  .error      { color: #c62828; }

  .result { margin-top: 0.5rem; }
  .result-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
</style>
