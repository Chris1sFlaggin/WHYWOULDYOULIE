const API = "http://localhost:8080";
let BLOCKCHAIN = null;
let ACTIVE_USER = localStorage.getItem("poh_user"); // Null se non loggato

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    checkAuth(); // Controlla subito se loggato

    // Init Sidebar UI
    if(ACTIVE_USER) {
        const authBox = document.querySelector('.auth-box');
        if(authBox) authBox.innerHTML = `
            <div style="margin-bottom:10px">Logged as <b>${ACTIVE_USER}</b></div>
            <button class="btn-logout" onclick="logout()">LOGOUT</button>
        `;
    }

    await loadChain();
    
    // Router
    const path = window.location.pathname;
    if(path.includes("explore.html")) renderExplore();
    else if(path.includes("create.html")) setupCreatePage();
    else if(path.includes("activity.html")) renderActivity();
    else if(path.includes("profile.html")) renderProfile();
    else renderHome();
});

// --- AUTH LOGIC ---
function checkAuth() {
    const isLoginPage = false; // Logicamente siamo sempre su pagine protette ora
    if(!ACTIVE_USER) {
        showLoginModal();
    }
}

function showLoginModal() {
    // Crea il modale dinamicamente se non esiste
    if(!document.getElementById('loginModal')) {
        const modal = document.createElement('div');
        modal.id = 'loginModal';
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal-box">
                <div class="brand" style="margin-bottom:20px; color:var(--accent)">WHYWOULDYOULIE</div>
                <h3 class="modal-title">Identify Yourself</h3>
                <input type="text" id="modalUser" class="modal-input" placeholder="Username (e.g. Neo)">
                <button class="modal-btn" onclick="performLogin()">ENTER SYSTEM</button>
                <div style="margin-top:15px; font-size:0.8em; color:gray">
                    New? Clicking Enter will create a new identity.
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

async function performLogin() {
    const user = document.getElementById('modalUser').value.trim();
    if(!user) return alert("Username required");
    
    // Tenta registrazione (se esiste già il backend lo sa e non da errore bloccante)
    await sendTx(user, 'REGISTER_USER', {});
    
    localStorage.setItem("poh_user", user);
    ACTIVE_USER = user;
    window.location.reload();
}

function logout() {
    localStorage.removeItem("poh_user");
    window.location.reload();
}

// --- CORE ---
async function loadChain() {
    try {
        const res = await fetch(`${API}/chain`);
        BLOCKCHAIN = await res.json();
    } catch(e) { console.error("API Error", e); }
}

// --- PAGE: CREATE (UPLOAD REALE) ---
function setupCreatePage() {
    const fileInput = document.getElementById('realFileInput');
    const label = document.getElementById('fileNameDisplay');
    
    if(fileInput) {
        fileInput.addEventListener('change', (e) => {
            if(fileInput.files.length > 0) {
                label.innerText = "Selected: " + fileInput.files[0].name;
            }
        });
    }
}

async function uploadAndPost() {
    const fileInput = document.getElementById('realFileInput');
    if(!fileInput || fileInput.files.length === 0) return alert("Seleziona un file!");

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("image", file);

    // 1. Upload fisico
    try {
        const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
        if(!res.ok) throw "Upload failed";
        const data = await res.json();
        const serverFileName = data.filename;

        // 2. Transazione Blockchain
        await sendTx(ACTIVE_USER, 'POST_IMAGE', { content: serverFileName });
        window.location.href = "index.html";

    } catch(e) {
        alert("Errore Upload: " + e);
    }
}

// --- PAGE: PROFILE (EDIT BIO) ---
function renderProfile() {
    const profile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    if(!profile) return; // Should not happen if logged in

    document.getElementById('profile-username').innerText = ACTIVE_USER;
    document.getElementById('profile-avatar').innerText = ACTIVE_USER[0].toUpperCase();
    document.getElementById('p-followers').innerText = profile.Followers ? profile.Followers.length : 0;
    document.getElementById('p-following').innerText = profile.Following ? profile.Following.length : 0;
    
    // Bio Section with Edit
    const bioContainer = document.getElementById('profile-bio-container');
    bioContainer.innerHTML = `
        <div style="color:var(--text-sec); font-style:italic">"${profile.Bio || 'No bio yet.'}"</div>
        <input type="text" id="newBio" class="edit-bio-input" placeholder="Change your status...">
        <button onclick="updateBio()" style="margin-top:5px; padding:5px; font-size:0.7em; cursor:pointer;">UPDATE</button>
    `;

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

async function updateBio() {
    const txt = document.getElementById('newBio').value;
    if(!txt) return;
    await sendTx(ACTIVE_USER, 'SET_PROFILE', { content: txt });
    window.location.reload();
}

// HELPERS ESSENZIALI
async function sendTx(sender, action, extra) {
    const payload = { sender, action, ...extra };
    try {
        await fetch(`${API}/transact`, { method: 'POST', body: JSON.stringify(payload) });
    } catch(e) { alert("Errore: " + e); }
}

// --- RENDERERS ---
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
        
        // Repost check
        if(tx.ActionType === 'REPOST' && cancelledReposts.has(`${tx.Sender}:${tx.TargetHash}`)) return false;

        // Censorship Check
        const targetHash = tx.ActionType === 'REPOST' ? tx.TargetHash : toHex(block.Hash);
        const imgState = BLOCKCHAIN.ImagesState[targetHash];
        if(imgState && imgState.Fakes > (imgState.Likes + 2)) return false;

        // Feed Logic: Me + Following
        if(tx.Sender === ACTIVE_USER) return true;
        if(following.includes(tx.Sender)) return true;
        return false;
    });

    if(blocks.length === 0) container.innerHTML = "<div style='text-align:center; padding:50px'>Nessun post. Vai su Esplora!</div>";
    blocks.forEach(block => container.appendChild(createPostCard(block)));
}

function renderExplore() {
    const grid = document.getElementById('explore-grid');
    if(!grid) return;
    grid.innerHTML = "";

    BLOCKCHAIN.Blocks.slice().reverse().forEach(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE') return;
        
        // Censorship
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
}

function renderProfile() {
    const profile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    if(!profile) {
        document.getElementById('profile-content').innerHTML = "<div style='text-align:center; margin-top:50px'>Utente non registrato.</div>";
        return;
    }

    document.getElementById('profile-username').innerText = ACTIVE_USER;
    document.getElementById('profile-avatar').innerText = ACTIVE_USER[0].toUpperCase();
    document.getElementById('p-followers').innerText = profile.Followers ? profile.Followers.length : 0;
    document.getElementById('p-following').innerText = profile.Following ? profile.Following.length : 0;

    const grid = document.getElementById('profile-grid');
    let postCount = 0;

    BLOCKCHAIN.Blocks.slice().reverse().forEach(block => {
        const tx = block.Transaction;
        if(tx.Sender !== ACTIVE_USER || tx.ActionType !== 'POST_IMAGE') return;
        postCount++;

        const imgState = BLOCKCHAIN.ImagesState[toHex(block.Hash)];
        const div = document.createElement('div');
        div.className = 'grid-item';
        div.innerHTML = `<img src="${API}/files/${tx.ContentText}">`;
        grid.appendChild(div);
    });
    document.getElementById('p-posts').innerText = postCount;
}

function renderActivity() {
    const container = document.getElementById('activity-list');
    if(!container) return;
    
    // Filter notifications for active user
    const notifs = BLOCKCHAIN.Blocks.slice().reverse().filter(b => {
        const tx = b.Transaction;
        return tx.ActionType === 'FOLLOW' && tx.TargetUser === ACTIVE_USER;
    });

    notifs.forEach(block => {
        const div = document.createElement('div');
        div.className = 'notif-item';
        div.innerHTML = `
            <div class="avatar">${block.Transaction.Sender[0]}</div>
            <div><b>${block.Transaction.Sender}</b> ha iniziato a seguirti.</div>
            <div class="notif-time">Just now</div>
        `;
        container.appendChild(div);
    });
}

// --- UI COMPONENTS ---
function createPostCard(block) {
    const tx = block.Transaction;
    const isRepost = tx.ActionType === 'REPOST';
    const hexHash = toHex(block.Hash);
    const targetHash = isRepost ? tx.TargetHash : hexHash;
    
    let original = isRepost ? BLOCKCHAIN.Blocks.find(b => toHex(b.Hash) === tx.TargetHash) : block;
    if(!original) return document.createElement('div');

    const imgState = BLOCKCHAIN.ImagesState[targetHash];
    const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    const iReposted = myProfile && myProfile.Reposted && myProfile.Reposted.includes(targetHash);
    const isFollowing = myProfile && myProfile.Following.includes(original.Transaction.Sender);

    const div = document.createElement('div');
    div.className = 'post-card';

    let headerHTML = isRepost ? `<div class="repost-label" style="padding:0 15px">🔁 ${tx.Sender} ha ripubblicato</div>` : '';
    let followBtn = (original.Transaction.Sender !== ACTIVE_USER && !isFollowing) 
        ? `<span style="color:var(--accent); font-size:0.8em; margin-left:auto; cursor:pointer; font-weight:bold" onclick="sendTx('${ACTIVE_USER}', 'FOLLOW', {target_user: '${original.Transaction.Sender}'})">Segui</span>` 
        : '';

    div.innerHTML = `
        ${headerHTML}
        <div class="post-header" style="padding: 10px 15px;">
            <div class="avatar">${original.Transaction.Sender[0]}</div>
            <div class="username">${original.Transaction.Sender}</div>
            ${followBtn}
        </div>
        <img class="post-img" src="${API}/files/${original.Transaction.ContentText}">
        <div style="padding: 0 15px;">
            <div class="post-actions">
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', 'VOTE', {target_hash: '${targetHash}', vote_type: 'BELIEVE'})" style="color:${imgState.Likes>0?'var(--green)':'inherit'}">thumb_up</span>
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', 'VOTE', {target_hash: '${targetHash}', vote_type: 'FAKE'})" style="color:${imgState.Fakes>0?'var(--accent)':'inherit'}">thumb_down</span>
                <span class="material-icons-round action-icon" onclick="toggleRepost('${ACTIVE_USER}', '${targetHash}', ${iReposted})" style="color:${iReposted?'var(--repost)':'inherit'}">repeat</span>
            </div>
            <div class="likes-count">${imgState.Likes} real | ${imgState.Fakes} fakes</div>
            <div class="metrics">
                Entropy: ${original.EntropyScore.toFixed(2)} | StdDev: ${original.StdDevScore.toFixed(2)}
            </div>
        </div>
    `;
    return div;
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
        if(b.Transaction.ActionType === 'UNREPOST') s.add(`${b.Transaction.Sender}:${b.Transaction.TargetHash}`);
    });
    return s;
}
