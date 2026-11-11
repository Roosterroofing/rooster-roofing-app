window.onerror = function(msg, url, line) {
  if(msg && msg.includes('Script error')) return; 
  console.error("System Error: " + msg); 
  return false; 
};

// =========================================================================
// GOOGLE DRIVE APP SCRIPT WEBHOOK URL
const GOOGLE_DRIVE_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycby7ajx5aaKMywfy_cLuFhOPm513SbXS-makCV9Wr4IPUStYD0KpfpGv12vLYAaqKJZw/exec"; 

const firebaseConfig = {
 apiKey: "AIzaSyC9oTSsB908sDnlwSQwqU1A5SSArSNkn88",
 authDomain: "estimates-eb3d1.firebaseapp.com",
 databaseURL: "https://estimates-eb3d1-default-rtdb.firebaseio.com",
 projectId: "estimates-eb3d1",
 storageBucket: "estimates-eb3d1.firebasestorage.app",
 messagingSenderId: "945130425651",
 appId: "1:945130425651:web:baa18040f2e501863c4246"
};

let db, auth, storage; 
let appReady = false;
let allEstimatesCache = [];
let allCustomersCache = [];
let activeSalesReps = [];
let activePayroll = [];
let salesChartInst, materialChartInst, commissionChartInst;
let statusChartInst, repPerfChartInst;

let pendingDeepLinkID = null; 
if(window.location.hash) {
    const hash = window.location.hash.substring(1).replace(/^\//, '');
    if (hash && hash.startsWith('RR')) pendingDeepLinkID = hash;
}

window.addEventListener('hashchange', () => {
    const hash = window.location.hash.substring(1).replace(/^\//, '');
    if (hash && hash.startsWith('RR')) {
        loadJob(hash).catch(err => console.error("Hashchange load failed:", err));
    }
});

let autoSaveTimeout = null;
let isRestoring = false;

let manageEstId = null;
let manageCrewIdx = null;
let multiPayrollCols = []; 
let interactiveSelectMode = null; 
let interactiveCommSelectMode = null;
let paidClosedPage = 1;
const PAID_CLOSED_PAGE_SIZE = 10;
let allPaidClosedItems = [];
let paidClosedCommPage = 1;
const PAID_CLOSED_COMM_PAGE_SIZE = 10;
let allPaidClosedCommItems = [];
let wizardResults = [];
let wizardCommResults = [];

let commManageEstId = null;
let commManageRepIdx = null;
let tempCommEntry = null;

let undoStack = [];
window.isUndoing = false;
let lastStateStr = "";

window.saveStateForUndo = function() {
    if (window.isUndoing || isRestoring) return;
    const currentState = harvestData();
    const stateStr = JSON.stringify(currentState);
    if (stateStr !== lastStateStr) {
        undoStack.push(JSON.parse(stateStr));
        if (undoStack.length > 50) undoStack.shift(); 
        lastStateStr = stateStr;
    }
};

window.undoAction = function() {
    if (undoStack.length <= 1) {
        if(typeof bootstrap !== 'undefined') customAlert("Nothing to undo.");
        return;
    }
    undoStack.pop(); 
    const prevState = undoStack[undoStack.length - 1];
    window.isUndoing = true;
    restoreJob(prevState);
    lastStateStr = JSON.stringify(prevState);
};

const defaultMaterialGroups = {
 "Tile": [
   {"name":"Tile Concrete (Std)","price":500},
   {"name":"Tile Concrete (Prem)","price":530},
   {"name":"Tile Clay (Std)","price":550},
   {"name":"Tile Clay (Prem)","price":590}
 ],
 "Shingle": [
   {"name":"OC Oak (ALL) (Std)","price":210},
   {"name":"GAF Mix w Carlisle","price":190},
   {"name":"OC TruDef (ALL)","price":200},
   {"name":"GAF (ALL)","price":198},
   {"name":"GAF (MIX w Resisto/OC)","price":194}
 ],
 "Metal": [
   {"name":"SS Mill 24G","price":360},
   {"name":"5V Mill","price":300},
   {"name":"5V Metal Color","price":500},
   {"name":"SS Metal 26Ga Mill","price":350},
   {"name":"SS Metal 26Ga Textured","price":370},
   {"name":"SS 24G Mill w Clips","price":400},
   {"name":"SS 24G Kynar","price":480},
   {"name":"SS Zam","price":505},
   {"name":"SS Zam w Clips","price":555},
   {"name":"SS 24G Kynar w Clips","price":474}
 ],
 "Stone Coated Steel": [
   {"name":"Westlake Unified Steel","price":550}
 ],
 "Preformed Steel": [
   {"name":"Worthouse","price":500},
   {"name":"Permatile","price":600}
 ],
 "Membrane": [
   {"name":"TPO w 1inch ISO","price":320},
   {"name":"TPO","price":275},
   {"name":"TPO w 2inch ISO","price":370}
 ],
 "BitMod": [
   {"name":"RR (Std)","price":200},
   {"name":"RR","price":210},
   {"name":"RR w 1 inch ISO","price":280},
   {"name":"RR w 2 inch ISO","price":320}
 ]
};

const defaultLaborMain = [
 {"name":"Shingle to Shingle","price":105,"groupPrice":80},
 {"name":"Tile to Tile","price":275,"groupPrice":230},
 {"name":"Shingle to SS metal","price":270,"groupPrice":260},
 {"name":"Shingle to 5V","price":270,"groupPrice":230},
 {"name":"Shingle to Tile","price":275,"groupPrice":230},
 {"name":"Metal to Metal","price":285,"groupPrice":220},
 {"name":"Tile to Metal","price":310,"groupPrice":250},
 {"name":"Rolled Roofing","price":105,"groupPrice":80},
 {"name":"Rolled Roofing to TPO","price":225,"groupPrice":200},
 {"name":"TPO to TPO","price":325,"groupPrice":250},
 {"name":"Tear shingle and Dry in","price":40,"groupPrice":30},
 {"name":"New Const: Standing Seam","price":200,"groupPrice":160},
 {"name":"New Const: 5V Metal","price":180,"groupPrice":145},
 {"name":"New Const: Shingle","price":75,"groupPrice":60}
];

const defaultExtrasList = [
    { name: "Plywood (Per Sheet)", price: 75.00, qty: 3 },
    { name: "Fascia Board (Per LF)", price: 3.50, qty: 20 },
    { name: "Drop Off Fee", price: 90.00, qty: 1 },
    { name: "Lull / Machinery", price: 2500.00, qty: 0 }
];

const defaultCrewOptions = ["Vicente", "Tavo", "Matt", "Juan", "Henry"];
const defaultRepOptions = ["Josh", "Aaron", "David"];
const defaultLeadSourceOptions = [
    { name: "Certified Lead", fee: 75 }, 
    { name: "Snappy", fee: 275 }, 
    { name: "Front Porch", fee: 125 }
];

const defaultEstimateStatuses = [
    "Draft (Not Ready)",
    "Estimate Created (Internal Review Required)",
    "Estimate In-Review",
    "Estimate Review Completed/Adjusted (OK to Create Proposal)",
    "Proposal Created (Internal Review Required)",
    "Proposal In-Review",
    "Proposal Review Completed/Adjusted (OK to Send)",
    "Sent (Customer Review & Signature)",
    "Signed (Pending Deposit)",
    "Accepted (Deposit Received)",
    "Job Started (In-Production)",
    "Complete (Phase 1)",
    "Complete (Phase 2)",
    "Complete (Phase 3)",
    "Complete / Closed",
    "Rejected",
    "Unqualified / Lost Lead"
];

let materialGroups = JSON.parse(JSON.stringify(defaultMaterialGroups));
let laborMain = JSON.parse(JSON.stringify(defaultLaborMain));
let extrasList = JSON.parse(JSON.stringify(defaultExtrasList));
let crewOptions = JSON.parse(JSON.stringify(defaultCrewOptions));
let repOptions = JSON.parse(JSON.stringify(defaultRepOptions));
let leadSourceOptions = JSON.parse(JSON.stringify(defaultLeadSourceOptions));
let estimateStatuses = JSON.parse(JSON.stringify(defaultEstimateStatuses));

function ensureLeadSourceObjects() {
    if (leadSourceOptions && leadSourceOptions.length > 0 && typeof leadSourceOptions[0] === 'string') {
        leadSourceOptions = leadSourceOptions.map(ls => {
            let name = ls; let fee = 0;
            const match = ls.match(/(.+?)\s*\(\$([0-9.]+)\)/);
            if (match) { name = match[1].trim(); fee = parseFloat(match[2]); }
            return { name, fee };
        });
    }
}

function adjustBackdropZIndex(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.addEventListener('show.bs.modal', () => {
        setTimeout(() => {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            if (backdrops.length > 0) backdrops[backdrops.length - 1].style.zIndex = '105500';
        }, 50);
    }, { once: true });
}

window.customAlert = function(message) {
    if(typeof bootstrap === 'undefined') { window.alert(message); return Promise.resolve(); }
    return new Promise(resolve => {
        const modalEl = document.getElementById('customAlertModal');
        document.getElementById('customAlertMessage').innerHTML = message;
        adjustBackdropZIndex('customAlertModal');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {backdrop: 'static', keyboard: false});
        
        let btnOk = document.getElementById('customAlertBtnOk');
        const newBtnOk = btnOk.cloneNode(true);
        btnOk.parentNode.replaceChild(newBtnOk, btnOk);
        btnOk = newBtnOk;

        let resolved = false;
        const hideHandler = () => { if(!resolved) { resolved = true; modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(); } };

        btnOk.addEventListener('click', () => { modal.hide(); hideHandler(); });
        modalEl.addEventListener('hidden.bs.modal', hideHandler);
        modal.show();
    });
};

window.customConfirm = function(message) {
    if(typeof bootstrap === 'undefined') return Promise.resolve(window.confirm(message));
    return new Promise(resolve => {
        const modalEl = document.getElementById('customConfirmModal');
        document.getElementById('customConfirmMessage').innerHTML = message;
        adjustBackdropZIndex('customConfirmModal');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {backdrop: 'static', keyboard: false});
        
        let btnYes = document.getElementById('customConfirmBtnYes'); const newBtnYes = btnYes.cloneNode(true); btnYes.parentNode.replaceChild(newBtnYes, btnYes); btnYes = newBtnYes;
        let btnNo = document.getElementById('customConfirmBtnNo'); const newBtnNo = btnNo.cloneNode(true); btnNo.parentNode.replaceChild(newBtnNo, btnNo); btnNo = newBtnNo;
        
        let resolved = false;
        const hideHandler = () => { if(!resolved){ resolved=true; modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(false); } };

        btnYes.addEventListener('click', () => { if(!resolved){ resolved = true; modal.hide(); modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(true); } });
        btnNo.addEventListener('click', () => { if(!resolved){ resolved = true; modal.hide(); modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(false); } });
        modalEl.addEventListener('hidden.bs.modal', hideHandler);
        modal.show();
    });
};

window.customPrompt = function(message, defaultValue = "") {
    if(typeof bootstrap === 'undefined') return Promise.resolve(window.prompt(message, defaultValue));
    return new Promise(resolve => {
        const modalEl = document.getElementById('customPromptModal');
        document.getElementById('customPromptMessage').innerHTML = message;
        const input = document.getElementById('customPromptInput'); input.value = defaultValue;
        adjustBackdropZIndex('customPromptModal');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {backdrop: 'static', keyboard: false});

        let btnOk = document.getElementById('customPromptBtnOk'); const newBtnOk = btnOk.cloneNode(true); btnOk.parentNode.replaceChild(newBtnOk, btnOk); btnOk = newBtnOk;
        let btnCancel = document.getElementById('customPromptBtnCancel'); const newBtnCancel = btnCancel.cloneNode(true); btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel); btnCancel = newBtnCancel;

        let resolved = false;
        const hideHandler = () => { if(!resolved){ resolved = true; modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(null); } };

        btnOk.addEventListener('click', () => { if(!resolved){ resolved = true; modal.hide(); modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(input.value); } });
        btnCancel.addEventListener('click', () => { if(!resolved){ resolved = true; modal.hide(); modalEl.removeEventListener('hidden.bs.modal', hideHandler); resolve(null); } });
        input.onkeydown = (e) => { if (e.key === 'Enter') btnOk.click(); };

        modalEl.addEventListener('hidden.bs.modal', hideHandler);
        modal.show(); setTimeout(() => input.focus(), 500);
    });
};

function getStatusClass(status) {
    let s = status || 'Draft (Not Ready)';
    if (s === 'Accepted') s = 'Accepted (Deposit Received)';
    if (s === 'Completed') s = 'Complete / Closed';

    if(s === 'Draft (Not Ready)') return 'bg-light text-dark border';
    if(s === 'Estimate Created (Internal Review Required)' || s === 'Proposal Created (Internal Review Required)') return 'bg-warning text-dark';
    if(s === 'Estimate In-Review' || s === 'Proposal In-Review') return 'bg-secondary text-white';
    if(s === 'Estimate Review Completed/Adjusted (OK to Create Proposal)' || s === 'Proposal Review Completed/Adjusted (OK to Send)') return 'bg-primary text-white';
    if(s === 'Sent (Customer Review & Signature)' || s === 'Signed (Pending Deposit)') return 'bg-info text-dark';
    if(s === 'Accepted (Deposit Received)' || s === 'Job Started (In-Production)') return 'bg-success text-white';
    if(s === 'Rejected' || s === 'Unqualified / Lost Lead') return 'bg-danger text-white';
    if(s === 'Complete (Phase 1)' || s === 'Complete (Phase 2)' || s === 'Complete (Phase 3)' || s === 'Complete / Closed') return 'bg-dark text-white';
    
    return 'bg-light text-dark border';
}

function getSafeTsMs(ts) {
    if (!ts) return 0;
    if (ts.seconds) return ts.seconds * 1000;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') return new Date(ts).getTime();
    if (ts.toMillis) return ts.toMillis();
    return 0;
}

function getSafeTsDateStr(ts) {
    const ms = getSafeTsMs(ts);
    if (!ms) return 'N/A';
    return new Date(ms).toLocaleDateString();
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getBaseUrl() { 
    let url = window.location.href.split('#')[0];
    if(url.endsWith('/')) url = url.slice(0, -1);
    return url; 
}
function escapeHtml(text) { if (!text) return ""; return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result); reader.onerror = error => reject(error);
    });
}

async function uploadFileToDrive(file) {
    if (!GOOGLE_DRIVE_WEBHOOK_URL || GOOGLE_DRIVE_WEBHOOK_URL === "") throw new Error("Google Drive Webhook URL is missing.");
    if (file.size > 10 * 1024 * 1024) throw new Error(`File ${file.name} is too large (Limit: 10MB).`);
    
    const base64 = await fileToBase64(file);
    const payload = { 
        filename: file.name, 
        mimeType: file.type || 'application/octet-stream', 
        base64: base64, 
        folderId: '1dZ7l6IUijEZndJeMO3mlau4U-U_5lBUZ' 
    };

    const response = await fetch(GOOGLE_DRIVE_WEBHOOK_URL, { 
        method: 'POST', 
        body: JSON.stringify(payload), 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' } 
    });
    
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result; 
}

function getRawDriveImageUrl(url, size = 'w800') {
    if (!url) return "";
    if (url.includes('drive.google.com/file/d/')) {
        const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=${size}`;
    }
    return url;
}

window.handleFilePreviewClick = function(el) { openFilePreview(el.getAttribute('data-url'), el.getAttribute('data-name'), el.getAttribute('data-type')); };

window.onload = function() {
   try {
       if (typeof firebase !== 'undefined') {
           if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
           db = firebase.firestore(); auth = firebase.auth();
           try { if(firebase.storage) storage = firebase.storage(); } catch(e) { console.error("Storage Init Error:", e); }
           db.enablePersistence().catch((err) => {});
           
           auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
             .then(() => { auth.onAuthStateChanged(user => { appReady = true; if (user) completeLogin(user); else document.getElementById('login-overlay').style.display = 'flex'; }); })
             .catch((err) => { auth.onAuthStateChanged(user => { appReady = true; if (user) completeLogin(user); else document.getElementById('login-overlay').style.display = 'flex'; }); });
       } else { customAlert("Error: Database library failed to load."); }
   } catch(e) { console.error("Firebase Init Error: " + e.message); }

   try { initCalculator(); injectLinkButton(); setupChatFeatures(); } catch(e) { console.error("UI Init Error: " + e.message); }
   
   if(window.ESTIMATE_BACKUP) {
       console.log("Loading from Backup...", window.ESTIMATE_BACKUP);
       appReady = true; document.getElementById('login-overlay').style.display = 'none';
       document.getElementById('nav-user-name').innerText = "Offline User"; document.getElementById('profile-name').innerText = "Offline User";
       
       const data = window.ESTIMATE_BACKUP;
       if(data.settings) {
            try {
                const s = data.settings;
                if(s.materialGroups) materialGroups = s.materialGroups;
                if(s.laborMain) laborMain = s.laborMain;
                if(s.extrasList) extrasList = s.extrasList; 
                if(s.crewOptions) crewOptions = s.crewOptions;
                if(s.repOptions) repOptions = s.repOptions;
                if(s.estimateStatuses) estimateStatuses = s.estimateStatuses;
                if(s.leadSourceOptions) { leadSourceOptions = s.leadSourceOptions; ensureLeadSourceObjects(); }
                populateDropdowns(); renderExtrasCalculator();
            } catch(e) { console.error("Error restoring settings", e); }
       }
       if(data.customer) { allCustomersCache = [data.customer]; const list = document.getElementById('customerList'); if(list) list.innerHTML = `<option value="${data.customer.name}">`; }
       forceSwitchView('calculator');

       if(data.estimate) {
           restoreJob(data.estimate); document.title = data.estimate.desiredMaterial ? data.estimate.desiredMaterial : `Estimate ${data.estimate.estimateId}`;
           const backupBtn = document.getElementById('btnSaveAndBackup'); if(backupBtn) backupBtn.classList.add('d-none');
       }
       return; 
   }
};

window.toggleCOType = function() {
    const type = document.getElementById('co_type').value;
    const crewContainer = document.getElementById('co_crew_container');
    if (type === 'material') crewContainer.classList.add('d-none'); else crewContainer.classList.remove('d-none');
};

function sendSystemNotification(message, actionType = null, actionId = null) {
    if (!db) return;
    db.collection('notifications').add({ text: message, actionType: actionType, actionId: actionId, timestamp: firebase.firestore.FieldValue.serverTimestamp() }).catch(e => console.error("System notification failed:", e));
}

async function sendAutomatedChatMessage(text) {
    if (!db) return;
    const user = auth.currentUser;
    const senderName = user ? (user.displayName || user.email.split('@')[0]) : "SystemBot";
    const uid = user ? user.uid : "system";
    try { await db.collection('messages').add({ text: text, sender: senderName, uid: uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() }); } catch(e) { console.error("Auto chat failed", e); }
}

function triggerAutomatedEmailNotification(estId, custName) {
    console.log(`[SYSTEM EMAIL ALERT] Job Complete Triggered for Estimate: ${estId} | Customer: ${custName}`);
    // Placeholder logic for triggering backend email or Zapier webhook
    sendSystemNotification(`✅ Automation Triggered: Job Complete checklist marked for ${estId} (${custName}). Notifications sent.`, 'estimate', estId);
}

function triggerAutomatedProposalChat(estId, status) {
    let baseUrl = getBaseUrl();
    const directUrl = `${baseUrl}#/${estId}`;
    if (status === 'Proposal Created (Internal Review Required)') sendAutomatedChatMessage(`@Patrice The proposal for ${estId} has been created and is ready for internal review. Please review and mark the estimate as "Proposal Ready (Customer Review)" when the proposal is good to be sent out to customer. Link: ${directUrl}`);
    else if (status === 'Proposal Review Completed/Adjusted (OK to Send)') sendAutomatedChatMessage(`@Reina The proposal for ${estId} has been reviewed and is good to be sent out to the customer. Link: ${directUrl}`);
    else if (status === 'Complete / Closed') sendAutomatedChatMessage(`@Patrice The estimate ${estId} has been marked as Complete / Closed. Please review final details. Link: ${directUrl}`);
}

let lastNotifViewTime = parseInt(localStorage.getItem('rooster_lastNotifViewTime')) || 0;
let initialNotifLoad = true;

function listenToNotifications() {
    if (!db) return;
    db.collection('notifications').orderBy('timestamp', 'desc').limit(30).onSnapshot(snap => {
        const list = document.getElementById('notification-list'); const badge = document.getElementById('nav-notif-badge');
        if(snap.empty) { list.innerHTML = '<li><a class="dropdown-item text-center text-muted small py-3" href="javascript:void(0)">No notifications yet.</a></li>'; return; }
        
        list.innerHTML = ''; let unread = 0; let hasNew = false;
        snap.forEach(doc => {
            const n = doc.data(); const t = getSafeTsMs(n.timestamp) || Date.now();
            const dateStr = new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'});
            let isUnread = t > lastNotifViewTime; if(isUnread) unread++;

            let clickHandler = ''; let cursorStyle = 'default'; let hoverClass = '';
            if (n.actionType === 'estimate' && n.actionId) { clickHandler = `onclick="handleNotificationClick('estimate', '${n.actionId}')"`; cursorStyle = 'pointer'; hoverClass = 'notification-link-hover'; } 
            else if (n.actionType === 'customer' && n.actionId) { clickHandler = `onclick="handleNotificationClick('customer', '${n.actionId}')"`; cursorStyle = 'pointer'; hoverClass = 'notification-link-hover'; }

            list.innerHTML += `<li><a class="dropdown-item py-2 border-bottom ${isUnread ? 'bg-highlight-blue' : ''} ${hoverClass}" style="white-space: normal; cursor: ${cursorStyle};" ${clickHandler} href="javascript:void(0)"><div class="small text-dark" style="line-height: 1.3;">${n.text}</div><div class="text-muted mt-1" style="font-size: 10px;">${dateStr}</div></a></li>`;
        });

        snap.docChanges().forEach(change => { if (change.type === 'added') hasNew = true; });

        if (unread > 0) {
            badge.classList.remove('d-none');
            if (!initialNotifLoad && hasNew) { const sound = document.getElementById('chat-notification-sound'); if (sound) sound.play().catch(e => {}); }
        } else badge.classList.add('d-none');
        initialNotifLoad = false;
    });
}

window.handleNotificationClick = function(type, id) {
    markNotificationsRead();
    const dropdownEl = document.getElementById('notificationBell');
    if (typeof bootstrap !== 'undefined' && dropdownEl) { const bsDropdown = bootstrap.Dropdown.getInstance(dropdownEl); if (bsDropdown) bsDropdown.hide(); }
    if (type === 'estimate') loadJob(id);
    else if (type === 'customer') { forceSwitchView('customers-db'); setTimeout(() => openCustomerDetails(id), 300); }
};

window.markNotificationsRead = function() {
    lastNotifViewTime = Date.now(); localStorage.setItem('rooster_lastNotifViewTime', lastNotifViewTime.toString());
    document.getElementById('nav-notif-badge').classList.add('d-none');
    document.querySelectorAll('#notification-list .bg-highlight-blue').forEach(el => el.classList.remove('bg-highlight-blue'));
}

window.closeModalAndLoadJob = function(estId, modalId) {
    const el = document.getElementById(modalId); if(el) { const m = bootstrap.Modal.getOrCreateInstance(el); if(m) m.hide(); }
    loadJob(estId);
};

function injectLinkButton() {
    const estIdContainer = document.getElementById('estimateId');
    if(estIdContainer && estIdContainer.parentNode && !document.getElementById('btnCopyLink')) {
        const btn = document.createElement('button'); btn.type = "button"; btn.id = "btnCopyLink"; btn.className = "btn btn-outline-secondary btn-sm mt-2 w-100";
        btn.style.fontSize = "10px"; btn.innerHTML = '<i class="mdi mdi-link"></i> Copy Link'; btn.onclick = copyCurrentEstimateLink;
        estIdContainer.parentNode.appendChild(btn);
    }
}

async function copyCurrentEstimateLink() {
    const id = document.getElementById('estimateId').value;
    if(!id) return await customAlert("No Estimate ID generated yet.");
    let baseUrl = getBaseUrl();
    
    navigator.clipboard.writeText(`${baseUrl}#/${id}`).then(() => {
        const btn = document.getElementById('btnCopyLink'); const orig = btn.innerHTML;
        btn.innerHTML = '<i class="mdi mdi-check"></i> Copied!'; btn.classList.replace('btn-outline-secondary', 'btn-success');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.replace('btn-success', 'btn-outline-secondary'); }, 2000);
    });
}

async function handleLogin() {
   if (typeof firebase !== 'undefined' && !appReady) appReady = true; 
   if(!appReady) return await customAlert("System still loading...");
   const e = document.getElementById('login-email').value; const p = document.getElementById('login-pass').value; const btn = document.getElementById('btn-signin');
   if(!e || !p) return await customAlert("Enter email and password.");
   btn.innerText = "Signing In..."; btn.disabled = true;
   
   auth.signInWithEmailAndPassword(e, p).then((cred) => completeLogin(cred.user))
     .catch(async err => { await customAlert("Login Failed: " + err.message); btn.innerText = "Sign In"; btn.disabled = false; });
}

async function handleRegister() {
   if (typeof firebase !== 'undefined' && !appReady) appReady = true; 
   if(!appReady) return await customAlert("System still loading...");
   const n = document.getElementById('reg-name').value; const e = document.getElementById('reg-email').value; const p = document.getElementById('reg-pass').value; const btn = document.getElementById('btn-signup');
   if(!e || !p || !n) return await customAlert("All fields required.");
   if(!e.toLowerCase().endsWith('@roosterroofingnow.com')) return await customAlert("Restricted domain.");
   btn.innerText = "Creating..."; btn.disabled = true;
   
   auth.createUserWithEmailAndPassword(e, p).then(async (cred) => {
          cred.user.updateProfile({displayName: n}); await customAlert("Account Created!"); completeLogin(cred.user); 
     }).catch(async err => { await customAlert("Error: " + err.message); btn.innerText = "Create Account"; btn.disabled = false; });
}

async function completeLogin(user) {
   document.getElementById('login-overlay').style.display = 'none';
   const name = user.displayName || user.email;
   document.getElementById('nav-user-name').innerText = name; updateUserProfile(user);

   const adminEmails = ['patrice@roosterroofingnow.com', 'admin@roosterroofingnow.com', 'jake@roosterroofingnow.com'];
   const isAdmin = adminEmails.includes(user.email ? user.email.toLowerCase() : '');
   const restrictedNavIds = ['nav-commissions', 'nav-payroll-ledger', 'nav-calculator', 'nav-customers'];
   const adminSection = document.querySelector('.sidebar-footer');
   const dashboardNewEstBtn = document.getElementById('dash-new-est-btn');

   if (!isAdmin) {
       restrictedNavIds.forEach(id => { const el = document.getElementById(id); if (el && el.parentElement) el.parentElement.style.display = 'none'; });
       if (adminSection) adminSection.style.display = 'none';
       if (dashboardNewEstBtn) dashboardNewEstBtn.style.display = 'none';
   } else {
       restrictedNavIds.forEach(id => { const el = document.getElementById(id); if (el && el.parentElement) el.parentElement.style.display = ''; });
       if (adminSection) adminSection.style.display = '';
       if (dashboardNewEstBtn) dashboardNewEstBtn.style.display = '';
   }
   
   initCalculator(); 
   
   try {
       await fetchGlobalSettings(); listenToNotifications(); await listenToCustomers(); await listenToEstimates();
       
       window.openChangeOrderModal = function() {
           const crewP = document.getElementById('co_crew_picker');
           crewP.innerHTML = "<option value=''>Select Crew...</option>"; crewP.add(new Option("-- Add New Crew --", "ADD_NEW_CREW"));
           crewOptions.forEach(c => crewP.add(new Option(c, c))); crewP.add(new Option("Other", "Other"));
           
           crewP.onchange = async function() {
               if (this.value === 'ADD_NEW_CREW') {
                   const name = await customPrompt("Enter New Crew Name:");
                   if(name) {
                       crewOptions.push(name); saveSettings(true); populateDropdowns();
                       const cP = document.getElementById('co_crew_picker'); cP.innerHTML = "<option value=''>Select Crew...</option>"; cP.add(new Option("-- Add New Crew --", "ADD_NEW_CREW"));
                       crewOptions.forEach(c => cP.add(new Option(c, c))); cP.add(new Option("Other", "Other")); cP.value = name;
                   } else this.value = "";
               }
           };

           document.getElementById('co_type').value = "labor"; window.toggleCOType();
           document.getElementById('co_amt').value = ""; document.getElementById('co_notes').value = ""; document.getElementById('co_bill_cust').checked = false;
           const sectionVal = document.getElementById('payroll_section').value; document.getElementById('co_section').value = sectionVal ? sectionVal : "1";
           bootstrap.Modal.getOrCreateInstance(document.getElementById('changeOrderModal')).show();
       };

       window.addChangeOrder = async function() {
           const type = document.getElementById('co_type').value; const section = document.getElementById('co_section').value;
           const crew = document.getElementById('co_crew_picker').value; const amt = parseMoney(document.getElementById('co_amt').value);
           const notes = document.getElementById('co_notes').value; const billToCust = document.getElementById('co_bill_cust').checked;

           if(type === 'labor' && !crew) return await customAlert("Please select a Crew.");
           if(!notes) return await customAlert("Please enter Notes / Description.");

           activePayroll.push({
               section: section, crew: type === 'material' ? 'Material' : crew, laborType: (type === 'material' ? "Mat CO: " : "Lab CO: ") + notes,
               calcType: 'flat', rate: amt, billToCust: billToCust, paymentStatus: type === 'material' ? 'N/A' : 'Unpaid',
               paymentDate: '', costs: [], deductions: [], payments: [], generalNotes: '', isChangeOrder: true, coType: type
           });
           calculate(); saveStateForUndo();
           bootstrap.Modal.getOrCreateInstance(document.getElementById('changeOrderModal')).show();
       };

       window.updatePayrollLabor = function(idx, val) { if(activePayroll[idx]) activePayroll[idx].laborType = val; };

   } catch(err) { console.warn("Non-fatal loading error:", err); }

   if(pendingDeepLinkID) {
       const linkId = pendingDeepLinkID;
       pendingDeepLinkID = null; 
       loadJob(linkId).then(async () => {
           await customAlert(`Loaded Estimate from Link: ${linkId}`); history.replaceState(null, null, ' ');
           if (!isAdmin) {
               const form = document.getElementById('calculatorForm');
               if(form) {
                    form.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = true);
                    document.querySelectorAll('button[onclick*="printSummary"]').forEach(b => b.disabled = false);
               }
           }
       }).catch(async err => { console.error(err); await customAlert("Could not load linked estimate."); forceSwitchView('dashboard'); });
   } else {
       const currentView = document.querySelector('.nav-link.active').id;
       if (!isAdmin && (restrictedNavIds.includes(currentView) || currentView === 'nav-settings')) {
           forceSwitchView('dashboard');
       } else {
           const viewId = currentView.replace('nav-', '');
           forceSwitchView(viewId === 'payroll-ledger' ? 'payroll' : viewId);
       }
   }
   loadChatView(); 
}

function forceSwitchView(viewId) {
   document.querySelectorAll('.modal.show').forEach(el => { const mInst = bootstrap.Modal.getOrCreateInstance(el); if (mInst) mInst.hide(); });
   
   document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
   document.body.classList.remove('modal-open');
   document.body.style.overflow = '';
   document.body.style.paddingRight = '';

   ['view-dashboard','view-calculator','view-customers','view-settings','view-profile','view-customers-db','view-commissions', 'view-payroll'].forEach(id => {
       const el = document.getElementById(id); if(el) { el.classList.add('d-none'); el.classList.remove('d-flex'); }
   });
   
   const activeView = document.getElementById('view-' + viewId); if(activeView) activeView.classList.remove('d-none');
   
   document.getElementById('sidebar').classList.remove('open');
   document.querySelectorAll('.sidebar .nav-link').forEach(link => link.classList.remove('active'));
   
   let navId = 'nav-' + viewId; if(viewId === 'payroll') navId = 'nav-payroll-ledger';
   const activeLink = document.getElementById(navId); if(activeLink) activeLink.classList.add('active');

   if(db || window.ESTIMATE_BACKUP) {
       if(viewId==='customers') loadFromCloud();
       if(viewId==='settings') loadSettingsToUI();
       if(viewId==='dashboard') renderDashboard();
       if(viewId==='customers-db') loadCustomerDB();
       if(viewId==='commissions') loadCommissionsView();
       if(viewId==='payroll') loadPayrollView();
       if(viewId==='profile') loadProfileStats();
   }
}

function toggleAuth(mode) {
   if(mode==='register') { document.getElementById('login-box').classList.add('d-none'); document.getElementById('register-box').classList.remove('d-none'); } 
   else { document.getElementById('register-box').classList.add('d-none'); document.getElementById('login-box').classList.remove('d-none'); }
}

function updateUserProfile(user) {
   const name = user.displayName || user.email.split('@')[0];
   const defaultAvatar = `https://ui-avatars.com/api/?name=${name}&background=aa0000&color=fff`;
   document.getElementById('nav-user-name').innerText = name; document.getElementById('profile-name').innerText = name;
   document.getElementById('profile-email').innerText = user.email; document.getElementById('profile-input-name').value = name;
   document.getElementById('nav-user-img').src = defaultAvatar; document.getElementById('profile-img-lg').src = defaultAvatar;
   
   db.collection('users').doc(user.uid).get().then(doc => {
       if(doc.exists) {
           const d = doc.data();
           document.getElementById('profile-input-phone').value = d.phone || "";
           document.getElementById('profile-input-role').value = d.role || "Sales Representative";
           document.getElementById('profile-input-region').value = d.region || "";
           if (d.avatarUrl) { document.getElementById('nav-user-img').src = d.avatarUrl; document.getElementById('profile-img-lg').src = d.avatarUrl; }
       }
   }).catch(e => {});
}

function handleAvatarUpload(input) {
    const file = input.files[0]; if (!file) return;
    const objUrl = URL.createObjectURL(file); document.getElementById('nav-user-img').src = objUrl; document.getElementById('profile-img-lg').src = objUrl;
    const user = auth.currentUser;
    if (user && db && storage) {
        const uniqueName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        storage.ref(`avatars/${user.uid}/${uniqueName}`).put(file)
        .then(snapshot => snapshot.ref.getDownloadURL())
        .then(url => db.collection('users').doc(user.uid).set({ avatarUrl: url, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }))
        .catch(async err => await customAlert("Error uploading avatar: " + err.message));
    }
}

function loadProfileStats() {
   const name = document.getElementById('nav-user-name').innerText;
   let totalSales = 0, totalComm = 0;
   allEstimatesCache.forEach(est => {
      if(est.activeSalesReps && (est.status === 'Accepted (Deposit Received)' || est.status === 'Accepted' || est.status === 'Complete / Closed' || est.status === 'Completed')) {
          const myRep = est.activeSalesReps.find(r => r.name === name || r.name === auth.currentUser.displayName);
          if(myRep) { totalSales += (est.totalRevenue || 0); totalComm += (est.totalProfit * (myRep.percent / 100)) || 0; }
      }
   });
   document.getElementById('profile-stat-sales').innerText = fmt(totalSales); document.getElementById('profile-stat-comm').innerText = fmt(totalComm);
}

function saveProfile() {
 const user = auth.currentUser; const newName = document.getElementById('profile-input-name').value;
 if(user && newName) {
     user.updateProfile({ displayName: newName })
     .then(() => db.collection('users').doc(user.uid).set({ phone: document.getElementById('profile-input-phone').value, role: document.getElementById('profile-input-role').value, region: document.getElementById('profile-input-region').value, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }))
     .then(async () => { await customAlert("Profile updated successfully!"); updateUserProfile(user); })
     .catch(async e => await customAlert("Error updating profile: " + e.message));
 }
}

function sendPasswordReset() {
   const email = auth.currentUser.email;
   auth.sendPasswordResetEmail(email).then(async () => await customAlert("Password reset email sent to: " + email)).catch(async e => await customAlert("Error: " + e.message));
}

function initCalculator() {
  const saved = localStorage.getItem('rooster_custom_settings');
  if(saved && !window.ESTIMATE_BACKUP) { 
      try {
          const p = JSON.parse(saved);
          if(p.materialGroups) materialGroups = p.materialGroups;
          if(p.laborMain) laborMain = p.laborMain;
          if(p.extrasList) extrasList = p.extrasList.filter(i => i.name !== "Dumpster");
          if(p.crewOptions) crewOptions = p.crewOptions;
          if(p.repOptions) repOptions = p.repOptions;
          if(p.estimateStatuses) estimateStatuses = p.estimateStatuses;
          if(p.leadSourceOptions) { leadSourceOptions = p.leadSourceOptions; ensureLeadSourceObjects(); }
      } catch(e) {}
  }
  ensureLeadSourceObjects(); populateDropdowns(); renderExtrasCalculator(); setupCurrencyInputs();
  const billCustEl = document.getElementById('payroll_bill_cust'); if(billCustEl) billCustEl.checked = false;
  const dateInput = document.getElementById('datePicker'); if(dateInput) dateInput.valueAsDate = new Date();
  
  setTimeout(() => { const estIdInput = document.getElementById('estimateId'); if(estIdInput && !estIdInput.value && db && !pendingDeepLinkID) generateSharedEstimateID(); }, 1000);
  
  const form = document.getElementById('calculatorForm');
  if(form) { form.removeEventListener('input', calculate); form.addEventListener('input', calculate); form.removeEventListener('change', saveStateForUndo); form.addEventListener('change', saveStateForUndo); }
}

function fetchGlobalSettings() {
    if(!db) return Promise.resolve();
    return db.collection('settings').doc('global_settings').get().then(doc => {
        if (doc.exists) {
            const data = doc.data();
            if(data.materialGroups) materialGroups = data.materialGroups;
            if(data.laborMain) laborMain = data.laborMain;
            if(data.extrasList) extrasList = data.extrasList.filter(i => i.name !== "Dumpster");
            if(data.crewOptions) crewOptions = data.crewOptions;
            if(data.repOptions) repOptions = data.repOptions;
            if(data.estimateStatuses) estimateStatuses = data.estimateStatuses;
            if(data.leadSourceOptions) { leadSourceOptions = data.leadSourceOptions; ensureLeadSourceObjects(); }
            populateDropdowns(); renderExtrasCalculator(); calculate(); 
        } else saveSettings(true);
    }).catch(error => console.error("Error getting settings:", error));
}

function populateDropdowns() {
  const estStat = document.getElementById('estimateStatus');
  if (estStat) {
      const currentVal = estStat.value; estStat.innerHTML = "";
      estimateStatuses.forEach(s => estStat.add(new Option(s, s))); estStat.add(new Option("-- Add New Estimate Status --", "ADD_NEW_STATUS"));
      if (currentVal && estimateStatuses.includes(currentVal)) estStat.value = currentVal;
      else if (currentVal === "ADD_NEW_STATUS") estStat.value = estimateStatuses[0];
      else if (currentVal && !estimateStatuses.includes(currentVal)) { estStat.add(new Option(currentVal, currentVal)); estStat.value = currentVal; }
      else estStat.value = estimateStatuses[0];
      updateStatusDropdownColor(estStat);
  }

  const typeSel = document.getElementById('matType1'); const typeSel2 = document.getElementById('matType2');
  if (typeSel) {
      typeSel.innerHTML = "<option value=''>-- Clear Selection --</option>"; typeSel.add(new Option("-- Add New Roofing Material --", "ADD_NEW_MAT_CAT"));
      Object.keys(materialGroups).forEach(k => typeSel.add(new Option(k, k)));
      typeSel.onchange = async function() {
          if(this.value === 'ADD_NEW_MAT_CAT') {
              const newCat = await customPrompt("Enter new Roofing Material Category Name:");
              if(newCat) { if(!materialGroups[newCat]) materialGroups[newCat] = []; saveSettings(true); populateDropdowns(); this.value = newCat; } else this.value = "";
          }
          updateMaterials(1);
      };
  }
  if (typeSel2) {
      typeSel2.innerHTML = "<option value=''>-- Clear Selection --</option>"; typeSel2.add(new Option("-- Add New Roofing Material --", "ADD_NEW_MAT_CAT"));
      Object.keys(materialGroups).forEach(k => typeSel2.add(new Option(k, k)));
      typeSel2.onchange = async function() {
          if(this.value === 'ADD_NEW_MAT_CAT') {
              const newCat = await customPrompt("Enter new Roofing Material Category Name:");
              if(newCat) { if(!materialGroups[newCat]) materialGroups[newCat] = []; saveSettings(true); populateDropdowns(); this.value = newCat; } else this.value = "";
          }
          updateMaterials(2);
      };
  }
  
  const l1 = document.getElementById('labSelect1'); const l2 = document.getElementById('labSelect2');
  if (l1) {
      l1.innerHTML = "<option value=''>-- Clear Selection --</option>"; l1.add(new Option("-- Add New Labor Type --", "ADD_NEW_LABOR"));
      laborMain.forEach((l,i) => l1.add(new Option(l.name, i)));
      l1.onchange = async function() {
          if(this.value === 'ADD_NEW_LABOR') {
              const newName = await customPrompt("Enter new Labor Type Name:");
              if(newName) {
                  let newPrice = await customPrompt("Enter price per SQ ($):", "0"); let newGrp = await customPrompt("Enter group price per SQ ($):", "0");
                  laborMain.push({name: newName, price: parseFloat(newPrice)||0, groupPrice: parseFloat(newGrp)||0}); saveSettings(true); populateDropdowns(); this.value = laborMain.length - 1;
              } else this.value = "";
          }
          updatePrices(1, 'lab'); calculate();
      };
  }
  if (l2) {
      l2.innerHTML = "<option value=''>-- Clear Selection --</option>"; l2.add(new Option("-- Add New Labor Type --", "ADD_NEW_LABOR"));
      laborMain.forEach((l,i) => l2.add(new Option(l.name, i)));
      l2.onchange = async function() {
          if(this.value === 'ADD_NEW_LABOR') {
              const newName = await customPrompt("Enter new Labor Type Name:");
              if(newName) {
                  let newPrice = await customPrompt("Enter price per SQ ($):", "0"); let newGrp = await customPrompt("Enter group price per SQ ($):", "0");
                  laborMain.push({name: newName, price: parseFloat(newPrice)||0, groupPrice: parseFloat(newGrp)||0}); saveSettings(true); populateDropdowns(); this.value = laborMain.length - 1;
              } else this.value = "";
          }
          updatePrices(2, 'lab'); calculate();
      };
  }

  const crewP = document.getElementById('payroll_crew_picker');
  if (crewP) {
      crewP.innerHTML = "<option value=''>Select Crew...</option>"; crewP.add(new Option("-- Add New Crew --", "ADD_NEW_CREW"));
      crewOptions.forEach(c => crewP.add(new Option(c, c))); crewP.add(new Option("Other", "Other"));
      crewP.onchange = async function() {
          if (this.value === 'ADD_NEW_CREW') {
              const name = await customPrompt("Enter New Crew Name:");
              if(name) { crewOptions.push(name); saveSettings(true); populateDropdowns(); this.value = name; } else this.value = "";
          }
      };
  }

  const labP = document.getElementById('payroll_lab_picker');
  if (labP) { labP.innerHTML = "<option value=''>Select Labor Type...</option>"; laborMain.forEach((l, i) => labP.add(new Option(l.name, i))); }

  const repP = document.getElementById('rep_picker');
  if(repP) {
      repP.innerHTML = "<option value=''>Select Rep...</option>"; repP.add(new Option("-- Add New Sales Rep --", "ADD_NEW_REP"));
      repOptions.forEach(c => repP.add(new Option(c,c))); repP.add(new Option("Other", "Other"));
      repP.onchange = async function() {
          if (this.value === 'ADD_NEW_REP') {
              const name = await customPrompt("Enter New Sales Rep Name:");
              if(name) { repOptions.push(name); saveSettings(true); populateDropdowns(); this.value = name; } else this.value = "";
          }
      };
  }
  
  const leadDD = document.getElementById('leadSourceDropdown');
  if (leadDD) {
      leadDD.innerHTML = `<option value="">Select Source...</option>`; leadDD.add(new Option("-- Add New Lead Source --", "ADD_NEW_LEAD"));
      repOptions.forEach(r => leadDD.add(new Option(r, r)));
      leadSourceOptions.forEach(ls => leadDD.add(new Option(ls.fee > 0 ? `${ls.name} ($${ls.fee})` : ls.name, ls.fee > 0 ? `${ls.name} ($${ls.fee})` : ls.name)));
      leadDD.add(new Option("Other", "Other"));
      
      leadDD.onchange = async function() {
          if (this.value === 'ADD_NEW_LEAD') {
              const name = await customPrompt("Enter New Lead Source Name:");
              if (name) {
                  let fee = parseFloat(await customPrompt("Enter Lead Fee ($):", "0")) || 0;
                  leadSourceOptions.push({name, fee}); saveSettings(true); populateDropdowns();
                  const text = fee > 0 ? `${name} ($${fee})` : name;
                  document.getElementById('leadSourceDropdown').value = text;
                  document.getElementById('leadFee').value = fmt(fee); calculate();
              } else this.value = "";
              return;
          }
          toggleLeadSourceInput(this);
          const val = this.value; const feeInput = document.getElementById('leadFee');
          const match = val.match(/\(\$([0-9.]+)\)/);
          if (match && match[1]) feeInput.value = fmt(parseFloat(match[1]));
          else if (val !== 'Other') feeInput.value = "$0.00";
          calculate();
      };
  }
}

function renderExtrasCalculator() {
    const tbody = document.getElementById('calcExtrasTableBody');
    if(!tbody) return;
    tbody.innerHTML = "";
    extrasList.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="form-control form-control-sm border-0 bg-transparent fw-bold" id="extra_name_${index}" value="${item.name}"></td>
            <td><input type="number" id="extra_qty_${index}" class="form-control form-control-sm bg-yellow text-center" value="${item.qty || 0}"></td>
            <td><input type="text" id="extra_cost_${index}" class="form-control form-control-sm bg-adjustable currency-input text-end" value="${fmt(item.price)}"></td>
            <td id="extra_total_${index}" class="text-end fw-bold align-middle">$0.00</td>`;
        tbody.appendChild(tr);
    });
    setupCurrencyInputs();
}

function togglePayrollType() {
    const type = document.getElementById('payroll_calc_type').value;
    const labPicker = document.getElementById('payroll_lab_picker');
    const flatDesc = document.getElementById('payroll_flat_desc');
    const rateLabel = document.getElementById('payroll_rate_label');
    
    if (type === 'flat') { labPicker.classList.add('d-none'); flatDesc.classList.remove('d-none'); rateLabel.innerText = "Amount ($)"; } 
    else { labPicker.classList.remove('d-none'); flatDesc.classList.add('d-none'); rateLabel.innerText = "Rate ($/Sq)"; }
}

function syncPayrollRate() {
  const idx = document.getElementById('payroll_lab_picker').value;
  if(idx !== "") document.getElementById('payroll_group_rate').value = fmt(laborMain[idx].groupPrice || 0);
}

async function addPayrollEntry() {
   const section = document.getElementById('payroll_section').value;
   const calcType = document.getElementById('payroll_calc_type').value;
   const crew = document.getElementById('payroll_crew_picker').value;
   const billToCust = document.getElementById('payroll_bill_cust').checked;
   let labName, rate, desc;

   if(!crew) return await customAlert("Please select a Crew.");
   
   if (calcType === 'sq') {
       const labIdx = document.getElementById('payroll_lab_picker').value;
       if (!labIdx) return await customAlert("Select Labor Type");
       labName = laborMain[labIdx].name; rate = parseMoney(document.getElementById('payroll_group_rate').value);
   } else {
       desc = document.getElementById('payroll_flat_desc').value;
       if (!desc) return await customAlert("Enter Description");
       labName = desc; rate = parseMoney(document.getElementById('payroll_group_rate').value);
   }

   activePayroll.push({
      section: section, crew: crew, laborType: labName, calcType: calcType, rate: rate, billToCust: billToCust,
      paymentStatus: 'Unpaid', paymentDate: '', costs: [], deductions: [], payments: [], generalNotes: '', isChangeOrder: false
   });

   document.getElementById('payroll_crew_picker').value = ""; document.getElementById('payroll_lab_picker').value = "";
   document.getElementById('payroll_flat_desc').value = ""; document.getElementById('payroll_group_rate').value = "";
   document.getElementById('payroll_bill_cust').checked = false;
   calculate(); saveStateForUndo();
}

function removePayrollEntry(index) { activePayroll.splice(index, 1); calculate(); saveStateForUndo(); }

function renderPayrollTable() {
   const tbody = document.getElementById('payrollTableBody');
   const ctbody = document.getElementById('changeOrderTableBody');
   const totalDisp = document.getElementById('payroll_total_display');
   if(!tbody || !ctbody) return;
   
   tbody.innerHTML = ""; ctbody.innerHTML = "";
   let totalLiability = 0, pCount = 0, cCount = 0;

   if(activePayroll.length === 0) {
       tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No crew members added yet.</td></tr>';
       ctbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No change orders added.</td></tr>';
       totalDisp.innerText = fmt(0); return;
   }

   activePayroll.forEach((entry, index) => {
       let subtotal = 0, qtyDisplay = '';
       if (entry.calcType === 'flat') { subtotal = entry.rate; qtyDisplay = '<span class="badge bg-secondary">Flat</span>'; } 
       else { const sq = parseFloat(document.getElementById('squares' + entry.section).value) || 0; subtotal = sq * entry.rate; qtyDisplay = sq.toFixed(2); }
       
       const extraCosts = (entry.costs || []).reduce((sum, item) => sum + (parseFloat(item.amount)||0), 0);
       subtotal += extraCosts;
       if (entry.coType !== 'material') totalLiability += subtotal;
       
       const billTag = entry.billToCust ? '<span class="badge bg-primary text-white ms-1" title="Billed to Customer"><i class="mdi mdi-account-cash"></i></span>' : '';
       const tr = document.createElement('tr');
       tr.innerHTML = `
          <td>${entry.section == 1 ? 'Main' : 'Sec'}</td><td class="fw-bold">${entry.crew}</td>
          <td><div class="d-flex align-items-center gap-1"><input type="text" class="form-control form-control-sm border-0 bg-transparent p-0 m-0 shadow-none text-dark" style="min-width:120px; font-size:inherit; border-bottom: 1px dashed #ccc !important; border-radius: 0;" value="${escapeHtml(entry.laborType)}" onchange="updatePayrollLabor(${index}, this.value)" title="Click to edit">${billTag}</div></td>
          <td class="text-end">${qtyDisplay}</td><td class="text-end">${fmt(entry.rate)}</td><td class="text-end fw-bold text-danger">${fmt(subtotal)}</td>
          <td class="text-center"><button type="button" class="btn btn-xs text-danger" onclick="removePayrollEntry(${index})">×</button></td>`;
       
       const isCO = entry.isChangeOrder || (entry.laborType && entry.laborType.startsWith("Lab CO: ")) || (entry.laborType && entry.laborType.startsWith("Mat CO: ")) || (entry.laborType && entry.laborType.startsWith("CO: "));
       if (isCO) { ctbody.appendChild(tr); cCount++; } else { tbody.appendChild(tr); pCount++; }
   });

   if(pCount === 0) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No crew members added yet.</td></tr>';
   if(cCount === 0) ctbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No change orders added.</td></tr>';
   totalDisp.innerText = fmt(totalLiability); return totalLiability;
}

function toggleLeadSourceInput(select) {
   const manualInput = document.getElementById('leadSourceManual');
   if(select.value === 'Other') manualInput.classList.remove('d-none'); else { manualInput.classList.add('d-none'); manualInput.value = ""; }
}

function updateMaterials(sec) {
  const type = document.getElementById('matType'+sec).value;
  const sel = document.getElementById('matSelect'+sec);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Clear Selection --</option>';
  
  if(type && materialGroups[type]) {
      sel.add(new Option("-- Add New Material Type --", "ADD_NEW_MAT_TYPE"));
      materialGroups[type].forEach(m => sel.add(new Option(m.name, JSON.stringify(m))));
  } else document.getElementById('matPrice'+sec).value = fmt(0);
  
  sel.onchange = async function() {
      if(this.value === 'ADD_NEW_MAT_TYPE') {
          const cat = document.getElementById('matType'+sec).value;
          if(!cat || !materialGroups[cat]) { await customAlert("Invalid category."); this.value = ""; return; }
          const newName = await customPrompt("Enter new Material Type / Mfr Name:");
          if(newName) {
              let newPrice = parseFloat(await customPrompt(`Enter price per SQ for ${newName} ($):`, "0")) || 0;
              const newItem = { name: newName, price: newPrice }; materialGroups[cat].push(newItem); saveSettings(true);
              updateMaterials(sec); sel.value = JSON.stringify(newItem);
              document.getElementById('matPrice'+sec).value = fmt(newPrice); calculate();
          } else this.value = "";
      } else if(this.value) {
          const d = JSON.parse(this.value); document.getElementById('matPrice'+sec).value = fmt(d.price);
      } else document.getElementById('matPrice'+sec).value = fmt(0);
      calculate();
  }
  calculate();
}

function updatePrices(sec, type) {
   if (type === 'lab') {
       const idx = document.getElementById('labSelect'+sec).value;
       if(idx !== "" && idx !== "ADD_NEW_LABOR") document.getElementById('labPrice'+sec).value = fmt(laborMain[idx].price);
       else document.getElementById('labPrice'+sec).value = fmt(0);
   }
}

async function addActiveRep() {
   const name = document.getElementById('rep_picker').value;
   const pct = parseFloat(document.getElementById('rep_commission_input').value);
   if(!name || name === '') return await customAlert("Please select a Sales Rep.");
   if(isNaN(pct)) return await customAlert("Please enter a Commission percentage.");
   
   activeSalesReps.push({ name: name, percent: pct, paymentStatus: 'Unpaid', payments: [], deductions: [], bonuses: [], notes: '' });
   document.getElementById('rep_picker').value = ""; document.getElementById('rep_commission_input').value = "";
   calculate(); saveStateForUndo();
}

function removeActiveRep(index) { activeSalesReps.splice(index, 1); calculate(); saveStateForUndo(); }

function renderSplitCommissions(totalProfit) {
   const container = document.getElementById('split_commission_display');
   if(!activeSalesReps || activeSalesReps.length === 0) { container.innerHTML = '<em class="text-muted small">No reps added yet.</em>'; return 0; }
   let html = '<table class="rep-table">'; let totalComm = 0;
   activeSalesReps.forEach((rep, index) => {
       const commAmt = totalProfit * (rep.percent / 100); totalComm += commAmt;
       html += `<tr><td>${rep.name}</td><td width="60">${rep.percent}%</td><td class="rep-amt">${fmt(commAmt)}</td><td width="30"><button type="button" class="btn btn-xs text-danger" onclick="removeActiveRep(${index})">×</button></td></tr>`;
   });
   html += '</table>'; container.innerHTML = html; return totalComm;
}

function calculate() {
   const taxRate = (parseFloat(document.getElementById('taxRate').value)||0) / 100;
   const profitPctMain = (parseFloat(document.getElementById('profitMarginMain').value)||0) / 100;
   const profitPctSec = (parseFloat(document.getElementById('profitMarginSec').value)||0) / 100;

   let totalExtrasSum = 0;
   extrasList.forEach((item, index) => {
       const qtyEl = document.getElementById(`extra_qty_${index}`);
       const costEl = document.getElementById(`extra_cost_${index}`);
       const totalEl = document.getElementById(`extra_total_${index}`);
       if(qtyEl && costEl && totalEl) {
           const qty = parseFloat(qtyEl.value) || 0; const cost = parseMoney(costEl.value);
           const total = qty * cost; totalEl.innerText = fmt(total); totalExtrasSum += total;
       }
   });

   const mainAddonPre = parseMoney(document.getElementById('m_addon_pre').value);
   const secAddonPre = parseMoney(document.getElementById('s_addon_pre').value);
   const dumpQty = parseFloat(document.getElementById('dumpQty').value) || 0;
   const dumpBase = parseMoney(document.getElementById('dumpBaseCost').value);
   const dumpTotal = dumpQty * dumpBase;
   
   let extraLaborMain = 0, extraLaborSec = 0, extraMaterialMain = 0, extraMaterialSec = 0, billableCOTotal = 0;
   
   activePayroll.forEach(p => {
       if (p.billToCust) {
           let cost = 0;
           if (p.calcType === 'flat') cost = p.rate;
           else { const sq = parseFloat(document.getElementById('squares' + p.section).value) || 0; cost = sq * p.rate; }
           
           if (p.coType === 'material') { if (p.section == 1) extraMaterialMain += cost; else extraMaterialSec += cost; } 
           else { if (p.section == 1) extraLaborMain += cost; else extraLaborSec += cost; }
           if (p.isChangeOrder) billableCOTotal += cost;
       }
   });

   const mainExtrasTotal = totalExtrasSum + mainAddonPre + extraMaterialMain;
   const secExtrasTotal = secAddonPre + extraMaterialSec;
   const totalExtrasBase = totalExtrasSum + mainAddonPre + secAddonPre + extraMaterialMain + extraMaterialSec;
   document.getElementById('extrasSumDisplay').innerText = fmt(totalExtrasBase);

   const main = calcSection(1, mainExtrasTotal, dumpTotal, taxRate, profitPctMain, 0, extraLaborMain);
   const sec = calcSection(2, secExtrasTotal, 0, taxRate, profitPctSec, 0, extraLaborSec);
   
   const discountVal = parseFloat(document.getElementById('discount').value) || 0;
   const discountTarget = document.getElementById('discountTarget').value;
   let mainTotal = main.total; let secTotal = sec.total;
   if(discountTarget === 'main') mainTotal -= discountVal;
   if(discountTarget === 'sec') secTotal -= discountVal;
   
   const grandTotal = (discountTarget === 'grand') ? (mainTotal + secTotal - discountVal) : (mainTotal + secTotal);
   const totalMarginDollars = main.plusProfit + sec.plusProfit; 
   
   const licRate = (parseFloat(document.getElementById('licFeeRate').value)||0) / 100;
   const licFeeAmt = grandTotal * licRate;
   setText('c_lic_fee_amt', licFeeAmt);

   const leadFee = parseMoney(document.getElementById('leadFee').value);
   const commissionableAmount = Math.max(0, totalMarginDollars - leadFee - licFeeAmt);
   const totalSalesComm = renderSplitCommissions(commissionableAmount);
   const actualProfit = totalMarginDollars - leadFee - totalSalesComm - licFeeAmt;
   
   renderPayrollTable();

   setText('c_main', mainTotal); setText('c_sec', secTotal); setText('c_grand', grandTotal);
   setText('c_total_profit', totalMarginDollars); setText('c_comm', totalSalesComm); setText('c_lead_fee', leadFee); 
   document.getElementById('lead-fee-label').innerText = "Lead Fee";
   setText('c_actual_profit', actualProfit); setText('c_deposit', grandTotal / 2);
   const totalSq = main.sq + sec.sq;
   setText('c_costPerSq', totalSq > 0 ? (grandTotal / totalSq) : 0);

   setText('sticky_grand_total', grandTotal);
   setText('sticky_total_profit', totalMarginDollars);
   setText('sticky_actual_profit', actualProfit);
   setText('sticky_cost_per_sq', totalSq > 0 ? (grandTotal / totalSq) : 0);

   const estStatus = document.getElementById('estimateStatus').value;
   const coRow = document.getElementById('c_billable_co_row');
   if (coRow) {
       if (['Complete (Phase 1)', 'Complete (Phase 2)', 'Complete (Phase 3)', 'Complete / Closed'].includes(estStatus) && billableCOTotal > 0) { 
           coRow.classList.remove('d-none'); 
           setText('c_billable_co', billableCOTotal); 
       } 
       else coRow.classList.add('d-none');
   }
}

function calcSection(prefix, extras, dumpster, taxRate, profitPct, addonPreInput, extraLaborBillable) {
   const p = (prefix===1) ? 'm_' : 's_';
   const sqIn = parseFloat(document.getElementById('squares'+prefix).value)||0;
   const waste = parseFloat(document.getElementById('waste'+prefix).value)||0;
   const totalSq = sqIn * (1 + waste);
   const tsInput = document.getElementById('totalSquares'+prefix);
   if (tsInput) tsInput.value = totalSq.toFixed(2);

   if(totalSq <= 0 && prefix === 2) { setText(p+'grand', "$0.00"); return { total: 0, plusProfit: 0, sq: 0 }; }
   const matP = parseMoney(document.getElementById('matPrice'+prefix).value);
   const labP = parseMoney(document.getElementById('labPrice'+prefix).value);
   const addonPost = parseFloat(document.getElementById(p+'addon_post').value)||0;
   
   const costSq = totalSq * matP;
   const matPre = costSq + extras;
   const tax = matPre * taxRate;
   
   const baseLaborTotal = sqIn * labP;
   const totalLabor = baseLaborTotal + extraLaborBillable;
   const matLabTax = matPre + totalLabor + tax + dumpster;
   
   let permits = 0;
   const waived = document.getElementById((prefix === 1) ? 'waivePermits' : 'waivePermitsSec').checked;
   if(!waived && matLabTax > 0) permits = (matLabTax * 0.025) + 75;

   const subtotal = matLabTax + permits + addonPreInput;
   const plusProfit = subtotal * profitPct;
   const sectionTotal = subtotal + plusProfit + addonPost;
   
   setText(p+'sq', totalSq.toFixed(2)); setText(p+'costSq', costSq); setText(p+'extras', extras);
   if(prefix===1) setText(p+'dump', dumpster);
   
   setText(p+'matPre', matPre); setText(p+'tax', tax); setText(p+'lab', totalLabor); setText(p+'matLabTax', matLabTax);
   setText(p+'permits', permits); setText(p+'subtotal', subtotal); setText(p+'profit_val', plusProfit);
   setText(p+'grand', sectionTotal); setText(p+'costPerSq', totalSq > 0 ? (sectionTotal/totalSq) : 0);
   return { total: sectionTotal, plusProfit: plusProfit, sq: totalSq };
}

window.confirmCommissionEntry = async function(estId, repIdx) {
    const est = allEstimatesCache.find(e => e.estimateId === estId);
    if(!est) return;
    est.activeSalesReps[repIdx].isConfirmed = true;
    if(db) {
        try { await db.collection('estimates').doc(est.id).update({ activeSalesReps: est.activeSalesReps }); await customAlert("Commission entry confirmed."); } 
        catch(e) { await customAlert("Error confirming entry: " + e.message); }
    }
    loadCommissionsView();
};

window.removeCommissionEntryFromLedger = async function(estId, repIdx) {
    if(!await customConfirm("Are you sure you want to remove this commission entry completely?")) return;
    const est = allEstimatesCache.find(e => e.estimateId === estId);
    if(!est) return;
    est.activeSalesReps[repIdx].isRemoved = true;
    if(db) {
        try { await db.collection('estimates').doc(est.id).update({ activeSalesReps: est.activeSalesReps }); } 
        catch(e) { await customAlert("Error removing entry: " + e.message); }
    }
    loadCommissionsView();
};

function loadCommissionsView() {
    const tableBody = document.getElementById('commissionTableBody');
    const stagingBody = document.getElementById('newCommissionBody');
    tableBody.innerHTML = '';
    if (stagingBody) stagingBody.innerHTML = '';
    
    let totalAll = 0, totalPaid = 0, totalPending = 0;
    
    const sortMode = document.getElementById('master-comm-sort') ? document.getElementById('master-comm-sort').value : 'date_desc';
    const startDateStr = document.getElementById('master-comm-start-date') ? document.getElementById('master-comm-start-date').value : '';
    const endDateStr = document.getElementById('master-comm-end-date') ? document.getElementById('master-comm-end-date').value : '';
    let startTimestamp = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;
    let endTimestamp = endDateStr ? new Date(endDateStr + 'T23:59:59').getTime() : Infinity;

    const allRepsForDropdown = new Set();
    let flatEntries = [];
    let stagingEntries = [];

    allEstimatesCache.forEach(est => {
        const isAcceptedOrClosed = (est.status === 'Accepted (Deposit Received)' || est.status === 'Complete / Closed');
        if (isAcceptedOrClosed && est.activeSalesReps && est.activeSalesReps.length > 0) {
            const estTime = getSafeTsMs(est.timestamp);
            const totalProfit = est.totalProfit || 0;
            
            est.activeSalesReps.forEach((rep, idx) => {
                if (rep.isRemoved) return;

                if(!rep.payments) rep.payments = []; if(!rep.deductions) rep.deductions = []; if(!rep.bonuses) rep.bonuses = [];
                const baseComm = totalProfit * (rep.percent / 100);
                const bonuses = rep.bonuses.reduce((sum, b) => sum + (parseFloat(b.amount)||0), 0);
                const deductions = rep.deductions.reduce((sum, d) => sum + (parseFloat(d.amount)||0), 0);
                const paid = rep.payments.reduce((sum, p) => sum + (parseFloat(p.amount)||0), 0);
                
                const netCommissionDue = (baseComm + bonuses) - deductions;
                const balance = netCommissionDue - paid;
                
                let status = 'Unpaid', statusClass = 'bg-warning text-dark';
                if(balance <= 0.01) { status = 'Paid in Full (PIF)'; statusClass = 'bg-success text-white'; } 
                else if(paid > 0) { status = 'Partial Payment (PP)'; statusClass = 'bg-info text-dark'; }
                
                const itemData = { 
                    estId: est.estimateId, custAddress: est.custAddress, repName: rep.name, totalRev: est.totalRevenue || 0, 
                    percent: rep.percent, netCommissionDue, paid, balance, status, statusClass, idx, 
                    dateStr: getSafeTsDateStr(est.timestamp), timestampVal: estTime 
                };

                if (rep.isConfirmed) {
                    allRepsForDropdown.add(rep.name);
                    totalAll += netCommissionDue; totalPaid += paid; totalPending += balance;
                    if (startDateStr || endDateStr) { if (estTime < startTimestamp || estTime > endTimestamp) return; }
                    flatEntries.push(itemData);
                } else {
                    stagingEntries.push(itemData);
                }
            });
        }
    });

    if(stagingBody) {
        if(stagingEntries.length === 0) stagingBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No new commission entries pending confirmation.</td></tr>';
        else {
            stagingEntries.sort((a,b) => b.timestampVal - a.timestampVal);
            stagingEntries.forEach(item => {
                stagingBody.innerHTML += `
                    <tr>
                        <td class="ps-4 text-muted small">${item.dateStr}</td>
                        <td class="text-truncate" style="max-width: 150px;">${item.custAddress || 'No Address'}</td>
                        <td class="fw-bold text-primary">${item.repName}</td>
                        <td><a href="#" onclick="loadJob('${item.estId}')">${item.estId}</a></td>
                        <td class="text-end fw-bold">${fmt(item.netCommissionDue)}</td>
                        <td class="text-center">
                            <button class="btn btn-sm btn-success py-0 me-1" onclick="confirmCommissionEntry('${item.estId}', ${item.idx})" title="Confirm"><i class="mdi mdi-check"></i></button>
                            <button class="btn btn-sm btn-outline-dark py-0 me-1" onclick="openManageCommissionModal('${item.estId}', ${item.idx})" title="Adjust"><i class="mdi mdi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger py-0" onclick="removeCommissionEntryFromLedger('${item.estId}', ${item.idx})" title="Remove"><i class="mdi mdi-trash-can"></i></button>
                        </td>
                    </tr>`;
            });
        }
    }

    allPaidClosedCommItems = flatEntries.filter(i => i.status === 'Paid in Full (PIF)');
    allPaidClosedCommItems.sort((a,b) => b.timestampVal - a.timestampVal);
    renderPaidClosedCommItems();

    const generateCommLedgerRow = (item) => {
        return `
            <tr>
               <td class="ps-4 text-muted small">${item.dateStr}</td>
               <td class="text-truncate" style="max-width: 150px;"><small>${item.custAddress || 'No Address'}</small></td>
               <td class="fw-bold text-primary">${item.repName}</td>
               <td><a href="#" onclick="loadJob('${item.estId}')" class="fw-bold text-dark">${item.estId}</a></td>
               <td class="text-end">${fmt(item.totalRev)}</td>
               <td class="text-center">${item.percent}%</td>
               <td class="text-end fw-bold">${fmt(item.netCommissionDue)}</td>
               <td class="text-end text-success">${fmt(item.paid)}</td>
               <td class="text-end text-danger">${fmt(item.balance)}</td>
               <td class="text-center"><span class="badge ${item.statusClass}">${item.status}</span></td>
               <td class="text-center action-col">
                   <button class="btn btn-sm btn-outline-dark py-0 me-1" onclick="openManageCommissionModal('${item.estId}', ${item.idx})" title="Manage"><i class="mdi mdi-pencil"></i></button>
                   <button class="btn btn-sm btn-outline-danger py-0" onclick="removeCommissionEntryFromLedger('${item.estId}', ${item.idx})" title="Remove"><i class="mdi mdi-trash-can"></i></button>
               </td>
            </tr>`;
    };

    if (sortMode === 'group_rep') {
        const grouped = {};
        flatEntries.forEach(item => { if (!grouped[item.repName]) grouped[item.repName] = []; grouped[item.repName].push(item); });
        Object.keys(grouped).sort().forEach(repName => {
            tableBody.innerHTML += `<tr class="table-secondary"><td colspan="11" class="fw-bold text-dark"><i class="mdi mdi-account"></i> ${repName}</td></tr>`;
            grouped[repName].forEach(item => tableBody.innerHTML += generateCommLedgerRow(item));
        });
    } else if (sortMode === 'group_job') {
        const grouped = {};
        flatEntries.forEach(item => { if (!grouped[item.custAddress]) grouped[item.custAddress] = []; grouped[item.custAddress].push(item); });
        Object.keys(grouped).sort().forEach(addr => {
            tableBody.innerHTML += `<tr class="table-secondary"><td colspan="11" class="fw-bold text-dark"><i class="mdi mdi-map-marker"></i> Job: ${addr}</td></tr>`;
            grouped[addr].forEach(item => tableBody.innerHTML += generateCommLedgerRow(item));
        });
    } else {
        flatEntries.sort((a, b) => sortMode === 'date_desc' ? b.timestampVal - a.timestampVal : a.timestampVal - b.timestampVal);
        flatEntries.forEach(item => tableBody.innerHTML += generateCommLedgerRow(item));
    }

    if (flatEntries.length === 0) tableBody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">No records found.</td></tr>`;
    
    setText('comm-total-all', totalAll); setText('comm-total-paid', totalPaid); setText('comm-total-pending', totalPending);

    const irPicker = document.getElementById('interactive-rep-picker');
    if (irPicker) {
        const currentSelection = irPicker.value; irPicker.innerHTML = '<option value="">-- Choose a Rep --</option>';
        Array.from(allRepsForDropdown).sort().forEach(r => irPicker.add(new Option(r, r)));
        if (currentSelection && allRepsForDropdown.has(currentSelection)) irPicker.value = currentSelection;
        loadInteractiveRepDashboard(); 
    }
}

function renderPaidClosedCommItems() {
    const tbody = document.getElementById('paidClosedCommBody');
    const loadMoreDiv = document.getElementById('loadMorePaidCommContainer');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    if (allPaidClosedCommItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No paid & closed commissions found.</td></tr>';
        if(loadMoreDiv) loadMoreDiv.classList.add('d-none');
        return;
    }

    const itemsToShow = allPaidClosedCommItems.slice(0, paidClosedCommPage * PAID_CLOSED_COMM_PAGE_SIZE);
    itemsToShow.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td class="ps-4 text-muted small">${item.dateStr}</td>
                <td class="text-truncate" style="max-width: 150px;"><small>${item.custAddress || 'No Address'}</small></td>
                <td class="fw-bold text-primary">${item.repName}</td>
                <td><a href="#" onclick="loadJob('${item.estId}')" class="text-dark fw-bold">${item.estId}</a></td>
                <td class="text-end fw-bold text-success">${fmt(item.netCommissionDue)}</td>
                <td class="text-center"><span class="badge ${item.statusClass}">${item.status}</span></td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-dark py-0" onclick="openManageCommissionModal('${item.estId}', ${item.idx})" title="View/Adjust"><i class="mdi mdi-eye"></i></button>
                </td>
            </tr>`;
    });

    if (allPaidClosedCommItems.length > paidClosedCommPage * PAID_CLOSED_COMM_PAGE_SIZE) {
        if(loadMoreDiv) loadMoreDiv.classList.remove('d-none');
    } else {
        if(loadMoreDiv) loadMoreDiv.classList.add('d-none');
    }
}
window.loadMorePaidClosedComm = function() { paidClosedCommPage++; renderPaidClosedCommItems(); };

window.exportCommToCSV = function() {
    const tbody = document.getElementById('commissionTableBody');
    const rows = tbody.querySelectorAll('tr');
    let csvContent = "data:text/csv;charset=utf-8,Date,Job Address,Sales Rep,Est ID,Job Value,Rate,Total Comm,Paid,Balance,Status\n";
    rows.forEach(row => {
        if(row.classList.contains('table-secondary')) return;
        let rowData = [];
        row.querySelectorAll('td:not(.action-col)').forEach(td => {
            let text = td.innerText.replace(/"/g, '""').trim();
            rowData.push(`"${text}"`);
        });
        csvContent += rowData.join(",") + "\n";
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "master_commission_ledger.csv");
    document.body.appendChild(link); link.click(); link.remove();
}

function printMasterCommLedger() {
    const tbody = document.getElementById('ml-comm-print-tbody'); 
    tbody.innerHTML = document.getElementById('commissionTableBody').innerHTML;
    tbody.querySelectorAll('.action-col').forEach(el => el.remove());
    
    const sortModeSel = document.getElementById('master-comm-sort'); 
    const sortText = sortModeSel.options[sortModeSel.selectedIndex].text;
    const start = document.getElementById('master-comm-start-date').value; 
    const end = document.getElementById('master-comm-end-date').value;
    
    let rangeText = "All Time"; if(start && end) rangeText = `${start} to ${end}`; else if (start) rangeText = `From ${start}`; else if (end) rangeText = `Until ${end}`;

    document.getElementById('ml-comm-print-date-range').innerText = rangeText; 
    document.getElementById('ml-comm-print-sort').innerText = sortText;
    triggerPayrollPrint('master_comm_ledger');
}

window.openInteractiveRepModal = function() { bootstrap.Modal.getOrCreateInstance(document.getElementById('interactiveRepModal')).show(); }

window.toggleMultiManageCommMode = function(mode) {
    const cols = document.querySelectorAll('.multi-manage-comm-col'); 
    const btnPrint = document.getElementById('btnPrintSelectModeComm'); 
    const btnConfirm = document.getElementById('btnConfirmMultiManageComm');
    if (cols.length === 0) return;
    
    if (interactiveCommSelectMode === mode) {
        interactiveCommSelectMode = null; cols.forEach(c => c.classList.add('d-none'));
        btnPrint.innerHTML = "<i class='mdi mdi-printer'></i> Print Rep Statement"; btnPrint.classList.remove('d-none');
        if(btnConfirm) btnConfirm.classList.add('d-none'); document.querySelectorAll('.multi-manage-comm-chk').forEach(chk => chk.checked = false);
    } else {
        interactiveCommSelectMode = mode; cols.forEach(c => c.classList.remove('d-none')); if(btnConfirm) btnConfirm.classList.remove('d-none');
        if (mode === 'print') { btnPrint.innerText = "Cancel Print Selection"; }
    }
}

window.toggleAllMultiManageCommChecks = function() {
    const checks = document.querySelectorAll('.multi-manage-comm-chk'); if (checks.length === 0) return;
    const allChecked = Array.from(checks).every(c => c.checked); checks.forEach(c => c.checked = !allChecked);
};

window.executeInteractiveCommSelection = function() {
    if (interactiveCommSelectMode === 'print') window.executeInteractiveCommPrint(true);
}

window.loadInteractiveRepDashboard = function() {
    const repName = document.getElementById('interactive-rep-picker').value;
    const content = document.getElementById('interactive-rep-content'); 
    const actions = document.getElementById('interactive-rep-actions');
    const tbody = document.getElementById('interactive-rep-table');
    
    interactiveCommSelectMode = null;
    const btnPrint = document.getElementById('btnPrintSelectModeComm'); 
    const btnConfirm = document.getElementById('btnConfirmMultiManageComm');
    
    document.querySelectorAll('.multi-manage-comm-col').forEach(c => c.classList.add('d-none'));
    if (btnPrint) { btnPrint.innerHTML = "<i class='mdi mdi-printer'></i> Print Rep Statement"; btnPrint.classList.remove('d-none'); }
    if (btnConfirm) btnConfirm.classList.add('d-none');
    
    if (!repName) { content.classList.add('d-none'); actions.style.display = 'none'; return; }
    
    let totalEarned = 0; let totalPaid = 0; tbody.innerHTML = "";
    
    allEstimatesCache.forEach(est => {
        const isAcceptedOrClosed = (est.status === 'Accepted (Deposit Received)' || est.status === 'Complete / Closed');
        if (isAcceptedOrClosed && est.activeSalesReps) {
            est.activeSalesReps.forEach((rep, idx) => {
                if (rep.isConfirmed && !rep.isRemoved && rep.name === repName) {
                    const totalProfit = est.totalProfit || 0;
                    const baseComm = totalProfit * (rep.percent / 100);
                    const bonuses = (rep.bonuses || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                    const ded = (rep.deductions || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                    const pay = (rep.payments || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                    
                    let gross = baseComm + bonuses; let bal = gross - ded - pay;
                    totalEarned += gross; totalPaid += pay;
                    
                    const dateStr = getSafeTsDateStr(est.timestamp);
                    
                    tbody.innerHTML += `
                        <tr>
                            <td class="multi-manage-comm-col d-none text-center align-middle"><input type="checkbox" class="multi-manage-comm-chk form-check-input" data-estid="${est.estimateId}" data-repidx="${idx}" style="transform: scale(1.2); cursor: pointer;"></td>
                            <td>${dateStr}</td><td><a href="#" onclick="loadJob('${est.estimateId}')">${est.estimateId}</a></td>
                            <td class="text-truncate" style="max-width: 150px;">${est.custAddress || '-'}</td>
                            <td class="text-end">${fmt(baseComm)}</td>
                            <td class="text-end">${fmt(bonuses)}</td>
                            <td class="text-end text-danger">${fmt(ded)}</td>
                            <td class="text-end text-success">${fmt(pay)}</td>
                            <td class="text-end fw-bold">${fmt(bal)}</td>
                            <td class="text-center"><button class="btn btn-sm btn-outline-dark py-0" onclick="openManageCommissionModal('${est.estimateId}', ${idx})">Manage</button></td>
                        </tr>`;
                }
            });
        }
    });
    
    if (tbody.innerHTML === "") tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">No records found for ${repName}.</td></tr>`;
    
    document.getElementById('ir-total-earned').innerText = fmt(totalEarned); document.getElementById('ir-total-paid').innerText = fmt(totalPaid); document.getElementById('ir-total-bal').innerText = fmt(totalEarned - totalPaid);
    content.classList.remove('d-none'); actions.style.display = 'block';
}

window.executeInteractiveCommPrint = function(isSelectionOnly = false) {
    const repName = document.getElementById('interactive-rep-picker').value;
    if(!repName) return customAlert("Select a rep first.");

    let recordsToPrint = [];
    if (isSelectionOnly) {
        const checks = document.querySelectorAll('.multi-manage-comm-chk:checked');
        if(checks.length === 0) return customAlert("Please select at least one commission record to print.");
        checks.forEach(chk => recordsToPrint.push({ estId: chk.dataset.estid, repIdx: parseInt(chk.dataset.repidx) }));
    } else {
        allEstimatesCache.forEach(est => {
            const isAcceptedOrClosed = (est.status === 'Accepted (Deposit Received)' || est.status === 'Complete / Closed');
            if (isAcceptedOrClosed && est.activeSalesReps) {
                est.activeSalesReps.forEach((rep, idx) => {
                    if (rep.isConfirmed && !rep.isRemoved && rep.name === repName) recordsToPrint.push({ estId: est.estimateId, repIdx: idx });
                });
            }
        });
        if(recordsToPrint.length === 0) return customAlert("No records found to print.");
    }

    document.getElementById('ccr-thead').innerHTML = `<tr><th>Date</th><th class="job-address-print">Job Address</th><th>Est ID</th><th>Rep</th><th class="text-end">Base Comm</th><th class="text-end">Bonuses</th><th class="text-end">Deductions</th><th class="text-end">Payments</th><th class="text-end">Balance Due</th></tr>`;
    const tbody = document.getElementById('ccr-tbody'); tbody.innerHTML = "";
    let grandBase = 0, grandBonus = 0, grandDed = 0, grandPay = 0, grandBal = 0;

    recordsToPrint.forEach(item => {
        const est = allEstimatesCache.find(e => e.estimateId === item.estId);
        const rep = est.activeSalesReps[item.repIdx];
        const totalProfit = est.totalProfit || 0;
        const baseComm = totalProfit * (rep.percent / 100);
        const bonuses = (rep.bonuses || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
        const deductions = (rep.deductions || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
        const payments = (rep.payments || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
        const balance = (baseComm + bonuses) - deductions - payments;

        grandBase += baseComm; grandBonus += bonuses; grandDed += deductions; grandPay += payments; grandBal += balance;
        
        const dateStr = getSafeTsDateStr(est.timestamp);
        
        tbody.innerHTML += `
            <tr>
                <td>${dateStr}</td><td class="job-address-print">${est.custAddress || '-'}</td><td>${est.estimateId}</td><td>${rep.name}</td>
                <td class="text-end">${fmt(baseComm)}</td><td class="text-end">${fmt(bonuses)}</td><td class="text-end text-danger">${fmt(deductions)}</td>
                <td class="text-end text-success">${fmt(payments)}</td><td class="text-end fw-bold">${fmt(balance)}</td>
            </tr>`;
    });

    document.getElementById('ccr-tfoot').innerHTML = `
        <tr>
            <td colspan="4" class="text-end"><strong>GRAND TOTALS:</strong></td>
            <td class="text-end">${fmt(grandBase)}</td><td class="text-end">${fmt(grandBonus)}</td><td class="text-end text-danger">${fmt(grandDed)}</td>
            <td class="text-end text-success">${fmt(grandPay)}</td><td class="text-end fs-6">${fmt(grandBal)}</td>
        </tr>`;

    document.getElementById('ccr-title').innerText = "Rep Statement";
    document.getElementById('ccr-date-range').innerText = isSelectionOnly ? "Selected Entries Only" : "All Time";
    document.getElementById('ccr-rep-filter').innerText = repName;
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('interactiveRepModal')).hide();
    triggerPayrollPrint('custom_comm');
}

function openManageCommissionModal(estId, repIdx) {
    commManageEstId = estId; commManageRepIdx = repIdx;
    const est = allEstimatesCache.find(e => e.estimateId === estId);
    if(!est) return;
    const rep = est.activeSalesReps[repIdx];
    
    tempCommEntry = JSON.parse(JSON.stringify(rep));
    if(!tempCommEntry.payments) tempCommEntry.payments = []; if(!tempCommEntry.deductions) tempCommEntry.deductions = []; if(!tempCommEntry.bonuses) tempCommEntry.bonuses = [];

    document.getElementById('mc_rep_display').innerText = rep.name;
    document.getElementById('mc_job_display').innerText = est.custAddress + " (" + estId + ")";
    document.getElementById('mc_notes').value = rep.notes || "";
    
    const base = (est.totalProfit || 0) * (rep.percent / 100);
    const bon = tempCommEntry.bonuses.reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
    const ded = tempCommEntry.deductions.reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
    const pd = tempCommEntry.payments.reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
    const bal = (base + bon - ded) - pd;
    let status = 'Unpaid';
    if(bal <= 0.01) status = 'Paid in Full (PIF)'; else if(pd > 0) status = 'Partial Payment (PP)';
    
    document.getElementById('mc_status_badge').innerText = status;
    document.getElementById('mc_status_badge').className = `badge ${status==='Paid in Full (PIF)'?'bg-success':(status==='Partial Payment (PP)'?'bg-info':'bg-warning text-dark')}`;

    document.querySelectorAll('#manageCommissionModal input').forEach(i => i.value = "");
    setCommCategory('pay'); renderCommManageLists();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('manageCommissionModal')).show();
}

function setCommCategory(cat) {
    ['pay','deduct','bonus'].forEach(c => { document.getElementById('btn-mc-'+c).classList.remove('active'); document.getElementById('form-mc-'+c).classList.add('d-none'); });
    document.getElementById('btn-mc-'+cat).classList.add('active'); document.getElementById('form-mc-'+cat).classList.remove('d-none');
}

async function addCommTransaction(type) {
    let amt, note, date;
    if(type === 'pay') {
        amt = parseFloat(document.getElementById('mc_pay_amt').value); note = document.getElementById('mc_pay_note').value; date = document.getElementById('mc_pay_date').value || new Date().toISOString().split('T')[0];
        if(!amt) return await customAlert("Enter amount");
        tempCommEntry.payments.push({amount: amt, note: note || "Payment", date: date});
    } else if (type === 'deduct') {
        amt = parseFloat(document.getElementById('mc_deduct_amt').value); note = document.getElementById('mc_deduct_note').value;
        if(!amt) return await customAlert("Enter amount");
        tempCommEntry.deductions.push({amount: amt, note: note || "Deduction"});
    } else if (type === 'bonus') {
        amt = parseFloat(document.getElementById('mc_bonus_amt').value); note = document.getElementById('mc_bonus_note').value;
        if(!amt) return await customAlert("Enter amount");
        tempCommEntry.bonuses.push({amount: amt, note: note || "Bonus"});
    }
    document.querySelectorAll(`#form-mc-${type} input`).forEach(i => i.value = ""); renderCommManageLists();
}

function removeCommTransaction(type, idx) {
    if(type === 'pay') tempCommEntry.payments.splice(idx, 1);
    if(type === 'deduct') tempCommEntry.deductions.splice(idx, 1);
    if(type === 'bonus') tempCommEntry.bonuses.splice(idx, 1);
    renderCommManageLists();
}

function renderCommManageLists() {
    const pDiv = document.getElementById('list-mc-pay'); pDiv.innerHTML = "";
    tempCommEntry.payments.forEach((x,i) => pDiv.innerHTML += `<div class="manage-list-item text-success"><span>${x.date}: ${x.note}</span><span>-${fmt(x.amount)} <i class="mdi mdi-close text-dark pointer ms-2" onclick="removeCommTransaction('pay',${i})"></i></span></div>`);
    const dDiv = document.getElementById('list-mc-deduct'); dDiv.innerHTML = "";
    tempCommEntry.deductions.forEach((x,i) => dDiv.innerHTML += `<div class="manage-list-item text-danger"><span>${x.note}</span><span>-${fmt(x.amount)} <i class="mdi mdi-close text-dark pointer ms-2" onclick="removeCommTransaction('deduct',${i})"></i></span></div>`);
    const bDiv = document.getElementById('list-mc-bonus'); bDiv.innerHTML = "";
    tempCommEntry.bonuses.forEach((x,i) => bDiv.innerHTML += `<div class="manage-list-item text-primary"><span>${x.note}</span><span>+${fmt(x.amount)} <i class="mdi mdi-close text-dark pointer ms-2" onclick="removeCommTransaction('bonus',${i})"></i></span></div>`);
}

async function saveCommissionDetails() {
    if(!commManageEstId) return;
    tempCommEntry.notes = document.getElementById('mc_notes').value;
    const est = allEstimatesCache.find(e => e.estimateId === commManageEstId);
    if(est) {
        est.activeSalesReps[commManageRepIdx] = tempCommEntry;
        if(db) {
            try {
                await db.collection('estimates').doc(est.id).update({ activeSalesReps: est.activeSalesReps });
                await customAlert("Commission Details Saved!");
                bootstrap.Modal.getOrCreateInstance(document.getElementById('manageCommissionModal')).hide();
                loadCommissionsView();
            } catch(e) { await customAlert("Error saving: " + e.message); }
        } else {
            await customAlert("Offline: Saved to session memory.");
            bootstrap.Modal.getOrCreateInstance(document.getElementById('manageCommissionModal')).hide();
            loadCommissionsView();
        }
    }
}

function openCommissionReportModal() { bootstrap.Modal.getOrCreateInstance(document.getElementById('salesReportModal')).show(); }

async function printCommissionStatement() {
    const val = document.getElementById('comm-report-picker').value;
    if(!val) return await customAlert("Select a record first.");
    const obj = JSON.parse(val); const est = allEstimatesCache.find(e => e.estimateId === obj.estId); const rep = est.activeSalesReps[obj.repIdx];
    
    document.getElementById('cs-rep-name').innerText = rep.name; document.getElementById('cs-est-id').innerText = est.estimateId;
    document.getElementById('cs-address').innerText = est.custAddress; document.getElementById('cs-gen-date').innerText = new Date().toLocaleDateString();
    
    const baseComm = (est.totalProfit || 0) * (rep.percent / 100);
    document.getElementById('cs-base-profit').innerText = fmt(est.totalProfit || 0); document.getElementById('cs-rate-val').innerText = rep.percent; document.getElementById('cs-base-comm').innerText = fmt(baseComm);
    
    const bDiv = document.getElementById('cs-bonus-rows'); bDiv.innerHTML = "";
    const bonuses = (rep.bonuses||[]).reduce((s,x) => { bDiv.innerHTML += `<div class="sheet-row"><div class="sheet-note">${x.note}</div><div class="sheet-amt text-primary">+${fmt(x.amount)}</div></div>`; return s + parseFloat(x.amount); }, 0);
    
    const dDiv = document.getElementById('cs-deduct-rows'); dDiv.innerHTML = "";
    const deductions = (rep.deductions||[]).reduce((s,x) => { dDiv.innerHTML += `<div class="sheet-row"><div class="sheet-note">${x.note}</div><div class="sheet-amt text-danger">-${fmt(x.amount)}</div></div>`; return s + parseFloat(x.amount); }, 0);

    const pDiv = document.getElementById('cs-payment-rows'); pDiv.innerHTML = "";
    const payments = (rep.payments||[]).reduce((s,x) => { pDiv.innerHTML += `<div class="sheet-row"><div class="sheet-note">${x.date}: ${x.note}</div><div class="sheet-amt text-success">-${fmt(x.amount)}</div></div>`; return s + parseFloat(x.amount); }, 0);

    document.getElementById('cs-notes').innerText = rep.notes || "";
    document.getElementById('cs-tot-comm').innerText = fmt(baseComm + bonuses); document.getElementById('cs-tot-ded').innerText = fmt(deductions);
    document.getElementById('cs-tot-paid').innerText = fmt(payments); document.getElementById('cs-final-bal').innerText = fmt((baseComm + bonuses) - deductions - payments);

    bootstrap.Modal.getOrCreateInstance(document.getElementById('salesReportModal')).hide();
    document.body.className = ''; document.body.classList.add('print-commission'); document.title = "Commission_Statement"; window.print();
    setTimeout(() => { document.body.classList.remove('print-commission'); document.title = "Rooster Roofing App"; forceSwitchView('commissions'); }, 1000);
}

function calculateCrewPreviousBalance(crewName, targetEstId, currentCrewIdx) {
    let prevBal = 0;
    const est = allEstimatesCache.find(e => e.estimateId === targetEstId);
    if (est && est.activePayroll && est.activePayroll.length > 0) {
        est.activePayroll.forEach((c, idx) => {
            if (idx < currentCrewIdx && c.isConfirmed && !c.isRemoved && c.crew === crewName && c.coType !== 'material') {
                let base = (c.calcType === 'flat') ? c.rate : ((parseFloat(est['squares' + c.section]) || 0) * c.rate);
                let ext = (c.costs || []).reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
                let ded = (c.deductions || []).reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
                let pay = (c.payments || []).reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
                prevBal += (base + ext) - ded - pay;
            }
        });
    }
    return prevBal;
}

window.confirmPayrollEntry = async function(estId, crewIdx) {
    const est = allEstimatesCache.find(e => e.estimateId === estId);
    if(!est) return;
    est.activePayroll[crewIdx].isConfirmed = true;
    if(db) {
        try { await db.collection('estimates').doc(est.id).update({ activePayroll: est.activePayroll }); await customAlert("Payroll entry confirmed."); } 
        catch(e) { await customAlert("Error confirming entry: " + e.message); }
    }
    loadPayrollView();
};

window.removePayrollEntryFromLedger = async function(estId, crewIdx) {
    if(!await customConfirm("Are you sure you want to remove this payroll entry completely?")) return;
    const est = allEstimatesCache.find(e => e.estimateId === estId);
    if(!est) return;
    est.activePayroll[crewIdx].isRemoved = true;
    if(db) {
        try { await db.collection('estimates').doc(est.id).update({ activePayroll: est.activePayroll }); } 
        catch(e) { await customAlert("Error removing entry: " + e.message); }
    }
    loadPayrollView();
};

window.exportPayrollToCSV = function() {
    const tbody = document.getElementById('payrollLedgerBody');
    const rows = tbody.querySelectorAll('tr');
    let csvContent = "data:text/csv;charset=utf-8,Date,Job Address,Est ID,Crew Name,Job Info & Scope,Base Rate,Total Payout,Status\n";
    rows.forEach(row => {
        if(row.classList.contains('table-secondary')) return;
        let rowData = [];
        row.querySelectorAll('td:not(.action-col)').forEach(td => {
            let text = td.innerText.replace(/"/g, '""').trim();
            rowData.push(`"${text}"`);
        });
        csvContent += rowData.join(",") + "\n";
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "master_payroll_ledger.csv");
    document.body.appendChild(link); link.click(); link.remove();
}

function renderOutstandingPayments() {
    const tbody = document.getElementById('outstandingPaymentsBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let count = 0;
    
    const filterCrew = document.getElementById('master-crew-filter') ? document.getElementById('master-crew-filter').value : '';

    allEstimatesCache.forEach(est => {
        if (est.activePayroll) {
            est.activePayroll.forEach((crew, idx) => {
                if (crew.isConfirmed && !crew.isRemoved && crew.coType !== 'material') {
                    if (crew.paymentStatus === 'Unpaid' || crew.paymentStatus === 'Partial Payment (PP)' || crew.paymentStatus === 'Partial') {
                        if (filterCrew && crew.crew !== filterCrew) return;
                        
                        let sq = (crew.calcType !== 'flat') ? (parseFloat(est['squares' + crew.section]) || 0) : 0;
                        let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
                        const extras = (crew.costs || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                        const totalPayout = baseCost + extras;
                        const deductions = (crew.deductions || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                        const payments = (crew.payments || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                        const balance = totalPayout - deductions - payments;
                        
                        const safeCrew = crew.crew.replace(/'/g, "\\'");
                        tbody.innerHTML += `
                            <tr>
                                <td>${getSafeTsDateStr(est.timestamp)}</td>
                                <td><a href="#" onclick="loadJob('${est.estimateId}')">${est.estimateId}</a></td>
                                <td class="fw-bold text-primary pointer" onclick="openPayrollCardModal('${est.estimateId}', '${safeCrew}', ${idx})">${crew.crew}</td>
                                <td>${est.custAddress || 'N/A'}</td>
                                <td class="text-end fw-bold">${fmt(totalPayout)}</td>
                                <td class="text-end text-success">${fmt(payments)}</td>
                                <td class="text-end text-danger fw-bold">${fmt(balance)}</td>
                                <td class="text-center"><span class="badge ${(crew.paymentStatus === 'Partial' || crew.paymentStatus === 'Partial Payment (PP)') ? 'bg-info text-dark' : 'bg-warning text-dark'}">${crew.paymentStatus}</span></td>
                            </tr>
                        `;
                        count++;
                    }
                }
            });
        }
    });

    if (count === 0) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No outstanding payments found.</td></tr>';
}


function initPayrollCalendar() {
    let calContainer = document.getElementById('payroll-calendar-container');
    if(!calContainer) {
        const viewPayroll = document.getElementById('view-payroll');
        const header = viewPayroll.querySelector('.payroll-no-print');
        if (!header) return; 
        calContainer = document.createElement('div');
        calContainer.id = 'payroll-calendar-container';
        calContainer.className = 'card mb-4 shadow-sm border-info';
        calContainer.innerHTML = `
            <div class="card-header bg-info text-dark py-3 d-flex justify-content-between align-items-center cursor-pointer" data-bs-toggle="collapse" data-bs-target="#calendarCollapse">
                <h6 class="fw-bold m-0"><i class="mdi mdi-calendar"></i> Subcontractor Payout Calendar View</h6>
                <i class="mdi mdi-chevron-down fs-4"></i>
            </div>
            <div id="calendarCollapse" class="collapse show">
                <div class="card-body bg-white">
                    <div id="payrollCalendarEl"></div>
                </div>
            </div>`;
        header.insertBefore(calContainer, header.children[2]);
    }

    if(window.FullCalendar && document.getElementById('payrollCalendarEl')) {
        const calEl = document.getElementById('payrollCalendarEl');
        let events = [];
        allEstimatesCache.forEach(est => {
            if (est.activePayroll) {
                est.activePayroll.forEach((crew, idx) => {
                    if (crew.isConfirmed && !crew.isRemoved) {
                        const evtDate = crew.paymentDate || new Date(getSafeTsMs(est.timestamp)).toISOString().split('T')[0];
                        
                        let statusText = (crew.paymentStatus === 'Paid' || crew.paymentStatus === 'Paid in Full (PIF)') ? 'PIF' : ((crew.paymentStatus === 'Partial' || crew.paymentStatus === 'Partial Payment (PP)') ? 'PP' : 'Unpaid');
                        let dateDisplay = crew.paymentDate ? ` (${crew.paymentDate})` : ` (${evtDate})`;
                        
                        events.push({
                            title: `${crew.crew} - ${est.custAddress || est.estimateId} - ${statusText}${dateDisplay}`,
                            start: evtDate,
                            color: statusText === 'PIF' ? '#10b981' : (statusText === 'PP' ? '#0ea5e9' : '#f59e0b'),
                            extendedProps: { estId: est.estimateId, crewIdx: idx, crewName: crew.crew }
                        });
                    }
                });
            }
        });

        if(window.payrollCalendarInst) { window.payrollCalendarInst.destroy(); }
        
        let viewType = window.innerWidth < 991 ? 'listWeek' : 'dayGridMonth';
        window.payrollCalendarInst = new FullCalendar.Calendar(calEl, {
            initialView: viewType,
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listWeek' },
            events: events,
            eventClick: function(info) { 
                openPayrollCardModal(info.event.extendedProps.estId, info.event.extendedProps.crewName, info.event.extendedProps.crewIdx); 
            },
            windowResize: function(arg) { if (window.innerWidth < 991) { window.payrollCalendarInst.changeView('listWeek'); } else { window.payrollCalendarInst.changeView('dayGridMonth'); } }
        });
        window.payrollCalendarInst.render();
    } else if (!window.FullCalendar) {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.global.min.js";
        script.onload = () => initPayrollCalendar();
        document.head.appendChild(script);
    }
}

function loadPayrollView() {
    let crewFilterSel = document.getElementById('master-crew-filter');
    if (!crewFilterSel) {
        const sortDiv = document.getElementById('master-payroll-sort').parentNode;
        const lbl = document.createElement('label');
        lbl.className = 'small fw-bold mt-2';
        lbl.innerText = 'Filter by Crew';
        sortDiv.appendChild(lbl);
        crewFilterSel = document.createElement('select');
        crewFilterSel.id = 'master-crew-filter';
        crewFilterSel.className = 'form-select form-select-sm';
        crewFilterSel.onchange = loadPayrollView;
        sortDiv.appendChild(crewFilterSel);
    }
    const currentCrewFilter = crewFilterSel.value;
    
    const tableBody = document.getElementById('payrollLedgerBody'); tableBody.innerHTML = '';
    let totalLiab = 0, totalPaid = 0;
    
    const sortMode = document.getElementById('master-payroll-sort') ? document.getElementById('master-payroll-sort').value : 'date_desc';
    const startDateStr = document.getElementById('master-start-date') ? document.getElementById('master-start-date').value : '';
    const endDateStr = document.getElementById('master-end-date') ? document.getElementById('master-end-date').value : '';
    let startTimestamp = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;
    let endTimestamp = endDateStr ? new Date(endDateStr + 'T23:59:59').getTime() : Infinity;

    const allCrewsForDropdown = new Set();
    let flatEntries = []; let stagingEntries = [];

    allEstimatesCache.forEach(est => {
        if (est.activePayroll && est.activePayroll.length > 0) {
            const estTime = getSafeTsMs(est.timestamp);
            const isComplete = (est.status === 'Complete (Phase 1)' || est.status === 'Complete (Phase 2)' || est.status === 'Complete (Phase 3)' || est.status === 'Complete / Closed' || est.status === 'Completed');

            est.activePayroll.forEach((crew, idx) => {
                if (crew.coType === 'material' || crew.isRemoved) return; 

                let sq = (crew.calcType !== 'flat') ? (parseFloat(est['squares' + crew.section]) || 0) : 0;
                let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
                
                const extras = (crew.costs || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                const deductions = (crew.deductions || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                const payments = (crew.payments || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

                const totalPayout = baseCost + extras;
                const balance = totalPayout - deductions - payments;
                
                let status = 'Unpaid', statusClass = 'bg-warning text-dark';
                if(balance <= 0) { status = 'Paid in Full (PIF)'; statusClass = 'bg-success text-white'; }
                else if(payments > 0) { status = 'Partial Payment (PP)'; statusClass = 'bg-info text-dark'; }
                
                crew.paymentStatus = status;

                const itemData = {
                    estId: est.estimateId, custAddress: est.custAddress, scope: est.desiredMaterial || 'N/A',
                    crewName: crew.crew, laborType: crew.laborType, calcType: crew.calcType, rate: crew.rate, sq,
                    baseCost, extras, totalPayout, status, statusClass, dateStr: getSafeTsDateStr(est.timestamp), timestampVal: estTime, idx
                };

                if (crew.isConfirmed) {
                    allCrewsForDropdown.add(crew.crew);
                    
                    if (currentCrewFilter && crew.crew !== currentCrewFilter) return;
                    
                    totalLiab += totalPayout; totalPaid += payments;
                    if (startDateStr || endDateStr) { if (estTime < startTimestamp || estTime > endTimestamp) return; }
                    flatEntries.push(itemData);
                } else if (isComplete) {
                    if (currentCrewFilter && crew.crew !== currentCrewFilter) return;
                    stagingEntries.push(itemData);
                }
            });
        }
    });

    crewFilterSel.innerHTML = '<option value="">All Crews</option>';
    Array.from(allCrewsForDropdown).sort().forEach(c => crewFilterSel.add(new Option(c, c)));
    crewFilterSel.value = currentCrewFilter;

    const stagingBody = document.getElementById('newPayrollBody');
    if (stagingBody) {
        stagingBody.innerHTML = '';
        if (stagingEntries.length === 0) stagingBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No new payroll entries pending confirmation.</td></tr>';
        else {
            stagingEntries.forEach(item => {
                stagingBody.innerHTML += `
                    <tr>
                        <td class="ps-4 text-muted small">${item.dateStr}</td>
                        <td class="text-truncate" style="max-width: 150px;">${item.custAddress || 'No Address'}</td>
                        <td class="fw-bold text-primary">${item.crewName}</td><td>${item.scope}<br><small class="text-muted" style="font-size:10px;">${item.laborType}</small></td>
                        <td class="text-end">${fmt(item.baseCost)}</td><td class="text-end fw-bold">${fmt(item.totalPayout)}</td>
                        <td class="text-center">
                            <button class="btn btn-sm btn-success py-0 me-1" onclick="confirmPayrollEntry('${item.estId}', ${item.idx})" title="Confirm"><i class="mdi mdi-check"></i></button>
                            <button class="btn btn-sm btn-outline-dark py-0 me-1" onclick="openManagePayrollModal('${item.estId}', ${item.idx})" title="Adjust"><i class="mdi mdi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger py-0" onclick="removePayrollEntryFromLedger('${item.estId}', ${item.idx})" title="Remove"><i class="mdi mdi-trash-can"></i></button>
                        </td>
                    </tr>`;
            });
        }
    }

    allPaidClosedItems = flatEntries.filter(i => i.status === 'Paid in Full (PIF)');
    allPaidClosedItems.sort((a,b) => b.timestampVal - a.timestampVal);
    renderPaidClosedItems();
    renderOutstandingPayments();

    const generateLedgerRow = (item) => {
        const safeCrew = item.crewName.replace(/'/g, "\\'");
        let laborRateDisplay = `${item.laborType} | ${item.sq > 0 ? `Total Sq: ${item.sq.toFixed(2)}` : 'Flat Rate'}`;
        return `
            <tr>
                <td class="ps-4 text-muted small">${item.dateStr}</td>
                <td class="text-truncate" style="max-width: 150px;">${item.custAddress || 'No Address'}</td>
                <td><a href="#" onclick="loadJob('${item.estId}')" class="fw-bold text-dark">${item.estId}</a></td>
                <td class="fw-bold text-primary pointer" onclick="openPayrollCardModal('${item.estId}', '${safeCrew}', ${item.idx})">${item.crewName}</td>
                <td><div class="small fw-bold">${item.scope}</div><div class="text-muted" style="font-size:10px;">${laborRateDisplay}</div></td>
                <td class="text-end">${fmt(item.rate)} ${item.calcType === 'flat' ? '(Flat)' : '/sq'}</td><td class="text-end fw-bold">${fmt(item.totalPayout)}</td>
                <td class="text-center"><span class="badge ${item.statusClass}">${item.status}</span></td>
                <td class="text-center action-col">
                    <button class="btn btn-sm btn-outline-dark py-0 me-1" onclick="openManagePayrollModal('${item.estId}', ${item.idx})" title="Adjust"><i class="mdi mdi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0" onclick="removePayrollEntryFromLedger('${item.estId}', ${item.idx})" title="Remove"><i class="mdi mdi-trash-can"></i></button>
                </td>
            </tr>`;
    };

    if (sortMode === 'group_crew') {
        const grouped = {};
        flatEntries.forEach(item => { if (!grouped[item.crewName]) grouped[item.crewName] = []; grouped[item.crewName].push(item); });
        Object.keys(grouped).sort().forEach(crewName => {
            tableBody.innerHTML += `<tr class="table-secondary"><td colspan="9" class="fw-bold text-dark"><i class="mdi mdi-account-hard-hat"></i> ${crewName}</td></tr>`;
            grouped[crewName].forEach(item => tableBody.innerHTML += generateLedgerRow(item));
        });
    } else if (sortMode === 'group_job') {
        const grouped = {};
        flatEntries.forEach(item => { if (!grouped[item.custAddress]) grouped[item.custAddress] = []; grouped[item.custAddress].push(item); });
        Object.keys(grouped).sort().forEach(addr => {
            tableBody.innerHTML += `<tr class="table-secondary"><td colspan="9" class="fw-bold text-dark"><i class="mdi mdi-map-marker"></i> Job: ${addr}</td></tr>`;
            grouped[addr].forEach(item => tableBody.innerHTML += generateLedgerRow(item));
        });
    } else {
        flatEntries.sort((a, b) => sortMode === 'date_desc' ? b.timestampVal - a.timestampVal : a.timestampVal - b.timestampVal);
        flatEntries.forEach(item => tableBody.innerHTML += generateLedgerRow(item));
    }

    if (flatEntries.length === 0) tableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No records found.</td></tr>`;
    
    setText('pay-total-all', totalLiab); setText('pay-total-paid', totalPaid); setText('pay-total-pending', totalLiab - totalPaid);

    const icPicker = document.getElementById('interactive-crew-picker');
    if (icPicker) {
        const currentSelection = icPicker.value; icPicker.innerHTML = '<option value="">-- Choose a Crew --</option>';
        Array.from(allCrewsForDropdown).sort().forEach(c => icPicker.add(new Option(c, c)));
        if (currentSelection && allCrewsForDropdown.has(currentSelection)) icPicker.value = currentSelection;
        loadInteractiveCrewDashboard(); 
    }
    
    if(!document.getElementById('btnExportPayrollCsv')) {
        const exportBtn = document.createElement('button');
        exportBtn.id = 'btnExportPayrollCsv';
        exportBtn.className = 'btn btn-outline-success btn-sm w-100 mt-2';
        exportBtn.innerHTML = '<i class="mdi mdi-file-excel"></i> Export to CSV';
        exportBtn.onclick = exportPayrollToCSV;
        document.querySelector('#master-payroll-sort').parentElement.parentElement.children[3].appendChild(exportBtn);
    }
    
    initPayrollCalendar();
}

function renderPaidClosedItems() {
    const tbody = document.getElementById('paidClosedBody');
    const loadMoreDiv = document.getElementById('loadMorePaidContainer');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    if (allPaidClosedItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No paid & closed payrolls found.</td></tr>';
        if(loadMoreDiv) loadMoreDiv.classList.add('d-none');
        return;
    }

    const itemsToShow = allPaidClosedItems.slice(0, paidClosedPage * PAID_CLOSED_PAGE_SIZE);
    itemsToShow.forEach(item => {
        const safeCrew = item.crewName.replace(/'/g, "\\'");
        let laborRateDisplay = `${item.laborType} | ${item.sq > 0 ? `Total Sq: ${item.sq.toFixed(2)}` : 'Flat Rate'}`;
        tbody.innerHTML += `
            <tr>
                <td class="ps-4 text-muted small">${item.dateStr}</td>
                <td class="text-truncate" style="max-width: 150px;">${item.custAddress || 'No Address'}</td>
                <td class="fw-bold text-primary pointer" onclick="openPayrollCardModal('${item.estId}', '${safeCrew}', ${item.idx})">${item.crewName}</td>
                <td><div class="small fw-bold">${item.scope}</div><div class="text-muted" style="font-size:10px;">${laborRateDisplay}</div></td>
                <td class="text-end fw-bold text-success">${fmt(item.totalPayout)}</td>
                <td class="text-center"><span class="badge ${item.statusClass}">${item.status}</span></td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-dark py-0" onclick="openManagePayrollModal('${item.estId}', ${item.idx})" title="View/Adjust"><i class="mdi mdi-eye"></i></button>
                </td>
            </tr>`;
    });

    if (allPaidClosedItems.length > paidClosedPage * PAID_CLOSED_PAGE_SIZE) {
        if(loadMoreDiv) loadMoreDiv.classList.remove('d-none');
    } else {
        if(loadMoreDiv) loadMoreDiv.classList.add('d-none');
    }
}

window.loadMorePaidClosed = function() { paidClosedPage++; renderPaidClosedItems(); };

window.openInteractiveCrewModal = function() { bootstrap.Modal.getOrCreateInstance(document.getElementById('interactiveCrewModal')).show(); };

window.openGenerateReportsWizard = function() {
    const el = document.getElementById('generateReportsWizardModal');
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    
    const crewPicker = document.getElementById('wizard-crew-picker');
    crewPicker.innerHTML = '<option value="">-- All Crews --</option>';
    const crews = new Set();
    allEstimatesCache.forEach(est => { if (est.activePayroll) est.activePayroll.forEach(c => { if(c.isConfirmed && !c.isRemoved && c.coType !== 'material') crews.add(c.crew); }); });
    Array.from(crews).sort().forEach(c => crewPicker.add(new Option(c, c)));
    
    document.getElementById('wizard-report-type').value = 'crew_statement'; document.getElementById('wizard-start-date').value = '';
    document.getElementById('wizard-end-date').value = ''; document.getElementById('wizard-job-search').value = '';
    
    toggleWizardFilters();
    document.getElementById('wizard-results-table').innerHTML = '<tr><td colspan="8" class="text-center text-muted py-5">Select filters and click "Search & Filter" to load payrolls.</td></tr>';
    document.getElementById('wizard-check-all').checked = false; document.getElementById('btn-wizard-confirm').disabled = true;
    
    document.getElementById('btn-wizard-confirm').onclick = executeWizardPrint;

    modal.show();
};

window.toggleWizardFilters = function() {
    const type = document.getElementById('wizard-report-type').value;
    const jobContainer = document.getElementById('wizard-job-filter-container');
    if (type === 'general_payroll') jobContainer.style.display = 'block'; else jobContainer.style.display = 'none';
};

window.renderReportWizardTable = function() {
    const type = document.getElementById('wizard-report-type').value; const crewFilter = document.getElementById('wizard-crew-picker').value;
    const startDateStr = document.getElementById('wizard-start-date').value; const endDateStr = document.getElementById('wizard-end-date').value;
    const jobSearch = document.getElementById('wizard-job-search').value.toLowerCase();

    let startTimestamp = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;
    let endTimestamp = endDateStr ? new Date(endDateStr + 'T23:59:59').getTime() : Infinity;

    wizardResults = [];

    allEstimatesCache.forEach(est => {
        const estTime = getSafeTsMs(est.timestamp);
        if (estTime < startTimestamp || estTime > endTimestamp) return;

        if (type === 'general_payroll' && jobSearch) {
            const estStr = `${est.custAddress} ${est.estimateId} ${est.custName}`.toLowerCase();
            if (!estStr.includes(jobSearch)) return;
        }

        if (est.activePayroll) {
            est.activePayroll.forEach((crew, idx) => {
                if (!crew.isConfirmed || crew.isRemoved || crew.coType === 'material') return;
                if (crewFilter && crew.crew !== crewFilter) return;

                let sq = (crew.calcType === 'flat') ? 0 : (parseFloat(est['squares' + crew.section]) || 0);
                let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
                let extras = (crew.costs || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                let ded = (crew.deductions || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                let pay = (crew.payments || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);

                let gross = baseCost + extras; let bal = gross - ded - pay;

                wizardResults.push({
                    estId: est.estimateId, crewName: crew.crew, address: est.custAddress || 'N/A', scope: est.desiredMaterial || 'N/A',
                    baseCost: baseCost, extras: extras, deductions: ded, payments: pay, gross: gross, balance: bal,
                    dateStr: getSafeTsDateStr(est.timestamp), idx: idx, timestampVal: estTime
                });
            });
        }
    });

    wizardResults.sort((a,b) => b.timestampVal - a.timestampVal);

    const tbody = document.getElementById('wizard-results-table'); tbody.innerHTML = '';
    if (wizardResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-5">No records found matching these criteria.</td></tr>';
        document.getElementById('btn-wizard-confirm').disabled = true; return;
    }

    wizardResults.forEach((res, i) => {
        tbody.innerHTML += `
            <tr>
                <td class="text-center"><input type="checkbox" class="form-check-input wizard-chk" value="${i}" onclick="checkWizardSelections()"></td>
                <td class="small text-muted">${res.dateStr}</td><td class="fw-bold text-dark">${res.estId}</td><td class="text-primary fw-bold">${res.crewName}</td>
                <td class="text-truncate" style="max-width: 150px;">${res.address}</td><td>${res.scope}</td><td class="text-end">${fmt(res.baseCost)}</td>
                <td class="text-end fw-bold ${res.balance > 0 ? 'text-danger' : 'text-success'}">${fmt(res.balance)}</td>
            </tr>`;
    });
    
    document.getElementById('wizard-check-all').checked = false; document.getElementById('btn-wizard-confirm').disabled = true;
};

window.toggleAllWizardChecks = function() {
    const isChecked = document.getElementById('wizard-check-all').checked;
    document.querySelectorAll('.wizard-chk').forEach(c => c.checked = isChecked); checkWizardSelections();
};

window.checkWizardSelections = function() { document.getElementById('btn-wizard-confirm').disabled = document.querySelectorAll('.wizard-chk:checked').length === 0; };

window.executeWizardPrint = function() {
    const checked = document.querySelectorAll('.wizard-chk:checked');
    if (checked.length === 0) return;

    const type = document.getElementById('wizard-report-type').value;
    const selectedRecords = Array.from(checked).map(c => wizardResults[c.value]);

    if (type === 'crew_statement' || type === 'crew_payroll' || type === 'general_payroll') {
        document.getElementById('cpr-thead').innerHTML = `<tr><th>Date</th><th class="job-address-print">Job Address</th><th>Est ID</th><th>Crew</th><th class="text-end">Base Cost</th><th class="text-end">Extras</th><th class="text-end">Deductions</th><th class="text-end">Payments</th><th class="text-end">Balance Due</th></tr>`;
        const tbody = document.getElementById('cpr-tbody'); tbody.innerHTML = "";
        let grandBase = 0, grandExtras = 0, grandDed = 0, grandPay = 0, grandBal = 0;

        selectedRecords.forEach(res => {
            grandBase += res.baseCost; grandExtras += res.extras; grandDed += res.deductions; grandPay += res.payments; grandBal += res.balance;
            tbody.innerHTML += `
                <tr>
                    <td>${res.dateStr}</td><td class="job-address-print text-truncate" style="max-width: 150px;">${res.address}</td><td>${res.estId}</td><td>${res.crewName}</td>
                    <td class="text-end">${fmt(res.baseCost)}</td><td class="text-end">${fmt(res.extras)}</td><td class="text-end text-danger">${fmt(res.deductions)}</td>
                    <td class="text-end text-success">${fmt(res.payments)}</td><td class="text-end fw-bold">${fmt(res.balance)}</td>
                </tr>`;
        });

        document.getElementById('cpr-tfoot').innerHTML = `
            <tr>
                <td colspan="4" class="text-end"><strong>GRAND TOTALS:</strong></td>
                <td class="text-end">${fmt(grandBase)}</td><td class="text-end">${fmt(grandExtras)}</td><td class="text-end text-danger">${fmt(grandDed)}</td>
                <td class="text-end text-success">${fmt(grandPay)}</td><td class="text-end fs-6">${fmt(grandBal)}</td>
            </tr>`;

        let typeTitle = "Custom Payroll Report";
        if(type === 'crew_statement') typeTitle = "Crew Statement"; if(type === 'crew_payroll') typeTitle = "Crew Payroll Report"; if(type === 'general_payroll') typeTitle = "General Payroll Report";
        document.getElementById('cpr-title').innerText = typeTitle;

        const crewFilter = document.getElementById('wizard-crew-picker').value;
        const start = document.getElementById('wizard-start-date').value; const end = document.getElementById('wizard-end-date').value;
        let rangeText = "Custom Selection";
        if(start && end) rangeText = `${start} to ${end}`; else if(start) rangeText = `From ${start}`; else if(end) rangeText = `Until ${end}`;

        document.getElementById('cpr-date-range').innerText = rangeText; document.getElementById('cpr-crew-filter').innerText = crewFilter || "Mixed/All Crews";
        bootstrap.Modal.getOrCreateInstance(document.getElementById('generateReportsWizardModal')).hide();
        triggerPayrollPrint('custom');
    }
};

window.renderCommReportWizardTable = function() {
    const type = document.getElementById('wizard-comm-report-type').value; 
    const repFilter = document.getElementById('wizard-comm-rep-picker').value;
    const startDateStr = document.getElementById('wizard-comm-start-date').value; 
    const endDateStr = document.getElementById('wizard-comm-end-date').value;
    const jobSearch = document.getElementById('wizard-comm-job-search').value.toLowerCase();

    let startTimestamp = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;
    let endTimestamp = endDateStr ? new Date(endDateStr + 'T23:59:59').getTime() : Infinity;

    wizardCommResults = [];

    allEstimatesCache.forEach(est => {
        const estTime = getSafeTsMs(est.timestamp);
        if (estTime < startTimestamp || estTime > endTimestamp) return;

        if (type === 'general_comm' && jobSearch) {
            const estStr = `${est.custAddress} ${est.estimateId} ${est.custName}`.toLowerCase();
            if (!estStr.includes(jobSearch)) return;
        }

        const isAcceptedOrClosed = (est.status === 'Accepted (Deposit Received)' || est.status === 'Complete / Closed');
        if (isAcceptedOrClosed && est.activeSalesReps) {
            const totalProfit = est.totalProfit || 0;
            est.activeSalesReps.forEach((rep, idx) => {
                if (!rep.isConfirmed || rep.isRemoved) return;
                if (repFilter && rep.name !== repFilter) return;

                let baseComm = totalProfit * (rep.percent / 100);
                let bonuses = (rep.bonuses || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                let ded = (rep.deductions || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                let pay = (rep.payments || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);

                let gross = baseComm + bonuses; let bal = gross - ded - pay;

                wizardCommResults.push({
                    estId: est.estimateId, repName: rep.name, address: est.custAddress || 'N/A',
                    baseComm: baseComm, bonuses: bonuses, deductions: ded, payments: pay, balance: bal,
                    dateStr: getSafeTsDateStr(est.timestamp), idx: idx, timestampVal: estTime
                });
            });
        }
    });

    wizardCommResults.sort((a,b) => b.timestampVal - a.timestampVal);

    const tbody = document.getElementById('wizard-comm-results-table'); tbody.innerHTML = '';
    if (wizardCommResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5">No records found matching these criteria.</td></tr>';
        document.getElementById('btn-wizard-comm-confirm').disabled = true; return;
    }

    wizardCommResults.forEach((res, i) => {
        tbody.innerHTML += `
            <tr>
                <td class="text-center"><input type="checkbox" class="form-check-input wizard-comm-chk" value="${i}" onclick="checkCommWizardSelections()"></td>
                <td class="small text-muted">${res.dateStr}</td><td class="fw-bold text-dark">${res.estId}</td><td class="text-primary fw-bold">${res.repName}</td>
                <td class="text-truncate" style="max-width: 150px;">${res.address}</td><td class="text-end">${fmt(res.baseComm)}</td>
                <td class="text-end fw-bold ${res.balance > 0 ? 'text-danger' : 'text-success'}">${fmt(res.balance)}</td>
            </tr>`;
    });
    
    document.getElementById('wizard-comm-check-all').checked = false; document.getElementById('btn-wizard-comm-confirm').disabled = true;
};

window.toggleAllCommWizardChecks = function() {
    const isChecked = document.getElementById('wizard-comm-check-all').checked;
    document.querySelectorAll('.wizard-comm-chk').forEach(c => c.checked = isChecked); checkCommWizardSelections();
};

window.checkCommWizardSelections = function() { 
    document.getElementById('btn-wizard-comm-confirm').disabled = document.querySelectorAll('.wizard-comm-chk:checked').length === 0; 
};

window.executeCommWizardPrint = function() {
    const checked = document.querySelectorAll('.wizard-comm-chk:checked');
    if (checked.length === 0) return;

    const type = document.getElementById('wizard-comm-report-type').value;
    const selectedRecords = Array.from(checked).map(c => wizardCommResults[c.value]);

    if (type === 'rep_statement' || type === 'general_comm') {
        document.getElementById('ccr-thead').innerHTML = `<tr><th>Date</th><th class="job-address-print">Job Address</th><th>Est ID</th><th>Rep</th><th class="text-end">Base Comm</th><th class="text-end">Bonuses</th><th class="text-end">Deductions</th><th class="text-end">Payments</th><th class="text-end">Balance Due</th></tr>`;
        const tbody = document.getElementById('ccr-tbody'); tbody.innerHTML = "";
        let grandBase = 0, grandBonus = 0, grandDed = 0, grandPay = 0, grandBal = 0;

        selectedRecords.forEach(res => {
            grandBase += res.baseComm; grandBonus += res.bonuses; grandDed += res.deductions; grandPay += res.payments; grandBal += res.balance;
            tbody.innerHTML += `
                <tr>
                    <td>${res.dateStr}</td><td class="job-address-print text-truncate" style="max-width: 150px;">${res.address}</td><td>${res.estId}</td><td>${res.repName}</td>
                    <td class="text-end">${fmt(res.baseComm)}</td><td class="text-end">${fmt(res.bonuses)}</td><td class="text-end text-danger">${fmt(res.deductions)}</td>
                    <td class="text-end text-success">${fmt(res.payments)}</td><td class="text-end fw-bold">${fmt(res.balance)}</td>
                </tr>`;
        });

        document.getElementById('ccr-tfoot').innerHTML = `
            <tr>
                <td colspan="4" class="text-end"><strong>GRAND TOTALS:</strong></td>
                <td class="text-end">${fmt(grandBase)}</td><td class="text-end">${fmt(grandBonus)}</td><td class="text-end text-danger">${fmt(grandDed)}</td>
                <td class="text-end text-success">${fmt(grandPay)}</td><td class="text-end fs-6">${fmt(grandBal)}</td>
            </tr>`;

        let typeTitle = "Custom Commission Report";
        if(type === 'rep_statement') typeTitle = "Rep Statement"; if(type === 'general_comm') typeTitle = "General Commission Report";
        document.getElementById('ccr-title').innerText = typeTitle;

        const repFilter = document.getElementById('wizard-comm-rep-picker').value;
        const start = document.getElementById('wizard-comm-start-date').value; const end = document.getElementById('wizard-comm-end-date').value;
        let rangeText = "Custom Selection";
        if(start && end) rangeText = `${start} to ${end}`; else if(start) rangeText = `From ${start}`; else if(end) rangeText = `Until ${end}`;

        document.getElementById('ccr-date-range').innerText = rangeText; document.getElementById('ccr-rep-filter').innerText = repFilter || "Mixed/All Reps";
        bootstrap.Modal.getOrCreateInstance(document.getElementById('generateCommReportsWizardModal')).hide();
        triggerPayrollPrint('custom_comm');
    }
};

function printMasterLedger() {
    const tbody = document.getElementById('ml-print-tbody'); 
    tbody.innerHTML = document.getElementById('payrollLedgerBody').innerHTML;
    tbody.querySelectorAll('.action-col').forEach(el => el.remove());
    
    // Swap columns in print container via JS if DOM manipulation is needed
    const headRow = document.querySelector('#master-ledger-print-container thead tr');
    if(headRow && headRow.children[1].innerText === 'Est ID') {
        headRow.children[1].innerText = 'Job Address';
        headRow.children[1].className = 'job-address-print';
    }
    
    const sortModeSel = document.getElementById('master-payroll-sort'); const sortText = sortModeSel.options[sortModeSel.selectedIndex].text;
    const start = document.getElementById('master-start-date').value; const end = document.getElementById('master-end-date').value;
    
    let rangeText = "All Time"; if(start && end) rangeText = `${start} to ${end}`; else if (start) rangeText = `From ${start}`; else if (end) rangeText = `Until ${end}`;

    document.getElementById('ml-print-date-range').innerText = rangeText; document.getElementById('ml-print-sort').innerText = sortText;
    triggerPayrollPrint('master_ledger');
}

function toggleMultiManageMode(mode) {
    const cols = document.querySelectorAll('.multi-select-col'); const btnManage = document.getElementById('btnMultiManage'); const btnPrint = document.getElementById('btnPrintSelectMode'); const btnConfirm = document.getElementById('btnConfirmMultiManage');
    if (cols.length === 0) return;
    
    if (interactiveSelectMode === mode) {
        interactiveSelectMode = null; cols.forEach(c => c.classList.add('d-none'));
        btnManage.innerHTML = "<i class='mdi mdi-format-list-checks'></i> Manage Multiple Payroll"; btnManage.classList.remove('d-none');
        btnPrint.innerHTML = "<i class='mdi mdi-printer'></i> Print Crew Statement"; btnPrint.classList.remove('d-none');
        btnConfirm.classList.add('d-none'); document.querySelectorAll('.multi-manage-chk').forEach(chk => chk.checked = false);
    } else {
        interactiveSelectMode = mode; cols.forEach(c => c.classList.remove('d-none')); btnConfirm.classList.remove('d-none');
        if (mode === 'manage') { btnManage.innerText = "Cancel Multi-Manage"; btnPrint.classList.add('d-none'); } 
        else if (mode === 'print') { btnPrint.innerText = "Cancel Print Selection"; btnManage.classList.add('d-none'); }
    }
}

window.toggleAllMultiManageChecks = function() {
    const checks = document.querySelectorAll('.multi-manage-chk'); if (checks.length === 0) return;
    const allChecked = Array.from(checks).every(c => c.checked); checks.forEach(c => c.checked = !allChecked);
};

window.executeInteractiveSelection = function() {
    if (interactiveSelectMode === 'manage') openManageMultipleModal();
    else if (interactiveSelectMode === 'print') window.executeInteractivePrint(true);
}

function loadInteractiveCrewDashboard() {
    const crewName = document.getElementById('interactive-crew-picker').value;
    const content = document.getElementById('interactive-crew-content'); const actions = document.getElementById('interactive-crew-actions');
    const tbody = document.getElementById('interactive-crew-table');
    
    interactiveSelectMode = null;
    const btnManage = document.getElementById('btnMultiManage'); const btnPrint = document.getElementById('btnPrintSelectMode'); const btnConfirm = document.getElementById('btnConfirmMultiManage');
    
    document.querySelectorAll('.multi-select-col').forEach(c => c.classList.add('d-none'));
    if (btnManage) { btnManage.innerHTML = "<i class='mdi mdi-format-list-checks'></i> Manage Multiple Payroll"; btnManage.classList.remove('d-none'); }
    if (btnPrint) { btnPrint.innerHTML = "<i class='mdi mdi-printer'></i> Print Crew Statement"; btnPrint.classList.remove('d-none'); }
    if (btnConfirm) btnConfirm.classList.add('d-none');
    
    if (!crewName) { content.classList.add('d-none'); actions.style.display = 'none'; return; }
    
    let totalEarned = 0; let totalPaid = 0; tbody.innerHTML = "";
    
    allEstimatesCache.forEach(est => {
        if (est.activePayroll) {
            est.activePayroll.forEach((crew, idx) => {
                if (crew.isConfirmed && !crew.isRemoved && crew.crew === crewName && crew.coType !== 'material') {
                    let sq = parseFloat(est['squares' + crew.section]) || 0;
                    let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
                    let extras = (crew.costs || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                    let ded = (crew.deductions || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                    let pay = (crew.payments || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
                    
                    let gross = baseCost + extras; let bal = gross - ded - pay;
                    totalEarned += gross; totalPaid += pay;
                    
                    const dateStr = getSafeTsDateStr(est.timestamp);
                    let sqDisplay = sq > 0 ? `Total Sq: ${sq.toFixed(2)}` : 'Flat Rate';
                    let scopeDisplay = est.desiredMaterial || 'N/A';
                    let laborRateDisplay = `${crew.laborType} | ${sqDisplay} | ${crew.calcType === 'flat' ? 'Flat' : fmt(crew.rate) + '/sq'}`;
                    
                    tbody.innerHTML += `
                        <tr>
                            <td class="multi-select-col d-none text-center align-middle">
                                <input type="checkbox" class="multi-manage-chk form-check-input" data-estid="${est.estimateId}" data-crewidx="${idx}" style="transform: scale(1.2); cursor: pointer;" onchange="validatePayrollCheckbox(this)">
                            </td>
                            <td>${dateStr}</td><td class="text-truncate" style="max-width: 150px;">${est.custAddress || '-'}</td>
                            <td><a href="#" onclick="loadJob('${est.estimateId}')">${est.estimateId}</a></td>
                            <td><div class="small fw-bold text-primary">${scopeDisplay}</div><div class="text-muted" style="font-size:10px;">${laborRateDisplay}</div></td>
                            <td class="text-end">${fmt(baseCost)}</td><td class="text-end">${fmt(extras)}</td>
                            <td class="text-end text-danger">${fmt(ded)}</td><td class="text-end text-success">${fmt(pay)}</td>
                            <td class="text-end fw-bold">${fmt(bal)}</td>
                            <td class="text-center"><button class="btn btn-sm btn-outline-dark py-0" onclick="openManagePayrollModal('${est.estimateId}', ${idx})">Manage</button></td>
                        </tr>`;
                }
            });
        }
    });
    
    if (tbody.innerHTML === "") tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">No records found for ${crewName}.</td></tr>`;
    
    document.getElementById('ic-total-earned').innerText = fmt(totalEarned); document.getElementById('ic-total-paid').innerText = fmt(totalPaid); document.getElementById('ic-total-bal').innerText = fmt(totalEarned - totalPaid);
    content.classList.remove('d-none'); actions.style.display = 'block';
}

window.validatePayrollCheckbox = async function(checkbox) {
    if (interactiveSelectMode === 'manage' && checkbox.checked) {
        const estId = checkbox.dataset.estid;
        const crewIdx = checkbox.dataset.crewidx;
        const est = allEstimatesCache.find(e => e.estimateId === estId);
        if(est && est.activePayroll[crewIdx] && est.activePayroll[crewIdx].paymentStatus === 'Unpaid') {
            const proceed = await customConfirm("This crew has an 'Unpaid' status. Selecting it for deduction assumes a payment has been verified. Continue?");
            if (!proceed) checkbox.checked = false;
        }
    }
};

window.executeInteractivePrint = function(isSelectionOnly = false) {
    const crewName = document.getElementById('interactive-crew-picker').value;
    if(!crewName) return customAlert("Select a crew first.");

    let recordsToPrint = [];
    if (isSelectionOnly) {
        const checks = document.querySelectorAll('.multi-manage-chk:checked');
        if(checks.length === 0) return customAlert("Please select at least one payroll record to print.");
        checks.forEach(chk => recordsToPrint.push({ estId: chk.dataset.estid, crewIdx: parseInt(chk.dataset.crewidx) }));
    } else {
        allEstimatesCache.forEach(est => {
            if (est.activePayroll) {
                est.activePayroll.forEach((crew, idx) => {
                    if (crew.isConfirmed && !crew.isRemoved && crew.crew === crewName && crew.coType !== 'material') recordsToPrint.push({ estId: est.estimateId, crewIdx: idx });
                });
            }
        });
        if(recordsToPrint.length === 0) return customAlert("No records found to print.");
    }

    document.getElementById('cpr-thead').innerHTML = `<tr><th>Date</th><th class="job-address-print">Job Address</th><th>Est ID</th><th>Job Info & Scope</th><th class="text-end">Base Pay</th><th class="text-end">Extras</th><th class="text-end">Deductions</th><th class="text-end">Paid</th><th class="text-end">Balance</th></tr>`;
    const tbody = document.getElementById('cpr-tbody'); tbody.innerHTML = "";
    let grandBase = 0, grandExtras = 0, grandDed = 0, grandPay = 0, grandBal = 0;

    recordsToPrint.forEach(item => {
        const est = allEstimatesCache.find(e => e.estimateId === item.estId); const crew = est.activePayroll[item.crewIdx];
        let sq = parseFloat(est['squares' + crew.section]) || 0;
        let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
        let extras = (crew.costs || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
        let ded = (crew.deductions || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
        let pay = (crew.payments || []).reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
        let bal = (baseCost + extras) - ded - pay;
        
        grandBase += baseCost; grandExtras += extras; grandDed += ded; grandPay += pay; grandBal += bal;
        const dateStr = getSafeTsDateStr(est.timestamp);
        let sqDisplay = sq > 0 ? `Total Sq: ${sq.toFixed(2)}` : 'Flat Rate';
        let scopeDisplay = est.desiredMaterial || 'N/A';
        let laborRateDisplay = `${crew.laborType} | ${sqDisplay} | ${crew.calcType === 'flat' ? 'Flat' : fmt(crew.rate) + '/sq'}`;
        let jobInfoScopePrint = `${scopeDisplay}<br><span style="font-size:10px; color:#555;">${laborRateDisplay}</span>`;
        
        tbody.innerHTML += `
            <tr>
                <td>${dateStr}</td><td class="job-address-print text-truncate" style="max-width: 150px;">${est.custAddress || '-'}</td><td>${est.estimateId}</td><td>${jobInfoScopePrint}</td>
                <td class="text-end">${fmt(baseCost)}</td><td class="text-end">${fmt(extras)}</td><td class="text-end text-danger">${fmt(ded)}</td>
                <td class="text-end text-success">${fmt(pay)}</td><td class="text-end fw-bold">${fmt(bal)}</td>
            </tr>`;
    });

    document.getElementById('cpr-tfoot').innerHTML = `
        <tr>
            <td colspan="4" class="text-end"><strong>GRAND TOTALS:</strong></td>
            <td class="text-end">${fmt(grandBase)}</td><td class="text-end">${fmt(grandExtras)}</td><td class="text-end text-danger">${fmt(grandDed)}</td>
            <td class="text-end text-success">${fmt(grandPay)}</td><td class="text-end fs-6">${fmt(grandBal)}</td>
        </tr>`;
    
    document.getElementById('cpr-title').innerText = "Crew Statement";
    document.getElementById('cpr-date-range').innerText = isSelectionOnly ? "Selected Entries Only" : "All Time";
    document.getElementById('cpr-crew-filter').innerText = crewName;
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('interactiveCrewModal')).hide();
    triggerPayrollPrint('custom');
};

function openManageMultipleModal() {
    const checks = document.querySelectorAll('.multi-manage-chk:checked');
    if(checks.length === 0) return customAlert("Please select at least one payroll record.");
    
    const interactiveCrewModalEl = document.getElementById('interactiveCrewModal');
    if (interactiveCrewModalEl) {
        bootstrap.Modal.getOrCreateInstance(interactiveCrewModalEl).hide();
    }
    
    multiPayrollCols = [];
    checks.forEach(chk => multiPayrollCols.push({ estId: chk.dataset.estid, crewIdx: parseInt(chk.dataset.crewidx) }));
    renderMultiPayrollTable();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('manageMultiplePayrollModal')).show();
}

window.addMultiPayrollColumn = function() { multiPayrollCols.push({estId: null, crewIdx: null}); renderMultiPayrollTable(); };
window.removeMultiPayrollColumn = function(idx) { multiPayrollCols.splice(idx, 1); renderMultiPayrollTable(); };
window.assignMultiPayrollColumn = function(idx, val) {
    if(!val) return; const parsed = JSON.parse(val);
    multiPayrollCols[idx].estId = parsed.estId; multiPayrollCols[idx].crewIdx = parsed.crewIdx; renderMultiPayrollTable();
};

function renderMultiPayrollTable() {
    const container = document.getElementById('multi-payroll-container');
    if (multiPayrollCols.length === 0) {
        container.innerHTML = "<div class='text-center p-4 text-muted'>No payrolls selected. Add a column to begin.</div><div class='text-center'><button class='btn btn-primary' onclick='addMultiPayrollColumn()'>+ ADD MORE COLUMNS</button></div>";
        return;
    }

    let groups = []; let cGroup = null, eGroup = null;
    multiPayrollCols.forEach((col, bIdx) => {
        const est = col.estId ? allEstimatesCache.find(e => e.estimateId === col.estId) : null;
        const crew = est && col.crewIdx !== null ? est.activePayroll[col.crewIdx] : null;

        const cName = crew ? crew.crew : 'Unassigned Crew';
        const eName = est ? `${est.estimateId} - ${est.custAddress || 'No Address'}` : 'Unassigned Job';
        let sName = est ? (est.desiredMaterial || 'N/A') : '-';
        if (crew && crew.section == 1) sName = `Main: ${sName}`; else if (crew && crew.section == 2) sName = `Sec: ${sName}`; else if (crew && crew.isChangeOrder) sName = `CO: ${sName}`;

        if (!cGroup || cGroup.crewName !== cName) { cGroup = { crewName: cName, span: 0, ests: [] }; groups.push(cGroup); eGroup = null; }
        cGroup.span++;

        if (!eGroup || eGroup.estName !== eName) { eGroup = { estName: eName, span: 0, cols: [] }; cGroup.ests.push(eGroup); }
        eGroup.span++;
        eGroup.cols.push({ bIdx, col, est, crew, sName });
    });

    let html = `
    <div class="mb-3 text-end"><button class="btn btn-sm btn-primary fw-bold shadow-sm" onclick="addMultiPayrollColumn()"><i class="mdi mdi-plus"></i> ADD MORE COLUMNS</button></div>
    <div class="bg-white p-0 border shadow-sm" style="overflow-x: auto;">
        <table class="spreadsheet-table w-100" style="min-width: ${200 + (multiPayrollCols.length * 250)}px;">
            <thead><tr><th class="bg-light-gray text-end pe-2 sticky-col border-bottom-0"></th>`;

    groups.forEach(cg => html += `<th colspan="${cg.span}" class="bg-dark text-white text-center border p-2 fs-5">${escapeHtml(cg.crewName)}</th>`);
    html += `</tr><tr><th class="bg-light-gray text-end pe-2 sticky-col border-top-0 border-bottom-0"></th>`;
    groups.forEach(cg => cg.ests.forEach(eg => html += `<th colspan="${eg.span}" class="bg-secondary text-white text-center border p-1" style="font-size:12px;">${escapeHtml(eg.estName)}</th>`));
    html += `</tr><tr><th class="bg-light-gray text-end pe-2 sticky-col border-top-0">Scope / Action:</th>`;
    
    const crewNameFilter = document.getElementById('interactive-crew-picker').value;
    let availableOptions = '<option value="">-- Select Job --</option>';
    allEstimatesCache.forEach(est => {
        if (est.activePayroll) {
            est.activePayroll.forEach((crew, idx) => {
                if(crew.isConfirmed && !crew.isRemoved && crew.crew === crewNameFilter && crew.coType !== 'material') {
                    const already = multiPayrollCols.find(c => c.estId === est.estimateId && c.crewIdx === idx);
                    if(!already) availableOptions += `<option value='{"estId":"${est.estimateId}", "crewIdx":${idx}}'>${est.estimateId} - ${escapeHtml(est.custAddress)}</option>`;
                }
            });
        }
    });

    multiPayrollCols.forEach((col, bIdx) => {
        let item; groups.forEach(cg => cg.ests.forEach(eg => eg.cols.forEach(c => { if(c.bIdx === bIdx) item = c; })));
        if (!col.estId) {
            html += `<th class="bg-light text-center border p-2"><div class="d-flex gap-1"><select class="form-select form-select-sm" onchange='assignMultiPayrollColumn(${bIdx}, this.value)'>${availableOptions}</select><button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="removeMultiPayrollColumn(${bIdx})"><i class="mdi mdi-close"></i></button></div></th>`;
        } else {
            html += `<th class="bg-light text-center border p-2"><div class="d-flex justify-content-between align-items-center"><span class="fw-bold text-primary">${escapeHtml(item.sName)}</span> <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="removeMultiPayrollColumn(${bIdx})"><i class="mdi mdi-close"></i></button></div></th>`;
        }
    });
    html += `</tr></thead><tbody>`;

    const renderRow = (label, labelClass, cellRenderer, extraStyles = "") => {
        let rowHtml = `<tr><td class="${labelClass} text-end pe-2 sticky-col" style="${extraStyles}">${label}</td>`;
        multiPayrollCols.forEach((col, bIdx) => rowHtml += `<td style="min-width: 250px; vertical-align: middle;" class="px-2 position-relative bg-white border">${cellRenderer(col, bIdx)}</td>`);
        rowHtml += `</tr>`; return rowHtml;
    };

    html += renderRow('Previous Job Balance:', 'bg-maroon text-white fw-bold', (col, bIdx) => `<div class="bg-light-pink fw-bold px-2 py-1 text-center border border-dark rounded" id="ss-prev-bal-${bIdx}">$0.00</div>`);
    html += renderRow('Status:', 'bg-light-gray fw-bold', (col, bIdx) => `<span id="ss-status-${bIdx}" class="fw-bold">-</span>`);
    html += `<tr><td colspan="${multiPayrollCols.length + 1}" class="border-0 p-1" style="background: transparent;"></td></tr>`;

    for(let i=0; i<3; i++) {
        html += renderRow(`Labor Note ${i+1}:`, 'bg-light-gray fw-bold', (col, bIdx) => `<input type="text" id="ss-lab-note-${i}-${bIdx}" class="form-control form-control-sm border-0 bg-transparent" placeholder="" onkeyup="calcMultiSpreadsheetTotals(${bIdx})">`);
        html += renderRow(`Labor Cost ${i+1}:`, 'bg-light-gray fw-bold', (col, bIdx) => `<div class="d-flex align-items-center"><span class="text-muted ms-1">$</span><input type="number" id="ss-lab-amt-${i}-${bIdx}" step="0.01" class="form-control form-control-sm border-0 bg-transparent fw-bold" placeholder="" onkeyup="calcMultiSpreadsheetTotals(${bIdx})" onchange="calcMultiSpreadsheetTotals(${bIdx})"></div>`);
    }
    html += renderRow('Total Labor Cost:', 'bg-dark-green text-white fw-bold', (col, bIdx) => `<div class="bg-light-pink text-center fw-bold align-middle py-1 border border-dark rounded" id="ss-lab-total-${bIdx}">$0.00</div>`);
    html += `<tr><td colspan="${multiPayrollCols.length + 1}" class="border-0 p-1" style="background: transparent;"></td></tr>`;

    for(let i=0; i<3; i++) {
        html += renderRow(`Deduction Note ${i+1}:`, 'bg-maroon text-white fw-bold', (col, bIdx) => `<input type="text" id="ss-ded-note-${i}-${bIdx}" class="form-control form-control-sm border-0 bg-transparent" placeholder="">`);
        html += renderRow(`Deduction Amt ${i+1}:`, 'bg-maroon text-white fw-bold', (col, bIdx) => `<div class="d-flex align-items-center"><span class="text-muted ms-1">$</span><input type="number" id="ss-ded-amt-${i}-${bIdx}" step="0.01" class="form-control form-control-sm border-0 bg-transparent text-danger fw-bold" placeholder="" onkeyup="calcMultiSpreadsheetTotals(${bIdx})" onchange="calcMultiSpreadsheetTotals(${bIdx})"></div>`);
    }
    html += renderRow('Total Deductions:', 'bg-maroon text-white fw-bold', (col, bIdx) => `<div class="bg-light-pink text-center fw-bold align-middle py-1 border border-dark rounded" id="ss-ded-total-${bIdx}">$0.00</div>`);
    html += `<tr><td colspan="${multiPayrollCols.length + 1}" class="border-0 p-1" style="background: transparent;"></td></tr>`;

    for(let i=0; i<3; i++) {
        html += renderRow(`Payment Note ${i+1}:`, 'bg-light-gray fw-bold', (col, bIdx) => `<input type="text" id="ss-pay-note-${i}-${bIdx}" class="form-control form-control-sm border-0 bg-transparent" placeholder="">`);
        html += renderRow(`Payment Amt ${i+1}:`, 'bg-light-gray fw-bold', (col, bIdx) => `<div class="d-flex align-items-center"><span class="text-muted ms-1">$</span><input type="number" id="ss-pay-amt-${i}-${bIdx}" step="0.01" class="form-control form-control-sm border-0 bg-transparent text-success fw-bold" placeholder="" onkeyup="calcMultiSpreadsheetTotals(${bIdx})" onchange="calcMultiSpreadsheetTotals(${bIdx})"></div>`);
        html += renderRow(`Payment Date ${i+1}:`, 'bg-light-gray fw-bold', (col, bIdx) => `<input type="date" id="ss-pay-date-${i}-${bIdx}" class="form-control form-control-sm border-0 bg-transparent text-muted date-input">`);
    }
    html += renderRow('Total Amount Paid:', 'bg-dark-green text-white fw-bold', (col, bIdx) => `<div class="bg-light-pink text-center fw-bold align-middle py-1 border border-dark rounded" id="ss-pay-total-${bIdx}">$0.00</div>`);
    html += `<tr><td colspan="${multiPayrollCols.length + 1}" class="border-0 p-1" style="background: transparent;"></td></tr>`;
    html += renderRow('Balance:', 'bg-maroon text-white fw-bold fs-6', (col, bIdx) => `<div id="ss-final-bal-${bIdx}" class="px-2 py-1 bg-light-pink text-dark fw-bold text-center fs-6 border border-dark rounded">$0.00</div>`);
    html += renderRow('<div class="text-center py-2">ADDITIONAL NOTE(S)</div>', 'bg-light-gray fw-bold align-top', (col, bIdx) => `<textarea id="ss-general-notes-${bIdx}" class="w-100 border p-2 outline-none rounded" rows="4" style="resize:none; font-size:13px; background: #fafafa;" placeholder="Type specific notes here..."></textarea>`);

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    multiPayrollCols.forEach((col, bIdx) => { if(col.estId && col.crewIdx !== null) populateMultiPayrollColumn(col, bIdx); });
}

function populateMultiPayrollColumn(col, bIdx) {
    const est = allEstimatesCache.find(e => e.estimateId === col.estId); if(!est) return;
    const crew = est.activePayroll[col.crewIdx]; if(!crew) return;

    let sq = parseFloat(est['squares' + crew.section]) || 0;
    let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
    const prevBalance = calculateCrewPreviousBalance(crew.crew, est.estimateId, col.crewIdx);

    document.getElementById(`ss-prev-bal-${bIdx}`).innerText = fmt(prevBalance);
    const statusEl = document.getElementById(`ss-status-${bIdx}`); if (statusEl) statusEl.innerText = crew.paymentStatus || 'Unpaid';

    const labNote0 = document.getElementById(`ss-lab-note-0-${bIdx}`); const labAmt0 = document.getElementById(`ss-lab-amt-0-${bIdx}`);
    if(labNote0) { labNote0.value = `Base: ${crew.laborType}`; labNote0.readOnly = true; labNote0.classList.add('fw-bold'); labNote0.style.color = "#000"; }
    if(labAmt0) { labAmt0.value = baseCost.toFixed(2); labAmt0.readOnly = true; labAmt0.classList.add('fw-bold'); labAmt0.style.color = "#000"; }

    if (crew.costs) crew.costs.forEach((x, i) => { if(i < 2) { let note = document.getElementById(`ss-lab-note-${i+1}-${bIdx}`); if(note) note.value = x.note; let amt = document.getElementById(`ss-lab-amt-${i+1}-${bIdx}`); if(amt) amt.value = x.amount; } });
    if (crew.deductions) crew.deductions.forEach((x, i) => { if(i <= 2) { let note = document.getElementById(`ss-ded-note-${i}-${bIdx}`); if(note) note.value = x.note; let amt = document.getElementById(`ss-ded-amt-${i}-${bIdx}`); if(amt) amt.value = x.amount; } });
    if (crew.payments) crew.payments.forEach((x, i) => { if(i <= 2) { let note = document.getElementById(`ss-pay-note-${i}-${bIdx}`); if(note) note.value = x.note; let amt = document.getElementById(`ss-pay-amt-${i}-${bIdx}`); if(amt) amt.value = x.amount; let date = document.getElementById(`ss-pay-date-${i}-${bIdx}`); if(date) date.value = x.date || ""; } });

    let genNotes = document.getElementById(`ss-general-notes-${bIdx}`); if(genNotes) genNotes.value = crew.generalNotes || "";
    calcMultiSpreadsheetTotals(bIdx);
}

function calcMultiSpreadsheetTotals(bIdx) {
    let totalLab = 0, totalDed = 0, totalPay = 0;

    for(let i=0; i<=2; i++) {
        let amtInput = document.getElementById(`ss-lab-amt-${i}-${bIdx}`); if(amtInput) totalLab += parseFloat(amtInput.value) || 0;
        let dedInput = document.getElementById(`ss-ded-amt-${i}-${bIdx}`); if(dedInput) totalDed += parseFloat(dedInput.value) || 0;
        let payInput = document.getElementById(`ss-pay-amt-${i}-${bIdx}`); if(payInput) totalPay += parseFloat(payInput.value) || 0;
    }

    const labTot = document.getElementById(`ss-lab-total-${bIdx}`); if(labTot) labTot.innerText = fmt(totalLab);
    const dedTot = document.getElementById(`ss-ded-total-${bIdx}`); if(dedTot) dedTot.innerText = fmt(totalDed);
    const payTot = document.getElementById(`ss-pay-total-${bIdx}`); if(payTot) payTot.innerText = fmt(totalPay);

    const prevBalEl = document.getElementById(`ss-prev-bal-${bIdx}`); const prevBal = prevBalEl ? parseMoney(prevBalEl.innerText) : 0;
    const bal = prevBal + totalLab - totalDed - totalPay;
    const balEl = document.getElementById(`ss-final-bal-${bIdx}`); if(balEl) balEl.innerText = fmt(bal);
}

async function saveManageMultiplePayroll() {
    const btn = document.getElementById('btnSaveMultiManage'); const origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...'; btn.disabled = true;

    try {
        let updates = [];
        multiPayrollCols.forEach((item, bIdx) => {
            if(!item.estId || item.crewIdx === null) return;
            const est = allEstimatesCache.find(e => e.estimateId === item.estId); if(!est) return;
            const crew = est.activePayroll[item.crewIdx];
            
            let newCosts = [];
            for(let i=1; i<=2; i++) { let amtEl = document.getElementById(`ss-lab-amt-${i}-${bIdx}`); let noteEl = document.getElementById(`ss-lab-note-${i}-${bIdx}`); if(amtEl && noteEl) { let amt = parseFloat(amtEl.value); let note = noteEl.value; if(amt) newCosts.push({amount: amt, note: note || "Extra Labor"}); } }
            
            let newDeds = [];
            for(let i=0; i<=2; i++) { let amtEl = document.getElementById(`ss-ded-amt-${i}-${bIdx}`); let noteEl = document.getElementById(`ss-ded-note-${i}-${bIdx}`); if(amtEl && noteEl) { let amt = parseFloat(amtEl.value); let note = noteEl.value; if(amt) newDeds.push({amount: amt, note: note || "Deduction"}); } }
            
            let newPays = [];
            let latestDate = "";
            for(let i=0; i<=2; i++) { let amtEl = document.getElementById(`ss-pay-amt-${i}-${bIdx}`); let noteEl = document.getElementById(`ss-pay-note-${i}-${bIdx}`); let dateEl = document.getElementById(`ss-pay-date-${i}-${bIdx}`); if(amtEl && noteEl && dateEl) { let amt = parseFloat(amtEl.value); let note = noteEl.value; let date = dateEl.value; if(amt) { newPays.push({amount: amt, note: note || "Payment", date: date}); if(date) latestDate = date; } } }

            crew.costs = newCosts; crew.deductions = newDeds; crew.payments = newPays;
            if (latestDate) crew.paymentDate = latestDate;
            let genNotes = document.getElementById(`ss-general-notes-${bIdx}`); crew.generalNotes = genNotes ? genNotes.value : "";

            let sq = parseFloat(est['squares' + crew.section]) || 0;
            let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
            let ext = newCosts.reduce((s,x)=>s+x.amount, 0); let ded = newDeds.reduce((s,x)=>s+x.amount, 0); let pay = newPays.reduce((s,x)=>s+x.amount, 0);
            
            let bal = (baseCost + ext) - ded - pay;
            crew.paymentStatus = (bal <= 0) ? 'Paid in Full (PIF)' : (pay > 0 ? 'Partial Payment (PP)' : 'Unpaid');
            if(!updates.includes(est)) updates.push(est);
        });

        if(db) {
            for (const est of updates) await db.collection('estimates').doc(est.id).update({ activePayroll: est.activePayroll });
            await customAlert("All Selected Payrolls Updated Successfully!");
        } else await customAlert("Offline: Saved to memory (session only).");

        bootstrap.Modal.getOrCreateInstance(document.getElementById('manageMultiplePayrollModal')).hide();
        document.querySelectorAll('.multi-select-col').forEach(c => c.classList.add('d-none'));
        document.getElementById('btnMultiManage').innerHTML = "<i class='mdi mdi-format-list-checks'></i> Manage Multiple Payroll";
        document.getElementById('btnPrintSelectMode').classList.remove('d-none');
        const btnConfirm = document.getElementById('btnConfirmMultiManage'); if(btnConfirm) btnConfirm.classList.add('d-none');

        loadInteractiveCrewDashboard(); loadPayrollView();

    } catch(e) { await customAlert("Error saving multiple payrolls: " + e.message); } 
    finally { btn.innerHTML = origHtml; btn.disabled = false; }
}

function triggerPayrollPrint(type) {
    document.body.className = ''; 
    const pc1 = document.getElementById('payroll-print-container'); 
    const pc2 = document.getElementById('custom-payroll-print-container'); 
    const pc3 = document.getElementById('master-ledger-print-container'); 
    const comm1 = document.getElementById('commission-print-container');
    const pc4 = document.getElementById('master-comm-ledger-print-container');
    const pc5 = document.getElementById('custom-comm-print-container');
    
    if (pc1) pc1.style.display = 'none'; if (pc2) pc2.style.display = 'none'; if (pc3) pc3.style.display = 'none'; 
    if (comm1) comm1.style.display = 'none'; if (pc4) pc4.style.display = 'none'; if (pc5) pc5.style.display = 'none';
    
    if (type === 'custom') {
        document.body.classList.add('print-payroll', 'print-layout-custom'); document.title = "Custom_Payroll_Report";
        if (pc2) pc2.style.display = 'block';
    } else if (type === 'pdf') {
        document.body.classList.add('print-payroll', 'print-layout-pdf'); document.getElementById('print-layout-title').innerText = "Detailed Payroll Report"; document.title = "Payroll_Report";
        if (pc1) pc1.style.display = 'block';
    } else if (type === 'record') {
        document.body.classList.add('print-payroll', 'print-layout-record'); document.getElementById('print-layout-title').innerText = "Payroll Record"; document.title = "Payroll_Record";
        if (pc1) pc1.style.display = 'block';
    } else if (type === 'card') {
        document.body.classList.add('print-payroll', 'print-layout-card'); document.getElementById('print-layout-title').innerText = "Crew Payout Slip"; document.title = "Crew_Payout_Slip";
        if (pc1) pc1.style.display = 'block';
    } else if (type === 'master_ledger') {
        document.body.classList.add('print-payroll', 'print-layout-master'); document.title = "Master_Payroll_Ledger";
        if (pc3) pc3.style.display = 'block';
    } else if (type === 'commission') {
        document.body.classList.add('print-commission'); document.title = "Commission_Statement";
        if (comm1) comm1.style.display = 'block';
    } else if (type === 'master_comm_ledger') {
        document.body.classList.add('print-payroll', 'print-layout-master-comm'); document.title = "Master_Commission_Ledger";
        if (pc4) pc4.style.display = 'block';
    } else if (type === 'custom_comm') {
        document.body.classList.add('print-payroll', 'print-layout-custom-comm'); document.title = "Custom_Commission_Report";
        if (pc5) pc5.style.display = 'block';
    }
    
    ['payrollCardModal', 'managePayrollModal', 'manageMultiplePayrollModal', 'salesReportModal', 'generateReportsWizardModal', 'interactiveCrewModal', 'interactiveRepModal', 'generateCommReportsWizardModal', 'manageCommissionModal'].forEach(id => {
        const el = document.getElementById(id); if(el) { const m = bootstrap.Modal.getOrCreateInstance(el); if(m) m.hide(); }
    });

    window.print();
    
    setTimeout(() => {
        document.body.className = ''; document.title = "Rooster Roofing App v18";
        if (pc1) pc1.style.display = 'none'; if (pc2) pc2.style.display = 'none'; if (pc3) pc3.style.display = 'none'; 
        if (comm1) comm1.style.display = 'none'; if (pc4) pc4.style.display = 'none'; if (pc5) pc5.style.display = 'none';
        const activeNavEls = document.querySelectorAll('.sidebar .nav-link.active');
        if (activeNavEls.length > 0) { const currentView = activeNavEls[0].id.replace('nav-', ''); forceSwitchView(currentView === 'payroll-ledger' ? 'payroll' : currentView); }
    }, 1000);
}

function populatePayrollPrintContainer(estId, crewIdx, scopeText) {
    const est = allEstimatesCache.find(e => e.estimateId === estId); if (!est) return false;
    const crew = est.activePayroll[crewIdx]; if (!crew) return false;

    let sq = parseFloat(est['squares' + crew.section]) || 0;
    let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);

    const extras = (crew.costs || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const deductions = (crew.deductions || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const payments = (crew.payments || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

    const totalLabor = baseCost + extras;
    const prevBalance = calculateCrewPreviousBalance(crew.crew, est.estimateId, crewIdx);
    const balance = prevBalance + (totalLabor - deductions - payments);

    let status = 'Draft (Not Ready)';
    if (balance <= 0) status = 'Completed'; else if (payments > 0 || deductions > 0 || prevBalance > 0) status = 'Unpaid Balance';

    document.getElementById('ps-crew-name').innerText = crew.crew; document.getElementById('ps-prev-bal').innerText = fmt(prevBalance);
    document.getElementById('ps-status').innerText = status; document.getElementById('ps-address').innerText = est.custAddress || 'No Address';
    document.getElementById('ps-scope').innerText = scopeText || est.desiredMaterial || 'N/A'; document.getElementById('ps-gen-date').innerText = new Date().toLocaleDateString();

    let labNote = crew.calcType === 'flat' ? `${crew.laborType} - Flat Rate - ${fmt(crew.rate)}` : `${crew.laborType} - ${sq.toFixed(2)} Sq - ${fmt(crew.rate)}/Sq`;
    const labRows = document.getElementById('ps-labor-rows');
    labRows.innerHTML = `<div class="sheet-row"><div class="sheet-note fw-bold">${labNote}</div><div class="sheet-amt">${fmt(baseCost)}</div></div>`;
    (crew.costs || []).forEach(c => labRows.innerHTML += `<div class="sheet-row"><div class="sheet-note">Extra: ${c.note}</div><div class="sheet-amt">${fmt(c.amount)}</div></div>`);

    const dedRows = document.getElementById('ps-deduct-rows'); dedRows.innerHTML = '';
    if((crew.deductions || []).length === 0) dedRows.innerHTML = `<div class="sheet-row"><div class="sheet-note text-muted">No deductions</div><div class="sheet-amt">-</div></div>`;
    (crew.deductions || []).forEach(d => dedRows.innerHTML += `<div class="sheet-row"><div class="sheet-note">${d.note}</div><div class="sheet-amt text-danger">-${fmt(d.amount)}</div></div>`);

    const payRows = document.getElementById('ps-payment-rows'); payRows.innerHTML = '';
    if((crew.payments || []).length === 0) payRows.innerHTML = `<div class="sheet-row"><div class="sheet-note text-muted">No payments</div><div class="sheet-amt">-</div></div>`;
    (crew.payments || []).forEach(p => payRows.innerHTML += `<div class="sheet-row"><div class="sheet-note">${p.date} - ${p.note}</div><div class="sheet-amt text-success">-${fmt(p.amount)}</div></div>`);

    document.getElementById('ps-tot-lab').innerText = fmt(totalLabor); document.getElementById('ps-tot-ded').innerText = fmt(deductions);
    document.getElementById('ps-tot-pay').innerText = fmt(payments); document.getElementById('ps-final-bal').innerText = fmt(balance);
    document.getElementById('ps-gen-notes').innerText = crew.generalNotes || 'None';
    return true;
}

async function openPayrollCardModal(estId, crewName, crewIdx) {
    const est = allEstimatesCache.find(e => e.estimateId === estId); if (!est) return await customAlert("Estimate not found");
    const crew = est.activePayroll[crewIdx]; if (!crew) return await customAlert("Crew record not found");

    let baseCost = 0;
    if (crew.calcType === 'flat') baseCost = crew.rate;
    else { const sq = parseFloat(est['squares' + crew.section]) || 0; baseCost = sq * crew.rate; }

    const extras = (crew.costs || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const deductions = (crew.deductions || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const payments = (crew.payments || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const totalLabor = baseCost + extras; const balance = totalLabor - deductions - payments;

    let status = 'Unpaid'; if(balance <= 0) status = 'Paid in Full (PIF)'; else if(payments > 0) status = 'Partial Payment (PP)';

    document.getElementById('card-crew-name').innerText = crew.crew; document.getElementById('card-date').innerText = new Date().toLocaleDateString();
    document.getElementById('card-status-badge').innerText = status; document.getElementById('card-status-badge').className = `badge ${status === 'Paid in Full (PIF)' ? 'bg-success' : (status === 'Partial Payment (PP)' ? 'bg-info' : 'bg-warning text-dark')}`;
    document.getElementById('card-job-address').innerText = est.custAddress || 'No Address'; document.getElementById('card-job-scope').innerText = est.desiredMaterial || 'No Scope';
    
    document.getElementById('card-total-labor').innerText = fmt(totalLabor); document.getElementById('card-total-deduct').innerText = fmt(deductions);
    document.getElementById('card-total-paid').innerText = fmt(payments); document.getElementById('card-balance').innerText = fmt(balance);

    document.getElementById('btnCardManage').onclick = function() { bootstrap.Modal.getOrCreateInstance(document.getElementById('payrollCardModal')).hide(); openManagePayrollModal(estId, crewIdx); };
    document.getElementById('btnCardPrint').onclick = function() { if(populatePayrollPrintContainer(estId, crewIdx, est.desiredMaterial || "Roof Replacement")) triggerPayrollPrint('card'); };

    bootstrap.Modal.getOrCreateInstance(document.getElementById('payrollCardModal')).show();
}

function calcSpreadsheetTotals() {
    let totalLab = 0, totalDed = 0, totalPay = 0;

    for(let i=0; i<=2; i++) {
        let amtInput = document.getElementById('ss-lab-amt-'+i); if(amtInput) totalLab += parseFloat(amtInput.value) || 0;
        let dedInput = document.getElementById('ss-ded-amt-'+i); if(dedInput) totalDed += parseFloat(dedInput.value) || 0;
        let payInput = document.getElementById('ss-pay-amt-'+i); if(payInput) totalPay += parseFloat(payInput.value) || 0;
    }

    document.getElementById('ss-lab-total').innerText = fmt(totalLab); document.getElementById('ss-ded-total').innerText = fmt(totalDed); document.getElementById('ss-pay-total').innerText = fmt(totalPay);
    document.getElementById('ss-final-lab').innerText = fmt(totalLab); document.getElementById('ss-final-ded').innerText = fmt(totalDed); document.getElementById('ss-final-pay').innerText = fmt(totalPay);

    const prevBal = parseMoney(document.getElementById('ss-prev-bal').innerText);
    const bal = prevBal + totalLab - totalDed - totalPay; document.getElementById('ss-final-bal').innerText = fmt(bal);
}

function openManagePayrollModal(estId, crewIdx) {
    manageEstId = estId; manageCrewIdx = crewIdx;
    const est = allEstimatesCache.find(e => e.estimateId === estId); if (!est) return;
    const crew = est.activePayroll[crewIdx]; if (!crew) return;

    let sq = parseFloat(est['squares' + crew.section]) || 0; let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
    const prevBalance = calculateCrewPreviousBalance(crew.crew, est.estimateId, crewIdx);

    document.getElementById('ss-prev-bal').innerText = fmt(prevBalance); document.getElementById('ss-est-id').innerText = est.estimateId || '-';
    document.getElementById('ss-status').innerText = crew.paymentStatus || 'Unpaid'; document.getElementById('ss-crew-name').innerText = crew.crew || '-';
    document.getElementById('ss-address').innerText = est.custAddress || 'No Address'; document.getElementById('ss-scope').innerText = est.desiredMaterial || 'N/A';

    for(let i=1; i<=2; i++) { let note = document.getElementById('ss-lab-note-'+i); if(note) note.value = ""; let amt = document.getElementById('ss-lab-amt-'+i); if(amt) amt.value = ""; }
    for(let i=0; i<=2; i++) {
        let dnote = document.getElementById('ss-ded-note-'+i); if(dnote) dnote.value = ""; let damt = document.getElementById('ss-ded-amt-'+i); if(damt) damt.value = "";
        let pnote = document.getElementById('ss-pay-note-'+i); if(pnote) pnote.value = ""; let pamt = document.getElementById('ss-pay-amt-'+i); if(pamt) pamt.value = ""; let pdate = document.getElementById('ss-pay-date-'+i); if(pdate) pdate.value = "";
    }

    const labNote0 = document.getElementById('ss-lab-note-0'); const labAmt0 = document.getElementById('ss-lab-amt-0');
    if(labNote0) { labNote0.value = `Base: ${crew.laborType}`; labNote0.readOnly = true; }
    if(labAmt0) { labAmt0.value = baseCost.toFixed(2); labAmt0.readOnly = true; }

    if (crew.costs) crew.costs.forEach((x, i) => { if(i < 2) { let note = document.getElementById('ss-lab-note-'+(i+1)); if(note) note.value = x.note; let amt = document.getElementById('ss-lab-amt-'+(i+1)); if(amt) amt.value = x.amount; } });
    if (crew.deductions) crew.deductions.forEach((x, i) => { if(i <= 2) { let note = document.getElementById('ss-ded-note-'+i); if(note) note.value = x.note; let amt = document.getElementById('ss-ded-amt-'+i); if(amt) amt.value = x.amount; } });
    if (crew.payments) crew.payments.forEach((x, i) => { if(i <= 2) { let note = document.getElementById('ss-pay-note-'+i); if(note) note.value = x.note; let amt = document.getElementById('ss-pay-amt-'+i); if(amt) amt.value = x.amount; let date = document.getElementById('ss-pay-date-'+i); if(date) date.value = x.date || ""; } });

    let genNotes = document.getElementById('ss-general-notes'); if(genNotes) genNotes.value = crew.generalNotes || "";
    
    calcSpreadsheetTotals();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('managePayrollModal')).show();
}

async function saveManagePayroll() {
    if(!manageEstId) return;
    const est = allEstimatesCache.find(e => e.estimateId === manageEstId); if(!est) return;
    const crew = est.activePayroll[manageCrewIdx];
    
    let newCosts = [];
    for(let i=1; i<=2; i++) { let amtEl = document.getElementById('ss-lab-amt-'+i); let noteEl = document.getElementById('ss-lab-note-'+i); if(amtEl && noteEl) { let amt = parseFloat(amtEl.value); let note = noteEl.value; if(amt) newCosts.push({amount: amt, note: note || "Extra Labor"}); } }
    
    let newDeds = [];
    for(let i=0; i<=2; i++) { let amtEl = document.getElementById('ss-ded-amt-'+i); let noteEl = document.getElementById('ss-ded-note-'+i); if(amtEl && noteEl) { let amt = parseFloat(amtEl.value); let note = noteEl.value; if(amt) newDeds.push({amount: amt, note: note || "Deduction"}); } }
    
    let newPays = [];
    let latestDate = "";
    for(let i=0; i<=2; i++) { let amtEl = document.getElementById('ss-pay-amt-'+i); let noteEl = document.getElementById('ss-pay-note-'+i); let dateEl = document.getElementById('ss-pay-date-'+i); if(amtEl && noteEl && dateEl) { let amt = parseFloat(amtEl.value); let note = noteEl.value; let date = dateEl.value; if(amt) { newPays.push({amount: amt, note: note || "Payment", date: date}); if(date) latestDate = date; } } }

    crew.costs = newCosts; crew.deductions = newDeds; crew.payments = newPays;
    if (latestDate) crew.paymentDate = latestDate;
    let genNotes = document.getElementById('ss-general-notes'); crew.generalNotes = genNotes ? genNotes.value : "";

    let sq = parseFloat(est['squares' + crew.section]) || 0; let baseCost = (crew.calcType === 'flat') ? crew.rate : (sq * crew.rate);
    let ext = newCosts.reduce((s,x)=>s+x.amount, 0); let ded = newDeds.reduce((s,x)=>s+x.amount, 0); let pay = newPays.reduce((s,x)=>s+x.amount, 0);
    
    let bal = (baseCost + ext) - ded - pay; crew.paymentStatus = (bal <= 0) ? 'Paid in Full (PIF)' : (pay > 0 ? 'Partial Payment (PP)' : 'Unpaid');
    
    if(db) {
        try {
            await db.collection('estimates').doc(est.id).update({ activePayroll: est.activePayroll }); await customAlert("Payroll Updated Successfully!");
            bootstrap.Modal.getOrCreateInstance(document.getElementById('managePayrollModal')).hide(); loadInteractiveCrewDashboard(); loadPayrollView();
        } catch(e) { await customAlert("Error saving: " + e.message); }
    } else {
         await customAlert("Offline: Saved to memory (session only).");
         bootstrap.Modal.getOrCreateInstance(document.getElementById('managePayrollModal')).hide(); loadInteractiveCrewDashboard(); loadPayrollView();
    }
}

function generateStandardFilename(data) {
    const scope = data.desiredMaterial ? data.desiredMaterial.trim() : "Roof Estimate";
    const address = data.custAddress ? data.custAddress.trim() : "No Address";
    const name = data.custName ? data.custName.trim() : "Unknown";
    const id = data.estimateId ? data.estimateId : "Draft (Not Ready)";
    return `${scope}_${address} - ${name}_${id}`.replace(/[/\\?%*:|"<>]/g, '-');
}

function printSummary(type) {
   document.body.classList.remove('print-main', 'print-sec', 'print-combined', 'print-payroll', 'print-commission', 'print-all', 'print-layout-pdf', 'print-layout-record', 'print-layout-card', 'print-layout-master', 'print-layout-master-comm', 'print-layout-custom-comm', 'print-layout-custom');
   document.body.classList.add('print-' + type);
   
   let pageStyle = document.getElementById('dynamic-print-style');
   if (!pageStyle) { pageStyle = document.createElement('style'); pageStyle.id = 'dynamic-print-style'; document.head.appendChild(pageStyle); }
   pageStyle.innerHTML = type === 'all' ? '@media print { @page { size: landscape; margin: 0.25in; } }' : '@media print { @page { size: portrait; margin: 0.25in; } }';

   const name = document.getElementById('custName').value || "Guest"; const addr = document.getElementById('custAddress').value || "";
   const id = document.getElementById('estimateId').value || ""; const date = document.getElementById('datePicker').value || new Date().toLocaleDateString();
   
   document.getElementById('printCustomerInfo').innerHTML = `<strong>Customer:</strong> ${name}<br><strong>Address:</strong> ${addr}<br><strong>Estimate ID:</strong> ${id} | <strong>Date:</strong> ${date}`;

   const originalTitle = document.title; const currentData = harvestData();
   currentData.estimateId = id; currentData.custName = name; currentData.custAddress = addr; currentData.desiredMaterial = document.getElementById('desiredMaterial').value;
   
   document.title = generateStandardFilename(currentData); window.print();
   setTimeout(() => { document.title = originalTitle; }, 1000);
}

function handleHtmlImport(input) {
   const file = input.files[0]; if(!file) return;
   const reader = new FileReader();
   reader.onload = async function(e) {
       const modalEl = document.getElementById('duplicateOptionsModal'); if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
       const content = e.target.result; const regex = /window\.ESTIMATE_BACKUP\s*=\s*(\{.*?\});/s; const match = content.match(regex);
       if(match && match[1]) {
           try {
               const data = JSON.parse(match[1]);
               if(data.settings) {
                    if(data.settings.materialGroups) materialGroups = data.settings.materialGroups;
                    if(data.settings.laborMain) laborMain = data.settings.laborMain;
                    if(data.settings.extrasList) extrasList = data.settings.extrasList;
                    if(data.settings.crewOptions) crewOptions = data.settings.crewOptions;
                    if(data.settings.repOptions) repOptions = data.settings.repOptions;
                    if(data.settings.estimateStatuses) estimateStatuses = data.settings.estimateStatuses;
                    if(data.settings.leadSourceOptions) { leadSourceOptions = data.settings.leadSourceOptions; ensureLeadSourceObjects(); }
                    populateDropdowns(); renderExtrasCalculator();
               }

               if(await customConfirm(`Import Estimate for ${data.customer?.name || 'Unknown'}? This will generate a NEW Estimate ID.`)) {
                   if(data.customer) { document.getElementById('custName').value = data.customer.name; onCustomerSelect(data.customer.name); }
                   if(data.estimate) {
                       restoreJob(data.estimate);
                       setTimeout(async () => { generateSharedEstimateID(); document.getElementById('estimateStatus').value = "Draft (Not Ready)"; calculate(); await customAlert("Success: Data imported and NEW Estimate ID generated."); }, 200);
                   }
               }
           } catch(err) { await customAlert("Error parsing backup file: " + err.message); }
       } else { await customAlert("Invalid backup file. Could not find estimate data."); }
   };
   reader.readAsText(file); input.value = '';
}

async function generateSharedEstimateID() {
 if(!db) return;
 const year = new Date().getFullYear().toString().substr(-2);
 const counterRef = db.collection('settings').doc('global_counter');
 try {
     const newIdNum = await db.runTransaction(async (t) => {
         const doc = await t.get(counterRef); let newCount = 100000;
         if(doc.exists) newCount = doc.data().current_count + 1;
         t.set(counterRef, { current_count: newCount }); return newCount;
     });
     document.getElementById('estimateId').value = `RR${year}-${newIdNum}`;
 } catch(e) {}
}

function listenToEstimates() {
  return new Promise((resolve) => {
      if(!db) return resolve();
      let isFirstLoad = true;
      db.collection('estimates').orderBy('timestamp', 'desc')
        .onSnapshot(snap => {
            allEstimatesCache = []; snap.forEach(doc => allEstimatesCache.push({ id: doc.id, ...doc.data() }));
            renderDashboard(); loadCustomerDB(); loadCommissionsView(); loadPayrollView(); loadFromCloud();
            if(isFirstLoad) { isFirstLoad = false; resolve(); }
        }, err => { console.error("Estimates listener error:", err); if(isFirstLoad) resolve(); });
  });
}

function listenToCustomers() {
  return new Promise((resolve) => {
      if(!db) return resolve();
      let isFirstLoad = true;
      db.collection('customers').orderBy('timestamp', 'desc')
        .onSnapshot(snap => {
            allCustomersCache = []; const list = document.getElementById('customerList'); if(list) list.innerHTML = "";
            snap.forEach(doc => {
                const c = doc.data(); allCustomersCache.push({ id: doc.id, ...c });
                let addrs = []; if (c.address) addrs.push(c.address);
                if (c.addresses && Array.isArray(c.addresses)) c.addresses.forEach(a => { if(a.fullAddress && !addrs.includes(a.fullAddress)) addrs.push(a.fullAddress); });

                if (addrs.length === 0) { if(list) list.innerHTML += `<option value="${c.name}">`; } 
                else addrs.forEach(addr => { if(list) list.innerHTML += `<option value="${c.name} | ${addr}">`; });
            });
            loadCustomerDB();
            if(isFirstLoad) { isFirstLoad = false; resolve(); }
        }, err => { console.error("Customers listener error:", err); if(isFirstLoad) resolve(); });
  });
}

function onCustomerSelect(val) {
   const parts = val.split(' | '); const actualName = parts[0].trim(); const actualAddr = parts[1] ? parts[1].trim() : null;
   const cust = allCustomersCache.find(c => c.name === actualName);

   if (cust) {
       document.getElementById('custName').value = cust.name; document.getElementById('selectedCustomerId').value = cust.id;
       const primaryEmail = cust.emails && cust.emails.length > 0 ? cust.emails[0] : (cust.email || '');
       const primaryPhone = cust.phones && cust.phones.length > 0 ? cust.phones[0] : (cust.phone || '');
       document.getElementById('custEmail').value = primaryEmail; document.getElementById('custPhone').value = primaryPhone;
       
       let targetAddr = { street: cust.street || '', city: cust.city || '', state: cust.state || '', zip: cust.zip || '', address: cust.address || '' };
       if (actualAddr) {
           if (cust.address === actualAddr) { } 
           else if (cust.addresses) { const found = cust.addresses.find(a => a.fullAddress === actualAddr); if (found) targetAddr = found; }
       } else if (cust.addresses && cust.addresses.length > 0) targetAddr = cust.addresses[0];
       
       document.getElementById('custAddress').value = targetAddr.fullAddress || targetAddr.address;
       document.getElementById('custCity').value = targetAddr.city; document.getElementById('custState').value = targetAddr.state; document.getElementById('custZip').value = targetAddr.zip;
   } else document.getElementById('selectedCustomerId').value = "";
}

async function saveAndBackup() {
    const btn = document.getElementById('btnSaveAndBackup'); const originalText = btn.innerHTML;
    btn.innerHTML = "<div class='spinner-border spinner-border-sm'></div> Saving Webpage..."; btn.disabled = true;

    try {
        if(db) {
            try { await saveToCloud(true); } 
            catch(e) { console.warn("Cloud save failed, proceeding to backup", e); if(!await customConfirm("Cloud Save Failed (Offline?). Do you want to continue downloading the Local Backup file?")) { btn.innerHTML = originalText; btn.disabled = false; return; } }
        } else console.warn("Offline Mode: Skipping Cloud Save");
        
        const id = document.getElementById('estimateId').value || "Draft (Not Ready)"; await downloadBackup(id);
        btn.innerHTML = originalText; btn.disabled = false;
    } catch(e) { await customAlert("Error during Save & Backup: " + e.message); btn.innerHTML = originalText; btn.disabled = false; }
}

async function saveToCloud(suppressAlert = false) {
  if(!db) throw new Error("No Database Connection");
  
  const estId = document.getElementById('estimateId').value;
  if(!estId) { if(!suppressAlert) await customAlert("Missing ID"); return; }
  
  let data = harvestData();
  data.totalRevenue = parseMoney(document.getElementById('c_grand').innerText); data.status = document.getElementById('estimateStatus').value;
  data.customerId = document.getElementById('selectedCustomerId').value; data.activeSalesReps = activeSalesReps; data.activePayroll = activePayroll; 
  data.totalProfit = parseMoney(document.getElementById('c_total_profit').innerText); data.totalSalesComm = parseMoney(document.getElementById('c_comm').innerText);

  data.c_main = parseMoney(document.getElementById('c_main').innerText); data.c_sec = parseMoney(document.getElementById('c_sec').innerText);
  data.c_lic_fee_amt = parseMoney(document.getElementById('c_lic_fee_amt').innerText); data.c_lead_fee = parseMoney(document.getElementById('c_lead_fee').innerText);
  data.c_actual_profit = parseMoney(document.getElementById('c_actual_profit').innerText); data.c_costPerSq = parseMoney(document.getElementById('c_costPerSq').innerText);

  let currentCreator = document.getElementById('createdBy').value;
  const existingEst = allEstimatesCache.find(e => e.estimateId === estId);
  if (!currentCreator) currentCreator = existingEst && existingEst.createdBy ? existingEst.createdBy : (auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System");
  data.createdBy = currentCreator; document.getElementById('createdBy').value = currentCreator; 

  let isNewEstimate = !existingEst; let oldStatus = existingEst ? existingEst.status : null;
  const sitePhotosInput = document.getElementById('sitePhotos'); const photosToUpload = sitePhotosInput && sitePhotosInput.files ? Array.from(sitePhotosInput.files) : [];
  
  const isJobComplete = document.getElementById('jobCompleteChecklist') ? document.getElementById('jobCompleteChecklist').checked : false;
  const wasJobComplete = existingEst && existingEst.jobCompleteChecklist;

  const bar = document.getElementById('autosaveBar'); bar.classList.remove('d-none'); bar.className = "badge bg-warning text-dark"; bar.innerText = "Saving...";

  try {
      await db.collection('estimates').doc(estId).set({ ...data, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
      
      bar.className = "badge bg-success text-white"; bar.innerText = "Saved";
      setTimeout(() => { bar.classList.add('d-none'); bar.className = "badge bg-warning text-dark d-none"; }, 2000);

      if (photosToUpload.length > 0) {
          bar.classList.remove('d-none'); bar.className = "badge bg-info text-white"; bar.innerText = "Uploading Photos...";
          try {
              const uploadPromises = photosToUpload.map(async (f) => {
                  const uploaded = await uploadFileToDrive(f);
                  return { name: f.name + ` (${formatBytes(f.size)})`, url: uploaded.url, type: f.type || 'application/octet-stream', size: f.size };
              });
              const uploadedPhotos = await Promise.all(uploadPromises);
              await db.collection('estimates').doc(estId).update({ sitePhotosList: firebase.firestore.FieldValue.arrayUnion(...uploadedPhotos) });
              bar.className = "badge bg-success text-white"; bar.innerText = "Photos Uploaded"; setTimeout(() => bar.classList.add('d-none'), 2000);
          } catch(err) { console.error("Site photo upload failed", err); bar.className = "badge bg-danger text-white"; bar.innerText = "Photo Upload Failed"; setTimeout(() => bar.classList.add('d-none'), 3000); }
      }

      if (isNewEstimate) {
          sendSystemNotification(`📄 New Estimate Created: ${estId} for ${data.custName || 'Unknown Customer'} by ${currentCreator}`, 'estimate', estId);
          triggerAutomatedProposalChat(estId, data.status);
      } else if (existingEst && oldStatus !== data.status) {
          const updater = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System";
          sendSystemNotification(`🔄 Estimate ${estId} status updated to [${data.status}] by ${updater}`, 'estimate', estId);
          triggerAutomatedProposalChat(estId, data.status);
      }
      
      if (isJobComplete && !wasJobComplete) {
          triggerAutomatedEmailNotification(estId, data.custName);
      }
      
      if(!suppressAlert) await customAlert("Saved successfully!");
  } catch(e) {
      bar.className = "badge bg-danger text-white"; bar.innerText = "Save Failed";
      setTimeout(() => { bar.classList.add('d-none'); bar.className = "badge bg-warning text-dark d-none"; }, 3000);
      throw e; 
  } finally { if (sitePhotosInput) sitePhotosInput.value = ""; }
}

window.toggleCustomerGroup = function(headerEl) {
    const container = headerEl.nextElementSibling; const icon = headerEl.querySelector('.group-toggle-icon');
    if (container.classList.contains('d-none')) {
        container.classList.remove('d-none'); headerEl.classList.add('rounded-top', 'border-bottom-0'); headerEl.classList.remove('rounded');
        if(icon) { icon.classList.remove('mdi-chevron-up'); icon.classList.add('mdi-chevron-down'); }
    } else {
        container.classList.add('d-none'); headerEl.classList.remove('rounded-top', 'border-bottom-0'); headerEl.classList.add('rounded');
        if(icon) { icon.classList.remove('mdi-chevron-up'); icon.classList.add('mdi-chevron-down'); }
    }
};

async function loadFromCloud() {
    const list = document.getElementById('savedEstimatesList');
    if(allEstimatesCache.length === 0) { list.innerHTML = "<div class='text-center p-5 text-muted'>No estimates found.</div>"; return; }
    
    list.innerHTML = "";
    const sortEl = document.getElementById('estimateSort'); const sortMode = sortEl ? sortEl.value : 'group_recent';
    let displayList = [...allEstimatesCache];
    
    const generateItemHtml = (d) => {
        const date = getSafeTsDateStr(d.timestamp);
        let status = d.status || 'Draft (Not Ready)'; if (status === 'Accepted') status = 'Accepted (Deposit Received)'; if (status === 'Completed') status = 'Complete / Closed';
        const statusClass = getStatusClass(status);
        let baseUrl = getBaseUrl(); const directUrl = `${baseUrl}#/${d.estimateId}`;

        return `
           <div class="db-list-item" onclick="openEstimatePreview('${d.estimateId}')">
              <div>
                 <div class="d-flex align-items-center gap-2"><h6 class="m-0 fw-bold">${d.estimateId || 'ID'}</h6><span class="status-badge ${statusClass}">${status}</span></div>
                 <small class="text-muted fw-bold">${escapeHtml(d.custName || 'Unknown')}</small> <small class="text-muted">| Date: ${date}</small><br>
                 <small class="text-muted"><i class="mdi mdi-map-marker"></i> ${escapeHtml(d.custAddress || 'No Address')}</small><br>
                 <small class="text-muted" style="font-size: 11px;"><i class="mdi mdi-account-edit"></i> Created by: ${escapeHtml(d.createdBy || 'Unknown')}</small><br>
                 <small class="text-primary" style="font-size: 11px;"><i class="mdi mdi-hammer-wrench"></i> <strong>Scope:</strong> ${escapeHtml(d.desiredMaterial || 'Not Specified')}</small>
                 <div class="small fw-bold text-success mt-1">${fmt(d.totalRevenue || 0)}</div>
              </div>
              <div class="text-muted small"><i class="mdi mdi-chevron-right fs-4"></i></div>
           </div>`;
    };

    if (sortMode.startsWith('group_')) {
        const groupedEstimates = {};
        displayList.forEach(d => { const custName = d.custName || 'Unknown Customer'; if (!groupedEstimates[custName]) groupedEstimates[custName] = []; groupedEstimates[custName].push(d); });
        Object.keys(groupedEstimates).forEach(k => groupedEstimates[k].sort((a, b) => getSafeTsMs(b.timestamp) - getSafeTsMs(a.timestamp)));

        let groupKeys = Object.keys(groupedEstimates);
        if (sortMode === 'group_recent') groupKeys.sort((a, b) => getSafeTsMs(groupedEstimates[b][0].timestamp) - getSafeTsMs(groupedEstimates[a][0].timestamp));
        else if (sortMode === 'group_az') groupKeys.sort((a, b) => a.localeCompare(b));

        groupKeys.forEach(custName => {
            const custAddress = groupedEstimates[custName][0].custAddress || 'No Address';
            let groupHtml = `<div class="estimate-group mb-3" data-customer="${escapeHtml(custName.toLowerCase())}">
               <div class="bg-light p-2 border rounded d-flex align-items-center gap-2 pointer group-header" onclick="toggleCustomerGroup(this)" style="user-select:none;">
                   <i class="mdi mdi-account-circle text-primary fs-4"></i>
                   <div class="flex-grow-1"><h6 class="m-0 fw-bold text-dark d-inline-block">${escapeHtml(custName)}</h6><span class="badge bg-secondary ms-1">${groupedEstimates[custName].length}</span><div class="text-muted mt-1" style="font-size: 11px;"><i class="mdi mdi-map-marker"></i> ${escapeHtml(custAddress)}</div></div>
                   <i class="mdi mdi-chevron-down fs-4 text-muted group-toggle-icon"></i>
               </div><div class="border rounded-bottom bg-white group-items-container d-none">`;
            groupedEstimates[custName].forEach(d => groupHtml += generateItemHtml(d));
            groupHtml += `</div></div>`; list.innerHTML += groupHtml;
        });
    } else {
        displayList.sort((a, b) => {
            if (sortMode === 'date_desc') return getSafeTsMs(b.timestamp) - getSafeTsMs(a.timestamp);
            else if (sortMode === 'date_asc') return getSafeTsMs(a.timestamp) - getSafeTsMs(b.timestamp);
            else if (sortMode === 'amount_desc') return (b.totalRevenue || 0) - (a.totalRevenue || 0);
            return 0;
        });
        let html = `<div class="border rounded bg-white">`; displayList.forEach(d => html += generateItemHtml(d)); html += `</div>`; list.innerHTML = html;
    }
    filterEstimates();
}

function updateStatusDropdownColor(selectEl) {
    selectEl.classList.remove('bg-light', 'bg-primary', 'bg-success', 'bg-danger', 'bg-info', 'bg-warning', 'bg-secondary', 'bg-dark', 'text-white', 'text-dark', 'border');
    const val = selectEl.value;
    if(val === 'Draft (Not Ready)') selectEl.classList.add('bg-light', 'text-dark', 'border');
    else if(val === 'Estimate Created (Internal Review Required)' || val === 'Proposal Created (Internal Review Required)') selectEl.classList.add('bg-warning', 'text-dark');
    else if(val === 'Estimate In-Review' || val === 'Proposal In-Review') selectEl.classList.add('bg-secondary', 'text-white');
    else if(val === 'Estimate Review Completed/Adjusted (OK to Create Proposal)' || val === 'Proposal Review Completed/Adjusted (OK to Send)') selectEl.classList.add('bg-primary', 'text-white');
    else if(val === 'Sent (Customer Review & Signature)' || val === 'Signed (Pending Deposit)') selectEl.classList.add('bg-info', 'text-dark');
    else if(val === 'Accepted (Deposit Received)' || val === 'Job Started (In-Production)') selectEl.classList.add('bg-success', 'text-white');
    else if(val === 'Rejected' || val === 'Unqualified / Lost Lead') selectEl.classList.add('bg-danger', 'text-white');
    else if(val === 'Complete (Phase 1)' || val === 'Complete (Phase 2)' || val === 'Complete (Phase 3)' || val === 'Complete / Closed') selectEl.classList.add('bg-dark', 'text-white');
    else selectEl.classList.add('bg-light', 'text-dark', 'border');
}

async function updatePreviewStatus(newStatus) {
    const selectEl = document.getElementById('prevModalStatusSelect'); const estId = selectEl.dataset.estid;
    updateStatusDropdownColor(selectEl);
    if(!estId || !db) return;
    
    const est = allEstimatesCache.find(e => e.estimateId === estId); const oldStatus = est ? est.status : null;
    if(est) est.status = newStatus;
    
    try {
        await db.collection('estimates').doc(estId).update({ status: newStatus });
        if (oldStatus !== newStatus) {
            const updater = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System";
            sendSystemNotification(`🔄 Estimate ${estId} status updated to [${newStatus}] by ${updater}`, 'estimate', estId);
            triggerAutomatedProposalChat(estId, newStatus);
        }
    } catch(e) { console.error("Error updating status:", e); }
}

function openEstimatePreview(id) {
    const est = allEstimatesCache.find(e => e.estimateId === id); if (!est) return;

    const el = document.getElementById('estimatePreviewModal'); const modal = bootstrap.Modal.getOrCreateInstance(el);
    
    document.getElementById('prevModalId').innerText = est.estimateId; document.getElementById('prevModalDate').innerText = getSafeTsDateStr(est.timestamp);
    document.getElementById('prevModalCustomer').innerText = est.custName || 'Unknown Customer';
    
    let status = est.status || 'Draft (Not Ready)'; if(status === 'Accepted') status = 'Accepted (Deposit Received)'; if(status === 'Completed') status = 'Complete / Closed';

    const statusSelect = document.getElementById('prevModalStatusSelect'); statusSelect.innerHTML = "";
    estimateStatuses.forEach(s => statusSelect.add(new Option(s, s)));
    if (!estimateStatuses.includes(status)) statusSelect.add(new Option(status, status));
    statusSelect.value = status; statusSelect.dataset.estid = est.estimateId; updateStatusDropdownColor(statusSelect);
    
document.getElementById('prevModalAddress').innerText = est.custAddress || 'No Address'; document.getElementById('prevModalScope').innerText = est.desiredMaterial || 'No Scope Defined';
    document.getElementById('prevModalMainTotal').innerText = fmt(est.c_main || 0); document.getElementById('prevModalSecTotal').innerText = fmt(est.c_sec || 0); document.getElementById('prevModalGrandTotal').innerText = fmt(est.totalRevenue || 0);
    document.getElementById('prevModalProfit').innerText = fmt(est.totalProfit || 0); document.getElementById('prevModalLicFee').innerText = fmt(est.c_lic_fee_amt || 0);
    document.getElementById('prevModalComm').innerText = fmt(est.totalSalesComm || 0); document.getElementById('prevModalLeadFee').innerText = fmt(est.c_lead_fee || 0); document.getElementById('prevModalActualProfit').innerText = fmt(est.c_actual_profit || 0);
    document.getElementById('prevModalDeposit').innerText = fmt((est.totalRevenue || 0) / 2); document.getElementById('prevModalCostPerSq').innerText = fmt(est.c_costPerSq || 0);

    const footer = document.querySelector('#estimatePreviewModal .modal-body');
    let linkDiv = document.getElementById('prevModalLink');
    if(!linkDiv) {
        linkDiv = document.createElement('div'); linkDiv.id = 'prevModalLink'; linkDiv.className = 'w-100 mt-4 mb-2 small text-center text-muted bg-white p-2 rounded border mx-auto'; linkDiv.style.maxWidth = '90%';
        footer.appendChild(linkDiv);
    }
    
    let baseUrl = getBaseUrl(); const directUrl = `${baseUrl}#/${est.estimateId}`;
    linkDiv.innerHTML = `<strong>Direct Link:</strong> <a href="${directUrl}" target="_blank">${directUrl}</a>`;

    document.getElementById('btnPrevEdit').onclick = function() { modal.hide(); loadJob(id); };
    document.getElementById('btnPrevDuplicate').onclick = function() { modal.hide(); duplicateJob(id); };
    document.getElementById('btnPrevDelete').onclick = function() { deleteJob(id); };
    modal.show();
}

async function deleteJob(id) {
    if(!await customConfirm("Are you sure you want to DELETE this estimate? This action cannot be undone.")) return;
    const est = allEstimatesCache.find(e => e.estimateId === id); if (!est) return;
    const mInst = bootstrap.Modal.getOrCreateInstance(document.getElementById('estimatePreviewModal')); if(mInst) mInst.hide();
    try { await db.collection('estimates').doc(est.id).delete(); await customAlert("Estimate deleted."); } catch (e) { await customAlert("Error deleting estimate: " + e.message); }
}

function openDuplicateModal() { bootstrap.Modal.getOrCreateInstance(document.getElementById('duplicateOptionsModal')).show(); }

async function duplicateCurrentEstimate() {
    if(!await customConfirm("Create a duplicate of the currently loaded estimate with a NEW ID?")) return;
    const modalEl = document.getElementById('duplicateOptionsModal'); if (modalEl) { const modalInst = bootstrap.Modal.getOrCreateInstance(modalEl); if(modalInst) modalInst.hide(); }
    document.getElementById('createdBy').value = ""; document.getElementById('estimateStatus').value = "Draft (Not Ready)";
    setTimeout(async () => { generateSharedEstimateID(); await customAlert("Duplicated: New Estimate ID generated. Please Save when ready."); calculate(); }, 200);
}

async function startNewEstimate() { await resetForm(true); forceSwitchView('calculator'); }

async function loadJob(id) {
   let found = allEstimatesCache.find(e => e.estimateId === id);
   if(found) { restoreJob(found); document.title = found.desiredMaterial ? found.desiredMaterial : `Estimate ${id}`; forceSwitchView('calculator'); return Promise.resolve(); } 
   else {
      try {
         const snap = await db.collection('estimates').where('estimateId', '==', id).get();
         if(!snap.empty) {
             found = snap.docs[0].data(); if (!allEstimatesCache.find(e => e.estimateId === id)) allEstimatesCache.push(found);
             restoreJob(found); document.title = found.desiredMaterial ? found.desiredMaterial : `Estimate ${id}`; forceSwitchView('calculator');
         } else {
             const doc = await db.collection('estimates').doc(id).get();
             if(doc.exists) {
                 found = doc.data(); if (!allEstimatesCache.find(e => e.estimateId === id)) allEstimatesCache.push(found);
                 restoreJob(found); document.title = found.desiredMaterial ? found.desiredMaterial : `Estimate ${id}`; forceSwitchView('calculator');
             } else throw new Error("Estimate not found");
         }
         return Promise.resolve();
      } catch(e) { return Promise.reject(e); }
   }
}

async function duplicateJob(id) {
   if(!await customConfirm("Create a duplicate of this estimate with a NEW ID?")) return;
   const found = allEstimatesCache.find(e => e.estimateId === id);
   if(found) {
       const duplicateData = JSON.parse(JSON.stringify(found)); delete duplicateData.createdBy; document.getElementById('createdBy').value = ""; 
       restoreJob(duplicateData);
       setTimeout(async () => { generateSharedEstimateID(); document.getElementById('estimateStatus').value = "Draft (Not Ready)"; forceSwitchView('calculator'); await customAlert("Duplicated: New Estimate ID generated."); }, 200);
   }
}

window.openFilePreview = function(url, name, type) {
    const img = document.getElementById('previewModalImage'); const iframe = document.getElementById('previewModalIframe'); const downloadBtn = document.getElementById('previewModalDownloadBtn');
    img.classList.add('d-none'); iframe.classList.add('d-none');
    
    let isImg = false;
    if(type && type.startsWith('image/')) isImg = true; else if(name && name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) isImg = true;
    
    if (isImg) { img.src = getRawDriveImageUrl(url); img.classList.remove('d-none'); } 
    else {
        let embedUrl = url; if (embedUrl.includes('drive.google.com') && embedUrl.includes('/view')) embedUrl = embedUrl.replace(/\/view.*/, '/preview');
        iframe.src = embedUrl; iframe.classList.remove('d-none');
    }
    
    let newDownloadBtn = downloadBtn.cloneNode(true); downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
    newDownloadBtn.onclick = function(e) {
        e.preventDefault(); const originalText = newDownloadBtn.innerHTML;
        newDownloadBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin me-2"></i>Downloading...'; newDownloadBtn.classList.add('disabled');
        fetch(url).then(response => { if(!response.ok) throw new Error("Network response was not ok"); return response.blob(); })
            .then(blob => {
                const blobUrl = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.style.display = 'none'; a.href = blobUrl; a.download = name;
                document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(blobUrl); a.remove();
                newDownloadBtn.innerHTML = originalText; newDownloadBtn.classList.remove('disabled');
            }).catch(err => {
                console.warn('Blob download failed, using direct link:', err);
                const a = document.createElement('a'); a.href = url; a.download = name; a.target = '_blank';
                document.body.appendChild(a); a.click(); a.remove();
                newDownloadBtn.innerHTML = originalText; newDownloadBtn.classList.remove('disabled');
            });
    };
    bootstrap.Modal.getOrCreateInstance(document.getElementById('imagePreviewModal')).show();
};

function loadCustomerDB() {
  const tbody = document.getElementById('customerTableBody'); if(!tbody) return;
  const custStats = {}; const latestEstMap = {};

  allEstimatesCache.forEach(e => {
     const name = e.custName || 'Unknown';
     if(!custStats[name]) custStats[name] = { count:0, total:0 };
     custStats[name].count++; custStats[name].total += (e.totalRevenue || 0);

     const eTime = getSafeTsMs(e.timestamp);
     if (!latestEstMap[name] || eTime > latestEstMap[name]) latestEstMap[name] = eTime;
  });

  const sortDropdown = document.getElementById('customerSortDropdown');
  const sortMode = sortDropdown ? sortDropdown.value : 'recent';
  let sortedCustomers = [...allCustomersCache];

  if (sortMode === 'az') sortedCustomers.sort((a,b) => a.name.localeCompare(b.name));
  else if (sortMode === 'za') sortedCustomers.sort((a,b) => b.name.localeCompare(a.name));
  else if (sortMode === 'recent_est') {
      sortedCustomers.sort((a,b) => {
          const timeA = latestEstMap[a.name] || 0; const timeB = latestEstMap[b.name] || 0;
          return timeB - timeA;
      });
  } else sortedCustomers.reverse();

  tbody.innerHTML = "";
  sortedCustomers.forEach(c => {
     const stats = custStats[c.name] || { count: 0, total: 0 };
     const safeName = escapeHtml(c.name).replace(/'/g, "\\'");
     const displayPhone = c.phones && c.phones.length > 0 ? c.phones[0] + (c.phones.length > 1 ? ' (+' + (c.phones.length-1) + ')' : '') : (c.phone || '-');
     const displayEmail = c.emails && c.emails.length > 0 ? c.emails[0] + (c.emails.length > 1 ? ' (+' + (c.emails.length-1) + ')' : '') : (c.email || '-');
     
     tbody.innerHTML += `<tr>
        <td><a href="#" onclick="openCustomerDetails('${c.id}')" class="fw-bold text-dark text-decoration-none">${escapeHtml(c.name)}</a></td>
        <td class="small text-muted">${escapeHtml(displayPhone)} <br> ${escapeHtml(displayEmail)}<br><i class="mdi mdi-map-marker"></i> ${escapeHtml(c.address || '-')}</td>
        <td>${stats.count}</td><td class="text-success fw-bold">${fmt(stats.total)}</td>
        <td>
            <button class="btn btn-sm btn-outline-dark" onclick="openCustomerModal('${c.id}')"><i class="mdi mdi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-primary" onclick="showCustomerHistory('${safeName}')"><i class="mdi mdi-history"></i></button>
        </td>
     </tr>`;
  });
}

function openCustomerDetails(id) {
  const customer = allCustomersCache.find(c => c.id === id); if(!customer) return;
  document.getElementById('viewCustId').value = id; 
  document.getElementById('viewCustAvatar').innerText = customer.name.charAt(0); document.getElementById('viewCustFullName').innerText = customer.name;
  
  let displayEmails = customer.emails && customer.emails.length > 0 ? customer.emails.join('<br>') : (customer.email || 'No email');
  let displayPhones = customer.phones && customer.phones.length > 0 ? customer.phones.join('<br>') : (customer.phone || 'No phone');
  
  document.getElementById('viewCustEmail').innerHTML = displayEmails; document.getElementById('viewCustPhone').innerHTML = displayPhones;
  document.getElementById('viewCustAddress').innerText = customer.address || 'No address';
  document.getElementById('viewCustSource').innerText = customer.leadSource || '-'; document.getElementById('viewCustOwner').innerText = customer.jobOwner || '-';
  document.getElementById('viewCustNotesBlock').innerText = customer.notes || "No notes available.";

  const filesBlock = document.getElementById('viewCustFilesBlock');
  if(customer.fileList && customer.fileList.length > 0) {
      filesBlock.innerHTML = customer.fileList.map(f => {
          let fileUrl = '#', fileName = f, fileType = '';
          if (typeof f === 'object' && f.url) { fileUrl = f.url; fileName = f.name; fileType = f.type || ''; } else if (typeof f === 'string') fileName = f; 

          let iconClass = 'mdi-file-document-outline';
          if (fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i) || fileType.startsWith('image/')) iconClass = 'mdi-file-image';
          else if (fileName.match(/\.pdf$/i) || fileType === 'application/pdf') iconClass = 'mdi-file-pdf-box';

          return `<div class="d-flex align-items-center gap-2 mb-1"><i class="mdi ${iconClass} text-primary"></i> <a href="javascript:void(0)" onclick="handleFilePreviewClick(this)" data-url="${escapeHtml(fileUrl)}" data-name="${escapeHtml(fileName)}" data-type="${escapeHtml(fileType)}" class="text-decoration-none text-dark hover-underline">${escapeHtml(fileName)}</a></div>`;
      }).join('');
  } else filesBlock.innerHTML = '<span class="text-muted">No documents uploaded.</span>';

  const driveBtn = document.getElementById('viewCustDriveBtn');
  if(customer.gDriveLink && customer.gDriveLink.startsWith('http')) { driveBtn.href = customer.gDriveLink; driveBtn.classList.remove('disabled'); } 
  else { driveBtn.href = "#"; driveBtn.classList.add('disabled'); }

  document.getElementById('btnEditCustFromView').onclick = function() { const m = bootstrap.Modal.getOrCreateInstance(document.getElementById('customerDetailsModal')); if(m) m.hide(); openCustomerModal(id); };
  document.getElementById('btnDeleteCustFromView').onclick = function() { deleteCustomer(id); };
  document.getElementById('btnCreateEstimateFromCust').onclick = function() {
      const m = bootstrap.Modal.getOrCreateInstance(document.getElementById('customerDetailsModal')); if(m) m.hide();
      resetForm(true); 
      document.getElementById('custName').value = customer.name; document.getElementById('selectedCustomerId').value = customer.id;
      const primaryEmail = customer.emails && customer.emails.length > 0 ? customer.emails[0] : (customer.email || '');
      const primaryPhone = customer.phones && customer.phones.length > 0 ? customer.phones[0] : (customer.phone || '');
      document.getElementById('custEmail').value = primaryEmail; document.getElementById('custPhone').value = primaryPhone;
      document.getElementById('custAddress').value = customer.address || ''; document.getElementById('custCity').value = customer.city || ''; document.getElementById('custState').value = customer.state || ''; document.getElementById('custZip').value = customer.zip || '';
      forceSwitchView('calculator');
  };

  const addrList = document.getElementById('viewCustAddressesList');
  let allCustAddrs = [];
  if(customer.address) allCustAddrs.push(customer.address);
  if(customer.addresses && Array.isArray(customer.addresses)) customer.addresses.forEach(a => { if(a.fullAddress && !allCustAddrs.includes(a.fullAddress)) allCustAddrs.push(a.fullAddress); });

  if(allCustAddrs.length === 0) { addrList.innerHTML = `<div class="text-muted p-2">No addresses found.</div>`; renderCustEstimates(customer.id, null, null); } 
  else {
      addrList.innerHTML = `<button class="list-group-item list-group-item-action active fw-bold" onclick="renderCustEstimates('${customer.id}', null, this)">All Locations</button>`;
      allCustAddrs.forEach(addr => addrList.innerHTML += `<button class="list-group-item list-group-item-action" onclick="renderCustEstimates('${customer.id}', '${escapeHtml(addr).replace(/'/g, "\\'")}', this)"><i class="mdi mdi-map-marker-outline text-muted"></i> ${escapeHtml(addr)}</button>`);
      renderCustEstimates(customer.id, null, addrList.firstElementChild);
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('customerDetailsModal')).show();
}

window.renderCustEstimates = function(id, filterAddr, btnEl) {
    if(btnEl) { document.querySelectorAll('#viewCustAddressesList .list-group-item').forEach(b => b.classList.remove('active', 'fw-bold')); btnEl.classList.add('active', 'fw-bold'); }
    const list = document.getElementById('viewCustEstimateList'); list.innerHTML = "";
    const customer = allCustomersCache.find(c => c.id === id); if(!customer) return;

    let estimates = allEstimatesCache.filter(e => e.customerId === id || e.custName === customer.name);
    if(filterAddr) estimates = estimates.filter(e => e.custAddress === filterAddr);
    
    if(estimates.length === 0) list.innerHTML = '<div class="text-center text-muted p-3">No estimates found for this location.</div>';
    else {
        let baseUrl = getBaseUrl();
        estimates.forEach(e => {
            let status = e.status || 'Draft (Not Ready)'; if (status === 'Accepted') status = 'Accepted (Deposit Received)'; if (status === 'Completed') status = 'Complete / Closed';
            const statusClass = getStatusClass(status); const date = getSafeTsDateStr(e.timestamp); const directUrl = `${baseUrl}#/${e.estimateId}`;
            
            list.innerHTML += `
               <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="closeModalAndLoadJob('${e.estimateId}', 'customerDetailsModal')">
                  <div><div class="fw-bold text-dark">${e.estimateId} <span class="status-badge ${statusClass} ms-2">${status}</span></div><div class="text-muted" style="font-size:11px;">${date} | <i class="mdi mdi-map-marker"></i> ${escapeHtml(e.custAddress || 'N/A')}</div><div class="text-primary small mt-1">Scope: ${escapeHtml(e.desiredMaterial || 'N/A')}</div></div>
                  <div class="text-end"><div class="fw-bold text-success mb-1">${fmt(e.totalRevenue || 0)}</div><a href="${directUrl}" target="_blank" onclick="event.stopPropagation()" class="btn btn-xs btn-outline-secondary">Open Link</a></div>
               </div>`;
        });
    }
};

async function quickUploadCustomerFiles(input) {
    const customerId = document.getElementById('viewCustId').value;
    if (!customerId || !input.files || input.files.length === 0) return;

    const btnLabel = document.getElementById('quickUploadLabel'); const origHTML = btnLabel.innerHTML;
    btnLabel.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i>'; btnLabel.classList.add('disabled');

    const filesBlock = document.getElementById('viewCustFilesBlock');
    if (filesBlock.innerHTML.includes('No documents uploaded.')) filesBlock.innerHTML = '';
    
    const filesToUpload = Array.from(input.files);
    filesToUpload.forEach(f => {
        const fileId = 'up_' + Date.now() + Math.floor(Math.random() * 1000); f.tempId = fileId; 
        filesBlock.innerHTML += `<div id="${fileId}" class="d-flex align-items-center gap-2 mb-1 text-muted"><i class="mdi mdi-loading mdi-spin text-primary"></i> <span>${escapeHtml(f.name)} (Uploading...)</span></div>`;
    });

    try {
        const uploadPromises = filesToUpload.map(async (f) => {
            const fileId = f.tempId; const fileMime = f.type || 'application/octet-stream';
            const uploaded = await uploadFileToDrive(f);
            const fileObj = { name: f.name + ` (${formatBytes(f.size)})`, url: uploaded.url, type: fileMime, size: f.size };
            
            const el = document.getElementById(fileId);
            if (el) {
                let iconClass = 'mdi-file-document-outline';
                if (f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) || fileMime.startsWith('image/')) iconClass = 'mdi-file-image';
                else if (f.name.match(/\.pdf$/i) || fileMime === 'application/pdf') iconClass = 'mdi-file-pdf-box';
                el.innerHTML = `<i class="mdi ${iconClass} text-primary"></i> <a href="javascript:void(0)" onclick="handleFilePreviewClick(this)" data-url="${escapeHtml(uploaded.url)}" data-name="${escapeHtml(fileObj.name)}" data-type="${escapeHtml(fileMime)}" class="text-decoration-none text-dark hover-underline">${escapeHtml(f.name)} (${formatBytes(f.size)})</a>`;
                el.classList.remove('text-muted');
            }
            return fileObj;
        });

        const uploadedFiles = await Promise.all(uploadPromises);
        await db.collection('customers').doc(customerId).update({ fileList: firebase.firestore.FieldValue.arrayUnion(...uploadedFiles) });
        
        const cachedCust = allCustomersCache.find(c => c.id === customerId);
        const creator = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System";
        sendSystemNotification(`📎 ${creator} is uploading ${filesToUpload.length} document(s) to customer: ${cachedCust ? cachedCust.name : 'Unknown'}`, 'customer', customerId);
    } catch (error) { 
        console.error("Quick Upload Error:", error); 
        await customAlert("Some files may have failed to upload. " + error.message); 
    } finally { 
        setTimeout(() => { btnLabel.innerHTML = origHTML; btnLabel.classList.remove('disabled'); }, 500); 
        input.value = ""; 
    }
}

async function deleteCustomer(id) {
   if(!await customConfirm("Are you sure you want to delete this customer? This cannot be undone.")) return;
   const hasEstimates = allEstimatesCache.some(e => e.customerId === id);
   if(hasEstimates && !await customConfirm("Warning: This customer has linked estimates. Deleting the customer record will not delete the estimates, but the link may be broken. Continue?")) return;

   try { await db.collection('customers').doc(id).delete(); await customAlert("Customer deleted."); const modalEl = document.getElementById('customerDetailsModal'); if (modalEl && modalEl.classList.contains('show')) { const m = bootstrap.Modal.getOrCreateInstance(modalEl); if(m) m.hide(); } } 
   catch(e) { await customAlert("Error deleting customer: " + e.message); }
}

window.updateCustModalAutoFields = function() {
  const first = document.getElementById('modalCustFirstName').value.trim(); const last = document.getElementById('modalCustLastName').value.trim();
  document.getElementById('modalCustName').value = (first + " " + last).trim();

  const firstAddrEntry = document.querySelector('.address-entry');
  if (firstAddrEntry) {
      const str = firstAddrEntry.querySelector('.addr-street').value.trim(); const city = firstAddrEntry.querySelector('.addr-city').value.trim();
      const state = firstAddrEntry.querySelector('.addr-state').value.trim(); const zip = firstAddrEntry.querySelector('.addr-zip').value.trim();
      let full = str; if(city) full += `, ${city}`; if(state) full += `, ${state}`; if(zip) full += ` ${zip}`;
      document.getElementById('modalCustAddress').value = full;
  } else document.getElementById('modalCustAddress').value = '';
}

function checkDriveLink() {
   const val = document.getElementById('modalCustGDrive').value; const btn = document.getElementById('btnOpenJobFolder');
   if(val && val.startsWith('http')) { btn.href = val; btn.classList.remove('disabled', 'btn-secondary'); btn.classList.add('btn-drive-active'); } 
   else { btn.href = "#"; btn.classList.add('disabled', 'btn-secondary'); btn.classList.remove('btn-drive-active'); }
}

function handleCustomerFilesPreview(input) {
    const display = document.getElementById('newFileListDisplay');
    if (!input.files || input.files.length === 0) { display.innerHTML = ''; return; }
    let html = '<strong>Files to upload:</strong><br>'; Array.from(input.files).forEach(f => { html += `&bull; ${escapeHtml(f.name)} (${formatBytes(f.size)})<br>`; }); display.innerHTML = html;
}

window.openAddAddressModal = function(prefillId = null) {
    const sel = document.getElementById('newAddrCustomer'); sel.innerHTML = '<option value="">-- Select Customer --</option>';
    const sorted = [...allCustomersCache].sort((a,b) => a.name.localeCompare(b.name)); sorted.forEach(c => sel.add(new Option(c.name, c.id)));
    if (prefillId && typeof prefillId === 'string') sel.value = prefillId;

    document.getElementById('newAddrStreet').value = ""; document.getElementById('newAddrCity').value = ""; document.getElementById('newAddrState').value = "FL"; document.getElementById('newAddrZip').value = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addAddressModal')).show();
};

window.saveNewAddress = async function() {
    const custId = document.getElementById('newAddrCustomer').value; const street = document.getElementById('newAddrStreet').value.trim();
    const city = document.getElementById('newAddrCity').value.trim(); const state = document.getElementById('newAddrState').value.trim(); const zip = document.getElementById('newAddrZip').value.trim();

    if(!custId || !street || !city || !state || !zip) return await customAlert("Please fill all fields.");

    let fullAddress = street; if(city) fullAddress += `, ${city}`; if(state) fullAddress += `, ${state}`; if(zip) fullAddress += ` ${zip}`;
    try { await db.collection('customers').doc(custId).update({ addresses: firebase.firestore.FieldValue.arrayUnion({ street, city, state, zip, fullAddress }) }); await customAlert("Address added successfully!"); bootstrap.Modal.getOrCreateInstance(document.getElementById('addAddressModal')).hide(); } 
    catch(e) { await customAlert("Error saving address: " + e.message); }
};

window.addEmailField = function(val = '') {
    const container = document.getElementById('modalEmailsContainer'); const div = document.createElement('div'); div.className = 'd-flex align-items-center gap-2';
    div.innerHTML = `<input type="email" class="form-control form-control-sm email-input" placeholder="Email Address" value="${escapeHtml(val)}"><button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="this.parentElement.remove()"><i class="mdi mdi-close"></i></button>`;
    container.appendChild(div);
};

window.addPhoneField = function(val = '') {
    const container = document.getElementById('modalPhonesContainer'); const div = document.createElement('div'); div.className = 'd-flex align-items-center gap-2';
    div.innerHTML = `<input type="tel" class="form-control form-control-sm phone-input" placeholder="Phone Number" value="${escapeHtml(val)}"><button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="this.parentElement.remove()"><i class="mdi mdi-close"></i></button>`;
    container.appendChild(div);
};

window.addAddressField = function(addr = { street: '', city: '', state: 'FL', zip: '' }) {
    const container = document.getElementById('modalAddressesContainer'); const div = document.createElement('div'); div.className = 'address-entry p-3 bg-white border rounded position-relative';
    div.innerHTML = `<button type="button" class="btn btn-sm btn-outline-danger position-absolute top-0 end-0 m-2 py-0 px-2" onclick="this.parentElement.remove(); updateCustModalAutoFields();" title="Remove Address"><i class="mdi mdi-trash-can-outline"></i></button><div class="row g-2 pe-4"><div class="col-12"><label class="small text-muted fw-bold mb-1">Street Address *</label><input type="text" class="form-control form-control-sm addr-street" value="${escapeHtml(addr.street)}" oninput="updateCustModalAutoFields()"></div><div class="col-md-5"><label class="small text-muted fw-bold mb-1">City</label><input type="text" class="form-control form-control-sm addr-city" value="${escapeHtml(addr.city)}" oninput="updateCustModalAutoFields()"></div><div class="col-md-3"><label class="small text-muted fw-bold mb-1">State</label><input type="text" class="form-control form-control-sm addr-state" value="${escapeHtml(addr.state)}" oninput="updateCustModalAutoFields()"></div><div class="col-md-4"><label class="small text-muted fw-bold mb-1">Zip</label><input type="text" class="form-control form-control-sm addr-zip" value="${escapeHtml(addr.zip)}" oninput="updateCustModalAutoFields()"></div></div>`;
    container.appendChild(div);
};

async function showCustomerHistoryFromCalc() {
   const name = document.getElementById('custName').value; if(!name) return await customAlert("Select a customer first"); showCustomerHistory(name);
}

function showCustomerHistory(name) {
   const el = document.getElementById('historyModal'); const modal = bootstrap.Modal.getOrCreateInstance(el);
   const list = document.getElementById('historyList'); list.innerHTML = `<h6 class="text-primary p-2">Estimates for: ${escapeHtml(name)}</h6>`;
   const filtered = allEstimatesCache.filter(e => e.custName === name);
   
   let baseUrl = getBaseUrl();

   if(filtered.length === 0) list.innerHTML += `<div class="p-3 text-center text-muted">No estimates found.</div>`;
   else {
       filtered.forEach(d => {
          const date = getSafeTsDateStr(d.timestamp);
          let status = d.status || 'Draft (Not Ready)'; if(status === 'Accepted') status = 'Accepted (Deposit Received)'; if(status === 'Completed') status = 'Complete / Closed';
          const statusClass = getStatusClass(status); const directUrl = `${baseUrl}#/${d.estimateId}`;

          list.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center">
                <div><div class="fw-bold">${d.estimateId} <span class="status-badge ${statusClass} ms-2">${status}</span></div><small class="text-muted">${date} | ${fmt(d.totalRevenue || 0)}</small><div class="small text-primary mt-1">Scope: ${escapeHtml(d.desiredMaterial || 'N/A')}</div></div>
                <div><a href="${directUrl}" target="_blank" class="btn btn-sm btn-outline-dark me-2">Open Link</a><button class="btn btn-sm btn-outline-info me-2" onclick="duplicateJob('${d.estimateId}')" title="Duplicate"><i class="mdi mdi-content-copy"></i></button><button class="btn btn-sm btn-outline-secondary me-2" onclick="downloadBackup('${d.estimateId}')" title="Save Webpage"><i class="mdi mdi-file-link"></i></button><button class="btn btn-sm btn-primary" onclick="closeModalAndLoadJob('${d.estimateId}', 'historyModal')">Load</button></div>
            </div>`;
       });
   }
   modal.show();
}

let activeChatListener = null; let chatFileCache = null; let isInitialChatLoad = true; 

function loadChatView() {
    if (!activeChatListener && db) {
        activeChatListener = db.collection('messages').orderBy('timestamp', 'desc').limit(50).onSnapshot(snapshot => {
                const messages = []; snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() })); renderChatMessages(messages.reverse()); 
                
                if (!isInitialChatLoad) {
                    let hasNewMessages = false;
                    snapshot.docChanges().forEach(change => { if (change.type === 'added') { const msgData = change.doc.data(); const currentUser = auth.currentUser; if (currentUser && msgData.uid !== currentUser.uid) hasNewMessages = true; } });
                    if (hasNewMessages) {
                        const windowEl = document.getElementById('chat-widget-container');
                        if (windowEl && windowEl.classList.contains('d-none')) {
                            const badge = document.getElementById('chat-badge'); if (badge) badge.classList.remove('d-none');
                            const launcher = document.getElementById('chat-floating-btn'); if (launcher) launcher.classList.add('chat-flash-anim');
                            const sound = document.getElementById('chat-notification-sound'); if (sound) sound.play().catch(e => console.warn("Audio blocked:", e));
                        }
                    }
                }
                isInitialChatLoad = false;
            }, error => { console.error("Chat Error:", error); });
    }
}

function toggleChatWidget() {
    const windowEl = document.getElementById('chat-widget-container'); const badge = document.getElementById('chat-badge'); const launcher = document.getElementById('chat-floating-btn');
    if (windowEl.classList.contains('d-none')) {
        windowEl.classList.remove('d-none'); if(badge) badge.classList.add('d-none'); if(launcher) launcher.classList.remove('chat-flash-anim'); 
        setTimeout(() => { const container = document.getElementById('chat-messages-container'); container.scrollTop = container.scrollHeight; }, 100);
    } else windowEl.classList.add('d-none');
}

function setupChatFeatures() {
    const container = document.getElementById('chat-widget-container');
    if (window.picmoPopup) { 
        const picker = window.picmoPopup.createPopup({}, { triggerElement: document.getElementById('emoji-trigger-btn'), referenceElement: document.getElementById('emoji-trigger-btn'), position: 'top-end' });
        picker.addEventListener('emoji:select', selection => { const input = document.getElementById('chat-input'); input.value += selection.emoji; });
        document.getElementById('emoji-trigger-btn').addEventListener('click', () => picker.toggle());
    }

    const input = document.getElementById('chat-input'); const suggestionBox = document.getElementById('tag-suggestions');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
    input.addEventListener('keyup', (e) => {
        const val = input.value; const lastWord = val.split(' ').pop();
        if (lastWord.startsWith('@') && lastWord.length > 1) {
            const query = lastWord.substring(1).toLowerCase(); const matches = getChatUsers().filter(u => u.toLowerCase().includes(query));
            if (matches.length > 0) { suggestionBox.innerHTML = matches.map(u => `<div class="suggestion-item" onclick="insertTag('${escapeHtml(u)}')">${escapeHtml(u)}</div>`).join(''); suggestionBox.classList.remove('d-none'); } 
            else suggestionBox.classList.add('d-none');
        } else suggestionBox.classList.add('d-none');
    });
}

function getChatUsers() {
    const users = new Set(["general", "Admin", "Sales", "Office", "Patrice", "Reina"]);
    activeSalesReps.forEach(r => users.add(r.name)); repOptions.forEach(r => { if(r!=='Other') users.add(r); });
    return Array.from(users);
}

window.insertTag = function(username) {
    const input = document.getElementById('chat-input'); const val = input.value; const words = val.split(' '); words.pop(); words.push(`@${username} `);
    input.value = words.join(' '); document.getElementById('tag-suggestions').classList.add('d-none'); input.focus();
}

function handleChatFileSelect(input) {
    const file = input.files[0]; if(!file) return; chatFileCache = file;
    document.getElementById('preview-filename').innerText = file.name; document.getElementById('preview-filesize').innerText = formatBytes(file.size);
    const iconEl = document.getElementById('chat-file-icon'); const thumbEl = document.getElementById('chat-file-thumbnail');

    if (file.type.startsWith('image/')) {
        const reader = new FileReader(); reader.onload = function(e) { thumbEl.src = e.target.result; thumbEl.classList.remove('d-none'); if(iconEl) iconEl.classList.add('d-none'); }
        reader.readAsDataURL(file);
    } else { thumbEl.classList.add('d-none'); if(iconEl) iconEl.classList.remove('d-none'); thumbEl.src = ""; }
    document.getElementById('chat-file-preview-area').classList.remove('d-none');
}

function clearChatFile() {
    chatFileCache = null; const input = document.getElementById('chat-file-input'); if (input) input.value = "";
    document.getElementById('chat-file-preview-area').classList.add('d-none');
}

function renderChatMessages(messages) {
    const container = document.getElementById('chat-messages-container'); const currentUser = auth.currentUser; if (!container) return;
    container.innerHTML = "";
    if(messages.length === 0) { container.innerHTML = '<div class="text-center mt-5 text-muted opacity-50"><i class="mdi mdi-forum-outline fs-1"></i><br>No messages yet.</div>'; return; }

    let lastUser = null;

    messages.forEach(msg => {
        const isMe = currentUser && msg.uid === currentUser.uid; const alignClass = isMe ? 'chat-sent' : 'chat-received'; const showName = !isMe && msg.sender !== lastUser;
        const ms = getSafeTsMs(msg.timestamp); const time = ms ? new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';
        
        let processedText = escapeHtml(msg.text).replace(/@(\w+)/g, '<span class="tag-mention">@$1</span>');
        let attachmentHtml = "";
        
        if (msg.isUploading) {
            attachmentHtml = `<div class="chat-file-download text-muted" style="background: rgba(0,0,0,0.05); padding: 8px; border-radius: 6px; margin-top: 5px; display: inline-flex; align-items: center; gap: 8px;"><i class="mdi mdi-loading mdi-spin fs-5 text-primary"></i> <span style="font-size: 0.75rem; font-style: italic;">Uploading ${escapeHtml(msg.fileName || 'file')}...</span></div>`;
        } else if (msg.attachment) {
            let isImg = false;
            if(msg.fileType && msg.fileType.startsWith('image/')) isImg = true; else if (msg.fileName && msg.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) isImg = true;
            if(isImg) attachmentHtml = `<div class="chat-file-preview"><img src="${escapeHtml(getRawDriveImageUrl(msg.attachment))}" alt="Image" onclick="handleFilePreviewClick(this)" data-url="${escapeHtml(msg.attachment)}" data-name="${escapeHtml(msg.fileName || 'Attachment')}" data-type="${escapeHtml(msg.fileType || '')}"></div>`;
            else attachmentHtml = `<a href="javascript:void(0)" onclick="handleFilePreviewClick(this)" data-url="${escapeHtml(msg.attachment)}" data-name="${escapeHtml(msg.fileName || 'Attachment')}" data-type="${escapeHtml(msg.fileType || '')}" class="chat-file-download"><i class="mdi mdi-file-download-outline fs-4"></i> <span>${escapeHtml(msg.fileName || 'Attachment')}</span></a>`;
        }

        container.innerHTML += `
            <div class="chat-message-row ${isMe ? 'justify-content-end' : 'justify-content-start'}">
                <div class="chat-bubble ${alignClass}">${showName ? `<div class="chat-sender-name">${escapeHtml(msg.sender)}</div>` : ''}<div class="chat-text">${processedText}</div>${attachmentHtml}<div class="chat-time">${time}</div></div>
            </div>`;
        lastUser = msg.sender;
    });
    container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input'); const text = input.value.trim(); const user = auth.currentUser;
    if ((!text && !chatFileCache) || !user) return;
    
    const messageData = { text: text || "📎 Sent an attachment", sender: user.displayName || user.email.split('@')[0], uid: user.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() };
    const fileToUpload = chatFileCache; const fileInput = document.getElementById('chat-file-input');

    input.value = ""; document.getElementById('chat-file-preview-area').classList.add('d-none');

    if (fileToUpload) {
        messageData.isUploading = true; messageData.fileName = fileToUpload.name; const fileMime = fileToUpload.type || 'application/octet-stream';
        try {
            const docRef = await db.collection('messages').add(messageData); const uploaded = await uploadFileToDrive(fileToUpload);
            await docRef.update({ attachment: uploaded.url, fileType: fileMime, isUploading: firebase.firestore.FieldValue.delete() });
        } catch(err) { console.error("Chat attachment upload failed:", err); } 
        finally { chatFileCache = null; if (fileInput) fileInput.value = ""; }
    } else db.collection('messages').add(messageData);
}

window.openAIModal = function() {
    document.getElementById('ai-sq').value = document.getElementById('squares1').value || ""; document.getElementById('ai-type').value = "";
    document.getElementById('ai-loading').classList.add('d-none'); document.getElementById('ai-product-results').classList.add('d-none');
    document.getElementById('btn-ai-apply').classList.add('disabled'); bootstrap.Modal.getOrCreateInstance(document.getElementById('aiEstimateModal')).show();
}

const aiMockCatalogs = {
    "Shingle": [ { id: "s1", brand: "Owens Corning", name: "Oakridge Architectural", price: 210, laborIdx: 0, waste: 0.10 }, { id: "s2", brand: "Owens Corning", name: "TruDefinition Duration", price: 200, laborIdx: 0, waste: 0.10 }, { id: "s3", brand: "GAF", name: "Timberline HDZ", price: 198, laborIdx: 0, waste: 0.10 }, { id: "s4", brand: "GAF", name: "Royal Sovereign 3-Tab", price: 175, laborIdx: 0, waste: 0.08 } ],
    "Metal": [ { id: "m1", brand: "Sunshine Metal Supply", name: "24G Standing Seam Mill", price: 360, laborIdx: 2, waste: 0.15 }, { id: "m2", brand: "Sunshine Metal Supply", name: "24G Standing Seam Kynar", price: 480, laborIdx: 2, waste: 0.15 }, { id: "m3", brand: "Sunshine Metal Supply", name: "5V Crimp Mill", price: 300, laborIdx: 3, waste: 0.15 } ],
    "Membrane": [ { id: "f1", brand: "Mule-Hide", name: "TPO 60-mil w/ 1-inch ISO", price: 320, laborIdx: 9, waste: 0.05 }, { id: "f2", brand: "Mule-Hide", name: "TPO 60-mil Standard", price: 275, laborIdx: 9, waste: 0.05 }, { id: "f3", brand: "Mule-Hide", name: "EPDM 45-mil Standard", price: 245, laborIdx: 9, waste: 0.05 } ]
};

let selectedAIProduct = null;

window.fetchAIProducts = function() {
    const type = document.getElementById('ai-type').value; const resultsDiv = document.getElementById('ai-product-results');
    const loadingDiv = document.getElementById('ai-loading'); const applyBtn = document.getElementById('btn-ai-apply');
    
    resultsDiv.classList.add('d-none'); applyBtn.classList.add('disabled'); selectedAIProduct = null;
    if (!type) return;
    
    loadingDiv.classList.remove('d-none');
    setTimeout(() => {
        loadingDiv.classList.add('d-none'); resultsDiv.innerHTML = "";
        const products = aiMockCatalogs[type] || [];
        if (products.length === 0) resultsDiv.innerHTML = "<div class='col-12 text-center text-muted'>No products found for this category.</div>";
        else products.forEach(p => {
            const card = document.createElement('div'); card.className = "col-md-6";
            card.innerHTML = `<div class="card h-100 border border-2 ai-product-card" id="ai-card-${p.id}" style="cursor:pointer; transition: 0.2s;" onclick="selectAIProduct('${p.id}', '${type}')"><div class="card-body p-3 text-center"><span class="badge bg-secondary mb-2">${p.brand}</span><h6 class="fw-bold text-dark m-0">${p.name}</h6><div class="text-success fw-bold mt-2">$${p.price} / SQ</div><small class="text-muted d-block mt-1">Est. Waste: ${p.waste * 100}%</small></div></div>`;
            resultsDiv.appendChild(card);
        });
        resultsDiv.classList.remove('d-none');
    }, 1200); 
}

window.selectAIProduct = function(pid, type) {
    document.querySelectorAll('.ai-product-card').forEach(c => { c.classList.remove('border-primary', 'bg-primary-subtle'); c.classList.add('border-2'); });
    document.getElementById(`ai-card-${pid}`).classList.add('border-primary', 'bg-primary-subtle'); document.getElementById(`ai-card-${pid}`).classList.remove('border-2');
    
    const products = aiMockCatalogs[type] || []; selectedAIProduct = products.find(x => x.id === pid); selectedAIProduct.mappedType = type;
    document.getElementById('btn-ai-apply').classList.remove('disabled');
}

window.applyAIEstimate = async function() {
    if (!selectedAIProduct) return;
    const sq = parseFloat(document.getElementById('ai-sq').value) || 0;
    if (sq > 0) document.getElementById('squares1').value = sq;
    
    document.getElementById('waste1').value = selectedAIProduct.waste;
    let groupName = selectedAIProduct.mappedType; if (groupName === 'Membrane') groupName = 'Membrane'; 
    document.getElementById('matType1').value = groupName; updateMaterials(1);
    
    setTimeout(async () => {
        const sel = document.getElementById('matSelect1'); let found = false;
        for(let i=0; i<sel.options.length; i++) { if(sel.options[i].text.includes(selectedAIProduct.name)) { sel.selectedIndex = i; found = true; break; } }
        if(!found) { const customMat = { name: `${selectedAIProduct.brand} - ${selectedAIProduct.name}`, price: selectedAIProduct.price }; sel.add(new Option(customMat.name, JSON.stringify(customMat))); sel.selectedIndex = sel.options.length - 1; }
        sel.dispatchEvent(new Event('change'));
        
        const labSel = document.getElementById('labSelect1');
        if (selectedAIProduct.laborIdx !== undefined && labSel.options.length > selectedAIProduct.laborIdx + 1) { labSel.selectedIndex = selectedAIProduct.laborIdx + 1; labSel.dispatchEvent(new Event('change')); }
        
        bootstrap.Modal.getOrCreateInstance(document.getElementById('aiEstimateModal')).hide(); calculate();
        await customAlert(`Applied ${selectedAIProduct.brand} ${selectedAIProduct.name} to Main Roof section!`);
    }, 150);
}

function harvestData() {
   const data = {};
   document.querySelectorAll('#calculatorForm input, #calculatorForm select, #calculatorForm textarea').forEach(el => { if(el.id && el.type !== 'file') data[el.id] = el.value; });
   data['waivePermits'] = document.getElementById('waivePermits').checked; data['waivePermitsSec'] = document.getElementById('waivePermitsSec').checked;
   const src = document.getElementById('leadSourceDropdown').value; data['leadSource'] = src;
   if(src === 'Other') data['leadSourceManual'] = document.getElementById('leadSourceManual').value;
   data['activeSalesReps'] = activeSalesReps; data['activePayroll'] = activePayroll;
   data['jobComplete'] = document.getElementById('jobCompleteChecklist').checked;
   return data;
}

function restoreJob(data) {
   isRestoring = true; window.isUndoing = true;
   for(const [k,v] of Object.entries(data)) {
       const el = document.getElementById(k);
       if(el && el.closest('#calculatorForm') && el.type !== 'file' && k !== 'matSelect1' && k !== 'matSelect2' && k !== 'matType1') {
            if (k.startsWith('extra_') || k === 'payroll_bill_cust') continue; 
            if (k === 'estimateStatus' && document.getElementById('estimateStatus').value && !data['estimateStatus']) continue;
            if(el.type === 'checkbox') el.checked = v; else el.value = v;
       }
   }
   
   const billCustEl = document.getElementById('payroll_bill_cust'); if (billCustEl) billCustEl.checked = false;
   const jobCompleteEl = document.getElementById('jobCompleteChecklist'); if(jobCompleteEl) jobCompleteEl.checked = data['jobComplete'] || false;
   
   extrasList.forEach((item, index) => {
       if(data[`extra_qty_${index}`] !== undefined) { const el = document.getElementById(`extra_qty_${index}`); if (el) el.value = data[`extra_qty_${index}`]; }
       if(data[`extra_cost_${index}`] !== undefined) { const el = document.getElementById(`extra_cost_${index}`); if (el) el.value = data[`extra_cost_${index}`]; }
       if(data[`extra_name_${index}`] !== undefined) { const el = document.getElementById(`extra_name_${index}`); if (el) el.value = data[`extra_name_${index}`]; }
   });
       
   if(data['matType1']) {
       document.getElementById('matType1').value = data['matType1']; updateMaterials(1); 
       if(data['matSelect1']) {
           let sel = document.getElementById('matSelect1'); sel.value = data['matSelect1']; 
           if (sel.selectedIndex <= 0 && data['matSelect1'].includes('{')) {
               try { const savedObj = JSON.parse(data['matSelect1']); for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value && sel.options[i].value.startsWith('{')) { const optObj = JSON.parse(sel.options[i].value); if (optObj.name === savedObj.name) { sel.selectedIndex = i; break; } } } } catch(e) {}
           }
       }
   }
       
   if(data['matType2']) {
       document.getElementById('matType2').value = data['matType2']; updateMaterials(2); 
       if(data['matSelect2']) {
           let sel2 = document.getElementById('matSelect2'); sel2.value = data['matSelect2']; 
           if (sel2.selectedIndex <= 0 && data['matSelect2'].includes('{')) {
               try { const savedObj = JSON.parse(data['matSelect2']); for (let i = 0; i < sel2.options.length; i++) { if (sel2.options[i].value && sel2.options[i].value.startsWith('{')) { const optObj = JSON.parse(sel2.options[i].value); if (optObj.name === savedObj.name) { sel2.selectedIndex = i; break; } } } } catch(e) { }
           }
       }
   }
    
   if(data['leadSource']) { const dd = document.getElementById('leadSourceDropdown'); dd.value = data['leadSource']; toggleLeadSourceInput(dd); }
       
   activeSalesReps = data['activeSalesReps'] ? JSON.parse(JSON.stringify(data['activeSalesReps'])) : [];
   activePayroll = data['activePayroll'] ? JSON.parse(JSON.stringify(data['activePayroll'])) : [];
    
   renderPayrollTable();
   setTimeout(() => { calculate(); isRestoring = false; window.isUndoing = false; lastStateStr = JSON.stringify(harvestData()); }, 150);
}
    
async function downloadBackup(id) {
   const btn = document.getElementById('btnPrevBackup') || document.getElementById('btnSaveAndBackup');
   const origText = btn ? btn.innerHTML : ""; if(btn) btn.innerHTML = "<div class='spinner-border spinner-border-sm'></div> Fetching Data...";

   try {
       let estData = null, custData = null;
       if (db) {
           try {
               const snap = await db.collection('estimates').where('estimateId', '==', id).get();
               if (!snap.empty) estData = snap.docs[0].data(); else { const doc = await db.collection('estimates').doc(id).get(); if(doc.exists) estData = doc.data(); }
               if (estData && estData.customerId) { const custDoc = await db.collection('customers').doc(estData.customerId).get(); if (custDoc.exists) custData = custDoc.data(); }
           } catch (e) { console.warn("DB fetch failed, using cache", e); }
       }

       if (!estData) estData = allEstimatesCache.find(e => e.estimateId === id);
       if (!estData) {
           if (document.getElementById('estimateId').value === id) estData = harvestData();
           else { if(btn) btn.innerHTML = origText; return await customAlert("Estimate data not found."); }
       }
       if (!custData) custData = estData.customerId ? allCustomersCache.find(c => c.id === estData.customerId) : { name: estData.custName || "Unknown" };

       if (document.getElementById('estimateId').value !== id) { restoreJob(estData); forceSwitchView('calculator'); await new Promise(resolve => setTimeout(resolve, 800)); } 
       else { calculate(); await new Promise(resolve => setTimeout(resolve, 300)); }

       let dataToSave = harvestData(); dataToSave = { ...estData, ...dataToSave }; 
       dataToSave.estimateId = id; dataToSave.totalRevenue = parseMoney(document.getElementById('c_grand').innerText);
       dataToSave.totalProfit = parseMoney(document.getElementById('c_total_profit').innerText); dataToSave.totalSalesComm = parseMoney(document.getElementById('c_comm').innerText);
       dataToSave.custName = document.getElementById('custName').value; dataToSave.custAddress = document.getElementById('custAddress').value;

       const currentSettings = { materialGroups, laborMain, extrasList, crewOptions, repOptions, leadSourceOptions, estimateStatuses };
       const backupData = { estimate: dataToSave, customer: custData, settings: currentSettings, generatedAt: new Date().toISOString() };

       if(btn) btn.innerHTML = "<div class='spinner-border spinner-border-sm'></div> Building File...";
       let stylesContent = "", scriptsContent = "";

       try {
           if (document.getElementById('main-style-link')) stylesContent = await (await fetch('styles.css')).text(); else { const existingStyle = document.querySelector('style'); if(existingStyle) stylesContent = existingStyle.innerHTML; }
           if (document.getElementById('main-script-src')) scriptsContent = await (await fetch('script.js')).text(); else { await customAlert("Warning: Re-saving from a snapshot may lose some functionality. Please save from the live app."); if(btn) btn.innerHTML = origText; return; }
       } catch(e) { console.error("Error fetching assets for inline:", e); await customAlert("Could not fetch assets to bundle. Ensure you are online."); if(btn) btn.innerHTML = origText; return; }

       document.querySelectorAll('input, textarea, select').forEach(el => {
           if(el.type === 'checkbox' || el.type === 'radio') { if(el.checked) el.setAttribute('checked', 'checked'); else el.removeAttribute('checked'); } 
           else if (el.tagName === 'SELECT') { el.querySelectorAll('option').forEach(o => o.removeAttribute('selected')); if (el.options[el.selectedIndex]) el.options[el.selectedIndex].setAttribute('selected', 'selected'); el.setAttribute('value', el.value); } 
           else { el.setAttribute('value', el.value); if(el.tagName === 'TEXTAREA') el.innerHTML = el.value; }
       });

       const clone = document.documentElement.cloneNode(true);
       const linkTag = clone.querySelector('#main-style-link'); if(linkTag) linkTag.remove();
       const scriptTag = clone.querySelector('#main-script-src'); if(scriptTag) scriptTag.remove();
       const styleEl = document.createElement('style'); styleEl.textContent = stylesContent; clone.querySelector('head').appendChild(styleEl);

       const modals = clone.querySelectorAll('.modal, .modal-backdrop, #login-overlay, .chat-widget-launcher, .chat-widget-window'); modals.forEach(m => m.remove());
       const sidebar = clone.querySelector('#sidebar'); if(sidebar) sidebar.remove();
       const mainPanel = clone.querySelector('.main-panel'); if(mainPanel) { mainPanel.style.marginLeft = '0'; mainPanel.style.marginTop = '20px'; }

       let baseUrl = getBaseUrl(); const liveLink = `${baseUrl}#/${id}`;

       const headerDiv = document.createElement('div');
       headerDiv.style.cssText = "background:#aa0000; color:white; padding:15px; text-align:center; font-family:sans-serif; position:fixed; top:0; left:0; width:100%; z-index:99999; box-shadow:0 2px 10px rgba(0,0,0,0.3); display:flex; justify-content:center; align-items:center; gap:20px;";
       headerDiv.innerHTML = `<span style="font-weight:bold; font-size:1.1rem;">ESTIMATE SNAPSHOT: ${id}</span><a href="${liveLink}" style="background:white; color:#aa0000; padding:8px 20px; text-decoration:none; border-radius:4px; font-weight:bold; border:2px solid white;">OPEN LIVE APP &rarr;</a>`;
       clone.querySelector('body').prepend(headerDiv); clone.querySelector('body').style.marginTop = "60px"; 

       const injectionScript = document.createElement('script');
       injectionScript.textContent = `window.ESTIMATE_BACKUP = ${JSON.stringify(backupData)};\n// INLINED APP LOGIC\n${scriptsContent}`;
       clone.querySelector('body').appendChild(injectionScript);

       const blob = new Blob([clone.outerHTML], {type: 'text/html'}); const url = URL.createObjectURL(blob);
       const a = document.createElement('a'); a.href = url; a.download = generateStandardFilename(dataToSave) + ".html"; a.click();
       if(btn) btn.innerHTML = origText;

   } catch(error) { console.error("Backup Error:", error); await customAlert("An error occurred during backup: " + error.message); if(btn) btn.innerHTML = origText; }
}

function fmt(n) { return n.toLocaleString('en-US', {style:'currency', currency:'USD'}); }
function parseMoney(str) { return parseFloat(String(str).replace(/[^0-9.-]/g, '')) || 0; }
function setText(id, v) { const el = document.getElementById(id); if(el) el.innerText = (typeof v === 'number') ? fmt(v) : v; }
function setupCurrencyInputs() { document.querySelectorAll('.currency-input').forEach(i => { i.addEventListener('blur', function() { this.value = fmt(parseMoney(this.value)); calculate(); }); i.addEventListener('focus', function() { this.value = parseMoney(this.value) || ''; }); }); }

function loadSettingsToUI() {
   const c = document.getElementById('settingsMainMatContainer'); c.innerHTML = "";
   Object.keys(materialGroups).forEach(grp => {
       let h = `<div class="mb-3 p-2 border rounded"><h6 class="text-danger">${grp}</h6>`;
       materialGroups[grp].forEach((m,i) => { h += `<div class="input-group input-group-sm mb-1"><input type="text" class="form-control" value="${m.name}" onchange="materialGroups['${grp}'][${i}].name=this.value"><input type="number" class="form-control" value="${m.price}" onchange="materialGroups['${grp}'][${i}].price=this.value"><button class="btn btn-outline-danger" onclick="delGrp('${grp}',${i})">X</button></div>`; });
           h += `<button class="btn btn-xs btn-light text-success" onclick="addGrp('${grp}')">+ Add</button></div>`;
           c.innerHTML += h;
       });
       renderTableSet('tableMainLab', laborMain, true); renderExtrasSettings();
       renderSimpleSettingsTable('tableCrews', 'crewOptions'); renderSimpleSettingsTable('tableReps', 'repOptions');
       renderLeadSourcesSettings(); renderSimpleSettingsTable('tableStatuses', 'estimateStatuses');
    }

    window.delGrp = (g,i) => { materialGroups[g].splice(i,1); loadSettingsToUI(); };
    window.addGrp = (g) => { materialGroups[g].push({name:'New Item', price:0}); loadSettingsToUI(); };

    function renderTableSet(tid, arr, hasG) {
         const tb = document.getElementById(tid).querySelector('tbody'); tb.innerHTML = "";
         arr.forEach((m,i) => {
             let tr = document.createElement('tr');
             let html = `<td><input type="text" value="${m.name}" onchange="updArr('${tid}',${i},'name',this.value)"></td><td><input type="number" step="0.01" value="${parseFloat(m.price).toFixed(2)}" onchange="updArr('${tid}',${i},'price',this.value)"></td>`;
             if(hasG) html += `<td><input type="number" step="0.01" value="${parseFloat(m.groupPrice||0).toFixed(2)}" onchange="updArr('${tid}',${i},'groupPrice',this.value)"></td>`;
             html += `<td><button class="btn btn-sm btn-outline-danger" onclick="delArr('${tid}',${i})">X</button></td>`;
             tr.innerHTML = html; tb.appendChild(tr);
         });
    }

    function renderExtrasSettings() {
         const tb = document.getElementById('tableExtras').querySelector('tbody'); tb.innerHTML = "";
         extrasList.forEach((m,i) => {
             let tr = document.createElement('tr');
             tr.innerHTML = `<td><input type="text" value="${m.name}" onchange="extrasList[${i}].name=this.value"></td>
                <td><input type="number" step="0.01" value="${parseFloat(m.price).toFixed(2)}" onchange="extrasList[${i}].price=this.value"></td>
                <td><input type="number" step="1" value="${m.qty||0}" onchange="extrasList[${i}].qty=this.value"></td>
                <td><button class="btn btn-sm btn-outline-danger" onclick="delExtrasRow(${i})">X</button></td>`;
             tb.appendChild(tr);
         });
    }

    window.delExtrasRow = (i) => { extrasList.splice(i,1); renderExtrasSettings(); };
    window.addExtrasSettingRow = () => { extrasList.push({name:'New Extra', price:0, qty: 0}); renderExtrasSettings(); };
    window.updArr = (tid,i,k,v) => { const arr = laborMain; arr[i][k] = (k!=='name'?parseFloat(v):v); };
    window.delArr = (tid,i) => { const arr = laborMain; arr.splice(i,1); renderTableSet(tid, arr, true); };
    window.addSettingRow = (tid, hasG) => { const arr = laborMain; arr.push({name:'New', price:0, groupPrice:0}); renderTableSet(tid, arr, true); };

    function renderSimpleSettingsTable(tid, arrName) {
        let arr = [];
        if(arrName==='crewOptions') arr = crewOptions; if(arrName==='repOptions') arr = repOptions; if(arrName==='estimateStatuses') arr = estimateStatuses;

        const tb = document.getElementById(tid).querySelector('tbody'); if(!tb) return;
        tb.innerHTML = "";
        arr.forEach((val, i) => {
            let tr = document.createElement('tr');
            tr.innerHTML = `<td><input type="text" class="form-control form-control-sm" value="${escapeHtml(val)}" onchange="updateSimpleArr('${arrName}', ${i}, this.value)"></td><td class="text-center"><button class="btn btn-sm btn-outline-danger" onclick="delSimpleRow('${arrName}', ${i})">X</button></td>`;
            tb.appendChild(tr);
        });
    }

    function renderLeadSourcesSettings() {
         const tb = document.getElementById('tableLeadSources').querySelector('tbody'); if(!tb) return;
         tb.innerHTML = "";
         leadSourceOptions.forEach((m,i) => {
             let tr = document.createElement('tr');
             tr.innerHTML = `<td><input type="text" class="form-control form-control-sm" value="${escapeHtml(m.name)}" onchange="updateLeadSourceArr(${i}, 'name', this.value)"></td>
                <td><input type="number" step="0.01" class="form-control form-control-sm" value="${m.fee}" onchange="updateLeadSourceArr(${i}, 'fee', this.value)"></td>
                <td class="text-center"><button class="btn btn-sm btn-outline-danger" onclick="delLeadSourceRow(${i})">X</button></td>`;
             tb.appendChild(tr);
         });
    }

    window.updateSimpleArr = (arrName, i, val) => {
        if(arrName==='crewOptions') crewOptions[i] = val; if(arrName==='repOptions') repOptions[i] = val; if(arrName==='estimateStatuses') estimateStatuses[i] = val;
    }
    window.updateLeadSourceArr = (i, key, val) => { if(key === 'fee') leadSourceOptions[i][key] = parseFloat(val) || 0; else leadSourceOptions[i][key] = val; }
    window.delSimpleRow = (arrName, i) => {
        if(arrName==='crewOptions') crewOptions.splice(i,1); if(arrName==='repOptions') repOptions.splice(i,1); if(arrName==='estimateStatuses') estimateStatuses.splice(i,1); loadSettingsToUI();
    };
    window.delLeadSourceRow = (i) => { leadSourceOptions.splice(i,1); loadSettingsToUI(); };
    window.addSimpleSettingRow = (arrName) => {
        if(arrName==='crewOptions') crewOptions.push('New Crew'); if(arrName==='repOptions') repOptions.push('New Rep'); if(arrName==='estimateStatuses') estimateStatuses.push('New Status'); loadSettingsToUI();
    };
    window.addLeadSourceRow = () => { leadSourceOptions.push({name:'New Source', fee: 0}); loadSettingsToUI(); };

    async function saveSettings(silent=false) { 
        if(!db) {
            localStorage.setItem('rooster_custom_settings', JSON.stringify({ materialGroups, laborMain, extrasList, crewOptions, repOptions, leadSourceOptions, estimateStatuses })); 
            if(!silent) await customAlert("Offline: Settings Saved locally.");
            initCalculator(); return;
        }

        const docRef = db.collection('settings').doc('global_settings');
        try {
            await docRef.set({ materialGroups, laborMain, extrasList, crewOptions, repOptions, leadSourceOptions, estimateStatuses, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() });
            if(!silent) await customAlert("Global Settings Saved to Database!");
            initCalculator(); 
        } catch(error) { await customAlert("Error saving settings: " + error.message); }
    }

    async function resetSettingsDefaults() { 
        if(await customConfirm("Reset GLOBAL settings to defaults? This will overwrite the database configuration.")) { 
            materialGroups = JSON.parse(JSON.stringify(defaultMaterialGroups)); laborMain = JSON.parse(JSON.stringify(defaultLaborMain)); extrasList = JSON.parse(JSON.stringify(defaultExtrasList));
            crewOptions = JSON.parse(JSON.stringify(defaultCrewOptions)); repOptions = JSON.parse(JSON.stringify(defaultRepOptions));
            leadSourceOptions = JSON.parse(JSON.stringify(defaultLeadSourceOptions)); estimateStatuses = JSON.parse(JSON.stringify(defaultEstimateStatuses)); saveSettings(); 
        } 
    }

    function switchTab(t, e) { 
        document.querySelectorAll('.setting-content').forEach(el => el.classList.add('d-none')); 
        document.querySelectorAll('#settingTabs .nav-link').forEach(el => el.classList.remove('active')); 
        document.getElementById(t).classList.remove('d-none'); 
        if(e && e.target) e.target.classList.add('active'); 
        if(t==='tabMainMat') loadSettingsToUI(); 
    }

    document.getElementById('sidebarToggle').onclick = function(){ document.getElementById('sidebar').classList.toggle('open'); };

    async function resetForm(promptConfirm = false) { 
        if(!promptConfirm || await customConfirm("Reset form? This will clear all data on the calculator screen.")) { 
            document.getElementById('calculatorForm').reset(); document.title = "Rooster Roofing App v18";
            activeSalesReps = []; activePayroll = []; 
            
            document.getElementById('split_commission_display').innerHTML = '<em class="text-muted small">No reps added yet.</em>'; 
            document.getElementById('matType1').value = ""; document.getElementById('matSelect1').innerHTML = "<option value=''>-- Clear Selection --</option>"; document.getElementById('labSelect1').value = "";
            document.getElementById('matType2').value = ""; document.getElementById('matSelect2').innerHTML = "<option value=''>-- Clear Selection --</option>"; document.getElementById('labSelect2').value = "";
            document.getElementById('matPrice1').value = "$0.00"; document.getElementById('labPrice1').value = "$0.00"; document.getElementById('matPrice2').value = "$0.00"; document.getElementById('labPrice2').value = "$0.00";

            const billCustEl = document.getElementById('payroll_bill_cust'); if(billCustEl) billCustEl.checked = false;
            generateSharedEstimateID(); renderPayrollTable(); renderExtrasCalculator(); calculate(); 
        } 
    }

    function filterEstimates() {
       const term = document.getElementById('estimateSearch').value.toLowerCase();
       const groups = document.querySelectorAll('.estimate-group');

       if (groups.length > 0) {
           groups.forEach(group => {
              let groupHasVisibleItem = false;
              const custName = group.getAttribute('data-customer') || "";
              const items = group.querySelectorAll('.db-list-item');

              items.forEach(item => {
                 const txt = item.innerText.toLowerCase();
                 if (txt.includes(term) || custName.includes(term)) { item.style.display = 'flex'; groupHasVisibleItem = true; } 
                 else item.style.display = 'none';
              });

              group.style.display = groupHasVisibleItem ? 'block' : 'none';

              const container = group.querySelector('.group-items-container');
              const headerEl = group.querySelector('.group-header');
              const icon = group.querySelector('.group-toggle-icon');

              if (term !== "" && groupHasVisibleItem && container) {
                  container.classList.remove('d-none');
                  if (headerEl) { headerEl.classList.add('rounded-top', 'border-bottom-0'); headerEl.classList.remove('rounded'); }
                  if (icon) { icon.classList.remove('mdi-chevron-down'); icon.classList.add('mdi-chevron-up'); }
              } else if (term === "" && container) {
                  container.classList.add('d-none');
                  if (headerEl) { headerEl.classList.remove('rounded-top', 'border-bottom-0'); headerEl.classList.add('rounded'); }
                  if (icon) { icon.classList.remove('mdi-chevron-up'); icon.classList.add('mdi-chevron-down'); }
              }
           });
       } else {
           const items = document.querySelectorAll('.db-list-item');
           items.forEach(item => { const txt = item.innerText.toLowerCase(); item.style.display = txt.includes(term) ? 'flex' : 'none'; });
       }
    }

    window.filterCustomers = function() {
       const term = document.getElementById('custSearch').value.toLowerCase();
       const rows = document.querySelectorAll('#customerTableBody tr');
       rows.forEach(row => {
          const text = row.innerText.toLowerCase();
          if (text.includes(term)) row.style.display = ''; else row.style.display = 'none';
       });
    };

    window.addSecondaryContactField = function(contact = {firstName: '', lastName: '', email: '', phone: ''}) {
        const container = document.getElementById('modalSecondaryContactsContainer'); if(!container) return;
        const div = document.createElement('div'); div.className = 'secondary-contact-entry p-3 bg-white border rounded position-relative';
        div.innerHTML = `
            <button type="button" class="btn btn-sm btn-outline-danger position-absolute top-0 end-0 m-2 py-0 px-2" onclick="this.parentElement.remove();" title="Remove Contact"><i class="mdi mdi-close"></i></button>
            <div class="row g-2 pe-4">
                <div class="col-md-6"><label class="small text-muted fw-bold mb-1">First Name</label><input type="text" class="form-control form-control-sm sc-first" value="${escapeHtml(contact.firstName)}"></div>
                <div class="col-md-6"><label class="small text-muted fw-bold mb-1">Last Name</label><input type="text" class="form-control form-control-sm sc-last" value="${escapeHtml(contact.lastName)}"></div>
                <div class="col-md-6"><label class="small text-muted fw-bold mb-1">Email</label><input type="email" class="form-control form-control-sm sc-email" value="${escapeHtml(contact.email)}"></div>
                <div class="col-md-6"><label class="small text-muted fw-bold mb-1">Phone</label><input type="tel" class="form-control form-control-sm sc-phone" value="${escapeHtml(contact.phone)}"></div>
            </div>`;
        container.appendChild(div);
    };

    window.openCustomerModal = function(id = null) {
       const el = document.getElementById('addCustomerModal'); const modal = bootstrap.Modal.getOrCreateInstance(el);
       
       document.getElementById('customerForm').reset(); document.getElementById('modalCustId').value = "";
       document.getElementById('fileListDisplay').innerHTML = ""; document.getElementById('newFileListDisplay').innerHTML = "";
       document.getElementById('modalEmailsContainer').innerHTML = ''; document.getElementById('modalPhonesContainer').innerHTML = '';
       document.getElementById('modalAddressesContainer').innerHTML = ''; const scContainer = document.getElementById('modalSecondaryContactsContainer'); if(scContainer) scContainer.innerHTML = '';
       
       if(id) {
           const c = allCustomersCache.find(x => x.id === id);
           if(c) {
               document.getElementById('modalCustId').value = c.id;
               if (c.firstName) { document.getElementById('modalCustFirstName').value = c.firstName; document.getElementById('modalCustLastName').value = c.lastName; } 
               else { const parts = (c.name || "").split(" "); document.getElementById('modalCustFirstName').value = parts[0] || ""; document.getElementById('modalCustLastName').value = parts.slice(1).join(" ") || ""; }
               document.getElementById('modalCustName').value = c.name;

               if (c.emails && c.emails.length > 0) c.emails.forEach(e => addEmailField(e)); else if (c.email) addEmailField(c.email); else addEmailField();
               if (c.phones && c.phones.length > 0) c.phones.forEach(p => addPhoneField(p)); else if (c.phone) addPhoneField(c.phone); else addPhoneField();
               if (c.secondaryContacts && c.secondaryContacts.length > 0) c.secondaryContacts.forEach(sc => addSecondaryContactField(sc));

               if (c.addresses && c.addresses.length > 0) c.addresses.forEach(a => addAddressField(a));
               else if (c.street || c.address) { let str = c.street || (c.address || "").split(',')[0]; addAddressField({ street: str, city: c.city || '', state: c.state || 'FL', zip: c.zip || '' }); } 
               else addAddressField();

               document.getElementById('modalCustJobOwner').value = c.jobOwner || ''; document.getElementById('modalCustLeadSource').value = c.leadSource || '';
               document.getElementById('modalCustGDrive').value = c.gDriveLink || ''; document.getElementById('modalCustNotes').value = c.notes || '';
               
               updateCustModalAutoFields(); checkDriveLink();

               if(c.fileList && Array.isArray(c.fileList)) {
                   document.getElementById('fileListDisplay').innerHTML = "<strong>Existing Files:</strong><br>" + c.fileList.map(f => {
                       let fname = typeof f === 'object' ? f.name : f; let ftype = typeof f === 'object' ? (f.type || '') : ''; let furl = typeof f === 'object' ? (f.url || '#') : '#';
                       return `&bull; <a href="javascript:void(0)" onclick="handleFilePreviewClick(this)" data-url="${escapeHtml(furl)}" data-name="${escapeHtml(fname)}" data-type="${escapeHtml(ftype)}" class="text-decoration-none">${escapeHtml(fname)}</a>`;
                   }).join('<br>');
               }
           }
       } else { addEmailField(); addPhoneField(); addAddressField(); updateCustModalAutoFields(); }
       modal.show();
    };

window.saveCustomer = async function() {
   const id = document.getElementById('modalCustId').value;
   const firstName = document.getElementById('modalCustFirstName').value.trim(); const lastName = document.getElementById('modalCustLastName').value.trim();
   const jobOwner = document.getElementById('modalCustJobOwner').value.trim(); const leadSource = document.getElementById('modalCustLeadSource').value.trim();
   const notes = document.getElementById('modalCustNotes').value.trim();
   
   const emails = Array.from(document.querySelectorAll('.email-input')).map(el => el.value.trim()).filter(Boolean);
   const phones = Array.from(document.querySelectorAll('.phone-input')).map(el => el.value.trim()).filter(Boolean);
   
   const secondaryContacts = Array.from(document.querySelectorAll('.secondary-contact-entry')).map(el => {
       return { firstName: el.querySelector('.sc-first').value.trim(), lastName: el.querySelector('.sc-last').value.trim(), email: el.querySelector('.sc-email').value.trim(), phone: el.querySelector('.sc-phone').value.trim() };
   }).filter(sc => sc.firstName !== "" || sc.lastName !== "" || sc.email !== "" || sc.phone !== "");

   const addresses = Array.from(document.querySelectorAll('.address-entry')).map(el => {
       const street = el.querySelector('.addr-street').value.trim(); const city = el.querySelector('.addr-city').value.trim();
       const state = el.querySelector('.addr-state').value.trim(); const zip = el.querySelector('.addr-zip').value.trim();
       let fullAddress = street; if(city) fullAddress += `, ${city}`; if(state) fullAddress += `, ${state}`; if(zip) fullAddress += ` ${zip}`;
       return { street, city, state, zip, fullAddress };
   }).filter(a => a.street !== "");
   
   if (!firstName || !lastName || addresses.length === 0 || !jobOwner || !leadSource) return await customAlert("Please fill in all required fields marked with an asterisk (*). Ensure at least one street address is provided.");

   const fileInput = document.getElementById('modalCustFiles'); const filesToUpload = Array.from(fileInput.files);
   document.getElementById('newFileListDisplay').innerHTML = ""; 

   const btnSave = document.querySelector('#addCustomerModal .btn-primary'); const origBtnText = btnSave.innerHTML;
   btnSave.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...'; btnSave.disabled = true;

   const primaryEmail = emails.length > 0 ? emails[0] : ''; const primaryPhone = phones.length > 0 ? phones[0] : ''; const primaryAddr = addresses[0];

   const data = { 
       firstName: firstName, lastName: lastName, name: document.getElementById('modalCustName').value, email: primaryEmail, emails: emails, phone: primaryPhone, phones: phones, secondaryContacts: secondaryContacts,
       street: primaryAddr.street, city: primaryAddr.city, state: primaryAddr.state, zip: primaryAddr.zip, address: primaryAddr.fullAddress, addresses: addresses,
       jobOwner: jobOwner, leadSource: leadSource, gDriveLink: document.getElementById('modalCustGDrive').value, notes: notes, timestamp: firebase.firestore.FieldValue.serverTimestamp() 
   };

   try {
       let customerRef; let isNew = false; let targetId = id;
       if(id) { await db.collection('customers').doc(id).update(data); customerRef = db.collection('customers').doc(id); }
       else { isNew = true; customerRef = await db.collection('customers').add(data); targetId = customerRef.id; }

       if (filesToUpload.length > 0) {
            btnSave.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading Files...';
            const uploadPromises = filesToUpload.map(async f => {
                const fileMime = f.type || 'application/octet-stream'; const uploaded = await uploadFileToDrive(f);
                return { name: f.name + ` (${formatBytes(f.size)})`, url: uploaded.url, type: fileMime, size: f.size };
            });
            const uploadedFiles = await Promise.all(uploadPromises);
            await customerRef.update({ fileList: firebase.firestore.FieldValue.arrayUnion(...uploadedFiles) });
       }
       
       if (isNew) {
            const creator = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System";
            sendSystemNotification(`👤 New Customer Added: ${data.name} by ${creator}`, 'customer', targetId);
       }
       
       await customAlert("Customer Saved!");
       const m = bootstrap.Modal.getOrCreateInstance(document.getElementById('addCustomerModal')); if(m) m.hide();
   } catch(e) { console.error("Save Error:", e); await customAlert("Error saving: " + e.message); } 
   finally { btnSave.innerHTML = origBtnText; btnSave.disabled = false; if(fileInput) fileInput.value = ""; }
};

window.updateDashboardEstimateStatus = async function(estId, newStatus) {
    if(!db) return await customAlert("Database not connected.");
    try {
        const docRef = db.collection('estimates').doc(estId);
        await docRef.update({ status: newStatus });
        const updater = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System";
        sendSystemNotification(`🔄 Estimate ${estId} status updated to [${newStatus}] by ${updater}`, 'estimate', estId);
        triggerAutomatedProposalChat(estId, newStatus);
    } catch(e) {
        console.error("Error updating status:", e);
        await customAlert("Error updating status: " + e.message);
    }
};

window.updateDashboardProposalStatus = async function(estId, newStatus) {
    if(!db) return await customAlert("Database not connected.");
    try {
        const docRef = db.collection('estimates').doc(estId);
        await docRef.update({ status: newStatus });
        const updater = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "System";
        sendSystemNotification(`🔄 Estimate ${estId} status updated to [${newStatus}] by ${updater}`, 'estimate', estId);
        triggerAutomatedProposalChat(estId, newStatus);
    } catch(e) {
        console.error("Error updating status:", e);
        await customAlert("Error updating status: " + e.message);
    }
};

window.renderDashboard = function() {
    let totalRevenue = 0, acceptedCount = 0, totalJobs = allEstimatesCache.length, activeRevenue = 0, activeCount = 0;
    let closedCount = 0, closedRev = 0, closedProfit = 0;
    let recentHtml = '', newEstimatesHtml = '', proposalsHtml = '', sentHtml = '', coHtml = '';
    let statusCounts = {}, repSales = {}, matCounts = {};
    let monthlyRevenue = new Array(12).fill(0);
    let monthLabels = [];
    for(let i=11; i>=0; i--) {
        let d = new Date(); d.setMonth(d.getMonth() - i);
        monthLabels.push(d.toLocaleString('default', { month: 'short' }));
    }

    allEstimatesCache.forEach((e, idx) => {
        const rev = parseFloat(e.totalRevenue) || 0;
        const isAccepted = e.status === 'Signed (Pending Deposit)' || e.status === 'Accepted' || e.status === 'Accepted (Deposit Received)' || e.status === 'Complete / Closed' || e.status === 'Completed';
        const isClosed = e.status === 'Complete / Closed' || e.status === 'Completed';
        const isActive = e.status !== 'Job Started (In-Production)' &&  e.status !== 'Complete (Phase 1)' &&  e.status !== 'Complete (Phase 2)' &&  e.status !== 'Complete (Phase 3)' &&   e.status !== 'Rejected' && e.status !== 'Unqualified / Lost Lead' && !isClosed;
        
        if (isAccepted) { totalRevenue += rev; acceptedCount++; }
        if (isActive) { activeRevenue += rev; activeCount++; }
        if (isClosed) { closedCount++; closedRev += rev; closedProfit += (parseFloat(e.c_actual_profit) || 0); }

        statusCounts[e.status || 'Draft (Not Ready)'] = (statusCounts[e.status || 'Draft (Not Ready)'] || 0) + 1;

        if (isAccepted && e.activeSalesReps) {
            e.activeSalesReps.forEach(rep => { repSales[rep.name] = (repSales[rep.name] || 0) + (rev * (rep.percent / 100)); });
        }

        if (e.desiredMaterial) {
            let mat = e.desiredMaterial.split(' ')[0] || 'Other';
            mat = mat.replace(/[^a-zA-Z]/g, '');
            if(!mat) mat = 'Other';
            matCounts[mat] = (matCounts[mat] || 0) + 1;
        } else {
            matCounts['Other'] = (matCounts['Other'] || 0) + 1;
        }

        if (isAccepted && e.timestamp) {
            const eDate = new Date(getSafeTsMs(e.timestamp));
            const now = new Date();
            const diffMonths = (now.getFullYear() - eDate.getFullYear()) * 12 + (now.getMonth() - eDate.getMonth());
            if (diffMonths >= 0 && diffMonths < 12) monthlyRevenue[11 - diffMonths] += rev;
        }

        if (idx < 5) {
            let sClass = getStatusClass(e.status);
            recentHtml += `<tr><td class="ps-4 text-muted small">${getSafeTsDateStr(e.timestamp)}</td><td class="fw-bold text-dark">${escapeHtml(e.custName || 'Unknown')}</td><td><a href="#" onclick="loadJob('${e.estimateId}')">${e.estimateId}</a></td><td><span class="badge ${sClass}">${e.status || 'Draft (Not Ready)'}</span></td><td class="text-end pe-4 fw-bold text-success">${fmt(rev)}</td></tr>`;
        }

        if (e.status === 'Estimate Created (Internal Review Required)') {
            let sClass = getStatusClass(e.status);
            newEstimatesHtml += `<tr>
                <td class="ps-4 text-muted small">${getSafeTsDateStr(e.timestamp)}</td>
                <td class="fw-bold text-dark">${escapeHtml(e.custName || 'Unknown')}</td>
                <td><a href="#" onclick="loadJob('${e.estimateId}')">${e.estimateId}</a></td>
                <td><span class="badge ${sClass}">${e.status}</span></td>
                <td class="text-end fw-bold text-primary">${fmt(rev)}</td>
                <td class="text-center pe-4">
                    <button class="btn btn-sm btn-outline-success py-0 px-2 me-1" title="Approved (OK to Create Proposal)" onclick="updateDashboardEstimateStatus('${e.estimateId}', 'Estimate Review Completed/Adjusted (OK to Create Proposal)')"><i class="mdi mdi-check"></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" title="In-Review" onclick="updateDashboardEstimateStatus('${e.estimateId}', 'Estimate In-Review')"><i class="mdi mdi-close"></i></button>
                </td>
            </tr>`;
        }

        if (e.status && (e.status.includes('Proposal Created (Internal Review Required)') || e.status.includes('Proposal In-Review') || e.status.includes('Proposal Review Completed/Adjusted (OK to Send)'))) {
            let sClass = getStatusClass(e.status);
            proposalsHtml += `<tr>
                <td class="ps-4 text-muted small">${getSafeTsDateStr(e.timestamp)}</td>
                <td class="fw-bold text-dark">${escapeHtml(e.custName || 'Unknown')}</td>
                <td><a href="#" onclick="loadJob('${e.estimateId}')">${e.estimateId}</a></td>
                <td><span class="badge ${sClass}">${e.status}</span></td>
                <td class="text-end fw-bold text-primary">${fmt(rev)}</td>
                <td class="text-center pe-4">
                    <button class="btn btn-sm btn-outline-success py-0 px-2 me-1" title="Approved" onclick="updateDashboardProposalStatus('${e.estimateId}', 'Proposal Review Completed/Adjusted (OK to Send)')"><i class="mdi mdi-check"></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Not Approved/Revision Required" onclick="updateDashboardProposalStatus('${e.estimateId}', 'Proposal In-Review')"><i class="mdi mdi-close"></i></button>
                </td>
            </tr>`;
        }

        if (e.status === 'Sent (Customer Review & Signature)') {
            let sClass = getStatusClass(e.status);
            sentHtml += `<tr>
                <td class="ps-4 text-muted small">${getSafeTsDateStr(e.timestamp)}</td>
                <td class="fw-bold text-dark">${escapeHtml(e.custName || 'Unknown')}</td>
                <td><a href="#" onclick="loadJob('${e.estimateId}')">${e.estimateId}</a></td>
                <td><span class="badge ${sClass}">${e.status}</span></td>
                <td class="text-end pe-4 fw-bold text-info">${fmt(rev)}</td>
            </tr>`;
        }

        if (e.activePayroll) {
            e.activePayroll.forEach(p => {
                if (p.isChangeOrder) {
                    coHtml += `<tr><td class="ps-4 text-muted small">${getSafeTsDateStr(e.timestamp)}</td><td><a href="#" onclick="loadJob('${e.estimateId}')">${e.estimateId}</a></td><td class="fw-bold text-dark">${escapeHtml(e.custName || 'Unknown')}</td><td>${escapeHtml(p.laborType)}</td><td>${escapeHtml(p.crew)}</td><td>${p.billToCust ? '<span class="badge bg-danger">Yes</span>' : '<span class="badge bg-secondary">No</span>'}</td><td class="text-end pe-4 fw-bold text-warning-emphasis">${fmt(p.rate)}</td></tr>`;
                }
            });
        }
    });

    setText('dash-revenue', totalRevenue); setText('dash-total-jobs', totalJobs);
    document.getElementById('dash-conversion').innerText = totalJobs > 0 ? Math.round((acceptedCount / totalJobs) * 100) + '%' : '0%';
    setText('dash-avg', activeCount > 0 ? (activeRevenue / activeCount) : 0);
    setText('dash-closed-count', closedCount); setText('dash-closed-rev', closedRev); setText('dash-closed-profit', closedProfit); setText('dash-closed-avg', closedCount > 0 ? (closedRev / closedCount) : 0);

    document.getElementById('dash-recent-table').innerHTML = recentHtml || '<tr><td colspan="5" class="text-center py-4 text-muted">No recent estimates found.</td></tr>';
    document.getElementById('dash-new-estimates-table').innerHTML = newEstimatesHtml || '<tr><td colspan="6" class="text-center py-4 text-muted">No new estimates require review.</td></tr>';
    document.getElementById('dash-proposals-table').innerHTML = proposalsHtml || '<tr><td colspan="6" class="text-center py-4 text-muted">No active proposals in review.</td></tr>';
    
    const sentTable = document.getElementById('dash-sent-table');
    if(sentTable) sentTable.innerHTML = sentHtml || '<tr><td colspan="5" class="text-center py-4 text-muted">No sent proposals found.</td></tr>';

    document.getElementById('dash-co-table').innerHTML = coHtml || '<tr><td colspan="7" class="text-center py-4 text-muted">No active change orders found.</td></tr>';

    if (typeof Chart !== 'undefined') {
        if (salesChartInst) salesChartInst.destroy();
        salesChartInst = new Chart(document.getElementById('salesChart'), { type: 'line', data: { labels: monthLabels, datasets: [{ label: 'Revenue ($)', data: monthlyRevenue, borderColor: '#10b981', tension: 0.3, fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });

        if (statusChartInst) statusChartInst.destroy();
        statusChartInst = new Chart(document.getElementById('statusChart'), { type: 'doughnut', data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#64748b', '#003b52'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } } } });

        if (repPerfChartInst) repPerfChartInst.destroy();
        repPerfChartInst = new Chart(document.getElementById('repPerfChart'), { type: 'bar', data: { labels: Object.keys(repSales), datasets: [{ label: 'Sales Volume ($)', data: Object.values(repSales), backgroundColor: '#3b82f6', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });

        if (materialChartInst) materialChartInst.destroy();
        materialChartInst = new Chart(document.getElementById('materialChart'), { type: 'pie', data: { labels: Object.keys(matCounts), datasets: [{ data: Object.values(matCounts), backgroundColor: ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } } } });
    }
};

window.triggerJobCompleteEmail = function() {
    const isComplete = document.getElementById('jobCompleteChecklist').checked;
    if (isComplete) {
        console.log("Triggering automated email notification: Job Complete.");
        sendSystemNotification("Job Complete Checklist marked. (Automated email placeholder triggered)");
    }
};