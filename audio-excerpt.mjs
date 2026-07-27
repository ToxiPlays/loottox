// audioExcerpt.js
// Deterministic "most exciting part" detector for previewSong.

import { spawn } from 'child_process';

const SAMPLE_RATE = 22050;
const FRAME_SIZE = 1024; // power of 2, required by the FFT below
const HOP_SIZE = 512; // 50% overlap
const EDGE_EXCLUSION_RATIO = 0.08; // ignore first/last 8% of the track
const ENERGY_WEIGHT = 0.5;
const FLUX_WEIGHT = 0.5;
const BOUNDARY_SNAP_SECONDS = 1.5; // search radius when snapping cut points

// ---- ffmpeg decode -------------------------------------------------------

/** Decode any audio file to mono 16-bit PCM at SAMPLE_RATE, returned as Float32Array in [-1, 1]. */
function decodeToPCM(filePath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', filePath,
      '-f', 's16le',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ]);

    const chunks = [];
    let stderr = '';
    ffmpeg.stdout.on('data', (c) => chunks.push(c));
    ffmpeg.stderr.on('data', (c) => { stderr += c; });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
      const buffer = Buffer.concat(chunks);
      const sampleCount = Math.floor(buffer.length / 2);
      const samples = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        samples[i] = buffer.readInt16LE(i * 2) / 32768;
      }
      resolve(samples);
    });
  });
}

// ---- tiny radix-2 FFT ------------------------------------------------------

/** In-place iterative Cooley-Tukey FFT. re/im are Float64Array of length n (power of 2). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

const HANN_WINDOW = (() => {
  const w = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
  }
  return w;
})();

function magnitudeSpectrum(frame) {
  const re = new Float64Array(FRAME_SIZE);
  const im = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    re[i] = frame[i] * HANN_WINDOW[i];
  }
  fft(re, im);
  const half = FRAME_SIZE / 2;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return mag;
}

// ---- frame-level feature extraction ---------------------------------------

/** Returns { rms: Float64Array, flux: Float64Array, frameTimes: Float64Array } */
function extractFrameFeatures(samples) {
  const frameCount = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const rms = new Float64Array(frameCount);
  const flux = new Float64Array(frameCount);
  const frameTimes = new Float64Array(frameCount);

  let prevMag = null;
  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE;
    const frame = samples.subarray(start, start + FRAME_SIZE);

    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
    rms[f] = Math.sqrt(sumSq / frame.length);

    const mag = magnitudeSpectrum(frame);
    if (prevMag) {
      let fluxSum = 0;
      for (let i = 0; i < mag.length; i++) {
        const diff = mag[i] - prevMag[i];
        if (diff > 0) fluxSum += diff; // half-wave rectified spectral flux
      }
      flux[f] = fluxSum;
    } else {
      flux[f] = 0;
    }
    prevMag = mag;

    frameTimes[f] = start / SAMPLE_RATE;
  }

  return { rms, flux, frameTimes };
}

function normalize(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max === 0) return arr;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return out;
}

// ---- window scoring ---------------------------------------------------------

/**
 * Finds the best `windowSeconds`-long excerpt.
 * @returns {{ start: number, end: number }} start/end in seconds
 */
function findBestWindow(rms, flux, frameTimes, totalDuration, windowSeconds) {
  const normRms = normalize(rms);
  const normFlux = normalize(flux);
  const score = new Float64Array(normRms.length);
  for (let i = 0; i < score.length; i++) {
    score[i] = ENERGY_WEIGHT * normRms[i] + FLUX_WEIGHT * normFlux[i];
  }

  const framesPerSecond = SAMPLE_RATE / HOP_SIZE;
  const windowFrames = Math.round(windowSeconds * framesPerSecond);
  const edgeFrames = Math.round(totalDuration * EDGE_EXCLUSION_RATIO * framesPerSecond);

  if (score.length <= windowFrames) {
    // Track shorter than the target window — just use the whole thing.
    return { start: 0, end: totalDuration };
  }

  // Sliding window sum via prefix sums.
  const prefix = new Float64Array(score.length + 1);
  for (let i = 0; i < score.length; i++) prefix[i + 1] = prefix[i] + score[i];

  let bestStartFrame = edgeFrames;
  let bestScore = -Infinity;
  const lastStart = Math.max(edgeFrames, score.length - windowFrames - edgeFrames);
  for (let s = edgeFrames; s <= lastStart; s++) {
    const windowScore = prefix[s + windowFrames] - prefix[s];
    if (windowScore > bestScore) {
      bestScore = windowScore;
      bestStartFrame = s;
    }
  }

  let start = frameTimes[bestStartFrame] ?? 0;
  let end = start + windowSeconds;

  // Snap boundaries to nearby local energy minima so we don't cut mid-beat.
  start = snapToLocalMinimum(score, frameTimes, start, framesPerSecond);
  end = snapToLocalMinimum(score, frameTimes, end, framesPerSecond);
  if (end - start < windowSeconds * 0.8) end = start + windowSeconds; // safety floor

  end = Math.min(end, totalDuration);
  start = Math.max(0, Math.min(start, end - 1));

  return { start, end };
}

function snapToLocalMinimum(score, frameTimes, targetSeconds, framesPerSecond) {
  const radius = Math.round(BOUNDARY_SNAP_SECONDS * framesPerSecond);
  const centerFrame = Math.round(targetSeconds * framesPerSecond);
  const lo = Math.max(0, centerFrame - radius);
  const hi = Math.min(score.length - 1, centerFrame + radius);
  let bestFrame = centerFrame;
  let bestScore = Infinity;
  for (let f = lo; f <= hi; f++) {
    if (score[f] < bestScore) {
      bestScore = score[f];
      bestFrame = f;
    }
  }
  return frameTimes[bestFrame] ?? targetSeconds;
}

// ---- public API ---------------------------------------------------------

/**
 * Analyzes a song file and returns the best excerpt window.
 * @param {string} filePath - path to the source audio file
 * @param {number} windowSeconds - target excerpt length (15-20 recommended)
 */
export async function computeExcitingWindow(filePath, windowSeconds = 17) {
  const samples = await decodeToPCM(filePath);
  const totalDuration = samples.length / SAMPLE_RATE;
  const { rms, flux, frameTimes } = extractFrameFeatures(samples);

  if (rms.length === 0) {
    return { start: 0, end: Math.min(windowSeconds, totalDuration) };
  }

  const { start, end } = findBestWindow(rms, flux, frameTimes, totalDuration, windowSeconds);
  return {
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
  };
}