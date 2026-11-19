// ==========================================================================
// 1. COLE AQUI A URL DO SEU FIREBASE REALTIME DATABASE:
// Exemplo: "https://ficha-infeccao-x-default-rtdb.firebaseio.com"
// ==========================================================================
const FIREBASE_DATABASE_URL = "https://ficha-infeccao-x-default-rtdb.firebaseio.com/";

let db = null;
let selectedPortalRole = 'player';
let sessionConfig = {
    role: 'player',
    campaignId: 'campanha-01',
    userId: 'sobrevivente-01'
};

let playerDbRef = null;
let cloudSaveTimer = null;
let isApplyingRemoteUpdate = false;
let toastTimer = null;
let currentMapZoom = 1;

function createDefaultState() {
    return {
        version: 4,
        avatar: '',
        nome: '',
        origem: '',
        idade: '',
        nascimento: '',
        apelido: '',
        vitalidade: 10,
        mental: 10,
        pn: 0,
        instinto: 1,
        mente: 1,
        corpo: 1,
        traumas: '',
        vinculos: '',
        personalidade: '',
        ferimentos: '',
        doencas: '',
        equipamentos: '',
        mochila: [],
        habilidades: '',
        insanidade: '',
        updatedAt: Date.now()
    };
}

let fichaState = createDefaultState();

const TEXT_FIELDS = [
    'nome', 'origem', 'idade', 'nascimento', 'apelido',
    'traumas', 'vinculos', 'personalidade',
    'ferimentos', 'doencas', 'equipamentos',
    'habilidades', 'insanidade'
];

const NUMBER_FIELDS = ['vitalidade', 'mental', 'pn', 'instinto', 'mente', 'corpo'];

// ==========================================================================
// INICIALIZAÇÃO DO FIREBASE & PORTAL DE ACESSO
// ==========================================================================
function sanitizeSlug(raw, fallback) {
    const clean = String(raw || '')
        .trim()
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return clean || fallback;
}

function setSyncStatus(mode, text) {
    const badge = document.getElementById('save-badge');
    const label = document.getElementById('save-status-text');
    if (!badge || !label) return;
    badge.classList.remove('syncing', 'offline');
    if (mode === 'syncing') badge.classList.add('syncing');
    if (mode === 'offline') badge.classList.add('offline');
    label.textContent = text;
}

function initFirebase() {
    if (!FIREBASE_DATABASE_URL || FIREBASE_DATABASE_URL.includes('COLE_AQUI')) {
        setSyncStatus('offline', 'Falta URL do Firebase');
        return false;
    }
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp({ databaseURL: FIREBASE_DATABASE_URL });
        }
        db = firebase.database();
        db.ref('.info/connected').on('value', (snap) => {
            if (snap.val() === true) {
                setSyncStatus('online', 'Sincronizado na nuvem');
            } else {
                setSyncStatus('offline', 'Offline (salvo local)');
            }
        });
        return true;
    } catch (err) {
        console.error('Erro Firebase:', err);
        setSyncStatus('offline', 'Erro na nuvem');
        return false;
    }
}

function selectPortalRole(role) {
    selectedPortalRole = role;
    document.getElementById('role-btn-player').classList.toggle('active', role === 'player');
    document.getElementById('role-btn-master').classList.toggle('active', role === 'master');

    const idLabel = document.getElementById('portal-id-label');
    const idInput = document.getElementById('portal-user-id');
    const pinGroup = document.getElementById('portal-pin-group');

    if (role === 'master') {
        idLabel.textContent = 'Seu ID de Mestre';
        idInput.placeholder = 'ex: mestre-carlos';
        pinGroup.style.display = 'flex';
    } else {
        idLabel.textContent = 'Seu ID de Sobrevivente';
        idInput.placeholder = 'ex: renato-01';
        pinGroup.style.display = 'none';
    }
}

async function enterSession() {
    const campaign = sanitizeSlug(document.getElementById('portal-campaign').value, 'campanha-01');
    const userId = sanitizeSlug(document.getElementById('portal-user-id').value, selectedPortalRole === 'master' ? 'mestre' : 'sobrevivente-01');
    const pin = document.getElementById('portal-master-pin').value.trim();

    if (selectedPortalRole === 'master' && db) {
        try {
            const metaRef = db.ref(`campaigns/${campaign}/meta`);
            const snap = await metaRef.once('value');
            const meta = snap.val();

            if (meta && meta.masterPin && meta.masterPin !== pin) {
                showToast('PIN do Mestre incorreto para esta campanha.');
                return;
            }
            if ((!meta || !meta.masterPin) && pin) {
                await metaRef.update({ masterPin: pin, masterId: userId });
            } else if (!meta) {
                await metaRef.update({ masterId: userId });
            }
        } catch (err) {
            console.warn('Aviso ao verificar PIN:', err);
        }
    }

    sessionConfig = { role: selectedPortalRole, campaignId: campaign, userId: userId };
    localStorage.setItem('infeccao_x_session', JSON.stringify(sessionConfig));

    const url = new URL(window.location.href);
    url.searchParams.set('mesa', campaign);
    url.searchParams.set('id', userId);
    url.searchParams.set('papel', selectedPortalRole);
    window.history.replaceState({}, '', url.toString());

    launchWorkspace();
}

function switchAccountPortal() {
    if (playerDbRef) playerDbRef.off();
    if (typeof detachMasterListeners === 'function') detachMasterListeners();

    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('portal-screen').classList.remove('hidden');
}

function launchWorkspace() {
    document.getElementById('portal-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    const isMaster = sessionConfig.role === 'master';
    document.getElementById('header-role-title').textContent = isMaster ? 'ESCUDO DO MESTRE' : 'FICHA DE SOBREVIVENTE';
    document.getElementById('session-badge-info').textContent = `MESA: ${sessionConfig.campaignId.toUpperCase()} // ID: ${sessionConfig.userId.toUpperCase()}`;

    // Alterna menus e visões
    document.getElementById('player-tabs').classList.toggle('hidden', isMaster);
    document.getElementById('player-view').classList.toggle('hidden', isMaster);
    document.getElementById('btn-backup-json').classList.toggle('hidden', isMaster);
    document.getElementById('btn-load-json').classList.toggle('hidden', isMaster);

    document.getElementById('master-tabs').classList.toggle('hidden', !isMaster);
    document.getElementById('master-view').classList.toggle('hidden', !isMaster);

    if (isMaster) {
        if (typeof initMasterWorkspace === 'function') {
            initMasterWorkspace(sessionConfig.campaignId, sessionConfig.userId);
        }
    } else {
        initPlayerWorkspace();
    }
}

function copySessionLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        showToast('Link direto copiado!');
    }).catch(() => {
        showToast('Copie o link da barra do navegador.');
    });
}

// ==========================================================================
// WORKSPACE DO JOGADOR (FICHA + VISÃO DA MESA)
// ==========================================================================
function initPlayerWorkspace() {
    const cacheKey = `infeccao_x_${sessionConfig.campaignId}_${sessionConfig.userId}`;
    try {
        const cached = localStorage.getItem(cacheKey);
        fichaState = cached ? normalizeImportedData(JSON.parse(cached)) : createDefaultState();
    } catch (e) {
        fichaState = createDefaultState();
    }
    renderStateToDOM();

    if (!db) return;

    if (playerDbRef) playerDbRef.off();
    setSyncStatus('syncing', 'Carregando ficha...');

    playerDbRef = db.ref(`campaigns/${sessionConfig.campaignId}/players/${sessionConfig.userId}`);
    playerDbRef.on('value', (snap) => {
        const remote = snap.val();
        if (remote && typeof remote === 'object') {
            isApplyingRemoteUpdate = true;
            fichaState = normalizeImportedData(remote);
            localStorage.setItem(cacheKey, JSON.stringify(fichaState));
            renderStateToDOM();
            isApplyingRemoteUpdate = false;
            setSyncStatus('online', 'Sincronizado na nuvem');
        } else {
            pushPlayerStateNow();
        }
    });

    // Escuta o que o Mestre libera na campanha (Mapas, NPCs, Itens)
    listenTableVisionForPlayer();
}

function listenTableVisionForPlayer() {
    if (!db) return;
    const baseRef = db.ref(`campaigns/${sessionConfig.campaignId}`);

    // 1. Mapa Ativo
    baseRef.child('activeMapId').on('value', async (snap) => {
        const activeMapId = snap.val();
        const imgEl = document.getElementById('player-map-img');
        const emptyEl = document.getElementById('player-map-empty');
        const titleEl = document.getElementById('player-map-title');

        if (!activeMapId) {
            imgEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            titleEl.textContent = 'Nenhum mapa transmitido';
            return;
        }

        const mapSnap = await baseRef.child(`maps/${activeMapId}`).once('value');
        const mapData = mapSnap.val();
        if (mapData && mapData.imageData) {
            imgEl.src = mapData.imageData;
            imgEl.classList.remove('hidden');
            emptyEl.classList.add('hidden');
            titleEl.textContent = mapData.name || 'Mapa da Cena';
            pingVisionTab();
        }
    });

    // 2. NPCs & Personagens Visíveis
    baseRef.child('entities').on('value', (snap) => {
        const data = snap.val() || {};
        const visibleList = Object.values(data).filter(item => item && item.visible === true);
        renderPlayerVisionCards('player-visible-entities', visibleList, 'Nenhum personagem ou criatura revelado pelo Mestre.');
        if (visibleList.length > 0) pingVisionTab();
    });

    // 3. Itens & Pistas Visíveis
    baseRef.child('items').on('value', (snap) => {
        const data = snap.val() || {};
        const visibleList = Object.values(data).filter(item => item && item.visible === true);
        renderPlayerVisionCards('player-visible-items', visibleList, 'Nenhum item ou pista revelado pelo Mestre.');
        if (visibleList.length > 0) pingVisionTab();
    });
}

function pingVisionTab() {
    const page3 = document.getElementById('page-3');
    if (page3 && page3.classList.contains('hidden')) {
        document.getElementById('vision-live-dot').classList.remove('hidden');
    }
}

function renderPlayerVisionCards(containerId, list, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-box">${emptyMessage}</div>`;
        return;
    }

    list.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'entity-card is-visible';
        card.innerHTML = `
            ${entry.imageData ? `<img src="${entry.imageData}" alt="${escapeHtml(entry.name)}" class="entity-thumb">` : ''}
            <div class="entity-info">
                <div class="entity-title">${escapeHtml(entry.name || 'Sem nome')}</div>
                ${entry.role ? `<div class="entity-sub">${escapeHtml(entry.role)}</div>` : ''}
                ${entry.desc ? `<div class="entity-desc">${escapeHtml(entry.desc)}</div>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function zoomPlayerMap(delta) {
    currentMapZoom = Math.min(2.5, Math.max(0.5, currentMapZoom + delta));
    const img = document.getElementById('player-map-img');
    if (img) img.style.transform = `scale(${currentMapZoom})`;
}

function resetPlayerMapZoom() {
    currentMapZoom = 1;
    const img = document.getElementById('player-map-img');
    if (img) img.style.transform = 'scale(1)';
}

// ==========================================================================
// NAVEGAÇÃO DE ABAS DO JOGADOR & SALVAMENTO AUTOMÁTICO
// ==========================================================================
function switchPlayerPage(num) {
    [1, 2, 3].forEach(n => {
        document.getElementById('page-' + n).classList.toggle('hidden', n !== num);
        document.getElementById('tab-btn-' + n).classList.toggle('active', n === num);
    });
    if (num === 3) {
        document.getElementById('vision-live-dot').classList.add('hidden');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scheduleSave() {
    if (isApplyingRemoteUpdate) return;
    fichaState.updatedAt = Date.now();
    const cacheKey = `infeccao_x_${sessionConfig.campaignId}_${sessionConfig.userId}`;
    localStorage.setItem(cacheKey, JSON.stringify(fichaState));

    if (!playerDbRef) return;
    setSyncStatus('syncing', 'Salvando na nuvem...');
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
        pushPlayerStateNow();
    }, 500);
}

function pushPlayerStateNow() {
    if (!playerDbRef) return;
    playerDbRef.set(JSON.parse(JSON.stringify(fichaState)))
        .then(() => setSyncStatus('online', 'Salvo na nuvem'))
        .catch(() => setSyncStatus('offline', 'Erro ao enviar (salvo local)'));
}

function adjustNumberField(fieldName, delta) {
    const input = document.getElementById('field-' + fieldName);
    if (!input) return;
    const next = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
    input.value = next;
    fichaState[fieldName] = next;
    scheduleSave();
}

function handleFieldChange() {
    TEXT_FIELDS.forEach(key => {
        const el = document.getElementById('field-' + key);
        if (el) fichaState[key] = el.value;
    });
    NUMBER_FIELDS.forEach(key => {
        const el = document.getElementById('field-' + key);
        if (el) {
            const parsed = parseInt(el.value, 10);
            fichaState[key] = isNaN(parsed) ? 0 : Math.max(0, parsed);
        }
    });
    scheduleSave();
}

function renderStateToDOM() {
    const activeEl = document.activeElement;
    TEXT_FIELDS.forEach(key => {
        const el = document.getElementById('field-' + key);
        if (el && el !== activeEl) el.value = fichaState[key] || '';
    });
    NUMBER_FIELDS.forEach(key => {
        const el = document.getElementById('field-' + key);
        if (el && el !== activeEl) el.value = fichaState[key] ?? 0;
    });
    updateAvatarUI();
    renderBackpack();
}

// ==========================================================================
// AVATAR & MOCHILA DO JOGADOR
// ==========================================================================
function triggerAvatarInput() { document.getElementById('avatar-file-input').click(); }

function handleAvatarSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    compressImageFile(file, 280, 0.78, (base64) => {
        fichaState.avatar = base64;
        updateAvatarUI();
        scheduleSave();
        showToast('Foto sincronizada na nuvem!');
    });
    event.target.value = '';
}

function removeAvatar() {
    fichaState.avatar = '';
    updateAvatarUI();
    scheduleSave();
}

function updateAvatarUI() {
    const imgEl = document.getElementById('avatar-img');
    const placeholderEl = document.getElementById('avatar-placeholder');
    const boxEl = document.getElementById('avatar-box');
    const removeBtn = document.getElementById('btn-remove-avatar');

    if (fichaState.avatar) {
        imgEl.src = fichaState.avatar;
        imgEl.style.display = 'block';
        placeholderEl.style.display = 'none';
        boxEl.classList.add('has-image');
        removeBtn.style.display = 'inline-flex';
    } else {
        imgEl.src = '';
        imgEl.style.display = 'none';
        placeholderEl.style.display = 'flex';
        boxEl.classList.remove('has-image');
        removeBtn.style.display = 'none';
    }
}

function generateItemId() { return 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6); }

function addBackpackItem() {
    if (!Array.isArray(fichaState.mochila)) fichaState.mochila = [];
    fichaState.mochila.push({ id: generateItemId(), nome: '', descricao: '' });
    renderBackpack();
    scheduleSave();
}

function updateBackpackItem(id, key, value) {
    const item = fichaState.mochila.find(it => it.id === id);
    if (item) {
        item[key] = value;
        scheduleSave();
    }
}

function removeBackpackItem(id) {
    fichaState.mochila = fichaState.mochila.filter(it => it.id !== id);
    renderBackpack();
    scheduleSave();
}

function renderBackpack() {
    const listEl = document.getElementById('backpack-list');
    const countEl = document.getElementById('backpack-count');
    const items = Array.isArray(fichaState.mochila) ? fichaState.mochila : [];

    countEl.textContent = items.length === 1 ? '(1 item)' : `(${items.length} itens)`;
    if (listEl.contains(document.activeElement) && listEl.children.length === items.length) return;

    listEl.innerHTML = '';
    if (items.length === 0) {
        listEl.innerHTML = '<div class="backpack-empty">Mochila vazia. Clique em "+ Adicionar Item".</div>';
        return;
    }

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'item-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'input-control';
        nameInput.placeholder = 'Nome do item';
        nameInput.value = item.nome || '';
        nameInput.addEventListener('input', (e) => updateBackpackItem(item.id, 'nome', e.target.value));

        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.className = 'input-control';
        descInput.placeholder = 'O que o item faz / quantidade...';
        descInput.value = item.descricao || '';
        descInput.addEventListener('input', (e) => updateBackpackItem(item.id, 'descricao', e.target.value));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'item-remove-btn';
        delBtn.textContent = 'X';
        delBtn.addEventListener('click', () => removeBackpackItem(item.id));

        row.appendChild(nameInput);
        row.appendChild(descInput);
        row.appendChild(delBtn);
        listEl.appendChild(row);
    });
}

// ==========================================================================
// UTILITÁRIOS COMPARTILHADOS (COMPRESSÃO DE IMAGEM, BACKUP, TOAST)
// ==========================================================================
function compressImageFile(file, maxDimension, quality, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            let w = img.width;
            let h = img.height;
            if (w > h && w > maxDimension) {
                h = Math.round(h * (maxDimension / w));
                w = maxDimension;
            } else if (h > maxDimension) {
                w = Math.round(w * (maxDimension / h));
                h = maxDimension;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            callback(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeImportedData(data) {
    const base = createDefaultState();
    if (!data || typeof data !== 'object') return base;
    TEXT_FIELDS.forEach(k => { if (typeof data[k] === 'string') base[k] = data[k]; });
    NUMBER_FIELDS.forEach(k => {
        if (data[k] !== undefined && !isNaN(parseInt(data[k], 10))) base[k] = Math.max(0, parseInt(data[k], 10));
    });
    if (typeof data.avatar === 'string') base.avatar = data.avatar;
    if (Array.isArray(data.mochila)) {
        base.mochila = data.mochila.map(it => ({
            id: it.id || generateItemId(),
            nome: String(it.nome || ''),
            descricao: String(it.descricao || '')
        }));
    }
    return base;
}

function saveFichaFile() {
    handleFieldChange();
    const blob = new Blob([JSON.stringify(fichaState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sessionConfig.userId}_infeccao_x.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function loadFichaFile() { document.getElementById('json-file-input').click(); }

function handleFallbackJsonUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            fichaState = normalizeImportedData(JSON.parse(e.target.result));
            renderStateToDOM();
            pushPlayerStateNow();
            showToast('Backup importado para a nuvem!');
        } catch (err) {
            showToast('Arquivo .json inválido.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function openResetModal() { document.getElementById('reset-modal').classList.remove('hidden'); }
function closeResetModal() { document.getElementById('reset-modal').classList.add('hidden'); }
function confirmResetFicha() {
    fichaState = createDefaultState();
    renderStateToDOM();
    pushPlayerStateNow();
    closeResetModal();
    showToast('Ficha limpa na nuvem.');
}

function toggleScanlines() {
    document.getElementById('scanline-overlay').classList.toggle('hidden-scanline');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ==========================================================================
// BOOTSTRAP DA APLICAÇÃO
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    initFirebase();

    const params = new URLSearchParams(window.location.search);
    const urlMesa = params.get('mesa');
    const urlId = params.get('id');
    const urlPapel = params.get('papel');

    if (urlMesa && urlId) {
        sessionConfig = {
            campaignId: sanitizeSlug(urlMesa, 'campanha-01'),
            userId: sanitizeSlug(urlId, 'sobrevivente-01'),
            role: urlPapel === 'master' ? 'master' : 'player'
        };
        if (sessionConfig.role === 'player') {
            launchWorkspace();
            return;
        }
        // Se for link de mestre, preenche o portal e pede confirmação/PIN
        selectPortalRole('master');
        document.getElementById('portal-campaign').value = sessionConfig.campaignId;
        document.getElementById('portal-user-id').value = sessionConfig.userId;
        return;
    }

    const saved = localStorage.getItem('infeccao_x_session');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            selectPortalRole(parsed.role === 'master' ? 'master' : 'player');
            document.getElementById('portal-campaign').value = parsed.campaignId || 'campanha-01';
            document.getElementById('portal-user-id').value = parsed.userId || '';
        } catch (e) {}
    }
});
