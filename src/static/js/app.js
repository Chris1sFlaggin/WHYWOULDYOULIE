const API = "http://localhost:8080";
let BLOCKCHAIN = null;
let ACTIVE_USER = localStorage.getItem("poh_user");
let EXPLORE_FILTER = null;

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    await loadChain();

    // Fix Logout automatico se il DB è stato resettato
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
    
    // Reset view_profile se non siamo nel profilo
    if(!path.includes("profile.html")) localStorage.removeItem("view_profile");

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
    localStorage.removeItem("view_profile");
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

// --- ACTIONS (FIXED) ---

// Funzione dedicata per gestire il Follow con attesa
async function toggleFollow(targetUser) {
    const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    if (!myProfile) return;

    const isFollowing = myProfile.Following.includes(targetUser);
    const action = isFollowing ? 'UNFOLLOW' : 'FOLLOW'; // Toggle intelligente

    // AWAIT è fondamentale: aspetta che il server risponda prima di ricaricare
    await sendTx(ACTIVE_USER, action, {target_user: targetUser});
    window.location.reload();
}

function goToProfile(username) {
    localStorage.setItem("view_profile", username);
    window.location.href = "profile.html";
}

async function sendComment(hash) {
    const txt = prompt("Scrivi un commento:");
    if(txt) {
        await sendTx(ACTIVE_USER, 'COMMENT', {target_hash: hash, content: txt});
        window.location.reload();
    }
}

async function sendMessage(targetUser) {
    const txt = prompt(`Scrivi messaggio privato a ${targetUser}:`);
    if(txt) {
        await sendTx(ACTIVE_USER, 'PRIVATE_MSG', {target_user: targetUser, content: txt});
        alert("Messaggio inviato!");
    }
}

// --- EXPLORE ---
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

    if(header) {
        if(EXPLORE_FILTER) {
            header.style.display = "block";
            header.innerText = `Results for: "${EXPLORE_FILTER}"`;
        } else {
            header.style.display = "none";
        }
    }

    if (!BLOCKCHAIN) return;

    // 1. Cerca Utenti
    if(EXPLORE_FILTER) {
        const filterLower = EXPLORE_FILTER.toLowerCase();
        const allUsers = Object.values(BLOCKCHAIN.UsersState);
        
        const foundUsers = allUsers.filter(u => u.Username.toLowerCase().includes(filterLower));
        
        foundUsers.forEach(user => {
            const div = document.createElement('div');
            div.className = 'notif-item';
            div.style.background = '#1a1a1a';
            div.style.borderRadius = '8px';

            const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
            const isFollowing = myProfile && myProfile.Following.includes(user.Username);
            let actionBtn = '';
            
            if(user.Username !== ACTIVE_USER) {
                // USA toggleFollow INVECE DI sendTx DIRETTO
                actionBtn = `<button class="btn-primary" style="padding:5px 15px; font-size:0.8em; margin-left:auto; margin-top:0;" onclick="toggleFollow('${user.Username}')">${isFollowing?'Unfollow':'Follow'}</button>`;
            } else {
                actionBtn = `<span style="color:var(--accent); font-size:0.8em; margin-left:auto;">It's you</span>`;
            }

            let avatarImg = `<div class="avatar" onclick="goToProfile('${user.Username}')" style="cursor:pointer">${user.Username[0]}</div>`;
            if(user.Avatar) avatarImg = `<img src="${API}/files/${user.Avatar}" class="avatar" onclick="goToProfile('${user.Username}')" style="cursor:pointer; object-fit:cover">`;

            div.innerHTML = `
                ${avatarImg}
                <div>
                    <b onclick="goToProfile('${user.Username}')" style="cursor:pointer">${user.Username}</b>
                    <div style="font-size:0.8em; color:gray">${user.Bio || ''}</div>
                </div>
                ${actionBtn}
            `;
            userContainer.appendChild(div);
        });
    }

    // 2. Cerca Post
    BLOCKCHAIN.Blocks.slice().reverse().forEach(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE') return;

        if(EXPLORE_FILTER) {
            const senderLower = tx.Sender.toLowerCase();
            const filterLower = EXPLORE_FILTER.toLowerCase();
            if(!senderLower.includes(filterLower)) return;
        }

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
    const viewUser = localStorage.getItem("view_profile") || ACTIVE_USER;
    const profile = BLOCKCHAIN.UsersState[viewUser];
    const isMe = (viewUser === ACTIVE_USER);

    if(!profile) return;

    document.getElementById('profile-username').innerText = viewUser;
    
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

    document.getElementById('p-followers').innerText = profile.Followers ? profile.Followers.length : 0;
    document.getElementById('p-following').innerText = profile.Following ? profile.Following.length : 0;

    const container = document.getElementById('profile-bio-container');
    let html = `<div style="color:var(--text-sec); font-style:italic">"${profile.Bio || ''}"</div>`;
    
    if(isMe) {
        html += `
            <input type="text" id="newBio" class="edit-bio-input" placeholder="Status...">
            <button onclick="updateBio()" class="btn-primary" style="padding:5px 10px; font-size:0.8em; margin-top:5px;">UPDATE BIO</button>
        `;
        const overlay = document.querySelector('.avatar-edit-overlay');
        if(overlay) overlay.style.display = 'flex';
    } else {
        const iFollow = BLOCKCHAIN.UsersState[ACTIVE_USER].Following.includes(viewUser);
        html += `
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button onclick="toggleFollow('${viewUser}')" class="btn-primary" style="flex:1;">${iFollow?'Unfollow':'Follow'}</button>
                <button onclick="sendMessage('${viewUser}')" class="btn-primary" style="flex:1; background:#333;">Message</button>
            </div>
        `;
        const overlay = document.querySelector('.avatar-edit-overlay');
        if(overlay) overlay.style.display = 'none';
    }
    
    container.innerHTML = html;

    const grid = document.getElementById('profile-grid');
    grid.innerHTML = "";
    let count = 0;
    
    BLOCKCHAIN.Blocks.slice().reverse().forEach(b => {
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
    const cancelled = getCancelledReposts(BLOCKCHAIN.Blocks);

    const blocks = BLOCKCHAIN.Blocks.slice().reverse().filter(block => {
        const tx = block.Transaction;
        if(tx.ActionType !== 'POST_IMAGE' && tx.ActionType !== 'REPOST') return false;
        if(tx.ActionType === 'REPOST' && cancelled.has(`${tx.Sender}:${tx.TargetHash}`)) return false;
        
        const targetHash = tx.ActionType === 'REPOST' ? tx.TargetHash : toHex(block.Hash);
        const imgState = BLOCKCHAIN.ImagesState[targetHash];
        if(imgState && imgState.Fakes > (imgState.Likes + 2)) return false; // Censura

        // LOGICA HOME: Mostra se è mio O se seguo l'utente
        if(tx.Sender === ACTIVE_USER || following.includes(tx.Sender)) return true;
        return false;
    });

    if(blocks.length === 0) container.innerHTML = "<div style='text-align:center; padding:50px'>Feed vuoto. Cerca utenti in Explore!</div>";
    blocks.forEach(b => container.appendChild(createPostCard(b)));
}

// --- ACTIVITY ---
function renderActivity() {
    const container = document.getElementById('activity-list');
    if(!container) return;
    container.innerHTML = "";

    const myProfile = BLOCKCHAIN.UsersState[ACTIVE_USER];
    
    // INBOX MESSAGGI
    const msgHeader = document.createElement('h3');
    msgHeader.innerText = "Inbox 📩";
    msgHeader.style.marginLeft = "10px";
    container.appendChild(msgHeader);

    if(myProfile.Inbox && myProfile.Inbox.length > 0) {
        myProfile.Inbox.slice().reverse().forEach(msg => {
            const div = document.createElement('div');
            div.className = 'notif-item';
            div.style.borderLeft = "3px solid var(--accent)";
            div.innerHTML = `
                <div class="avatar">${msg.From[0]}</div>
                <div>
                    <b>${msg.From}</b><br>
                    <span style="color:white">${msg.Content}</span>
                </div>
            `;
            container.appendChild(div);
        });
    } else {
        container.innerHTML += "<div style='padding:10px; color:gray'>No new messages.</div>";
    }

    // NOTIFICHE (Follows)
    const notifHeader = document.createElement('h3');
    notifHeader.innerText = "Alerts 🔔";
    notifHeader.style.marginLeft = "10px";
    container.appendChild(notifHeader);

    BLOCKCHAIN.Blocks.slice().reverse().forEach(b => {
        if(b.Transaction.ActionType === 'FOLLOW' && b.Transaction.TargetUser === ACTIVE_USER) {
            const div = document.createElement('div');
            div.className = 'notif-item';
            div.innerHTML = `<div class="avatar">${b.Transaction.Sender[0]}</div><div><b>${b.Transaction.Sender}</b> started following you.</div>`;
            container.appendChild(div);
        }
    });
}

// --- POST CARD ---
function createPostCard(block) {
    const tx = block.Transaction;
    const isRepost = tx.ActionType === 'REPOST';
    const hash = toHex(block.Hash);
    const targetHash = isRepost ? tx.TargetHash : hash;
    
    let original = isRepost ? BLOCKCHAIN.Blocks.find(b => toHex(b.Hash) === tx.TargetHash) : block;
    if(!original) return document.createElement('div');

    const senderProfile = BLOCKCHAIN.UsersState[original.Transaction.Sender];
    let avatarHTML = `<div class="avatar" onclick="goToProfile('${original.Transaction.Sender}')" style="cursor:pointer">${original.Transaction.Sender[0]}</div>`;
    if(senderProfile && senderProfile.Avatar) {
        avatarHTML = `<img src="${API}/files/${senderProfile.Avatar}" class="avatar" onclick="goToProfile('${original.Transaction.Sender}')" style="cursor:pointer; object-fit:cover;">`;
    }

    const imgState = BLOCKCHAIN.ImagesState[targetHash];
    
    // Commenti
    let commentsHTML = "";
    if(imgState.Comments && imgState.Comments.length > 0) {
        imgState.Comments.forEach(c => {
            commentsHTML += `<div style="font-size:0.85em; margin-top:4px;"><b style="cursor:pointer" onclick="goToProfile('${c.User}')">${c.User}</b>: ${c.Content}</div>`;
        });
    }

    const div = document.createElement('div');
    div.className = 'post-card';

    let headerHTML = isRepost ? `<div class="repost-label" style="padding:0 15px">🔁 ${tx.Sender} ha ripubblicato</div>` : '';
    let followBtn = ""; // In home card usually no follow btn, handled in explore

    div.innerHTML = `
        ${headerHTML}
        <div class="post-header" style="padding: 10px 15px;">
            ${avatarHTML}
            <div class="username" onclick="goToProfile('${original.Transaction.Sender}')">${original.Transaction.Sender}</div>
        </div>
        <img class="post-img" src="${API}/files/${original.Transaction.ContentText}">
        <div style="padding: 0 15px;">
            <div class="post-actions">
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', 'VOTE', {target_hash: '${targetHash}', vote_type: 'BELIEVE'}); window.location.reload();" style="color:${imgState.Likes>0?'var(--green)':'inherit'}">thumb_up</span>
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', 'VOTE', {target_hash: '${targetHash}', vote_type: 'FAKE'}); window.location.reload();" style="color:${imgState.Fakes>0?'var(--accent)':'inherit'}">thumb_down</span>
                <span class="material-icons-round action-icon" onclick="sendComment('${targetHash}')">chat_bubble_outline</span>
                <span class="material-icons-round action-icon" onclick="sendTx('${ACTIVE_USER}', '${isRepost ? 'UNREPOST' : 'REPOST'}', {target_hash: '${targetHash}'}); window.location.reload();" style="color:${isRepost?'var(--repost)':'inherit'}">repeat</span>
            </div>
            <div class="likes-count">${imgState.Likes} real | ${imgState.Fakes} fakes</div>
            <div class="metrics">
                Entropy: ${original.EntropyScore.toFixed(2)} | StdDev: ${original.StdDevScore.toFixed(2)}
            </div>
            <div style="margin-top:10px; border-top:1px solid #222; padding-top:5px;">${commentsHTML}</div>
        </div>
    `;
    return div;
}