const API = "http://localhost:8080";
let BLOCKCHAIN = null;
let ACTIVE_USER = localStorage.getItem("poh_user");
let EXPLORE_FILTER = null; // Filtro per la ricerca utente

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Carichiamo PRIMA la blockchain per verificare se l'utente esiste ancora
    await loadChain();

    // 2. Controllo coerenza sessione (Fix per il problema del reset DB)
    if (ACTIVE_USER && BLOCKCHAIN.UsersState && !BLOCKCHAIN.UsersState[ACTIVE_USER]) {
        console.warn("Utente locale non trovato nel DB (Blockchain resettata?). Eseguo Logout.");
        logout(); // Pulisce localStorage e ricarica
        return;
    }

    checkAuth();

    // UI Sidebar: Mostra utente loggato e bottone Logout
    if(ACTIVE_USER) {
        const authBox = document.querySelector('.auth-box');
        if(authBox) authBox.innerHTML = `
            <div style="margin-bottom:10px">Logged as <b>${ACTIVE_USER}</b></div>
            <button class="btn-logout" onclick="logout()">LOGOUT</button>
        `;
    }
    
    // Routing Semplice basato sul nome del file HTML
    const path = window.location.pathname;
    if(path.includes("explore.html")) renderExplore();
    else if(path.includes("create.html")) setupCreatePage();
    else if(path.includes("activity.html")) renderActivity();
    else if(path.includes("profile.html")) renderProfile();
    else renderHome();
});

// --- AUTHENTICATION ---
function checkAuth() {
    if(!ACTIVE_USER) showLoginModal();
}

function showLoginModal() {
    if(document.getElementById('loginModal')) return;
    const modal = document.createElement('div');
    modal.id = 'loginModal';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-box">
            <div class="brand" style="margin-bottom:20px; color:var(--accent)">WHYWOULDYOULIE</div>
            <h3 class="modal-title">Identify Yourself</h3>
            <input type="text" id="modalUser" class="modal-input" placeholder="Username (e.g. Neo)">
            <button class="modal-btn" onclick="performLogin()">ENTER SYSTEM</button>
        </div>
    `;
    document.body.appendChild(modal);
}

async function performLogin() {
    const user = document.getElementById('modalUser').value.trim();
    if(!user) return alert("Username required");
    // Registra utente (se non esiste) o fa login
    await sendTx(user, 'REGISTER_USER', {});
    localStorage.setItem("poh_user", user);
    ACTIVE_USER = user;
    window.location.reload();
}

function logout() {
    localStorage.removeItem("poh_user");
    window.location.reload();
}

// --- CORE DATA ---
async function loadChain() {
    try {
        const res = await fetch(`${API}/chain`);
        BLOCKCHAIN = await res.json();
    } catch(e) { console.error("API Error", e); }
}

// --- UTILITIES ---
async function sendTx(sender, action, extra) {
    try {
        await fetch(`${API}/transact`, {
            method: 'POST',
            body: JSON.stringify({ sender, action, ...extra })
        });
    } catch(e) { alert("Tx Error: " + e); }
}

// Upload generico per immagini (post o avatar)
async function genericUpload(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if(!fileInput || fileInput.files.length === 0) return null;
    
    const formData = new FormData();
    formData.append("image", fileInput.files[0]);

    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    if(!res.ok) throw new Error("Upload Failed");
    return (await res.json()).filename;
}

function toHex(str) {
    const raw = atob(str);
    let res = '';
    for (let i = 0; i < raw.length; i++) {
        const hex = raw.charCodeAt(i).toString(16);
        res += (hex.length === 2 ? hex : '0' + hex);
    }
    return res;
}

function getCancelledReposts(blocks) {
    const s = new Set();
    blocks.forEach(b => {
        if(b.Transaction.ActionType === 'UNREPOST') 
            s.add(`${b.Transaction.Sender}:${b.Transaction.TargetHash}`);
    });
    return s;
}

// --- PAGE: EXPLORE (SEARCH & GRID) ---
function searchUser() {
    const term = document.getElementById('searchInput').value.trim();
    EXPLORE_FILTER = term || null;
    renderExplore();
}

function renderExplore() {
    const grid = document.getElementById('explore-grid');
    if(!grid) return;
    grid.innerHTML = "";

    // Header Risultati Ricerca
    const header = document.getElementById('explore-header');
    if(header) {
        if(EXPLORE_FILTER) {
            header.style.display = "block";
            header.innerText = `Results for: "${EXPLORE_FILTER}"`;
        } else {
            header.style.display = "none";
        }
    }

    BLOCKCHAIN.Blocks.slice().reverse().forEach(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE') return;

        // --- FIX LOGICA RICERCA ---
        if(EXPLORE_FILTER) {
            const senderLower = tx.Sender.toLowerCase();
            const filterLower = EXPLORE_FILTER.toLowerCase();
            // Ora usa includes() invece di uguaglianza esatta
            if(!senderLower.includes(filterLower)) return;
        }
        // --------------------------

        // Censura Community
        const imgState = BLOCKCHAIN.ImagesState[toHex(block.Hash)];
        if(imgState && imgState.Fakes > (imgState.Likes + 2)) return;

        const div = document.createElement('div');
        div.className = 'grid-item';
        div.innerHTML = `
            <img src="${API}/files/${tx.ContentText}">
            <div class="grid-overlay">
                <span class="material-icons-round">favorite</span> ${imgState ? imgState.Likes : 0}
            </div>
        `;
        grid.appendChild(div);
    });

    if(grid.innerHTML === "") grid.innerHTML = "<div style='color:gray; padding:20px'>No content found.</div>";
}

// --- PAGE: PROFILE (AVATAR & BIO) ---
async function changeAvatar() {
    try {
        const filename = await genericUpload('avatarInput');
        if(filename) {
            // Aggiorna solo avatar via JSON payload nella transazione
            const jsonPayload = JSON.stringify({ avatar: filename });
            await sendTx(ACTIVE_USER, 'SET_PROFILE', { content: jsonPayload });
            window.location.reload();
        }
    } catch(e) { alert("Avatar update failed: " + e); }
}

async function updateBio() {
    const txt = document.getElementById('newBio').value;
    if(!txt) return;
    const jsonPayload = JSON.stringify({ bio: txt });
    await sendTx(ACTIVE_USER, 'SET_PROFILE', { content: jsonPayload });
    window.location.reload();
}

function renderProfile() {
    const profile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    if(!profile) return;

    document.getElementById('profile-username').innerText = ACTIVE_USER;
    
    // Logica Avatar: Se esiste, mostra immagine, altrimenti lettera iniziale
    const imgEl = document.getElementById('profile-avatar-img');
    const txtEl = document.getElementById('profile-avatar-text');
    
    if(profile.Avatar) {
        imgEl.src = `${API}/files/${profile.Avatar}`;
        imgEl.style.display = "block";
        txtEl.style.display = "none";
    } else {
        imgEl.style.display = "none";
        txtEl.style.display = "block";
        txtEl.innerText = ACTIVE_USER[0].toUpperCase();
    }

    document.getElementById('p-followers').innerText = profile.Followers ? profile.Followers.length : 0;
    document.getElementById('p-following').innerText = profile.Following ? profile.Following.length : 0;

    // Sezione Bio & Edit
    const bioContainer = document.getElementById('profile-bio-container');
    bioContainer.innerHTML = `
        <div style="color:var(--text-sec); font-style:italic">"${profile.Bio || 'No bio yet.'}"</div>
        <div style="margin-top:10px; border-top:1px solid #333; padding-top:10px;">
            <input type="text" id="newBio" class="edit-bio-input" placeholder="Update status...">
            <button onclick="updateBio()" class="btn-primary" style="padding:5px 10px; font-size:0.8em; margin-top:5px;">UPDATE BIO</button>
        </div>
    `;

    // Griglia dei Post Utente
    const grid = document.getElementById('profile-grid');
    grid.innerHTML = "";
    let postCount = 0;

    BLOCKCHAIN.Blocks.slice().reverse().forEach(block => {
        const tx = block.Transaction;
        if(tx.Sender !== ACTIVE_USER || tx.ActionType !== 'POST_IMAGE') return;
        postCount++;
        const div = document.createElement('div');
        div.className = 'grid-item';
        div.innerHTML = `<img src="${API}/files/${tx.ContentText}">`;
        grid.appendChild(div);
    });
    document.getElementById('p-posts').innerText = postCount;
}

// --- PAGE: CREATE (UPLOAD) ---
function setupCreatePage() {
    const fileInput = document.getElementById('realFileInput');
    if(fileInput) {
        fileInput.addEventListener('change', () => {
             document.getElementById('fileNameDisplay').innerText = fileInput.files[0].name;
        });
    }
}

async function uploadAndPost() {
    try {
        const filename = await genericUpload('realFileInput');
        if(filename) {
            await sendTx(ACTIVE_USER, 'POST_IMAGE', { content: filename });
            window.location.href = "index.html";
        }
    } catch(e) { alert(e); }
}

// --- PAGE: HOME (FEED) ---
function renderHome() {
    const container = document.getElementById('feed-container');
    if(!container) return;
    container.innerHTML = "";
    
    const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    const following = myProfile ? myProfile.Following : [];
    const cancelledReposts = getCancelledReposts(BLOCKCHAIN.Blocks);

    const blocks = BLOCKCHAIN.Blocks.slice().reverse().filter(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE' && tx.ActionType !== 'REPOST') return false;
        
        // Non mostrare Repost annullati
        if(tx.ActionType === 'REPOST' && cancelledReposts.has(`${tx.Sender}:${tx.TargetHash}`)) return false;

        const targetHash = tx.ActionType === 'REPOST' ? tx.TargetHash : toHex(block.Hash);
        const imgState = BLOCKCHAIN.ImagesState[targetHash];
        
        // Censura Community
        if(imgState && imgState.Fakes > (imgState.Likes + 2)) return false;

        // Logica Feed: Mostra post MIEI o di chi SEGUO
        if(tx.Sender === ACTIVE_USER || following.includes(tx.Sender)) return true;
        return false;
    });

    if(blocks.length === 0) container.innerHTML = "<div style='text-align:center; padding:50px'>Follow someone to see posts.</div>";
    blocks.forEach(block => container.appendChild(createPostCard(block)));
}

// --- PAGE: ACTIVITY ---
function renderActivity() {
    const container = document.getElementById('activity-list');
    if(!container) return;
    
    // Filtra notifiche per l'utente attivo
    const notifs = BLOCKCHAIN.Blocks.slice().reverse().filter(b => 
        b.Transaction.ActionType === 'FOLLOW' && b.Transaction.TargetUser === ACTIVE_USER
    );

    notifs.forEach(block => {
        const div = document.createElement('div');
        div.className = 'notif-item';
        div.innerHTML = `
            <div class="avatar">${block.Transaction.Sender[0]}</div>
            <div><b>${block.Transaction.Sender}</b> ha iniziato a seguirti.</div>
        `;
        container.appendChild(div);
    });
}

// --- UI COMPONENT: POST CARD ---
function createPostCard(block) {
    const tx = block.Transaction;
    const isRepost = tx.ActionType === 'REPOST';
    const targetHash = isRepost ? tx.TargetHash : toHex(block.Hash);
    
    // Trova blocco originale (se è un repost)
    let original = isRepost ? BLOCKCHAIN.Blocks.find(b => toHex(b.Hash) === tx.TargetHash) : block;
    if(!original) return document.createElement('div');

    // Trova Profilo dell'Autore Originale (per mostrare l'Avatar)
    const senderProfile = BLOCKCHAIN.UsersState[original.Transaction.Sender];
    
    let avatarHTML = `<div class="avatar">${original.Transaction.Sender[0]}</div>`;
    if(senderProfile && senderProfile.Avatar) {
        avatarHTML = `<img src="${API}/files/${senderProfile.Avatar}" class="avatar" style="object-fit:cover;">`;
    }

    const imgState = BLOCKCHAIN.ImagesState[targetHash];
    const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    const iReposted = myProfile && myProfile.Reposted && myProfile.Reposted.includes(targetHash);
    const isFollowing = myProfile && myProfile.Following.includes(original.Transaction.Sender);

    const div = document.createElement('div');
    div.className = 'post-card';

    let headerHTML = isRepost ? `<div class="repost-label" style="padding:0 15px">🔁 ${tx.Sender} ha ripubblicato</div>` : '';
    
    // Bottone Segui (appare solo se non stai già seguendo e non sei tu)
    let followBtn = (original.Transaction.Sender !== ACTIVE_USER && !isFollowing) 
        ? `<span style="color:var(--accent); font-size:0.8em; margin-left:auto; cursor:pointer; font-weight:bold" onclick="sendTx('${ACTIVE_USER}', 'FOLLOW', {target_user: '${original.Transaction.Sender}'}); window.location.reload();">Segui</span>` 
        : '';

    div.innerHTML = `
        ${headerHTML}
        <div class="post-header" style="padding: 10px 15px;">
            ${avatarHTML}
            <div class="username">${original.Transaction.Sender}</div>
            ${followBtn}
        </div>
        <img class="post-img" src="${API}/files/${original.Transaction.ContentText}">
        <div style="padding: 0 15px;">
            <div class="post-actions">
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', 'VOTE', {target_hash: '${targetHash}', vote_type: 'BELIEVE'}); window.location.reload();" style="color:${imgState.Likes>0?'var(--green)':'inherit'}">thumb_up</span>
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', 'VOTE', {target_hash: '${targetHash}', vote_type: 'FAKE'}); window.location.reload();" style="color:${imgState.Fakes>0?'var(--accent)':'inherit'}">thumb_down</span>
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', '${iReposted ? 'UNREPOST' : 'REPOST'}', {target_hash: '${targetHash}'}); window.location.reload();" style="color:${iReposted?'var(--repost)':'inherit'}">repeat</span>
            </div>
            <div class="likes-count">${imgState.Likes} real | ${imgState.Fakes} fakes</div>
            <div class="metrics">
                Entropy: ${original.EntropyScore.toFixed(2)} | StdDev: ${original.StdDevScore.toFixed(2)}
            </div>
        </div>
    `;
    return div;
}