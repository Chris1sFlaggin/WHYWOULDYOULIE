const API = "http://localhost:8080";
let BLOCKCHAIN = null;
let ACTIVE_USER = localStorage.getItem("poh_user");
let EXPLORE_FILTER = null;

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    await loadChain();

    if (ACTIVE_USER && BLOCKCHAIN.UsersState && !BLOCKCHAIN.UsersState[ACTIVE_USER]) {
        console.warn("Utente locale non trovato. Logout.");
        logout(); 
        return;
    }

    checkAuth();

    if(ACTIVE_USER) {
        const authBox = document.querySelector('.auth-box');
        if(authBox) authBox.innerHTML = `
            <div style="margin-bottom:10px">Logged as <b>${ACTIVE_USER}</b></div>
            <button class="btn-logout" onclick="logout()">LOGOUT</button>
        `;
    }
    
    const path = window.location.pathname;
    if(path.includes("explore.html")) {
        setupExplorePage();
        renderExplore();
    }
    else if(path.includes("create.html")) setupCreatePage();
    else if(path.includes("activity.html")) renderActivity();
    else if(path.includes("profile.html")) renderProfile();
    else renderHome();
});

// --- AUTH ---
function checkAuth() { if(!ACTIVE_USER) showLoginModal(); }

function showLoginModal() {
    if(document.getElementById('loginModal')) return;
    const modal = document.createElement('div');
    modal.id = 'loginModal';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-box">
            <div class="brand" style="margin-bottom:20px; color:var(--accent)">WHYWOULDYOULIE</div>
            <h3 class="modal-title">Identify Yourself</h3>
            <input type="text" id="modalUser" class="modal-input" placeholder="Username">
            <button class="modal-btn" onclick="performLogin()">ENTER SYSTEM</button>
        </div>
    `;
    document.body.appendChild(modal);
}

async function performLogin() {
    const user = document.getElementById('modalUser').value.trim();
    if(!user) return alert("Username required");
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

async function sendTx(sender, action, extra) {
    try {
        await fetch(`${API}/transact`, {
            method: 'POST',
            body: JSON.stringify({ sender, action, ...extra })
        });
    } catch(e) { alert("Tx Error: " + e); }
}

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

// --- EXPLORE & SEARCH ---
function setupExplorePage() {
    const input = document.getElementById('searchInput');
    if(input) {
        input.addEventListener("keyup", function(event) {
            if (event.key === "Enter") searchUser();
        });
    }
}

function searchUser() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    EXPLORE_FILTER = input.value.trim();
    renderExplore();
}

function renderExplore() {
    const grid = document.getElementById('explore-grid');
    const userList = document.getElementById('user-results');
    if(!grid || !userList) return;
    
    grid.innerHTML = ""; 
    userList.innerHTML = "";

    // 1. RICERCA UTENTI (Cerca nel DB Utenti, non solo nei Post)
    if(EXPLORE_FILTER && BLOCKCHAIN.UsersState) {
        const filter = EXPLORE_FILTER.toLowerCase();
        const header = document.getElementById('explore-header');
        if(header) {
            header.style.display = "block";
            header.innerText = `Results for: ${EXPLORE_FILTER}`;
        }

        Object.values(BLOCKCHAIN.UsersState).filter(u => u.Username.toLowerCase().includes(filter)).forEach(u => {
            const div = document.createElement('div');
            div.className = 'notif-item';
            div.style.background = '#1a1a1a'; div.style.borderRadius = '8px'; div.style.marginBottom = '5px';
            
            // Logica Follow
            const iFollow = BLOCKCHAIN.UsersState[ACTIVE_USER].Following.includes(u.Username);
            let btn = (u.Username !== ACTIVE_USER) 
                ? `<button class="btn-primary" style="padding:5px 15px; margin-left:auto; font-size:0.8em" onclick="sendTx('${ACTIVE_USER}', '${iFollow?'UNFOLLOW':'FOLLOW'}', {target_user:'${u.Username}'});window.location.reload()">${iFollow?'Unfollow':'Follow'}</button>` 
                : `<span style="margin-left:auto; color:gray">You</span>`;

            div.innerHTML = `
                <div class="avatar" onclick="goToProfile('${u.Username}')" style="cursor:pointer">${u.Avatar ? `<img src="${API}/files/${u.Avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : u.Username[0]}</div>
                <div style="margin-left:10px; cursor:pointer" onclick="goToProfile('${u.Username}')"><b>${u.Username}</b><br><span style="font-size:0.8em;color:gray">${u.Bio||''}</span></div>
                ${btn}
            `;
            userList.appendChild(div);
        });
    }

    // 2. RICERCA POST
    BLOCKCHAIN.Blocks.slice().reverse().forEach(b => {
        const tx = b.Transaction;
        if(tx.ActionType !== 'POST_IMAGE') return;
        if(EXPLORE_FILTER && !tx.Sender.toLowerCase().includes(EXPLORE_FILTER.toLowerCase())) return;
        
        const div = document.createElement('div');
        div.className = 'grid-item';
        div.innerHTML = `<img src="${API}/files/${tx.ContentText}">`;
        grid.appendChild(div);
    });
}

// --- PROFILE ---
async function changeAvatar() {
    try {
        const filename = await genericUpload('avatarInput');
        if(filename) {
            const jsonPayload = JSON.stringify({ avatar: filename });
            await sendTx(ACTIVE_USER, 'SET_PROFILE', { content: jsonPayload });
            window.location.reload();
        }
    } catch(e) { alert("Avatar error: " + e); }
}

async function updateBio() {
    const txt = document.getElementById('newBio').value;
    if(!txt) return;
    const jsonPayload = JSON.stringify({ bio: txt });
    await sendTx(ACTIVE_USER, 'SET_PROFILE', { content: jsonPayload });
    window.location.reload();
}

function goToProfile(username) {
    localStorage.setItem("view_profile", username);
    window.location.href = "profile.html";
}

function renderProfile() {
    // Determina quale profilo mostrare: quello richiesto o l'utente attivo
    const viewUser = localStorage.getItem("view_profile") || ACTIVE_USER;
    const profile = BLOCKCHAIN.UsersState[viewUser];
    const isMe = (viewUser === ACTIVE_USER);

    if(!profile) return;

    // Imposta Header Profilo
    document.getElementById('profile-username').innerText = viewUser;
    
    // Gestione Avatar
    const imgEl = document.getElementById('profile-avatar-img');
    const txtEl = document.getElementById('profile-avatar-text');
    
    if(profile.Avatar) { 
        imgEl.src = `${API}/files/${profile.Avatar}`; 
        imgEl.style.display = "block"; 
        txtEl.style.display = "none"; 
    } else { 
        imgEl.style.display = "none"; 
        txtEl.style.display = "block"; 
        txtEl.innerText = viewUser[0].toUpperCase(); 
    }

    // Statistiche
    document.getElementById('p-followers').innerText = profile.Followers.length;
    document.getElementById('p-following').innerText = profile.Following.length;

    // Logica Dinamica: BIO + Tasti (Edit vs Follow/Message)
    const container = document.getElementById('profile-bio-container');
    let html = `<div style="color:var(--text-sec); font-style:italic">"${profile.Bio || ''}"</div>`;
    
    if(isMe) {
        // Se sono io: Mostra input per modificare Bio/Avatar
        html += `
            <input type="text" id="newBio" class="edit-bio-input" placeholder="Update status...">
            <button onclick="updateBio()" class="btn-primary" style="padding:5px 10px; font-size:0.8em; margin-top:5px;">UPDATE BIO</button>
        `;
        // Riattiva l'overlay per cambiare avatar
        const overlay = document.querySelector('.avatar-edit-overlay');
        if(overlay) overlay.style.display = 'flex';

    } else {
        // Se è un altro utente: Mostra tasti Follow e Message
        const iFollow = BLOCKCHAIN.UsersState[ACTIVE_USER].Following.includes(viewUser);
        html += `
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button onclick="sendTx('${ACTIVE_USER}', '${iFollow?'UNFOLLOW':'FOLLOW'}', {target_user:'${viewUser}'});window.location.reload()" class="btn-primary" style="flex:1;">${iFollow?'Unfollow':'Follow'}</button>
                <button onclick="const m=prompt('Message:');if(m)sendTx('${ACTIVE_USER}','PRIVATE_MSG',{target_user:'${viewUser}',content:m})" class="btn-primary" style="flex:1; background:#333;">Message</button>
            </div>
        `;
        // Nascondi l'overlay per cambiare avatar (non puoi cambiare l'avatar degli altri)
        const overlay = document.querySelector('.avatar-edit-overlay');
        if(overlay) overlay.style.display = 'none';
    }
    
    container.innerHTML = html;

    // Griglia Post: Filtra SOLO i post dell'utente che stai guardando
    const grid = document.getElementById('profile-grid');
    grid.innerHTML = "";
    let count = 0;
    
    BLOCKCHAIN.Blocks.slice().reverse().forEach(b => {
        // Mostra solo i post originali caricati da viewUser
        if(b.Transaction.Sender === viewUser && b.Transaction.ActionType === 'POST_IMAGE') {
            count++;
            const div = document.createElement('div');
            div.className = 'grid-item';
            div.innerHTML = `<img src="${API}/files/${b.Transaction.ContentText}">`;
            grid.appendChild(div);
        }
    });
    
    document.getElementById('p-posts').innerText = count;
}

// --- CREATE ---
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

// --- HOME ---
function renderHome() {
    const container = document.getElementById('feed-container');
    if(!container) return;
    container.innerHTML = "";
    
    const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    const following = myProfile ? myProfile.Following : [];
    const cancelled = getCancelledReposts(BLOCKCHAIN.Blocks); // Assicurati di avere questa helper function

    const blocks = BLOCKCHAIN.Blocks.slice().reverse().filter(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE' && tx.ActionType !== 'REPOST') return false;
        if(tx.ActionType === 'REPOST' && cancelled.has(`${tx.Sender}:${tx.TargetHash}`)) return false;
        
        // MOSTRA SE: È un mio post OPPURE l'autore è tra i miei seguiti
        if(tx.Sender === ACTIVE_USER || following.includes(tx.Sender)) return true;
        return false;
    });

    if(blocks.length === 0) container.innerHTML = "<div style='text-align:center; padding:50px'>Il feed è vuoto. Cerca utenti in Explore!</div>";
    blocks.forEach(b => container.appendChild(createPostCard(b)));
}

// --- ACTIVITY ---
function renderActivity() {
    const container = document.getElementById('activity-list');
    if(!container) return;
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

function createPostCard(block) {
    const tx = block.Transaction;
    const isRepost = tx.ActionType === 'REPOST';
    const targetHash = isRepost ? tx.TargetHash : toHex(block.Hash);
    
    let original = isRepost ? BLOCKCHAIN.Blocks.find(b => toHex(b.Hash) === tx.TargetHash) : block;
    if(!original) return document.createElement('div');

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
        </div>
    `;
    return div;
}