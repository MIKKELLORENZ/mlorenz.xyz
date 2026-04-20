// =============================
// SpectrAudio – app.js (revised)
// =============================
(() => {
    "use strict";

    /* --------------  CONSTANTS -------------- */
    const MAX_FILE_SIZE_MB = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

    /* --------------  DOM HOOKS -------------- */
    const $ = (id) => document.getElementById(id);

    const el = {
      uploadArea: $("upload-area"),
      imageInput: $("image-input"),

      stepCrop: $("step-crop"),
      imgCrop: $("image-to-crop"),
      btnRotL: $("rotate-left"),
      btnRotR: $("rotate-right"),
      btnFlipH: $("flip-horizontal"),
      btnFlipV: $("flip-vertical"),
      btnCropOk: $("crop-confirm"),

      minFreq: $("min-freq"),
      maxFreq: $("max-freq"),
      duration: $("duration"),
      sampleRate: $("sample-rate"), // Add sample rate input
      btnProcess: $("process-button"),

      stepRes: $("step-result"),
      imgPreview: $("spectrogram-preview"),
      audioPlayer: $("audio-player"),
      spinner: $("processing-message"),
      btnDownload: $("download-button"),

      progWrap: $("progress-container"),
      progBar: $("progress-bar"),
      reconstructionMethod: $("reconstruction-method"), // Add the new select element
    };

    /* --------------  STATE -------------- */
    const state = {
      originalURI: null,
      croppedURI: null,
      cropper: null,
      audioBlob: null,
      flipH: 1,
      flipV: 1,
    };

    /* --------------  HELPERS -------------- */
    function showStep(step) {
      ["crop", "result"].forEach((s) => {
        const elStep = document.getElementById(`step-${s}`);
        if (elStep) elStep.style.display = s === step ? "block" : "none";
      });
      document.getElementById(`step-${step}`)?.scrollIntoView({ behavior: "smooth" });
    }

    function resetResultUI() {
      state.audioBlob = null;
      el.audioPlayer.src = "";
      el.audioPlayer.style.display = "none";
      el.btnDownload.disabled = true;
      el.btnDownload.style.display = "none";
      el.spinner.style.display = "none";
      el.progWrap.style.display = "none";
      el.progBar.style.width = "0%";
      // Also clear the preview image on reset
      el.imgPreview.src = "";
    }

    /* --------------  UPLOAD + CROP -------------- */
    // Proxy click so the entire area triggers file dialog
    el.uploadArea.addEventListener("click", () => el.imageInput.click());

    const dragEvents = ["dragover", "dragenter", "dragleave", "drop"];
    dragEvents.forEach((ev) => {
      el.uploadArea.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === "dragover" || ev === "dragenter") {
          e.dataTransfer.dropEffect = "copy";
          el.uploadArea.classList.add("drag-over");
        } else {
          el.uploadArea.classList.remove("drag-over");
        }
      });
    });

    el.uploadArea.addEventListener("drop", (e) => {
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    el.imageInput.addEventListener("change", (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
      if (!file.type.match(/image\/(png|jpeg|jpg)/i)) { // More robust regex, case-insensitive
        alert("Please upload a PNG or JPG image.");
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        alert(`File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        state.originalURI = ev.target.result;
        state.croppedURI = null; // Reset cropped URI on new upload
        el.imgCrop.src = state.originalURI; // Trigger load event
        resetResultUI(); // Clear previous results
        showStep("crop"); // Show cropping step
      };
      reader.onerror = (err) => {
          console.error("FileReader error:", err);
          alert("Error reading file.");
          // Optionally reset UI further if needed
      };
      reader.readAsDataURL(file);
    }

    // Initialize / re-initialize cropper when image source changes
    el.imgCrop.addEventListener("load", () => {
      // Check if the src is actually set (might trigger on empty src assignment)
      if (!el.imgCrop.src || el.imgCrop.src.startsWith('data:,')) return; // Ignore empty/default src
      if (!state.originalURI) return; // Ensure original URI is set

      // Destroy previous cropper instance if it exists
      state.cropper?.destroy();
      state.flipH = state.flipV = 1; // Reset flips

      try {
        state.cropper = new Cropper(el.imgCrop, {
          viewMode: 2,
          autoCropArea: 1,
          background: false,
          responsive: true,
          restore: false,
          zoomOnWheel: true,
          checkOrientation: false, // Avoid potential conflicts with manual rotation/flip
          ready: () => {
              console.log("Cropper is ready.");
              // You could potentially enable crop button here if needed
          }
        });
      } catch (err) {
          console.error("Failed to initialize Cropper:", err);
          alert("Error initializing image cropper. Please try reloading the image.");
          // Reset relevant state if cropper fails
          state.cropper = null;
          showStep('upload'); // Or hide crop step
      }
    });

    // Add error handling for cropper actions if needed, though most are safe
    el.btnRotL.addEventListener("click", () => {
        if (!state.cropper) return;
        try { state.cropper.rotate(-90); } catch (e) { console.error("Rotate error", e); }
    });
    el.btnRotR.addEventListener("click", () => {
        if (!state.cropper) return;
        try { state.cropper.rotate(90); } catch (e) { console.error("Rotate error", e); }
    });
    el.btnFlipH.addEventListener("click", () => {
      if (!state.cropper) return;
      try {
          state.flipH *= -1;
          state.cropper.scaleX(state.flipH);
      } catch (e) { console.error("Flip H error", e); }
    });
    el.btnFlipV.addEventListener("click", () => {
      if (!state.cropper) return;
      try {
          state.flipV *= -1;
          state.cropper.scaleY(state.flipV);
      } catch (e) { console.error("Flip V error", e); }
    });

    el.btnCropOk.addEventListener("click", () => {
      if (!state.cropper) {
          alert("Cropper not initialized. Please upload an image again.");
          return;
      }
      let canvas = null;
      try {
          canvas = state.cropper.getCroppedCanvas({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high",
            // Consider adding maxWidth/maxHeight constraints if needed
            // maxWidth: 4096,
            // maxHeight: 4096,
          });
      } catch (err) {
          console.error("Cropping failed:", err);
          alert("Failed to crop the image. The selection might be too small or invalid.");
          return;
      }

      if (!canvas) {
        alert("Failed to get cropped canvas. Please try cropping again.");
        return;
      }

      try {
          state.croppedURI = canvas.toDataURL("image/png"); // Or 'image/jpeg'
          el.imgPreview.src = state.croppedURI;

          // Successfully cropped, destroy cropper and move to next step
          state.cropper.destroy();
          state.cropper = null;
          showStep("result");
      } catch (err) {
          console.error("Failed to convert canvas to Data URL:", err);
          alert("Error processing cropped image. Please try again.");
          // Clean up if necessary
          state.croppedURI = null;
          el.imgPreview.src = "";
          state.cropper?.destroy(); // Ensure cropper is destroyed if error occurs after creation
          state.cropper = null;
          showStep("crop"); // Go back to crop step
      }
    });

    /* --------------  PROCESS → AUDIO -------------- */
    let griffinLim = null; // Keep instance reusable
    let progressUpdateTimer = null; // For tracking progress updates

    el.btnProcess.addEventListener("click", async () => {
      if (!state.croppedURI) {
        alert("Please upload and confirm crop of a spectrogram first.");
        return;
      }

      resetResultUI(); // Clear previous results before starting
      el.spinner.style.display = "flex";
      el.progWrap.style.display = "block";
      el.progBar.style.width = "0%"; // Ensure progress starts at 0

      // Log processing start
      console.log("Starting audio generation process...");

      // Get and validate parameters
      const minF = parseInt(el.minFreq.value, 10); // Use radix 10
      const maxF = parseInt(el.maxFreq.value, 10);
      const dur = parseFloat(el.duration.value);
      const sr = parseInt(el.sampleRate.value, 10); // Get sample rate
      const quality = el.reconstructionMethod.value; // Get selected quality

      if (isNaN(minF) || isNaN(maxF) || isNaN(dur) || isNaN(sr)) { // Validate sample rate
          alert("Invalid settings: Frequency, Duration, and Sample Rate must be numbers.");
          el.spinner.style.display = "none"; // Hide spinner on validation fail
          el.progWrap.style.display = "none";
          return;
      }

      if (minF < 0 || maxF <= 0 || minF >= maxF) {
        alert("Invalid frequency range: Minimum must be >= 0, Maximum must be > 0, and Minimum must be less than Maximum.");
        el.spinner.style.display = "none";
        el.progWrap.style.display = "none";
        return;
      }
      if (dur <= 0) {
        alert("Duration must be a positive number.");
        el.spinner.style.display = "none";
        el.progWrap.style.display = "none";
        return;
      }
      if (sr < 8000 || sr > 48000) { // Add validation for sample rate
          alert("Sample Rate must be between 8000 Hz and 48000 Hz.");
          el.spinner.style.display = "none";
          el.progWrap.style.display = "none";
          return;
      }

      // Log parameters
      console.log(`Parameters: ${minF}-${maxF}Hz, ${dur}s, ${sr}Hz, Quality: ${quality}`);

      // Define progress callback with timeout safeguard
      let lastProgressUpdate = Date.now();
      
      const updateProgress = (p) => {
          // Ensure progress is between 0 and 1
          const progressPercent = Math.max(0, Math.min(1, p)) * 100;
          
          // Update progress bar
          el.progBar.style.width = `${progressPercent.toFixed(1)}%`;
          
          // Log progress at most every 1 second
          const now = Date.now();
          if (now - lastProgressUpdate > 1000) {
              console.log(`Processing progress: ${progressPercent.toFixed(1)}%`);
              lastProgressUpdate = now;
          }
          
          // Ensure progress feedback even if browser is busy
          clearTimeout(progressUpdateTimer);
          progressUpdateTimer = setTimeout(() => {
              console.log(`Processing still active: ${progressPercent.toFixed(1)}%`);
              // Force repaint of progress bar if needed
              el.progBar.style.opacity = "0.99";
              setTimeout(() => {
                  el.progBar.style.opacity = "1";
              }, 10);
          }, 2000);
      };

      try {
        // Ensure TensorFlow.js is ready
        console.log("Initializing TensorFlow.js...");
        await tf.ready();
        console.log("TensorFlow.js backend:", tf.getBackend());

        // Determine iterations based on quality setting
        let iterations;
        switch (quality) {
          case 'high':
            iterations = 50; // More iterations for higher quality
            console.log("Using high quality mode (50 iterations)");
            break;
          case 'fastest':
            iterations = 10; // Fewer iterations for speed
            console.log("Using fastest mode (10 iterations)");
            break;
          case 'balanced':
          default:
            iterations = 30; // Default balanced setting
            console.log("Using balanced mode (30 iterations)");
            break;
        }

        // Initialize GriffinLim
        // Re-initialize if settings change or it's the first run
        if (!griffinLim || griffinLim.iterations !== iterations || griffinLim.sampleRate !== sr) {
            console.log(`Initializing GriffinLim with ${iterations} iterations, ${sr} Hz.`);
            // Dispose previous instance if exists and settings changed
            if (griffinLim) {
                // Potentially add a dispose method to GriffinLim if needed for internal state cleanup
                console.log("Re-initializing GriffinLim due to settings change.");
            }
            griffinLim = new GriffinLim({ fftSize: 2048, iterations: iterations, sampleRate: sr });
        }

        // Load image and prepare spectrogram
        console.log("Loading cropped image data...");
        const img = await loadImage(state.croppedURI);
        console.log(`Image loaded: ${img.naturalWidth}x${img.naturalHeight}`);

        // Draw image to canvas
        console.log("Converting image to spectrogram data...");
        const cvs = document.createElement("canvas");
        cvs.width = img.naturalWidth; // Use naturalWidth for accuracy
        cvs.height = img.naturalHeight;
        const ctx = cvs.getContext("2d", { willReadFrequently: true }); // Hint for performance
        if (!ctx) throw new Error("Could not get 2D context from canvas.");
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);

        // Convert image to magnitude spectrogram tensor
        const spec = griffinLim.imageToSpectrogram(imgData, {
          minFreq: minF,
          maxFreq: maxF,
          // Sample rate is now handled by the instance
        });
        if (!spec || spec.rank !== 2) {
            spec?.dispose(); // Dispose if invalid
            throw new Error("Failed to generate valid spectrogram tensor from image.");
        }


        // Reconstruct audio samples using Griffin-Lim
        console.log(`Starting audio reconstruction with Griffin-Lim algorithm...`);
        // Pass duration and progress callback. Sample rate is handled by the instance.
        const samples = await griffinLim.reconstruct(spec, dur, updateProgress);
        spec.dispose(); // Dispose spectrogram tensor after use

        if (!samples || samples.length === 0) {
            throw new Error("Audio reconstruction resulted in empty samples.");
        }

        // Create WAV blob
        state.audioBlob = griffinLim.createWavFile(samples);
        const url = URL.createObjectURL(state.audioBlob);

        // Update UI with results
        el.audioPlayer.src = url;
        el.audioPlayer.style.display = "block";
        el.btnDownload.style.display = "block";
        el.btnDownload.disabled = false;
        console.log("Audio generation successful.");

      } catch (err) {
        console.error("Error during audio processing:", err);
        alert(`Error processing spectrogram: ${err.message || err}`);
        // Ensure UI is reset correctly on error
        resetResultUI(); // Call reset which handles hiding player/button/spinner/progress
      } finally {
        // Clean up timer
        clearTimeout(progressUpdateTimer);
        // Always hide spinner and progress bar when done (success or error)
        el.spinner.style.display = "none";
        el.progWrap.style.display = "none";
        el.progBar.style.width = "0%"; // Reset progress bar visually
      }
    });

    /* --------------  DOWNLOAD -------------- */
    el.btnDownload.addEventListener("click", () => {
      if (!state.audioBlob) {
          alert("No audio data available to download.");
          return;
      }
      let url = null;
      try {
          url = URL.createObjectURL(state.audioBlob);
          const a = document.createElement("a");
          a.href = url;
          // Generate a slightly more unique filename
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          a.download = `spectrogram_audio_${timestamp}.wav`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Revoke URL after a short delay
          setTimeout(() => {
              if (url) URL.revokeObjectURL(url);
              console.log("Revoked blob URL:", url);
          }, 1500); // Increased delay slightly
      } catch (err) {
          console.error("Download failed:", err);
          alert("Could not create download link.");
          // Clean up URL if it was created before the error
          if (url) {
              try { URL.revokeObjectURL(url); } catch (revokeErr) { console.error("Error revoking URL:", revokeErr); }
          }
      }
    });

    /* --------------  UTILITY -------------- */
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => {
            console.error("Image load error:", err);
            reject(new Error("Failed to load image"));
        };
        // Check if src is valid before setting? Basic check:
        if (!src || typeof src !== 'string' || !src.startsWith('data:image/')) {
            return reject(new Error("Invalid image source provided."));
        }
        img.src = src;
      });
    }

    // Initial setup
    showStep('upload'); // Or determine initial step based on state if needed

})();