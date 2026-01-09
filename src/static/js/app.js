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
    const userContainer = document.getElementById('user-results');
    const header = document.getElementById('explore-header');
    
    if(!grid || !userContainer) return;
    
    grid.innerHTML = "";
    userContainer.innerHTML = "";

    // Gestione Header
    if(header) {
        if(EXPLORE_FILTER) {
            header.style.display = "block";
            header.innerText = `Results for: "${EXPLORE_FILTER}"`;
        } else {
            header.style.display = "none";
        }
    }

    if (!BLOCKCHAIN) return;

    // --- 1. CERCA UTENTI (Se c'è filtro) ---
    if(EXPLORE_FILTER) {
        const filterLower = EXPLORE_FILTER.toLowerCase();
        // Prendo tutti gli utenti dallo stato
        const allUsers = Object.values(BLOCKCHAIN.UsersState);
        
        // Filtro per nome
        const foundUsers = allUsers.filter(u => u.Username.toLowerCase().includes(filterLower));
        
        foundUsers.forEach(user => {
            // Creo card utente
            const div = document.createElement('div');
            div.className = 'notif-item'; // Stile riutilizzato
            div.style.background = '#1a1a1a'; // Leggermente più chiaro
            div.style.borderRadius = '8px';

            // Logica bottone Follow
            const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
            const isFollowing = myProfile && myProfile.Following.includes(user.Username);
            let actionBtn = '';
            
            if(user.Username !== ACTIVE_USER) {
                if(isFollowing) {
                    actionBtn = `<span style="color:gray; font-size:0.8em; margin-left:auto;">Following</span>`;
                } else {
                    actionBtn = `<button class="btn-primary" style="padding:5px 15px; font-size:0.8em; margin-left:auto; margin-top:0;" onclick="sendTx('${ACTIVE_USER}', 'FOLLOW', {target_user: '${user.Username}'}); window.location.reload();">Follow</button>`;
                }
            } else {
                actionBtn = `<span style="color:var(--accent); font-size:0.8em; margin-left:auto;">It's you</span>`;
            }

            // Avatar 
            let avatarImg = `<div class="avatar">${user.Username[0]}</div>`;
            if(user.Avatar) avatarImg = `<img src="${API}/files/${user.Avatar}" class="avatar" style="object-fit:cover">`;

            div.innerHTML = `
                ${avatarImg}
                <div>
                    <b>${user.Username}</b>
                    <div style="font-size:0.8em; color:gray">${user.Bio || ''}</div>
                </div>
                ${actionBtn}
            `;
            userContainer.appendChild(div);
        });

        if(foundUsers.length === 0) {
            // userContainer.innerHTML = "<div style='color:gray; padding:10px'>No users found.</div>";
        }
    }

    // --- 2. CERCA POST (Immagini) ---
    let foundPosts = 0;
    BLOCKCHAIN.Blocks.slice().reverse().forEach(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE') return;

        // Filtro Ricerca Post
        if(EXPLORE_FILTER) {
            const senderLower = tx.Sender.toLowerCase();
            const filterLower = EXPLORE_FILTER.toLowerCase();
            if(!senderLower.includes(filterLower)) return;
        }

        const imgState = BLOCKCHAIN.ImagesState[toHex(block.Hash)];
        if(imgState && imgState.Fakes > (imgState.Likes + 2)) return;

        foundPosts++;
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

    if(foundPosts === 0 && (!EXPLORE_FILTER || userContainer.innerHTML === "")) {
        grid.innerHTML = "<div style='color:gray; padding:20px'>No content found.</div>";
    }
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

function renderProfile() {
    const profile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    if(!profile) return;

    document.getElementById('profile-username').innerText = ACTIVE_USER;
    
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

    const bioContainer = document.getElementById('profile-bio-container');
    bioContainer.innerHTML = `
        <div style="color:var(--text-sec); font-style:italic">"${profile.Bio || 'No bio yet.'}"</div>
        <div style="margin-top:10px; border-top:1px solid #333; padding-top:10px;">
            <input type="text" id="newBio" class="edit-bio-input" placeholder="Update status...">
            <button onclick="updateBio()" class="btn-primary" style="padding:5px 10px; font-size:0.8em; margin-top:5px;">UPDATE BIO</button>
        </div>
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
    const cancelledReposts = getCancelledReposts(BLOCKCHAIN.Blocks);

    const blocks = BLOCKCHAIN.Blocks.slice().reverse().filter(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE' && tx.ActionType !== 'REPOST') return false;
        if(tx.ActionType === 'REPOST' && cancelledReposts.has(`${tx.Sender}:${tx.TargetHash}`)) return false;
        const targetHash = tx.ActionType === 'REPOST' ? tx.TargetHash : toHex(block.Hash);
        const imgState = BLOCKCHAIN.ImagesState[targetHash];
        if(imgState && imgState.Fakes > (imgState.Likes + 2)) return false;
        if(tx.Sender === ACTIVE_USER || following.includes(tx.Sender)) return true;
        return false;
    });

    if(blocks.length === 0) container.innerHTML = "<div style='text-align:center; padding:50px'>Follow someone to see posts.</div>";
    blocks.forEach(block => container.appendChild(createPostCard(block)));
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