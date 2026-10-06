import { parseTrackString, stringifyTracks } from "./history-helpers.js";

function log(str) {
    console.log(`%cLOG%c |%c ${str}`,
        "color: #ff607a; font-weight: bold;",
        "color: #444; font-weight: bold;",
        "color: #f1f1f1;"
    );
}

log("Parsing local song history...");

if (!localStorage.getItem("song-history")) {
    document.location.replace("/403");
}

let songHistoryString = localStorage.getItem("song-history");
let songHistoryArray = parseTrackString(songHistoryString);
let serverData;
let currentCanvas = null;
let currentUsername = null;

log("Creating song shells...");

for (let index = 0; index < setAttributes.songLength; index++) {
    function generateAlphanumeric(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789      ()_-+.,';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    const div = document.createElement("div");
    div.classList.add("song-row");
    div.title = "You haven't unlocked this track yet";
    const h2 = document.createElement("h2");
    h2.classList.add("blurred");
    h2.textContent = generateAlphanumeric(Math.floor(Math.random() * (25 - 5 + 1)) + 5);
    div.appendChild(h2);
    document.querySelector(".song-ctn").appendChild(div);
}

log("Checking with the server...");

async function getSetInfo() {
    let ENDPOINT = new URL(`/api/set-progress/${setAttributes.slug}`, window.location.origin);
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
        alert("Something went wrong if you're seeing this. Please contact me.");
    }    
    
    return data;
}

serverData = await getSetInfo();
console.log('Server Data:', serverData);

log("Data display time!");

if (serverData.items.length < 1) {
    log('Wait, that shit say no songs 💀');
    document.location.replace("/403");
}

let songIdx = 0;
const revealInt = setInterval(() => {
    document.querySelector(".subtitle").textContent = `${songIdx + 1} / ${setAttributes.songLength} songs unlocked`;
    let songRow = document.querySelector(".song-ctn").children[songIdx];
    let songH2 = songRow.querySelector("h2");

    const savedSong = songHistoryArray.find(track => track.name === serverData.items[songIdx].name);

    songH2.textContent = serverData.items[songIdx].title;
    songH2.classList.add(serverData.items[songIdx].rarity);
    songH2.classList.remove("blurred");
    songRow.title = `You discovered this track on ${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(savedSong.time)}\n⇒ ${serverData.items[songIdx].description.replace(/<\/?[^>]+(>|$)/g, "").replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')}
    `;

    songIdx++;
    if (songIdx === serverData.items.length) {
        clearInterval(revealInt);
        document.querySelector(".set-icon").classList.remove("set-unloaded-icon");
        document.querySelector(".dropdown-icon").classList.remove("hidden");
        document.querySelector(".description").innerHTML = setAttributes.description.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="loottox-extra" class="description-link">$1</a>');
        document.querySelector(".button-container").classList.remove("hidden");
        log("All done!");
    };
}, 2000/setAttributes.songLength);

let descriptionExpanded = false;
let descClicks = 0;

document.querySelector(".dropdown-icon").addEventListener("click", () => {
    descClicks++;
    descriptionExpanded = !descriptionExpanded;
    if (descriptionExpanded) {
        document.querySelector(".description").classList.remove("hidden");
        document.querySelector(".subtitle").classList.add("hidden");
    } else {
        document.querySelector(".description").classList.add("hidden");
        document.querySelector(".subtitle").classList.remove("hidden");
    }
    if (descClicks === 7) {
        document.getElementById("hidden-hi").classList.remove("hidden");
    } else {
        document.getElementById("hidden-hi").classList.add("hidden");
    }
});

document.getElementById("share-btn").addEventListener("click", () => {
    let USER_FIELD = document.getElementById("username");
    let USERNAME = USER_FIELD.value?.trim() || null;

    if (!USERNAME) {
        USER_FIELD.value = "";
        USER_FIELD.classList.remove("hidden");
        USER_FIELD.focus();
        return;
    }
    
    document.querySelector(".snapshot-song-ctn").innerHTML = "";

    [...document.querySelector(".song-ctn").children].forEach((v, i) => {
        if (v.querySelector("h2").classList.contains("blurred")) {
            return;
        };
        let x = v.cloneNode(true);
        document.querySelector(".snapshot-song-ctn").appendChild(x);
        document.querySelector(".card-sub").textContent = document.querySelector(".subtitle").textContent;
        document.querySelector(".card-progress").style = `width: ${((serverData.items.length / setAttributes.songLength) * 100).toFixed(2)}%;`
        title.replaceChildren(`${USERNAME}'s `, Object.assign(document.createElement("i"), { textContent: setAttributes.name }))
    });

    document.getElementById("share-btn").textContent = "Please hold";
    document.getElementById("share-btn").disabled = true;

    html2canvas(document.querySelector(".share-snapshot"), {
        onclone: (c) => {
            c.querySelector(".share-snapshot").classList.remove("hidden");
        },
        scale: 2,
        backgroundColor: "#0f0404",
    }).then(canvas => {
        currentCanvas = canvas;
        currentUsername = USERNAME;

        document.querySelector(".canvas-holder").innerHTML = "";
        document.querySelector(".canvas-holder").appendChild(canvas);
        document.querySelector(".modal-container").classList.remove("hidden");
    });
});

document.getElementById("save-btn").addEventListener("click", () => {
    if (!currentCanvas) return;
    const a = document.createElement("a");
    a.href = currentCanvas.toDataURL("image/png");
    a.download = `${currentUsername}'s progression on ${setAttributes.name} | Loottox.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

document.getElementById("copy-btn").addEventListener("click", () => {
    if (!currentCanvas) return;
    currentCanvas.toBlob(async (blob) => {
        if (!blob) {
            console.error("Canvas conversion to Blob failed.");
            return;
        }
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        document.getElementById("copy-btn").textContent = "Copied";
    }, "image/png");
});

document.getElementById("close-btn").addEventListener("click", () => {
    document.querySelector(".canvas-holder").innerHTML = "";
    document.querySelector(".modal-container").classList.add("hidden");
    document.getElementById("username").classList.add("hidden");
    document.getElementById("share-btn").textContent = "Share Progress";
    document.getElementById("share-btn").disabled = false;
    currentCanvas = null;
});

document.getElementById("share2-btn").addEventListener("click", () => {
    if (!currentCanvas) return;
    currentCanvas.toBlob(async (blob) => {
        if (!blob) return;

        const file = new File([blob], "progression.png", { type: "image/png" });
        const shareData = {
            title: `${setAttributes.name} | Loottox`,
            text: `👀 I've unlocked ${serverData.items.length} of the ${setAttributes.songLength} songs available in the ${setAttributes.name} set in Loottox so far. How about you?\n\n${document.location.href}`,
            files: [file],
        };

        if (navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
                log("Shared successfully");
            } catch (err) {
                if (err.name !== "AbortError") {
                    console.error("Error sharing:", err);
                    document.getElementById("share2-btn").textContent = "Error";
                }
            }
        } else {
            const btn = document.getElementById("share2-btn");
            btn.textContent = "Unsupported";
            btn.disabled = true;
            setTimeout(() => btn.classList.add("hidden"), 3000);
        }
    }, "image/png");
});