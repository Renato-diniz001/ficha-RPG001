// ==========================================================================
// ESCUDO DO MESTRE — MAPAS DO CANVA, NPCS, ITENS & CONTROLE DE VISIBILIDADE
// ==========================================================================
let masterCampaignRef = null;
let currentActiveMapId = null;

function initMasterWorkspace(campaignId) {
    if (!db) {
        showToast('Configure a URL do Firebase para usar o Escudo do Mestre.');
        return;
    }

    detachMasterListeners();
    masterCampaignRef = db.ref(`campaigns/${campaignId}`);

    // 1. Escuta qual mapa está ativo na visão dos jogadores
    masterCampaignRef.child('activeMapId').on('value', (snap) => {
        currentActiveMapId = snap.val();
        masterCampaignRef.child('maps').once('value').then(s => renderMasterMaps(s.val() || {}));
    });

    // 2. Escuta lista de mapas da campanha
    masterCampaignRef.child('maps').on('value', (snap) => {
        renderMasterMaps(snap.val() || {});
    });

    // 3. Escuta NPCs e Personagens
    masterCampaignRef.child('entities').on('value', (snap) => {
        renderMasterCardsList('master-entities-list', 'entities', snap.val() || {}, 'Nenhum NPC cadastrado.');
    });

    // 4. Escuta Itens e Pistas
    masterCampaignRef.child('items').on('value', (snap) => {
        renderMasterCardsList('master-items-list', 'items', snap.val() || {}, 'Nenhum item ou pista cadastrado.');
    });

    // 5. Monitora todos os jogadores conectados nesta campanha
    masterCampaignRef.child('players').on('value', (snap) => {
        renderPlayersMonitor(snap.val() || {});
    });
}

function detachMasterListeners() {
    if (masterCampaignRef) {
        masterCampaignRef.child('activeMapId').off();
        masterCampaignRef.child('maps').off();
        masterCampaignRef.child('entities').off();
        masterCampaignRef.child('items').off();
        masterCampaignRef.child('players').off();
    }
}

function switchMasterPage(num) {
    [1, 2, 3].forEach(n => {
        document.getElementById('mpage-' + n).classList.toggle('hidden', n !== num);
        document.getElementById('mtab-btn-' + n).classList.toggle('active', n === num);
    });
}

// ==========================================================================
// UPLOAD & TRANSMISSÃO DE MAPAS (PNG / JPEG DO CANVA)
// ==========================================================================
function uploadMasterMap() {
    if (!masterCampaignRef) return;
    const nameInput = document.getElementById('master-map-name');
    const fileInput = document.getElementById('master-map-file');
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
        showToast('Selecione uma imagem PNG ou JPEG do mapa primeiro.');
        return;
    }

    const mapName = nameInput.value.trim() || file.name.replace(/\.[^/.]+$/, '');
    setSyncStatus('syncing', 'Otimizando e enviando mapa...');

    // Comprime para até 1600px de largura mantendo nitidez e carregamento rápido no celular
    compressImageFile(file, 1600, 0.82, (base64Image) => {
        const mapId = 'map_' + Date.now();
        masterCampaignRef.child(`maps/${mapId}`).set({
            id: mapId,
            name: mapName,
            imageData: base64Image,
            createdAt: Date.now()
        }).then(() => {
            nameInput.value = '';
            fileInput.value = '';
            setSyncStatus('online', 'Mapa salvo (Oculto)');
            showToast(`Mapa "${mapName}" enviado! Clique em Mostrar para liberar aos jogadores.`);
        }).catch(() => {
            setSyncStatus('offline', 'Erro ao enviar mapa');
            showToast('Erro ao enviar mapa. Tente uma imagem mais leve.');
        });
    });
}

function toggleMapVisibility(mapId) {
    if (!masterCampaignRef) return;
    const nextActiveId = (currentActiveMapId === mapId) ? null : mapId;
    masterCampaignRef.child('activeMapId').set(nextActiveId).then(() => {
        showToast(nextActiveId ? 'Mapa LIBERADO na tela dos jogadores!' : 'Mapa OCULTADO dos jogadores.');
    });
}

function deleteMasterMap(mapId) {
    if (!masterCampaignRef) return;
    if (currentActiveMapId === mapId) {
        masterCampaignRef.child('activeMapId').set(null);
    }
    masterCampaignRef.child(`maps/${mapId}`).remove().then(() => {
        showToast('Mapa removido da campanha.');
    });
}

function renderMasterMaps(mapsObj) {
    const container = document.getElementById('master-maps-list');
    if (!container) return;
    const maps = Object.values(mapsObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (maps.length === 0) {
        container.innerHTML = '<div class="empty-state-box">Nenhum mapa enviado ainda. Suba um PNG ou JPG feito no Canva acima.</div>';
        return;
    }

    container.innerHTML = '';
    maps.forEach(map => {
        const isLive = currentActiveMapId === map.id;
        const card = document.createElement('div');
        card.className = `map-item-card ${isLive ? 'active-map' : ''}`;
        card.innerHTML = `
            <img src="${map.imageData}" alt="${escapeHtml(map.name)}" class="map-thumb">
            <div class="map-item-body">
                <div class="map-item-header">
                    <strong>${escapeHtml(map.name)}</strong>
                    <span class="visibility-pill ${isLive ? 'visible' : 'hidden-pill'}">
                        ${isLive ? 'VISÍVEL NA MESA' : 'OCULTO'}
                    </span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn ${isLive ? 'btn-danger-outline' : 'btn-success'}" style="flex: 1;" onclick="toggleMapVisibility('${map.id}')">
                        ${isLive ? 'Ocultar dos Jogadores' : 'Mostrar para Jogadores'}
                    </button>
                    <button type="button" class="btn btn-danger-outline" onclick="deleteMasterMap('${map.id}')" title="Excluir mapa">X</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ==========================================================================
// CRIAÇÃO & VISIBILIDADE DE NPCS, PERSONAGENS E ITENS
// ==========================================================================
function createMasterCard(collectionName) {
    if (!masterCampaignRef) return;
    const isEntity = collectionName === 'entities';
    const prefix = isEntity ? 'npc' : 'item';

    const nameEl = document.getElementById(`${prefix}-name`);
    const roleEl = document.getElementById(`${prefix}-role`);
    const descEl = document.getElementById(`${prefix}-desc`);
    const fileEl = document.getElementById(`${prefix}-image`);

    const name = nameEl.value.trim();
    if (!name) {
        showToast('Digite um nome antes de salvar.');
        return;
    }

    const saveRecord = (imageData) => {
        const cardId = `${prefix}_${Date.now()}`;
        masterCampaignRef.child(`${collectionName}/${cardId}`).set({
            id: cardId,
            name: name,
            role: roleEl.value.trim(),
            desc: descEl.value.trim(),
            imageData: imageData || '',
            visible: false,
            createdAt: Date.now()
        }).then(() => {
            nameEl.value = '';
            roleEl.value = '';
            descEl.value = '';
            fileEl.value = '';
            showToast(`"${name}" salvo como OCULTO. Clique em Mostrar quando quiser revelar.`);
        });
    };

    const file = fileEl.files && fileEl.files[0];
    if (file) {
        compressImageFile(file, 480, 0.8, saveRecord);
    } else {
        saveRecord('');
    }
}

function toggleCardVisibility(collectionName, cardId, currentStatus) {
    if (!masterCampaignRef) return;
    masterCampaignRef.child(`${collectionName}/${cardId}/visible`).set(!currentStatus).then(() => {
        showToast(!currentStatus ? 'Revelado para os jogadores!' : 'Ocultado dos jogadores.');
    });
}

function deleteMasterCard(collectionName, cardId) {
    if (!masterCampaignRef) return;
    masterCampaignRef.child(`${collectionName}/${cardId}`).remove().then(() => {
        showToast('Registro excluído.');
    });
}

function renderMasterCardsList(containerId, collectionName, dataObj, emptyText) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const list = Object.values(dataObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-box">${emptyText}</div>`;
        return;
    }

    container.innerHTML = '';
    list.forEach(entry => {
        const isVis = entry.visible === true;
        const card = document.createElement('div');
        card.className = `entity-card ${isVis ? 'is-visible' : 'is-hidden'}`;
        card.innerHTML = `
            ${entry.imageData ? `<img src="${entry.imageData}" alt="${escapeHtml(entry.name)}" class="entity-thumb">` : ''}
            <div class="entity-info">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <span class="entity-title">${escapeHtml(entry.name)}</span>
                    <span class="visibility-pill ${isVis ? 'visible' : 'hidden-pill'}">${isVis ? 'VISÍVEL' : 'OCULTO'}</span>
                </div>
                ${entry.role ? `<div class="entity-sub">${escapeHtml(entry.role)}</div>` : ''}
                ${entry.desc ? `<div class="entity-desc">${escapeHtml(entry.desc)}</div>` : ''}
                <div class="entity-controls">
                    <button type="button" class="btn-mini ${isVis ? '' : 'btn-success'}" onclick="toggleCardVisibility('${collectionName}', '${entry.id}', ${isVis})">
                        ${isVis ? 'Ocultar' : 'Mostrar aos Jogadores'}
                    </button>
                    <button type="button" class="btn-mini danger" onclick="deleteMasterCard('${collectionName}', '${entry.id}')">Excluir</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ==========================================================================
// MONITOR EM TEMPO REAL DOS SOBREVIVENTES DA MESA
// ==========================================================================
function renderPlayersMonitor(playersObj) {
    const container = document.getElementById('master-players-overview');
    if (!container) return;
    const entries = Object.entries(playersObj);

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state-box">Nenhum jogador conectado nesta campanha ainda.</div>';
        return;
    }

    container.innerHTML = '';
    entries.forEach(([playerId, p]) => {
        const card = document.createElement('div');
        card.className = 'player-status-card';
        const displayName = p.nome || p.apelido || playerId;
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${escapeHtml(displayName)}</strong>
                    <div class="section-hint">ID: ${escapeHtml(playerId)} ${p.origem ? '// Origem: ' + escapeHtml(p.origem) : ''}</div>
                </div>
                <span class="visibility-pill visible">ONLINE</span>
            </div>
            <div class="player-stats-strip">
                <div class="stat-box"><span>VITALIDADE</span><strong style="color: #f87171;">${p.vitalidade ?? 10}</strong></div>
                <div class="stat-box"><span>MENTAL</span><strong style="color: #fbbf24;">${p.mental ?? 10}</strong></div>
                <div class="stat-box"><span>PN</span><strong style="color: #60a5fa;">${p.pn ?? 0}</strong></div>
            </div>
            <div class="section-hint">
                Instinto: <strong>${p.instinto ?? 1}</strong> &bull; Mente: <strong>${p.mente ?? 1}</strong> &bull; Corpo: <strong>${p.corpo ?? 1}</strong>
            </div>
        `;
        container.appendChild(card);
    });
}
