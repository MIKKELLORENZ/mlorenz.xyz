import os
import sys
import shutil
import subprocess


def discover_ffmpeg_binaries():
    ffmpeg_path = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg")
    ffprobe_path = os.environ.get("FFPROBE_BINARY") or shutil.which("ffprobe")

    if os.name == "nt" and (not ffmpeg_path or not ffprobe_path):
        winget_base = os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Microsoft",
            "WinGet",
            "Packages",
            "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
        )
        alt_winget_base = os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Microsoft",
            "WinGet",
            "Packages",
            "Gyan.FFmpeg_Microsoft.WinGet.Source_8wekyb3d8bbwe",
        )
        search_roots = [
            winget_base,
            alt_winget_base,
            os.path.join("C:\\", "ffmpeg"),
        ]

        for root in search_roots:
            if not os.path.isdir(root):
                continue
            for current_root, _, files in os.walk(root):
                if not ffmpeg_path and "ffmpeg.exe" in files:
                    ffmpeg_path = os.path.join(current_root, "ffmpeg.exe")
                if not ffprobe_path and "ffprobe.exe" in files:
                    ffprobe_path = os.path.join(current_root, "ffprobe.exe")
                if ffmpeg_path and ffprobe_path:
                    break
            if ffmpeg_path and ffprobe_path:
                break

    return ffmpeg_path, ffprobe_path


def prepare_ffmpeg_environment():
    ffmpeg_path, ffprobe_path = discover_ffmpeg_binaries()

    if ffmpeg_path and os.path.exists(ffmpeg_path):
        ffmpeg_dir = os.path.dirname(ffmpeg_path)
        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if ffmpeg_dir and ffmpeg_dir not in path_entries:
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
        os.environ["FFMPEG_BINARY"] = ffmpeg_path

    if ffprobe_path and os.path.exists(ffprobe_path):
        ffprobe_dir = os.path.dirname(ffprobe_path)
        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if ffprobe_dir and ffprobe_dir not in path_entries:
            os.environ["PATH"] = ffprobe_dir + os.pathsep + os.environ.get("PATH", "")
        os.environ["FFPROBE_BINARY"] = ffprobe_path

    return ffmpeg_path, ffprobe_path

def install_if_missing(packages):
    """Checks if the specified Python packages are installed and installs them if not."""
    for package in packages:
        try:
            __import__(package)
        except ImportError:
            print(f"Package '{package}' not found. Attempting to install...")
            try:
                # First, ensure pip is available
                try:
                    import pip
                except ImportError:
                    print("Pip not found. attempting to bootstrap with 'ensurepip'...")
                    # Try to bootstrap pip (adding --user and --break-system-packages if needed)
                    try:
                        subprocess.check_call([sys.executable, "-m", "ensurepip", "--default-pip"])
                    except subprocess.CalledProcessError:
                        # Fallback for restricted/MSYS2 environments
                        subprocess.check_call([sys.executable, "-m", "ensurepip", "--default-pip", "--user"])
                
                # Attempt installation with --break-system-packages if the first attempt fails due to PEP 668
                try:
                    subprocess.check_call([sys.executable, "-m", "pip", "install", package])
                except subprocess.CalledProcessError:
                    print(f"Standard install failed for '{package}'. Retrying with system override...")
                    subprocess.check_call([sys.executable, "-m", "pip", "install", package, "--break-system-packages"])
                
                print(f"Successfully installed '{package}'.")
            except subprocess.CalledProcessError as e:
                print(f"\nError: Could not install '{package}' automatically.")
                print(f"The current Python environment ({sys.executable}) appears to be missing 'pip' or is restricted.")
                print("Suggestions:")
                print("1. Run: python -m ensurepip --default-pip")
                print("2. Use a standard Python installation instead of a bundled one (like Inkscape/Blender).")
                print("3. Install manually: pip install " + " ".join(packages))
                sys.exit(1)
            except Exception as e:
                print(f"An unexpected error occurred during installation: {e}")
                sys.exit(1)

# List of required packages
REQUIRED_PACKAGES = ["numpy", "pydub", "scipy", "moviepy"]

# Run the installation check before other imports
install_if_missing(REQUIRED_PACKAGES)
prepare_ffmpeg_environment()

import numpy as np
from pydub import AudioSegment
from pydub import utils as pydub_utils
from scipy.io import wavfile
try:
    from moviepy.editor import AudioFileClip, VideoClip
except ImportError:
    from moviepy import AudioFileClip, VideoClip


def configure_ffmpeg_for_pydub():
    ffmpeg_path, ffprobe_path = prepare_ffmpeg_environment()

    if ffmpeg_path and os.path.exists(ffmpeg_path):
        ffmpeg_dir = os.path.dirname(ffmpeg_path)
        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if ffmpeg_dir and ffmpeg_dir not in path_entries:
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
        os.environ["FFMPEG_BINARY"] = ffmpeg_path
        AudioSegment.converter = ffmpeg_path
    if ffprobe_path and os.path.exists(ffprobe_path):
        ffprobe_dir = os.path.dirname(ffprobe_path)
        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if ffprobe_dir and ffprobe_dir not in path_entries:
            os.environ["PATH"] = ffprobe_dir + os.pathsep + os.environ.get("PATH", "")
        os.environ["FFPROBE_BINARY"] = ffprobe_path
        AudioSegment.ffprobe = ffprobe_path

    if ffmpeg_path:
        pydub_utils.get_encoder_name = lambda: ffmpeg_path
    if ffprobe_path:
        pydub_utils.get_prober_name = lambda: ffprobe_path

    return ffmpeg_path, ffprobe_path

def convert_and_render_video_dynamic_bars(input_file="input.m4a", output_video="output.mp4"):
    # --- Configuration ---
    LOGO_BLUE_RGB = (0, 28, 133)  # '#001C85'
    WAV_FILENAME = "temp_audio.wav"
    MAX_SECONDS = 20

    # Video
    W, H = 1920, 1080
    FPS = 30

    # Bar style
    N_BARS = 88
    BAR_GAP_PX = 7
    MIN_BAR_HEIGHT_PX = 8
    SMOOTHING_ATTACK = 0.55
    SMOOTHING_RELEASE = 0.90
    GAIN = 1.20
    GAMMA = 0.72          # <1 boosts low levels for a nicer look
    FREQ_SMOOTH_KERNEL = np.array([0.18, 0.64, 0.18], dtype=np.float32)

    # Spectrum analyzer settings
    FFT_MS = 96           # larger = smoother, smaller = snappier
    FMIN = 30             # Hz
    FMAX_CAP = 16000      # Hz cap (visual preference)
    DB_RANGE = 60         # dynamic range in dB mapped to [0..1]
    LOW_TILT_REF_HZ = 220.0
    LOW_TILT_CURVE = 0.35
    LOW_TILT_MIN = 0.60

    ffmpeg_path, ffprobe_path = configure_ffmpeg_for_pydub()
    if not ffmpeg_path or not ffprobe_path:
        print("Error: ffmpeg/ffprobe could not be located.")
        print("Install FFmpeg and ensure binaries are on PATH, or set FFMPEG_BINARY and FFPROBE_BINARY.")
        return

    print(f"1. Converting {input_file} to .wav format...")

    try:
        audio = AudioSegment.from_file(input_file, format="m4a")
        audio.export(WAV_FILENAME, format="wav")
    except Exception as e:
        print(f"Error converting audio: {e}")
        print(f"ffmpeg: {ffmpeg_path}")
        print(f"ffprobe: {ffprobe_path}")
        print("Ensure ffmpeg is installed and accessible.")
        return

    print("2. Loading audio...")

    samplerate, data = wavfile.read(WAV_FILENAME)

    # Convert to float mono in [-1, 1]
    if data.ndim == 2:
        data = data.mean(axis=1)
    data = data.astype(np.float32)
    peak = np.max(np.abs(data)) if len(data) else 1.0
    if peak > 0:
        data /= peak

    audio_clip_full = AudioFileClip(WAV_FILENAME)
    duration = min(MAX_SECONDS, audio_clip_full.duration)

    # --- Precompute spectrum binning ---
    def next_pow2(n: int) -> int:
        p = 1
        while p < n:
            p <<= 1
        return p

    n_fft = next_pow2(int((FFT_MS / 1000.0) * samplerate))
    window = np.hanning(n_fft).astype(np.float32)

    nyquist = samplerate / 2.0
    fmax = min(FMAX_CAP, nyquist)
    fmin = max(1.0, float(FMIN))

    freqs = np.fft.rfftfreq(n_fft, d=1.0 / samplerate)

    # Mel-spaced frequency edges (more perceptual and smoother low-end behavior)
    def hz_to_mel(freq_hz: float) -> float:
        return 2595.0 * np.log10(1.0 + (freq_hz / 700.0))

    def mel_to_hz(freq_mel: float) -> float:
        return 700.0 * ((10.0 ** (freq_mel / 2595.0)) - 1.0)

    mel_edges = np.linspace(hz_to_mel(fmin), hz_to_mel(fmax), N_BARS + 1)
    edges = mel_to_hz(mel_edges)
    band_centers = np.sqrt(edges[:-1] * edges[1:])
    low_tilt = np.clip((band_centers / LOW_TILT_REF_HZ) ** LOW_TILT_CURVE, LOW_TILT_MIN, 1.0).astype(np.float32)

    # Precompute FFT bin indices for each band (speed)
    band_bins = []
    for i in range(N_BARS):
        left = int(np.searchsorted(freqs, edges[i], side="left"))
        right = int(np.searchsorted(freqs, edges[i + 1], side="right"))
        left = max(0, min(left, len(freqs) - 1))
        right = max(left + 1, min(right, len(freqs)))
        idx = np.arange(left, right, dtype=np.int32)
        band_bins.append(idx)

    # Precompute bar geometry
    total_gap = BAR_GAP_PX * (N_BARS - 1)
    bar_w = max(2, (W - total_gap) // N_BARS)
    bars_total_w = N_BARS * bar_w + total_gap
    x0 = (W - bars_total_w) // 2

    # Drawing helper (square vertical bar)
    def draw_square_bar(frame, x, y_top, w, h, color):
        if h <= 0:
            return
        y_bottom = y_top + h
        x1 = max(0, x)
        x2 = min(W, x + w)
        y1 = max(0, y_top)
        y2 = min(H, y_bottom)
        if x2 <= x1 or y2 <= y1:
            return

        frame[y1:y2, x1:x2, :] = color

    # Smoothing state
    prev_levels = np.zeros(N_BARS, dtype=np.float32)

    def levels_at_time(t: float) -> np.ndarray:
        # Grab a centered window of samples for FFT
        center = int(t * samplerate)
        start = center - (n_fft // 2)
        end = start + n_fft

        if start < 0 or end > len(data):
            # pad with zeros at edges
            seg = np.zeros(n_fft, dtype=np.float32)
            s1 = max(0, start)
            e1 = min(len(data), end)
            seg[(s1 - start):(s1 - start) + (e1 - s1)] = data[s1:e1]
        else:
            seg = data[start:end].copy()

        seg *= window

        # FFT -> power spectrum
        spec = np.fft.rfft(seg)
        power = (np.abs(spec) ** 2).astype(np.float32)

        # Aggregate power into perceptual bands
        band_power = np.zeros(N_BARS, dtype=np.float32)
        for i, idx in enumerate(band_bins):
            # mean is smoother; max is punchier. mean generally looks better.
            band_power[i] = np.mean(power[idx])

        # Convert to dB relative to current frame max (stable mapping)
        band_db = 10.0 * np.log10(band_power + 1e-12)
        band_db -= np.max(band_db)  # now max is 0 dB

        # Map [-DB_RANGE..0] dB -> [0..1]
        lvl = np.clip((band_db + DB_RANGE) / DB_RANGE, 0.0, 1.0)

        # Visual shaping
        lvl = (lvl ** GAMMA) * GAIN
        lvl *= low_tilt
        lvl = np.convolve(lvl, FREQ_SMOOTH_KERNEL, mode="same")
        return np.clip(lvl, 0.0, 1.0)

    print("3. Rendering dynamic spectrum video...")

    def make_frame(t):
        nonlocal prev_levels

        frame = np.zeros((H, W, 3), dtype=np.uint8)
        frame[:, :, 0] = LOGO_BLUE_RGB[0]
        frame[:, :, 1] = LOGO_BLUE_RGB[1]
        frame[:, :, 2] = LOGO_BLUE_RGB[2]

        lvl = levels_at_time(t)
        rising = lvl > prev_levels
        lvl = np.where(
            rising,
            SMOOTHING_ATTACK * prev_levels + (1.0 - SMOOTHING_ATTACK) * lvl,
            SMOOTHING_RELEASE * prev_levels + (1.0 - SMOOTHING_RELEASE) * lvl,
        )
        prev_levels = lvl

        mid_y = H // 2
        max_bar_h = int(H * 0.55)
        color = np.array([255, 255, 255], dtype=np.uint8)

        for i in range(N_BARS):
            h = int(MIN_BAR_HEIGHT_PX + lvl[i] * (max_bar_h - MIN_BAR_HEIGHT_PX))
            x = x0 + i * (bar_w + BAR_GAP_PX)
            y_top = mid_y - h // 2
            draw_square_bar(frame, x, y_top, bar_w, h, color)

        return frame

    if hasattr(audio_clip_full, "subclip"):
        audio_clip = audio_clip_full.subclip(0, duration)
    else:
        audio_clip = audio_clip_full.subclipped(0, duration)
    base_video = VideoClip(make_frame, duration=duration)
    if hasattr(base_video, "set_audio"):
        video = base_video.set_audio(audio_clip)
    else:
        video = base_video.with_audio(audio_clip)

    video.write_videofile(
        output_video,
        fps=FPS,
        codec="libx264",
        audio_codec="aac",
        preset="slow",
        bitrate="14M",
        threads=4
    )

    try:
        audio_clip.close()
    except Exception:
        pass
    try:
        audio_clip_full.close()
    except Exception:
        pass
    try:
        video.close()
    except Exception:
        pass

    try:
        os.remove(WAV_FILENAME)
    except PermissionError:
        print(f"Warning: could not remove temporary file '{WAV_FILENAME}' because it is still in use.")
    print(f"Done! Video saved as {output_video}")

if __name__ == "__main__":
    if os.path.exists("input.m4a"):
        convert_and_render_video_dynamic_bars()
    else:
        print("Error: 'input.m4a' not found in the current directory.")
