let transactionId = document.cookie.split('; ').find(row => row.startsWith('transactionId=')).split('=')[1];
import WaveSurfer from '/vendor/wavesurfer/wavesurfer.js';
import { parseTTML, mountTTMLRenderer } from './ttml-renderer.js';

let downloadAuth = false;

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
            } else {
                let lastSong = document.querySelector(".expanded");
                if (lastSong) { lastSong.classList.remove("expanded") };
                song.parentElement.classList.add('expanded');

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

                wavesurfer.on('interaction', () => {
                    wavesurfer.playPause();
                });

                waveform.addEventListener('pointermove', (e) => (hover.style.width = `${e.offsetX}px`));

                const formatTime = (seconds) => {
                    const minutes = Math.floor(seconds / 60)
                    const secondsRemainder = Math.round(seconds) % 60
                    const paddedSeconds = `0${secondsRemainder}`.slice(-2)
                    return `${minutes}:${paddedSeconds}`
                }

                wavesurfer.on('decode', (d) => (duration.textContent = formatTime(d)));
                wavesurfer.on('timeupdate', (ct) => (time.textContent = formatTime(ct)));

                const ttmlContainer = song.parentElement.querySelector('.ttml-container');
                wavesurfer.on('ready', () => {
                    loadAndMountTTML(song.textContent, ttmlContainer, wavesurfer);
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
    document.querySelector('.intro').classList.add('hidden');
    document.querySelector('main').classList.remove('hidden');
    startGlowLoop();
    document.addEventListener('mousemove', updateGlowVolume);
});