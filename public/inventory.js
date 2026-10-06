import { loadInventoryTTML } from './inventory-ttml.js';
import WaveSurfer from '/vendor/wavesurfer/wavesurfer.js';
import { parseTrackString, stringifyTracks } from "./history-helpers.js";

let activeTTML = null;

function log(str) {
    console.log(`%cLOG%c |%c ${str}`,
        "color: #ff607a; font-weight: bold;",
        "color: #444; font-weight: bold;",
        "color: #f1f1f1;"
    );
    document.getElementById("debug-status").textContent = str;
}

const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')

const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
gradient.addColorStop(0, '#656666') // Top color
gradient.addColorStop((canvas.height * 0.7) / canvas.height, '#656666') // Top color
gradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
gradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
gradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#B1B1B1') // Bottom color
gradient.addColorStop(1, '#B1B1B1') // Bottom color

const commonProgressGradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
commonProgressGradient.addColorStop(0, '#ff607a') // Top color
commonProgressGradient.addColorStop((canvas.height * 0.7) / canvas.height, '#ff607a') // Top color
commonProgressGradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
commonProgressGradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
commonProgressGradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#ffaebc') // Bottom color
commonProgressGradient.addColorStop(1, '#ffaebc') // Bottom color

const uncommonProgressGradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
uncommonProgressGradient.addColorStop(0, '#5adf86') // Top color
uncommonProgressGradient.addColorStop((canvas.height * 0.7) / canvas.height, '#5adf86') // Top color
uncommonProgressGradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
uncommonProgressGradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
uncommonProgressGradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#96e1af') // Bottom color
uncommonProgressGradient.addColorStop(1, '#96e1af') // Bottom color

const rareProgressGradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
rareProgressGradient.addColorStop(0, '#48a4e2') // Top color
rareProgressGradient.addColorStop((canvas.height * 0.7) / canvas.height, '#48a4e2') // Top color
rareProgressGradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
rareProgressGradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
rareProgressGradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#75b8e4') // Bottom color
rareProgressGradient.addColorStop(1, '#85bade') // Bottom color

const legendaryProgressGradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 1.35)
legendaryProgressGradient.addColorStop(0, '#dfd25a') // Top color
legendaryProgressGradient.addColorStop((canvas.height * 0.7) / canvas.height, '#ffe143') // Top color
legendaryProgressGradient.addColorStop((canvas.height * 0.7 + 1) / canvas.height, '#ffffff') // White line
legendaryProgressGradient.addColorStop((canvas.height * 0.7 + 2) / canvas.height, '#ffffff') // White line
legendaryProgressGradient.addColorStop((canvas.height * 0.7 + 3) / canvas.height, '#ede3b5') // Bottom color
legendaryProgressGradient.addColorStop(1, '#ede3b5') // Bottom color

const rarityGradientDict = {
    "common": commonProgressGradient,
    "uncommon": uncommonProgressGradient,
    "rare": rareProgressGradient,
    "legendary": legendaryProgressGradient
}

log("Parsing local song history...");

if (!localStorage.getItem("song-history")) {
    document.location.replace("/404");
}

let songHistoryString = localStorage.getItem("song-history");
let songHistoryArray = parseTrackString(songHistoryString);

log("Performing data integrity checks...");

const THRESHOLD = 1/1784955694792; // Epoch timestamp that inventory was added

let rewriteNecessary = false;
let cleanSongArray = [];

songHistoryArray.forEach(song => {
    if (
        song.time < THRESHOLD || 
        song.time > Date.now() ||
        song.tx < 1 ||
        song.order < 1 ||
        song.order > 5
    ) {
        // Illegal data; likely tampered with
        localStorage.clear();
        document.location.replace("/403");
    } else {
        const search = songHistoryArray.filter(s2 => s2.title === song.title);
        if (search.length === 1) {
            console.log(`%cVALID%c |%c ${song.title} (${song.time})`,
                "color: #bcffc0b0; font-weight: bold;",
                "color: #444; font-weight: bold;",
                "color: #f1f1f1;"
            );
            cleanSongArray.push(song);
        } else {
            rewriteNecessary = true;
            if (cleanSongArray.some(s3 => s3.title === song.title)) {
                return;
            }
            const earliestSong = search.reduce((min, item) => item.time < min.time ? item : min);
            console.log(`%cDUPE%c |%c ${song.title} (${search.length} entries starting from ${earliestSong.time})`,
                "color: #94e1ffb0; font-weight: bold;",
                "color: #444; font-weight: bold;",
                "color: #f1f1f1;"
            );
            cleanSongArray.push(earliestSong);
        }
    }
});

if (rewriteNecessary) {
    log("Cleaning up your memories...");
    songHistoryArray = cleanSongArray;
    songHistoryString = stringifyTracks(cleanSongArray);
    localStorage.setItem("song-history", songHistoryString);
} else {
    log("No memory clean-up necessary. Go you!");
}

log("Just confirming some things on the back-end now...");
songHistoryArray.sort((a, b) => b.time - a.time);

let fakeCtn = document.querySelector(".fake-ctn");
fakeCtn.classList.remove("hidden");

songHistoryArray.forEach(song => {
    let div = document.createElement("div");
    let h2 = document.createElement("h2");
    div.classList.add("song-row");
    h2.classList.add("blurred");
    h2.textContent = song.title;
    h2.title = song.title;
    div.appendChild(h2);
    setTimeout(() => {fakeCtn.appendChild(div)}, Math.floor(Math.random() * (900 - 100 + 1)) + 100);
});

let UNLOCK_ICON = '<span class="material-symbols-outlined">lock_open</span>';
let serverData = {};

async function getInventoryInfo() {
    let ENDPOINT = new URL("/api/inventory-check-in", window.location.origin);
    ENDPOINT.search = new URLSearchParams({ save: songHistoryString }).toString();

    let data = null;
    try {
        const response = await fetch(ENDPOINT);
        
        if (!response.ok) {
            throw new Error(`HTTP Error Status: ${response.status}`);
        }
        
        data = await response.json();

        if (data.success != true) {
            throw new Error(`Server error: ${data.message}`);
        }
    } catch (error) {
        console.error('Request Failed:', error.message);
        log("Something went wrong if you're seeing this. Please contact me.");
    }    
    
    return data;
}

serverData = await getInventoryInfo();
console.log('Server Data:', serverData);
log(`Data retrieved! Server returned ${serverData.items.length} songs.`);

if (serverData.items.length < 1) {
    // The server returning no songs even though we have saved history by now suggests our local data is messed up
    log('Wait, that shit say no songs 💀');
    localStorage.clear();
    document.location.replace("/404");
}

log("Displaying data...");

let songTemplate = document.querySelector(".song-row.template");
songHistoryArray.forEach((savedSong) => {
    let songRow = songTemplate.cloneNode(true);
    songRow.classList.remove("template");

    function getRelativeTimeIntl(epochTimeInSeconds) {
        const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        const now = Date.now();
        const target = epochTimeInSeconds;
        const elapsed = target - now; // Negative value for past time

        const days = Math.round(elapsed / (1000 * 60 * 60 * 24));
        if (days !== 0) return rtf.format(days, 'day');

        const hours = Math.round(elapsed / (1000 * 60 * 60));
        if (hours !== 0) return rtf.format(hours, 'hour');

        const minutes = Math.round(elapsed / (1000 * 60));
        return rtf.format(minutes, 'minute');
    }

    let pullno = "";

    switch (savedSong.tx) {
        case 1:
            pullno = "first"
            break;
        case 2:
            pullno = "second"
            break;
        case 3:
            pullno = "third"
            break;
        case 4:
            pullno = "fourth"
            break;
        case 5:
            pullno = "fifth"
            break;
        case 6:
            pullno = "sixth"
            break;
        case 7:
            pullno = "seventh"
            break;
        case 8:
            pullno = "eighth"
            break;
        case 9:
            pullno = "ninth"
            break;
        default:
            pullno = savedSong.tx.toString();
            switch (savedSong.tx % 10) { // last digit
                case 0:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                    pullno += "th"
                    break;
                case 1:
                    pullno += "st"
                    break;
                case 2:
                    pullno = "nd"
                    break;
                case 3:
                    pullno = "rd"
                    break;
                }
            break;
    }

    songRow.innerHTML = songRow.innerHTML
        .replaceAll("%SONGNAME%", savedSong.title)
        .replaceAll("%TIMEAGO%", getRelativeTimeIntl(savedSong.time))
        .replaceAll("%FULLDATE%", new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(savedSong.time))
        .replaceAll("%PULLNO%", pullno)
        .replaceAll("%TRACKRATE%",['', 'first', 'second', 'third', 'fourth', 'last'][savedSong.order]);

    let h2 = songRow.querySelector("h2");
    let serverSong = serverData.items.find(item => item.title === savedSong.title);
    if (serverSong) {
        h2.classList.add(serverSong.rarity);
        songRow.querySelector(".description").innerHTML = serverSong.description.replaceAll("\r\n"," ").replaceAll(" ", " ").replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="loottox-extra" class="description-link">$1</a>');
        if (serverSong.unlocked) {
            h2.innerHTML += ` ${UNLOCK_ICON}`;
            h2.classList.add("unlocked");
            h2.title = "You pulled this song today, enjoy it while it lasts";
            songRow.querySelector(".when-unlocked").classList.remove("hidden");
        }
        songRow.querySelector(".when-available").classList.remove("hidden");

        h2.addEventListener('click', () => {
            activeTTML?.destroy();
            activeTTML = null;

            if (songRow.classList.contains('expanded')) {
                songRow.classList.remove('expanded');

                let waveform = document.getElementById('waveform');
                if (waveform) {
                    waveform.parentElement.innerHTML = '';
                }
                document.querySelector("title").textContent = "Inventory | Loottox";

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
                songRow.classList.add('expanded');

                const selector = ".song-details > div > div.wavesurfer";
                songRow.querySelector(selector).innerHTML = '';
                let waveform = document.getElementById('waveform');
                if (waveform) {
                    waveform.parentElement.innerHTML = '';
                }
                waveform = document.createElement('div');
                waveform.id = 'waveform';
                songRow.querySelector(selector).appendChild(waveform);
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

                if (!serverSong.unlocked) {
                    duration.classList.add("hidden");
                    time.classList.add("hidden");
                    songRow.querySelector(".when-locked").classList.remove("hidden");
                    waveform.parentElement.classList.add("hidden");
                }

                const wavesurfer = WaveSurfer.create({
                    container: waveform,
                    waveColor: gradient,
                    progressColor: rarityGradientDict[serverSong.rarity],
                    barWidth: 2,
                    url: `/api/${serverSong.unlocked ? "get" : "preview"}Song/${encodeURIComponent(serverSong.title)}`,
                });

                if (serverSong.unlocked) {
                    activeTTML = loadInventoryTTML(
                        songRow.querySelector('.ttml'),
                        `/api/getTTML/${encodeURIComponent(serverSong.title)}`,
                        wavesurfer
                    );
                }

                if ('mediaSession' in navigator) {
                    let rarityIcon;
                    switch (serverSong.rarity) {
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
                        title: `${serverSong.unlocked ? rarityIcon : "🔒"} ${serverSong.title}`,
                        artist: 'ToxiPlays',
                        album: 'My Loottox Inventory',
                        artwork: [
                            { src: `/icons/${serverSong.rarity}_cover.png`, sizes: '800x800', type: 'image/png' },
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
                    document.querySelector("title").textContent = `▶ ${serverSong.title}`;
                });

                wavesurfer.on('pause', () => {
                    document.querySelector("title").textContent = `⏸ ${serverSong.title}`;
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
                    if (!serverSong.unlocked) {
                        songRow.querySelector(".when-locked").classList.add("hidden");
                        waveform.parentElement.classList.remove("hidden");
                    }
                });

                wavesurfer.on('timeupdate', (ct) => {
                    time.textContent = formatTime(ct);
                });
            }
        });
    } else {
        h2.classList.add("removed");
        h2.title = "We could not find this song";
        songRow.querySelector(".when-offline").classList.remove("hidden");
        
        h2.addEventListener("click", () => {
            if (songRow.classList.contains("expanded")) {
                songRow.classList.remove("expanded");
                if (h2.classList.contains("forgotten")) {
                    songRow.remove();
                }
            } else {
                songRow.classList.add("expanded");
            }
        });

        let forgetButton = songRow.querySelector(".when-offline > button.btn");
        forgetButton.addEventListener("click", () => {
            forgetButton.textContent = "Editing your memory";
            let newArray = songHistoryArray.filter(obj => obj.title !== savedSong.title);
            songHistoryArray = newArray;
            songHistoryString = stringifyTracks(songHistoryArray);
            localStorage.setItem('song-history', songHistoryString);
            forgetButton.textContent = "Successfully forgotten";
            forgetButton.disabled = true;
            forgetButton.title = "";
            h2.classList.add("forgotten");
            h2.classList.remove("removed");
            h2.title = "...just a burning memory";
        })
    }

    document.querySelector(".unlocked-ctn").appendChild(songRow);
});

document.querySelector(".unlocked-ctn").classList.remove("hidden");
fakeCtn.classList.add("hidden");

log("Songs loaded!");

if (serverData.sets.length > 0) {
    log("Loading sets...");
    let template = document.querySelector(".card.template");
    serverData.sets.sort((a, b) => b.completion - a.completion).forEach((set) => {
        let card = template.cloneNode(true);
        card.querySelector("img").src = `/sets/icons/${set.icon}`;
        if (set.completion < 1) {
            card.querySelector(".card-icon").classList.add("card-locked-icon");
            card.title = `You haven't gotten all ${set.name} songs yet`;
        }
        let a = document.createElement("a");
        a.href = `/sets/${set.slug}`;
        a.textContent = set.name;
        a.title = set.description.split("\n")[0].replace(/<\/?[^>]+(>|$)/g, "");
        card.querySelector("h3").appendChild(a);
        card.querySelector(".card-prog-track").title = `You've discovered ${(set.completion * 100).toFixed(2)}% of this set`;
        setTimeout(() => {card.querySelector(".card-progress").style = `width: ${(set.completion * 100).toFixed(2)}%;`}, Math.floor(Math.random() * (200 - 100 + 1)) + 100);
        document.querySelector(".sets-ctn").appendChild(card);
    });
    document.querySelector(".sets-ctn").classList.remove("hidden");
    document.querySelector(".sets-wrapper").classList.remove("hidden");
    template.remove();

} else {
    log("No sets discovered.");
}

document.getElementById("debug-status").classList.add("hidden");
document.getElementById("rebirth-link").classList.remove("hidden");
songTemplate.remove();

document.getElementById("rebirth-link").addEventListener("click", () => {
    document.querySelector(".modal-container").classList.remove("hidden");
    document.getElementById("rebirth-complete-modal").classList.add("hidden");
    document.getElementById("rebirth-modal").classList.remove("hidden");
    document.getElementById("confirm-rebirth-btn").classList.add("hidden");
    setTimeout(() => {
        document.getElementById("confirm-rebirth-btn").classList.remove("hidden");
    }, 8000);
});

document.getElementById("hide-rebirth-btn").addEventListener("click", () => {
    document.querySelector(".modal-container").classList.add("hidden");
    document.getElementById("rebirth-complete-modal").classList.add("hidden");
    document.getElementById("rebirth-modal").classList.add("hidden");
});

document.getElementById("confirm-rebirth-btn").addEventListener("click", () => {
    log("Rebirth requested!");
    document.getElementById("rebirth-complete-modal").classList.remove("hidden");
    document.getElementById("rebirth-modal").classList.add("hidden");
    document.querySelector(".sets-ctn").classList.add("hidden");
    document.querySelector(".unlocked-ctn").classList.add("hidden");
    localStorage.clear();
});