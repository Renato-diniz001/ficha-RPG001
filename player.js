// ==========================================================================
// 1. COLE AQUI A URL DO SEU FIREBASE REALTIME DATABASE:
// Exemplo: "https://ficha-infeccao-x-default-rtdb.firebaseio.com"
// ==========================================================================
const FIREBASE_DATABASE_URL = "https://ficha-infeccao-x-default-rtdb.firebaseio.com/";

const BASE_CARRY_CAPACITY = 4;
const LOCAL_ROSTER_STORAGE_KEY = "infeccao_x_local_roster_v1";

let db = null;
let selectedPortalRole = 'player';
let sessionConfig = {
    role: 'player',       // 'player', 'standalone', 'master'
    campaignId: 'campanha-01',
    userId: 'sobrevivente-01'
};

let playerDbRef = null;
let playerPresenceRef = null;
let cloudSaveTimer = null;
let isApplyingRemoteUpdate = false;
let toastTimer = null;
let currentMapZoom = 1;
let knownBackpackIds = new Set();
let hasLoadedInitialBackpack = false;

// Estado local de Áudio do Jogador
let playerAudioUnlocked = false;
let currentPlayingAudioId = null;

function createDefaultState() {
    return {
        version: 8,
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
// GERENCIAMENTO LOCAL DE PERSONAGENS (SEM PRECISAR DE CAMPANHA)
// ==========================================================================
function getLocalRosterMap() {
    try {
        const raw = localStorage.getItem(LOCAL_ROSTER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveCharacterToLocalRoster(charId, stateObj) {
    if (!charId) return;
    const roster = getLocalRosterMap();
    roster[charId] = {
        id: charId,
        state: normalizeImportedData(stateObj),
        savedAt: Date.now()
    };
    localStorage.setItem(LOCAL_ROSTER_STORAGE_KEY, JSON.stringify(roster));
}

function deleteCharacterFromLocalRoster(charId) {
    const roster = getLocalRosterMap();
    delete roster[charId];
    localStorage.setItem(LOCAL_ROSTER_STORAGE_KEY, JSON.stringify(roster));
    renderLocalRosterUI();
    populateSavedCharSelect();
    showToast(`Personagem "${charId}" removido deste aparelho.`);
}

function createNewLocalCharacter() {
    const input = document.getElementById('new-local-char-id');
    const raw = input.value.trim();
    if (!raw) {
        showToast('Digite um nome ou ID para o novo personagem.');
        return;
    }
    const charId = sanitizeSlug(raw, 'sobrevivente-' + Date.now());
    const roster = getLocalRosterMap();
    if (!roster[charId]) {
        const fresh = createDefaultState();
        fresh.nome = raw;
        saveCharacterToLocalRoster(charId, fresh);
    }
    input.value = '';
    openCharacterStandalone(charId);
}

function openCharacterStandalone(charId) {
    sessionConfig = {
        role: 'standalone',
        campaignId: '',
        userId: charId
    };
    launchWorkspace();
}

function joinCampaignWithRosterChar(charId) {
    selectPortalRole('player');
    const select = document.getElementById('portal-saved-char-select');
    if (select) select.value = charId;
    document.getElementById('portal-user-id').value = charId;
    document.getElementById('portal-campaign').focus();
    showToast(`Personagem "${charId}" selecionado! Informe o código da campanha e clique em Acessar Terminal.`);
}

function applySelectedRosterCharacterToPortal() {
    const select = document.getElementById('portal-saved-char-select');
    if (!select) return;
    const chosenId = select.value;
    if (chosenId) {
        document.getElementById('portal-user-id').value = chosenId;
    }
}

function populateSavedCharSelect() {
    const select = document.getElementById('portal-saved-char-select');
    if (!select) return;
    const roster = getLocalRosterMap();
    const list = Object.values(roster).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    select.innerHTML = '<option value="">-- Digitar ID manualmente ou escolher salvo --</option>';
    list.forEach(entry => {
        const title = (entry.state && (entry.state.nome || entry.state.apelido))
            ? `${entry.state.nome || entry.state.apelido} (${entry.id})`
            : entry.id;
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = title;
        select.appendChild(opt);
    });
}

function renderLocalRosterUI() {
    const container = document.getElementById('local-roster-list');
    if (!container) return;
    const roster = getLocalRosterMap();
    const list = Object.values(roster).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    if (list.length === 0) {
        container.innerHTML = '<div class="empty-state-box">Nenhum personagem criado neste aparelho ainda. Digite um nome acima e clique em "+ Criar Ficha".</div>';
        return;
    }

    container.innerHTML = '';
    list.forEach(entry => {
        const st = entry.state || createDefaultState();
        const displayName = st.nome || st.apelido || entry.id;
        const card = document.createElement('div');
        card.className = 'roster-char-card';
        card.innerHTML = `
            <div class="roster-char-top">
                <div>
                    <strong>${escapeHtml(displayName)}</strong>
                    <div class="section-hint">ID: ${escapeHtml(entry.id)} &bull; VIT ${st.vitalidade ?? 10} | MEN ${st.mental ?? 10}</div>
                </div>
                <span class="visibility-pill visible">LOCAL</span>
            </div>
            <div class="roster-char-actions">
                <button type="button" class="btn-mini" onclick="openCharacterStandalone('${escapeHtml(entry.id)}')">Editar Ficha</button>
                <button type="button" class="btn-mini btn-success" onclick="joinCampaignWithRosterChar('${escapeHtml(entry.id)}')">Entrar em Campanha</button>
                <button type="button" class="btn-mini danger" onclick="deleteCharacterFromLocalRoster('${escapeHtml(entry.id)}')">Excluir</button>
            </div>
        `;
        container.appendChild(card);
    });
}

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
            if (sessionConfig.role === 'standalone') return;
            if (snap.val() === true) {
                setSyncStatus('online', 'Sincronizado na nuvem');
                if (sessionConfig.role === 'player' && sessionConfig.campaignId && sessionConfig.userId) {
                    registerPlayerOnlinePresence(sessionConfig.campaignId, sessionConfig.userId);
                }
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
    document.getElementById('role-btn-roster').classList.toggle('active', role === 'roster');
    document.getElementById('role-btn-master').classList.toggle('active', role === 'master');

    const sessionForm = document.getElementById('portal-form-session');
    const rosterPanel = document.getElementById('portal-roster-panel');

    if (role === 'roster') {
        sessionForm.classList.add('hidden');
        rosterPanel.classList.remove('hidden');
        renderLocalRosterUI();
        return;
    }

    sessionForm.classList.remove('hidden');
    rosterPanel.classList.add('hidden');
    populateSavedCharSelect();

    const idLabel = document.getElementById('portal-id-label');
    const idInput = document.getElementById('portal-user-id');
    const pinGroup = document.getElementById('portal-pin-group');
    const savedPickerGroup = document.getElementById('portal-saved-char-picker-group');

    if (role === 'master') {
        idLabel.textContent = 'Seu ID de Mestre';
        idInput.placeholder = 'ex: mestre-carlos';
        pinGroup.style.display = 'flex';
        savedPickerGroup.style.display = 'none';
    } else {
        idLabel.textContent = 'Seu ID de Sobrevivente';
        idInput.placeholder = 'ex: renato-01';
        pinGroup.style.display = 'none';
        savedPickerGroup.style.display = 'flex';
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

    playerAudioUnlocked = true;

    sessionConfig = { role: selectedPortalRole, campaignId: campaign, userId: userId };
    localStorage.setItem('infeccao_x_session', JSON.stringify(sessionConfig));

    const url = new URL(window.location.href);
    url.searchParams.set('mesa', campaign);
    url.searchParams.set('id', userId);
    url.searchParams.set('papel', selectedPortalRole);
    window.history.replaceState({}, '', url.toString());

    launchWorkspace();
}

// ==========================================================================
// PRESENÇA ONLINE DO JOGADOR (ENTRA E SAI LIMPO DA LISTA DO MESTRE)
// ==========================================================================
function registerPlayerOnlinePresence(campaignId, userId) {
    if (!db || !campaignId || !userId) return;
    if (playerPresenceRef) {
        playerPresenceRef.onDisconnect().cancel();
    }
    playerPresenceRef = db.ref(`campaigns/${campaignId}/onlinePlayers/${userId}`);
    playerPresenceRef.set({
        online: true,
        joinedAt: Date.now()
    });
    playerPresenceRef.onDisconnect().remove();
}

async function removePlayerOnlinePresence() {
    if (playerPresenceRef) {
        try {
            await playerPresenceRef.onDisconnect().cancel();
            await playerPresenceRef.remove();
        } catch (e) {}
        playerPresenceRef = null;
    }
}

async function switchAccountPortal() {
    if (sessionConfig.role === 'player') {
        await removePlayerOnlinePresence();
    }
    if (playerDbRef) {
        playerDbRef.off();
        playerDbRef = null;
    }
    if (typeof detachMasterListeners === 'function') detachMasterListeners();

    hasLoadedInitialBackpack = false;
    knownBackpackIds.clear();
    stopLocalAudioEngine();

    // Limpa os parâmetros da URL para não reconectar sozinho ao recarregar
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('mesa');
    cleanUrl.searchParams.delete('id');
    cleanUrl.searchParams.delete('papel');
    window.history.replaceState({}, '', cleanUrl.toString());

    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('portal-screen').classList.remove('hidden');

    if (sessionConfig.role === 'standalone') {
        selectPortalRole('roster');
    } else {
        selectPortalRole(sessionConfig.role === 'master' ? 'master' : 'player');
    }
}

function launchWorkspace() {
    document.getElementById('portal-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    const isMaster = sessionConfig.role === 'master';
    const isStandalone = sessionConfig.role === 'standalone';

    if (isMaster) {
        document.getElementById('header-role-title').textContent = 'ESCUDO DO MESTRE';
        document.getElementById('session-badge-info').textContent = `MESA: ${sessionConfig.campaignId.toUpperCase()} // ID: ${sessionConfig.userId.toUpperCase()}`;
    } else if (isStandalone) {
        document.getElementById('header-role-title').textContent = 'OFICINA DE PERSONAGEM (SEM MESA)';
        document.getElementById('session-badge-info').textContent = `PERSONAGEM LOCAL // ID: ${sessionConfig.userId.toUpperCase()}`;
        setSyncStatus('online', 'Salvo neste aparelho');
    } else {
        document.getElementById('header-role-title').textContent = 'FICHA DE SOBREVIVENTE';
        document.getElementById('session-badge-info').textContent = `MESA: ${sessionConfig.campaignId.toUpperCase()} // ID: ${sessionConfig.userId.toUpperCase()}`;
    }

    document.getElementById('player-tabs').classList.toggle('hidden', isMaster);
    document.getElementById('player-view').classList.toggle('hidden', isMaster);
    document.getElementById('tab-btn-3').classList.toggle('hidden', isStandalone);
    document.getElementById('btn-join-campaign-from-standalone').classList.toggle('hidden', !isStandalone);
    document.getElementById('btn-copy-link').classList.toggle('hidden', isStandalone);

    document.getElementById('btn-backup-json').classList.toggle('hidden', isMaster);
    document.getElementById('btn-load-json').classList.toggle('hidden', isMaster);
    document.getElementById('player-audio-bar').classList.add('hidden');

    document.getElementById('master-tabs').classList.toggle('hidden', !isMaster);
    document.getElementById('master-view').classList.toggle('hidden', !isMaster);

    switchPlayerPage(1);

    if (isMaster) {
        if (typeof initMasterWorkspace === 'function') {
            initMasterWorkspace(sessionConfig.campaignId, sessionConfig.userId);
        }
    } else if (isStandalone) {
        initStandaloneCharacterWorkspace();
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
// CONECTAR PERSONAGEM CRIADO SEM MESA EM UMA CAMPANHA
// ==========================================================================
function promptJoinCampaignFromStandalone() {
    document.getElementById('join-campaign-modal').classList.remove('hidden');
}

function closeJoinCampaignModal() {
    document.getElementById('join-campaign-modal').classList.add('hidden');
}

function confirmJoinCampaignFromStandalone() {
    const campInput = document.getElementById('standalone-target-campaign');
    const campaign = sanitizeSlug(campInput.value, 'campanha-01');
    saveCharacterToLocalRoster(sessionConfig.userId, fichaState);

    closeJoinCampaignModal();
    sessionConfig = {
        role: 'player',
        campaignId: campaign,
        userId: sessionConfig.userId
    };
    localStorage.setItem('infeccao_x_session', JSON.stringify(sessionConfig));

    const url = new URL(window.location.href);
    url.searchParams.set('mesa', campaign);
    url.searchParams.set('id', sessionConfig.userId);
    url.searchParams.set('papel', 'player');
    window.history.replaceState({}, '', url.toString());

    launchWorkspace();
    showToast(`Conectado na campanha "${campaign}" com ${sessionConfig.userId}!`);
}

// ==========================================================================
// CÁLCULO AUTOMÁTICO DE PESO DA MOCHILA (ESTILO C.R.I.S.)
// ==========================================================================
function calculateBackpackWeightStats(items) {
    const list = Array.isArray(items) ? items : [];
    let usedWeight = 0;
    let bonusCapacity = 0;

    list.forEach(item => {
        const w = parseFloat(item.peso);
        if (isNaN(w)) return;
        if (w < 0) {
            bonusCapacity += Math.abs(w);
        } else {
            usedWeight += w;
        }
    });

    const maxCapacity = BASE_CARRY_CAPACITY + bonusCapacity;
    const freeSpace = maxCapacity - usedWeight;

    return {
        usedWeight: Number(usedWeight.toFixed(2)),
        bonusCapacity: Number(bonusCapacity.toFixed(2)),
        maxCapacity: Number(maxCapacity.toFixed(2)),
        freeSpace: Number(freeSpace.toFixed(2))
    };
}

function updateWeightUI() {
    const stats = calculateBackpackWeightStats(fichaState.mochila);
    const pill = document.getElementById('weight-meter-pill');
    const summaryText = document.getElementById('weight-summary-text');
    const barFill = document.getElementById('weight-bar-fill');
    const bonusLabel = document.getElementById('weight-bonus-label');
    const alertLabel = document.getElementById('weight-status-alert');

    if (!pill || !summaryText) return;

    const isOver = stats.usedWeight > stats.maxCapacity;
    pill.classList.toggle('overweight', isOver);

    const freeDisplay = stats.freeSpace >= 0 ? `Livre: ${stats.freeSpace}` : `Excesso: +${Math.abs(stats.freeSpace)}`;
    summaryText.textContent = `Carga: ${stats.usedWeight} / ${stats.maxCapacity} (${freeDisplay})`;

    bonusLabel.textContent = stats.bonusCapacity > 0 ? `(+${stats.bonusCapacity} de mochila/expansão)` : '';

    const pct = stats.maxCapacity > 0 ? Math.min(100, (stats.usedWeight / stats.maxCapacity) * 100) : 100;
    barFill.style.width = `${pct}%`;
    barFill.classList.remove('warning', 'overload');
    if (isOver) {
        barFill.classList.add('overload');
        alertLabel.className = 'weight-danger';
        alertLabel.textContent = 'SOBRECARGA! Reduza itens ou equipe uma mochila.';
    } else if (pct >= 80) {
        barFill.classList.add('warning');
        alertLabel.className = 'weight-ok';
        alertLabel.textContent = 'Quase no limite de carga';
    } else {
        alertLabel.className = 'weight-ok';
        alertLabel.textContent = 'Capacidade normal';
    }
}

// ==========================================================================
// WORKSPACE STANDALONE (CRIAR / EDITAR PERSONAGEM FORA DE CAMPANHA)
// ==========================================================================
function initStandaloneCharacterWorkspace() {
    const roster = getLocalRosterMap();
    const saved = roster[sessionConfig.userId];
    fichaState = saved && saved.state ? normalizeImportedData(saved.state) : createDefaultState();
    saveCharacterToLocalRoster(sessionConfig.userId, fichaState);
    renderStateToDOM();
}

// ==========================================================================
// WORKSPACE DO JOGADOR EM CAMPANHA (FICHA + PRESENÇA + VISÃO DA MESA)
// ==========================================================================
function initPlayerWorkspace() {
    const roster = getLocalRosterMap();
    const cacheKey = `infeccao_x_${sessionConfig.campaignId}_${sessionConfig.userId}`;
    let initialLocalState = null;

    if (roster[sessionConfig.userId] && roster[sessionConfig.userId].state) {
        initialLocalState = normalizeImportedData(roster[sessionConfig.userId].state);
    } else {
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) initialLocalState = normalizeImportedData(JSON.parse(cached));
        } catch (e) {}
    }

    fichaState = initialLocalState || createDefaultState();
    renderStateToDOM();

    if (!db) return;

    registerPlayerOnlinePresence(sessionConfig.campaignId, sessionConfig.userId);

    if (playerDbRef) playerDbRef.off();
    setSyncStatus('syncing', 'Carregando ficha...');

    playerDbRef = db.ref(`campaigns/${sessionConfig.campaignId}/players/${sessionConfig.userId}`);
    playerDbRef.on('value', (snap) => {
        const remote = snap.val();
        if (remote && typeof remote === 'object') {
            const normalized = normalizeImportedData(remote);

            if (hasLoadedInitialBackpack) {
                normalized.mochila.forEach(item => {
                    if (!knownBackpackIds.has(item.id) && item.fromMaster) {
                        showToast(`O Mestre enviou "${item.nome}" para sua mochila!`);
                    }
                });
            }
            knownBackpackIds = new Set(normalized.mochila.map(i => i.id));
            hasLoadedInitialBackpack = true;

            isApplyingRemoteUpdate = true;
            fichaState = normalized;
            localStorage.setItem(cacheKey, JSON.stringify(fichaState));
            saveCharacterToLocalRoster(sessionConfig.userId, fichaState);
            renderStateToDOM();
            isApplyingRemoteUpdate = false;
            setSyncStatus('online', 'Sincronizado na nuvem');
        } else {
            hasLoadedInitialBackpack = true;
            pushPlayerStateNow();
        }
    });

    listenTableVisionForPlayer();
}

function listenTableVisionForPlayer() {
    if (!db) return;
    const baseRef = db.ref(`campaigns/${sessionConfig.campaignId}`);

    baseRef.child('activeMapId').on('value', async (snap) => {
        const activeMapId = snap.val();
        const stageEl = document.getElementById('player-map-stage');
        const imgEl = document.getElementById('player-map-img');
        const emptyEl = document.getElementById('player-map-empty');
        const titleEl = document.getElementById('player-map-title');

        if (!activeMapId) {
            stageEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            titleEl.textContent = 'Nenhum mapa transmitido';
            return;
        }

        const mapSnap = await baseRef.child(`maps/${activeMapId}`).once('value');
        const mapData = mapSnap.val();
        if (mapData && mapData.imageData) {
            imgEl.src = mapData.imageData;
            stageEl.classList.remove('hidden');
            emptyEl.classList.add('hidden');
            titleEl.textContent = mapData.name || 'Mapa da Cena';
            pingVisionTab();
        }
    });

    baseRef.child('mapPins').on('value', (snap) => {
        renderInteractiveMapPins('player-pins-layer', snap.val() || {}, false);
    });

    baseRef.child('entities').on('value', (snap) => {
        const data = snap.val() || {};
        const visibleList = Object.values(data).filter(item => item && item.visible === true);
        renderPlayerVisionCards('player-visible-entities', visibleList, 'Nenhum personagem ou criatura revelado pelo Mestre.');
        if (visibleList.length > 0) pingVisionTab();
    });

    baseRef.child('items').on('value', (snap) => {
        const data = snap.val() || {};
        const visibleList = Object.values(data).filter(item => item && item.visible === true);
        renderPlayerVisionCards('player-visible-items', visibleList, 'Nenhum item ou pista revelado pelo Mestre.');
        if (visibleList.length > 0) pingVisionTab();
    });

    baseRef.child('activeAudio').on('value', async (snap) => {
        const activeMeta = snap.val();
        const bar = document.getElementById('player-audio-bar');
        const titleEl = document.getElementById('player-audio-title');
        const unmuteBtn = document.getElementById('btn-player-unmute');
        const audioEl = document.getElementById('native-table-audio');

        if (!activeMeta || !activeMeta.id) {
            currentPlayingAudioId = null;
            bar.classList.add('hidden');
            stopLocalAudioEngine();
            return;
        }

        bar.classList.remove('hidden');
        titleEl.textContent = activeMeta.name || 'Carregando trilha...';

        if (currentPlayingAudioId === activeMeta.id && audioEl && audioEl.src) {
            return;
        }

        currentPlayingAudioId = activeMeta.id;
        const trackSnap = await baseRef.child(`audioLibrary/${activeMeta.id}`).once('value');
        const track = trackSnap.val();

        if (!track || !track.audioData) {
            titleEl.textContent = 'Faixa indisponível';
            return;
        }

        titleEl.textContent = track.name || activeMeta.name;
        const vol = parseInt(document.getElementById('player-local-volume').value, 10) || 75;
        audioEl.src = track.audioData;
        audioEl.volume = vol / 100;

        audioEl.play().then(() => {
            playerAudioUnlocked = true;
            unmuteBtn.classList.add('hidden');
        }).catch(() => {
            playerAudioUnlocked = false;
            unmuteBtn.classList.remove('hidden');
        });
    });
}

function enablePlayerAudio() {
    const audioEl = document.getElementById('native-table-audio');
    if (!audioEl) return;
    audioEl.play().then(() => {
        playerAudioUnlocked = true;
        document.getElementById('btn-player-unmute').classList.add('hidden');
        showToast('Áudio da mesa ativado!');
    }).catch(() => {
        showToast('Toque novamente para liberar o som no navegador.');
    });
}

function updatePlayerLocalVolume(val) {
    const audioEl = document.getElementById('native-table-audio');
    if (audioEl) {
        audioEl.volume = (parseInt(val, 10) || 0) / 100;
    }
}

function stopLocalAudioEngine() {
    const audioEl = document.getElementById('native-table-audio');
    if (audioEl) {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
    }
}

// ==========================================================================
// LIGHTBOX PARA ABRIR PISTAS, DOCUMENTOS E IMAGENS EM TELA CHEIA
// ==========================================================================
function openEntryLightbox(entry) {
    if (!entry) return;
    document.getElementById('lightbox-title').textContent = entry.name || 'Registro';
    document.getElementById('lightbox-subtitle').textContent = entry.role || '';
    document.getElementById('lightbox-desc').textContent = entry.desc || '';

    const imgWrap = document.getElementById('lightbox-img-wrap');
    const imgEl = document.getElementById('lightbox-img');
    if (entry.imageData) {
        imgEl.src = entry.imageData;
        imgWrap.classList.remove('hidden');
    } else {
        imgEl.src = '';
        imgWrap.classList.add('hidden');
    }

    document.getElementById('lightbox-modal').classList.remove('hidden');
}

function closeLightbox() {
    document.getElementById('lightbox-modal').classList.add('hidden');
}

// ==========================================================================
// SISTEMA DE PINOS ARRASTÁVEIS NO MAPA
// ==========================================================================
let draggingPinId = null;

function renderInteractiveMapPins(layerId, pinsObj, isMasterMode) {
    const layer = document.getElementById(layerId);
    if (!layer) return;
    layer.innerHTML = '';

    Object.values(pinsObj).forEach(pin => {
        if (!pin || !pin.id) return;
        const pinEl = document.createElement('div');
        pinEl.className = 'map-pin';
        pinEl.style.left = `${pin.x ?? 50}%`;
        pinEl.style.top = `${pin.y ?? 50}%`;
        pinEl.dataset.pinId = pin.id;

        const initials = (pin.label || '?').substring(0, 2).toUpperCase();
        pinEl.innerHTML = `
            <div class="pin-token" style="background-color: ${pin.color || '#ef4444'};">
                ${escapeHtml(initials)}
            </div>
            <div class="pin-tag">${escapeHtml(pin.label || 'Pino')}</div>
            ${isMasterMode ? `<button type="button" class="pin-del-badge" title="Remover pino">x</button>` : ''}
        `;

        if (isMasterMode) {
            const delBtn = pinEl.querySelector('.pin-del-badge');
            delBtn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                if (db) db.ref(`campaigns/${sessionConfig.campaignId}/mapPins/${pin.id}`).remove();
            });
        }

        pinEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            draggingPinId = pin.id;
            pinEl.setPointerCapture(e.pointerId);

            const onPointerMove = (moveEvent) => {
                if (draggingPinId !== pin.id) return;
                const rect = layer.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const xPct = Math.min(98, Math.max(2, ((moveEvent.clientX - rect.left) / rect.width) * 100));
                const yPct = Math.min(98, Math.max(2, ((moveEvent.clientY - rect.top) / rect.height) * 100));
                pinEl.style.left = `${xPct.toFixed(2)}%`;
                pinEl.style.top = `${yPct.toFixed(2)}%`;
            };

            const onPointerUp = (upEvent) => {
                if (draggingPinId !== pin.id) return;
                draggingPinId = null;
                pinEl.releasePointerCapture(upEvent.pointerId);
                pinEl.removeEventListener('pointermove', onPointerMove);
                pinEl.removeEventListener('pointerup', onPointerUp);

                const rect = layer.getBoundingClientRect();
                const finalX = Number(Math.min(98, Math.max(2, ((upEvent.clientX - rect.left) / rect.width) * 100)).toFixed(2));
                const finalY = Number(Math.min(98, Math.max(2, ((upEvent.clientY - rect.top) / rect.height) * 100)).toFixed(2));

                if (db) {
                    db.ref(`campaigns/${sessionConfig.campaignId}/mapPins/${pin.id}`).update({
                        x: finalX,
                        y: finalY
                    });
                }
            };

            pinEl.addEventListener('pointermove', onPointerMove);
            pinEl.addEventListener('pointerup', onPointerUp);
        });

        layer.appendChild(pinEl);
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
        card.className = 'entity-card is-visible clickable-card';
        card.title = 'Clique para abrir e ler/ver em tela cheia';
        card.innerHTML = `
            ${entry.imageData ? `<img src="${entry.imageData}" alt="${escapeHtml(entry.name)}" class="entity-thumb">` : ''}
            <div class="entity-info">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <span class="entity-title">${escapeHtml(entry.name || 'Sem nome')}</span>
                    <span class="visibility-pill visible" style="font-size: 0.62rem;">ABRIR</span>
                </div>
                ${entry.role ? `<div class="entity-sub">${escapeHtml(entry.role)}</div>` : ''}
                ${entry.desc ? `<div class="entity-desc">${escapeHtml(entry.desc)}</div>` : ''}
            </div>
        `;
        card.addEventListener('click', () => openEntryLightbox(entry));
        container.appendChild(card);
    });
}

function zoomPlayerMap(delta) {
    currentMapZoom = Math.min(2.5, Math.max(0.5, currentMapZoom + delta));
    const stage = document.getElementById('player-map-stage');
    if (stage) stage.style.transform = `scale(${currentMapZoom})`;
}

function resetPlayerMapZoom() {
    currentMapZoom = 1;
    const stage = document.getElementById('player-map-stage');
    if (stage) stage.style.transform = 'scale(1)';
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

    // Sempre salva também na lista de personagens locais do aparelho
    saveCharacterToLocalRoster(sessionConfig.userId, fichaState);

    if (sessionConfig.role === 'standalone') {
        setSyncStatus('online', 'Salvo neste aparelho');
        return;
    }

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
    if (!playerDbRef || sessionConfig.role !== 'player') return;
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
    updateWeightUI();
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
        showToast('Foto salva!');
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

function addBackpackItem(isExpansion = false) {
    if (!Array.isArray(fichaState.mochila)) fichaState.mochila = [];
    const newId = generateItemId();
    knownBackpackIds.add(newId);

    fichaState.mochila.push({
        id: newId,
        nome: isExpansion ? 'Mochila' : '',
        descricao: isExpansion ? 'Aumenta a capacidade de carga em +5' : '',
        peso: isExpansion ? -5 : 1
    });
    renderBackpack(true);
    updateWeightUI();
    scheduleSave();
}

function updateBackpackItem(id, key, value) {
    const item = fichaState.mochila.find(it => it.id === id);
    if (item) {
        item[key] = key === 'peso' ? (parseFloat(value) || 0) : value;
        if (key === 'peso') {
            updateWeightUI();
        }
        scheduleSave();
    }
}

function removeBackpackItem(id) {
    fichaState.mochila = fichaState.mochila.filter(it => it.id !== id);
    renderBackpack(true);
    updateWeightUI();
    scheduleSave();
}

function renderBackpack(forceRebuild = false) {
    const listEl = document.getElementById('backpack-list');
    const items = Array.isArray(fichaState.mochila) ? fichaState.mochila : [];

    if (!forceRebuild && listEl.contains(document.activeElement) && listEl.children.length === items.length) {
        updateWeightUI();
        return;
    }

    listEl.innerHTML = '';
    if (items.length === 0) {
        listEl.innerHTML = '<div class="backpack-empty">Mochila vazia (Carga atual: 0 / 4). Adicione itens ou uma mochila de expansão.</div>';
        updateWeightUI();
        return;
    }

    items.forEach(item => {
        const w = parseFloat(item.peso);
        const isExpansion = !isNaN(w) && w < 0;

        const row = document.createElement('div');
        row.className = `item-row ${isExpansion ? 'expansion-item' : ''}`;

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'input-control';
        nameInput.placeholder = isExpansion ? 'Nome da mochila / bolsa' : 'Nome do item';
        nameInput.value = item.nome || '';
        nameInput.addEventListener('input', (e) => updateBackpackItem(item.id, 'nome', e.target.value));

        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.className = 'input-control';
        descInput.placeholder = 'Descrição, efeito ou quantidade...';
        descInput.value = item.descricao || '';
        descInput.addEventListener('input', (e) => updateBackpackItem(item.id, 'descricao', e.target.value));

        const weightWrap = document.createElement('div');
        weightWrap.className = 'weight-input-wrap';
        weightWrap.title = 'Peso do item (use número negativo como -5 para mochilas que aumentam capacidade)';
        weightWrap.innerHTML = '<span>PESO</span>';

        const weightInput = document.createElement('input');
        weightInput.type = 'number';
        weightInput.step = '0.5';
        weightInput.value = item.peso !== undefined ? item.peso : 1;
        weightInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            row.classList.toggle('expansion-item', !isNaN(val) && val < 0);
            updateBackpackItem(item.id, 'peso', e.target.value);
        });
        weightWrap.appendChild(weightInput);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'item-remove-btn';
        delBtn.textContent = 'X';
        delBtn.addEventListener('click', () => removeBackpackItem(item.id));

        row.appendChild(nameInput);
        row.appendChild(descInput);
        row.appendChild(weightWrap);
        row.appendChild(delBtn);
        listEl.appendChild(row);
    });

    updateWeightUI();
}

// ==========================================================================
// UTILITÁRIOS COMPARTILHADOS
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
            descricao: String(it.descricao || ''),
            peso: it.peso !== undefined && !isNaN(parseFloat(it.peso)) ? parseFloat(it.peso) : 1,
            fromMaster: Boolean(it.fromMaster)
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
            saveCharacterToLocalRoster(sessionConfig.userId, fichaState);
            pushPlayerStateNow();
            showToast('Backup importado!');
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
    saveCharacterToLocalRoster(sessionConfig.userId, fichaState);
    pushPlayerStateNow();
    closeResetModal();
    showToast('Ficha limpa.');
}

function toggleScanlines() {
    document.getElementById('scanline-overlay').classList.toggle('hidden-scanline');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
}

// ==========================================================================
// BOOTSTRAP DA APLICAÇÃO
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    populateSavedCharSelect();

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
