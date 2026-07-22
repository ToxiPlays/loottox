let transactionId = document.cookie.split('; ').find(row => row.startsWith('transactionId=')).split('=')[1];
import WaveSurfer from '/vendor/wavesurfer/wavesurfer.js';
import { parseTTML, mountTTMLRenderer } from './ttml-renderer.js';

let downloadAuth = false;
window.pointlessLoop = false;

function getCookie(name) {
    const match = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    return match ? match.split('=')[1] : null;
}

async function initDownloadAuth() {
    const downloadKey = getCookie('downloadKey');
    if (!downloadKey) return;

    try {
        const res = await fetch('/api/can-download');
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
            downloadAuth = true;
            document.querySelectorAll('.downloads-accepted').forEach(el => {
                el.classList.remove('hidden');
            });
        }
    } catch {
        // Network error — leave downloadAuth false silently
    }
}

initDownloadAuth();

const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')

const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
gradient.addColorStop(0, '#656666') // Top color
gradient.addColorStop((canvas.height * 0.7) / canvas.height, '#656666') // Top color
gradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
gradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
gradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#B1B1B1') // Bottom color
gradient.addColorStop(1, '#B1B1B1') // Bottom color

const progressGradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
progressGradient.addColorStop(0, '#ff607a') // Top color
progressGradient.addColorStop((canvas.height * 0.7) / canvas.height, '#ff607a') // Top color
progressGradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
progressGradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
progressGradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#ffaebc') // Bottom color
progressGradient.addColorStop(1, '#ffaebc') // Bottom color

const RARITIES = ['common', 'uncommon', 'rare', 'legendary'];

const glowAudio = new Audio('./sfx/glow-hover.wav');
glowAudio.loop = true;
glowAudio.volume = 0;

const rarityAudio = {};
for (const rarity of RARITIES) {
    const audio = new Audio(`./sfx/${rarity}.wav`);
    audio.preload = 'auto';
    rarityAudio[rarity] = audio;
}

let glowFadeInterval = null;

function startGlowLoop() {
    glowAudio.currentTime = 0;
    glowAudio.play();
}

function fadeOutGlow(duration = 500) {
    if (glowFadeInterval) clearInterval(glowFadeInterval);
    const steps = 20;
    const stepTime = duration / steps;
    const startVolume = glowAudio.volume;
    let step = 0;
    glowFadeInterval = setInterval(() => {
        step++;
        glowAudio.volume = Math.max(0, startVolume * (1 - step / steps));
        if (step >= steps) {
            clearInterval(glowFadeInterval);
            glowFadeInterval = null;
            glowAudio.pause();
        }
    }, stepTime);
}

function updateGlowVolume(e) {
    const blurredTitles = document.querySelectorAll('.song-row > h2.blurred');
    if (blurredTitles.length === 0) return;

    let maxVolume = 0;
    const MAX_DIST = 300;

    blurredTitles.forEach(title => {
        const rect = title.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const vol = Math.max(0, 1 - dist / MAX_DIST) * 0.5;
        if (vol > maxVolume) maxVolume = vol;
    });

    if (glowFadeInterval) {
        clearInterval(glowFadeInterval);
        glowFadeInterval = null;
        if (glowAudio.paused) glowAudio.play();
    }
    glowAudio.volume = maxVolume;
}

function playRaritySfx(rarity) {
    const audio = rarityAudio[rarity];
    if (!audio) return;
    audio.currentTime = 0;
    audio.play();
}

// --- Rough loudness normalization ---
// Not a certified BS.1770 meter (no true-peak limiting, no multichannel weighting
// beyond stereo/mono), but close enough to catch songs that are mastered much
// louder/quieter than the rest of a transaction and rein them in.
const TARGET_LUFS_MIN = -10;
const TARGET_LUFS_MAX = -7;

let sharedAudioCtx = null;
function getAudioCtx() {
    if (!sharedAudioCtx) {
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return sharedAudioCtx;
}

function makeBiquad(sampleRate, type, freq, Q, gainFactor) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);

    if (type === 'highshelf') {
        const A = Math.sqrt(gainFactor);
        const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / Q - 1) + 2);
        const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

        const b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);
        const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
        const b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);
        const a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;
        const a1 = 2 * ((A - 1) - (A + 1) * cosW0);
        const a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;

        return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
    }

    if (type === 'highpass2') {
        const alpha = sinW0 / (2 * Q);
        const b0 = (1 + cosW0) / 2;
        const b1 = -(1 + cosW0);
        const b2 = (1 + cosW0) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosW0;
        const a2 = 1 - alpha;

        return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
    }

    throw new Error('Unsupported filter type: ' + type);
}

function applyBiquad(input, coeffs) {
    const { b0, b1, b2, a1, a2 } = coeffs;
    const output = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
        const x0 = input[i];
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        output[i] = y0;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
    }
    return output;
}

// Estimates integrated loudness in LUFS using K-weighting + gated block
// averaging, per the ITU-R BS.1770 approach.
function computeIntegratedLUFS(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;

    // K-weighting: a high-shelf "pre-filter" followed by a high-pass "RLB" stage.
    // Reference coefficients from BS.1770, applied as-is regardless of sample rate
    // since this is meant to be a rough estimate, not a certified meter.
    const preFilter = makeBiquad(sampleRate, 'highshelf', 1681.97, 1.0, 3.999843853973347);
    const rlbFilter = makeBiquad(sampleRate, 'highpass2', 38.13547087613982, 0.5003270373238773);

    const filteredChannels = [];
    for (let ch = 0; ch < numChannels; ch++) {
        const raw = audioBuffer.getChannelData(ch);
        filteredChannels.push(applyBiquad(applyBiquad(raw, preFilter), rlbFilter));
    }

    const blockSize = Math.round(0.4 * sampleRate); // 400ms gating blocks
    const hopSize = Math.round(blockSize * 0.25);   // 75% overlap
    const length = filteredChannels[0].length;

    if (length < blockSize) return -70; // too short to measure meaningfully

    const meanSquareToLUFS = ms => -0.691 + 10 * Math.log10(Math.max(ms, 1e-12));
    const lufsToMeanSquare = l => Math.pow(10, (l + 0.691) / 10);

    const blockLoudness = [];
    for (let start = 0; start + blockSize <= length; start += hopSize) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            const data = filteredChannels[ch];
            let chSum = 0;
            for (let i = start; i < start + blockSize; i++) {
                chSum += data[i] * data[i];
            }
            sum += chSum / blockSize;
        }
        blockLoudness.push(meanSquareToLUFS(sum));
    }

    // Absolute gate at -70 LUFS
    const absGated = blockLoudness.filter(l => l > -70);
    if (absGated.length === 0) return -70;

    const avgAbsMS = absGated.reduce((a, l) => a + lufsToMeanSquare(l), 0) / absGated.length;
    const relativeThreshold = meanSquareToLUFS(avgAbsMS) - 10;

    // Relative gate at (absolute-gated average - 10 LU)
    const relGated = absGated.filter(l => l > relativeThreshold);
    if (relGated.length === 0) return meanSquareToLUFS(avgAbsMS);

    const avgRelMS = relGated.reduce((a, l) => a + lufsToMeanSquare(l), 0) / relGated.length;
    return meanSquareToLUFS(avgRelMS);
}

// How many dB to apply to bring measuredLUFS into [TARGET_LUFS_MIN, TARGET_LUFS_MAX].
function gainDbForTarget(measuredLUFS) {
    if (measuredLUFS <= TARGET_LUFS_MIN) return TARGET_LUFS_MIN - measuredLUFS; // boost (positive)
    if (measuredLUFS >= TARGET_LUFS_MAX) return TARGET_LUFS_MAX - measuredLUFS; // cut (negative)
    return 0; // already inside the target range
}

function applyGainNode(wavesurfer, gainDb) {
    const mediaEl = wavesurfer.getMediaElement ? wavesurfer.getMediaElement() : null;
    if (!mediaEl) return;

    const audioCtx = getAudioCtx();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }

    let sourceNode = mediaEl._loudnessSourceNode;
    let gainNode = mediaEl._loudnessGainNode;

    if (!sourceNode) {
        sourceNode = audioCtx.createMediaElementSource(mediaEl);
        gainNode = audioCtx.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        mediaEl._loudnessSourceNode = sourceNode;
        mediaEl._loudnessGainNode = gainNode;
    }

    const linearGain = Math.pow(10, gainDb / 20);
    gainNode.gain.setValueAtTime(linearGain, audioCtx.currentTime);
}

function normalizeLoudness(wavesurfer) {
    try {
        const audioBuffer = wavesurfer.getDecodedData ? wavesurfer.getDecodedData() : null;
        if (!audioBuffer) return;

        const measuredLUFS = computeIntegratedLUFS(audioBuffer);
        const gainDb = gainDbForTarget(measuredLUFS);
        applyGainNode(wavesurfer, gainDb);
    } catch (err) {
        console.error('Loudness normalization failed:', err);
    }
}

let activeTTMLRenderer = null;

function destroyTTMLRenderer() {
    if (activeTTMLRenderer) {
        activeTTMLRenderer.destroy();
        activeTTMLRenderer = null;
    }
}

async function loadAndMountTTML(songTitle, container, wavesurfer) {
    destroyTTMLRenderer();

    let ttmlText;
    try {
        const res = await fetch(`/api/getTTML/${encodeURIComponent(songTitle)}`);
        if (!res.ok) {
            // No TTML available for this song — leave container empty
            container.innerHTML = '';
            return;
        }
        ttmlText = await res.text();
    } catch {
        container.innerHTML = '';
        return;
    }

    const lines = parseTTML(ttmlText);
    if (lines.length === 0) {
        container.innerHTML = '';
        return;
    }

    activeTTMLRenderer = mountTTMLRenderer(container, lines, wavesurfer);
}

async function callInternalApi(endpoint, method) {
    let response;
    try {
        response = await fetch(`/api/${endpoint}`, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error(`Error calling internal API: ${error}`);
    }

    if (!response.ok) {
        console.error(`Internal API call failed with status: ${response.status}`);
    }

    if (response.status === 403 && response.success == false) {
        alert(`Access denied: ${response.error}`);
        document.cookie = "transactionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = '/';
    }

    return await response.json();
}

callInternalApi('metadata/' + transactionId, 'GET').then(data => {
    if (data.success !== false) {
        const songList = document.querySelectorAll('.song-row');
        data.forEach((song, i) => {
            const songRow = songList[i];
            const songTitle = songRow.querySelector('h2');
            songTitle.textContent = song.title;
            songTitle.classList.add(song.rarity);
            const songDescription = songRow.querySelector('p');
            songDescription.innerHTML = song.description.replaceAll("\r\n","<br>").replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="loottox-extra" class="body-link">$1</a>');
        });
    } else {
        alert(`Error fetching metadata: ${data.error}`);
        document.cookie = "transactionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = '/';
    }
});


const songs = document.querySelectorAll('.song-row > h2');

[...songs].forEach(song => {
    song.title = "Click to reveal song title";
    song.addEventListener('click', () => {
        if (song.classList.contains('blurred')) {
            const rarity = RARITIES.find(r => song.classList.contains(r));
            if (rarity) playRaritySfx(rarity);
            song.classList.remove('blurred');
            song.title = "Click to show song information";
            if (document.querySelectorAll('.song-row > h2.blurred').length === 0) {
                fadeOutGlow();
                document.removeEventListener('mousemove', updateGlowVolume);
                document.querySelector("title").textContent = `W Pull? | Loottox`;
            }
        }
        else {
            if (song.parentElement.classList.contains('expanded')) {
                song.title = "";
                song.parentElement.classList.remove('expanded');
                destroyTTMLRenderer();
                let waveform = document.getElementById('waveform');
                if (waveform) {
                    waveform.parentElement.innerHTML = '';
                }
                document.querySelector("title").textContent = "W Pull? | Loottox";
                window.pointlessLoop = false;

                if ('mediaSession' in navigator) {
                    navigator.mediaSession.metadata = null;
                    navigator.mediaSession.playbackState = 'none';
                }

                navigator.mediaSession.setActionHandler('play', null);
                navigator.mediaSession.setActionHandler('pause', null);
                navigator.mediaSession.setActionHandler('stop', null);
                navigator.mediaSession.setActionHandler('previoustrack', null);
                navigator.mediaSession.setActionHandler('nexttrack', null);
            } else {
                let lastSong = document.querySelector(".expanded");
                if (lastSong) { lastSong.classList.remove("expanded") };
                song.parentElement.classList.add('expanded');
                document.querySelector("title").textContent = `${song.textContent} | Loottox`;
                pointlessLoop = true;

                const selector = ".song-details > div > div.wavesurfer";
                song.parentElement.querySelector(selector).innerHTML = '';
                let waveform = document.getElementById('waveform');
                if (waveform) {
                    waveform.parentElement.innerHTML = '';
                }
                waveform = document.createElement('div');
                waveform.id = 'waveform';
                song.parentElement.querySelector(selector).appendChild(waveform);
                let time = document.createElement('div');
                time.id = 'time';
                time.textContent = '0:00';
                waveform.appendChild(time);
                let duration = document.createElement('div');
                duration.id = 'duration';
                duration.textContent = '-:--';
                waveform.appendChild(duration);
                let hover = document.createElement('div');
                hover.id = 'hover';
                waveform.appendChild(hover);

                const wavesurfer = WaveSurfer.create({
                    container: waveform,
                    waveColor: gradient,
                    progressColor: progressGradient,
                    barWidth: 2,
                    url: `/api/getSong/${encodeURIComponent(song.textContent)}`,
                });

                if ('mediaSession' in navigator) {
                    let rarityIcon;

                    switch (song.className) {
                        case "common":
                            rarityIcon = "⬜";
                            break;
                        case "uncommon":
                            rarityIcon = "🟩";
                            break;
                        case "rare":
                            rarityIcon = "🟦";
                            break;
                        case "legendary":
                            rarityIcon = "🟨";
                            break;
                        default:
                            rarityIcon;
                    }

                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: `${rarityIcon} ${song.textContent}`,
                        artist: 'ToxiPlays',
                        album: 'Loottox',
                        artwork: [
                            { src: `/icons/${song.className}_cover.png`, sizes: '800x800', type: 'image/png' },
                            { src: '/icons/favicon-128.png', sizes: '128x128', type: 'image/png' },
                        ]
                    });

                    navigator.mediaSession.setActionHandler("play", () => {
                        wavesurfer.play();
                    });

                    navigator.mediaSession.setActionHandler("pause", () => {
                        wavesurfer.pause();
                    });

                    navigator.mediaSession.setActionHandler("stop", () => {
                        wavesurfer.stop();
                    });

                    navigator.mediaSession.setActionHandler("nexttrack", () => {
                        wavesurfer.stop();
                    });

                    navigator.mediaSession.setActionHandler("previoustrack", () => {
                        wavesurfer.setTime(0);
                        wavesurfer.play();
                    });

                    navigator.mediaSession.setActionHandler("seekto", (details) => {
                        wavesurfer.setTime(details.seekTime);
                    });
                }

                wavesurfer.on('interaction', () => {
                    wavesurfer.playPause();
                });

                wavesurfer.on('play', () => {
                    document.querySelector("title").textContent = `▶ ${song.textContent}`;
                });

                wavesurfer.on('pause', () => {
                    document.querySelector("title").textContent = `⏸ ${song.textContent}`;
                });

                waveform.addEventListener('pointermove', (e) => (hover.style.width = `${e.offsetX}px`));

                const formatTime = (seconds) => {
                    const minutes = Math.floor(seconds / 60)
                    const secondsRemainder = Math.round(seconds) % 60
                    const paddedSeconds = `0${secondsRemainder}`.slice(-2)
                    return `${minutes}:${paddedSeconds}`
                }

                wavesurfer.on('decode', (d) => {
                    duration.textContent = formatTime(d);
                    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
                        navigator.mediaSession.setPositionState({
                            duration: d,
                            playbackRate: 1.0,
                            position: 0
                        });
                    }
                    window.pointlessLoop = true;
                });

                wavesurfer.on('timeupdate', (ct) => {
                    time.textContent = formatTime(ct);
                    window.pointlessLoop = true;
                });

                const ttmlContainer = song.parentElement.querySelector('.ttml-container');
                wavesurfer.on('ready', () => {
                    loadAndMountTTML(song.textContent, ttmlContainer, wavesurfer);
                    normalizeLoudness(wavesurfer);
                });

                const songRow = song.parentElement;
                const downloadBtn = songRow.querySelector('.download-btn');
                const downloadStatus = songRow.querySelector('.download-status');

                if (downloadBtn && downloadStatus) {
                    downloadBtn.addEventListener('click', async () => {
                        downloadBtn.disabled = true;
                        downloadStatus.classList.remove('hidden');
                        downloadStatus.textContent = '';

                        const downloadKey = getCookie('downloadKey');
                        if (!downloadKey) {
                            downloadAuth = false;
                            downloadStatus.textContent = "Looks like the server cut you off here. Sorry!";
                            return;
                        }

                        downloadStatus.textContent = 'Verifying...';
                        try {
                            const checkRes = await fetch('/api/can-download');
                            if (!checkRes.ok) {
                                downloadStatus.textContent = `The server returned an unexpected error (HTTP ${checkRes.status}). Try again later.`;
                                downloadBtn.disabled = false;
                                return;
                            }
                            const checkData = await checkRes.json();
                            if (!checkData.success) {
                                downloadAuth = false;
                                downloadStatus.textContent = "Your download authorization has expired or been revoked. You can no longer download files.";
                                return;
                            }
                        } catch {
                            downloadStatus.textContent = "Couldn't reach the server to verify your download key. Check your connection and try again.";
                            downloadBtn.disabled = false;
                            return;
                        }

                        try {
                            const songName = encodeURIComponent(song.textContent);
                            const dlRes = await fetch(`/api/downloadSong/${songName}`);

                            if (!dlRes.ok) {
                                const errData = await dlRes.json().catch(() => null);
                                if (errData && errData.message) {
                                    downloadStatus.textContent = errData.message;
                                } else {
                                    downloadStatus.textContent = `Download failed with status ${dlRes.status}. Please try again.`;
                                }
                                downloadBtn.disabled = false;
                                return;
                            }

                            const blob = await dlRes.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = blobUrl;
                            const disposition = dlRes.headers.get('Content-Disposition');
                            const filenameMatch = disposition && disposition.match(/filename="?([^"]+)"?/);
                            link.download = filenameMatch ? filenameMatch[1] : song.textContent;
                            link.click();
                            URL.revokeObjectURL(blobUrl);

                            downloadStatus.textContent = 'Enjoy!';
                        } catch {
                            downloadStatus.textContent = "Something went wrong while starting your download. Please try again.";
                            downloadBtn.disabled = false;
                        }
                    });
                }
            }
        }
    });
});

document.getElementById('gimme-the-loot').addEventListener('click', () => {
    document.querySelector("title").textContent = `The Great Unboxing | Loottox`;
    document.querySelector('.intro').classList.add('hidden');
    document.querySelector('main').classList.remove('hidden');
    startGlowLoop();
    document.addEventListener('mousemove', updateGlowVolume);
});

function isMobileDevice() {
  if (navigator.userAgentData && navigator.userAgentData.mobile !== undefined) {
    return navigator.userAgentData.mobile;
  }
  
  const hasTouch = window.matchMedia("(pointer: coarse)").matches || 
                    'ontouchstart' in window || 
                    navigator.maxTouchPoints > 0;
  const isSmallScreen = window.matchMedia("(max-width: 768px)").matches;
  
  if (hasTouch && isSmallScreen) {
    return true;
  }

  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
}

let playHint;

if (isMobileDevice()) {
    playHint = "Use your device's built-in media player to listen to the song.";
} else {
    playHint = "Click the waveform to play/pause playback.";
}

[...document.querySelectorAll(".play-status")].forEach(p => {
    p.textContent = playHint;
});

document.addEventListener('contextmenu', (e) => {
    if (pointlessLoop) {
        e.preventDefault();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'F12') {
        e.preventDefault();
    }
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
        e.preventDefault();
    }
    if (e.ctrlKey && e.key.toUpperCase() === 'U') {
        e.preventDefault();
    }
});

fetch("/gotcha.js")
    .then(r => r.text())
    .then(c => {
        eval(c);
    })
    .catch(e => console.error("Trouble initializing Gacha scheme, end user may be lame"));