async function getBasicTransaction() {
    try {
        const res = await fetch('/api/get-basic-transaction/');
        if (!res.ok) {
            alert("Server error, please try again!");
        };
        if (res.ok && document.cookie.trim() !== "") {
            window.location.href = window.location.href.split('?')[0] + '?cb=' + new Date().getTime().toString().split("")[6];
            return true;
        }
    } catch (e) {
        alert(`Network error, please try again!\n${e}`);
    }
}

document.getElementById("basic-btn").addEventListener("click", () => {
    document.getElementById("basic-btn").textContent = "Please wait";
    document.getElementById("basic-btn").disabled = true;
    getBasicTransaction();
});

document.getElementById("standard-btn").addEventListener("click", () => {
    window.location.href = "/buy/standard";
});

document.getElementById("ultra-btn").addEventListener("click", () => {
    window.location.href = "/buy/ultra";
});

if (localStorage.getItem("song-history")) {
    let a = document.createElement("a");
    a.href = "/inventory";
    a.textContent = "Inventory";
    document.querySelector("nav.navigation").appendChild(a);
}