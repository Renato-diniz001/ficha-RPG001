// ==========================================================================
// ESCUDO DO MESTRE — MAPAS, PINOS, ENVIO DE ITENS, MÚSICA LOCAL & NOTAS
// ==========================================================================
let masterCampaignRef = null;
let currentActiveMapId = null;
let currentActiveAudioId = null;
let cachedCampaignPlayers = {};
let noteSaveTimers = {};

function initMasterWorkspace(campaignId) {
    if (!db) {
        showToast('Configure a URL do Firebase para usar o Escudo do Mestre.');
        return;
    }

    detachMasterListeners();
    masterCampaignRef = db.ref(`campaigns/${campaignId}`);

    // 1. Escuta o mapa ativo e atualiza o palco interativo do Mestre
    masterCampaignRef.child('activeMapId').on('value', async (snap) => {
        currentActiveMapId = snap.val();
        const stageEl = document.getElementById('master-map-stage');
        const imgEl = document.getElementById('master-map-img');
        const emptyEl = document.getElementById('master-map-empty');
        const labelEl = document.getElementById('master-active-map-label');

        if (!currentActiveMapId) {
            stageEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            labelEl.textContent = 'Nenhum mapa ativo na tela dos jogadores';
        } else {
            const mSnap = await masterCampaignRef.child(`maps/${currentActiveMapId}`).once('value');
            const mData = mSnap.val();
            if (mData && mData.imageData) {
                imgEl.src = mData.imageData;
                stageEl.classList.remove('hidden');
                emptyEl.classList.add('hidden');
                labelEl.textContent = `Transmitindo ao vivo: ${mData.name}`;
            }
        }

        masterCampaignRef.child('maps').once('value').then(s => renderMasterMaps(s.val() || {}));
    });

    // 2. Escuta pinos arrastáveis do mapa
    masterCampaignRef.child('mapPins').on('value', (snap) => {
        renderInteractiveMapPins('master-pins-layer', snap.val() || {}, true);
    });

    // 3. Escuta lista de mapas da campanha
    masterCampaignRef.child('maps').on('value', (snap) => {
        renderMasterMaps(snap.val() || {});
    });

    // 4. Escuta NPCs e Personagens
    masterCampaignRef.child('entities').on('value', (snap) => {
        renderMasterCardsList('master-entities-list', 'entities', snap.val() || {}, 'Nenhum NPC cadastrado.');
    });

    // 5. Escuta Pistas e Documentos
    masterCampaignRef.child('items').on('value', (snap) => {
        renderMasterCardsList('master-items-list', 'items', snap.val() || {}, 'Nenhuma pista cadastrada.');
    });

    // 6. Escuta Biblioteca de Músicas Locais & Música Tocando Agora
    masterCampaignRef.child('activeAudio').on('value', (snap) => {
        const val = snap.val();
        currentActiveAudioId = val ? val.id : null;
        document.getElementById('master-current-audio-name').textContent = val ? val.name : 'Nenhuma música tocando';
        masterCampaignRef.child('audioLibrary').once('value').then(s => renderMasterAudioList(s.val() || {}));
    });

    masterCampaignRef.child('audioLibrary').on('value', (snap) => {
        renderMasterAudioList(snap.val() || {});
    });

    // 7. Monitora jogadores conectados + atualiza seletor de envio direto de itens
    masterCampaignRef.child('players').on('value', (snap) => {
        cachedCampaignPlayers = snap.val() || {};
        renderPlayersMonitor(cachedCampaignPlayers);
        updateGiftPlayerSelect(cachedCampaignPlayers);
    });

    // 8. Escuta Blocos de Notas Secretos
    masterCampaignRef.child('masterSecretNotes').on('value', (snap) => {
        renderMasterSecretNotes(snap.val());
    });
}

function detachMasterListeners() {
    if (masterCampaignRef) {
        masterCampaignRef.child('activeMapId').off();
        masterCampaignRef.child('mapPins').off();
        masterCampaignRef.child('maps').off();
        masterCampaignRef.child('entities').off();
        masterCampaignRef.child('items').off();
        masterCampaignRef.child('activeAudio').off();
        masterCampaignRef.child('audioLibrary').off();
        masterCampaignRef.child('players').off();
        masterCampaignRef.child('masterSecretNotes').off();
    }
}

function switchMasterPage(num) {
    [1, 2, 3, 4, 5].forEach(n => {
        document.getElementById('mpage-' + n).classList.toggle('hidden', n !== num);
        document.getElementById('mtab-btn-' + n).classList.toggle('active', n === num);
    });
}

// ==========================================================================
// JUKEBOX DE MÚSICAS LOCAIS DO MESTRE (UPLOAD DIRETO DO CELULAR/PC)
// ==========================================================================
function uploadMasterAudioFile() {
    if (!masterCampaignRef) return;
    const nameEl = document.getElementById('media-name');
    const fileEl = document.getElementById('media-file');
    const file = fileEl.files && fileEl.files[0];

    if (!file) {
        showToast('Selecione um arquivo de áudio (.mp3, .ogg, .wav, .m4a) do seu aparelho.');
        return;
    }

    const maxBytes = 8 * 1024 * 1024; // 8 MB (limite seguro para Firebase RTDB)
    if (file.size > maxBytes) {
        showToast('Arquivo muito grande (máx. 8 MB). Use um MP3 comprimido ou mais curto.');
        return;
    }

    const trackName = nameEl.value.trim() || file.name.replace(/\.[^/.]+$/, '');
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    setSyncStatus('syncing', 'Enviando música para a nuvem...');

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Audio = e.target.result;
        const audioId = 'audio_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);

        masterCampaignRef.child(`audioLibrary/${audioId}`).set({
            id: audioId,
            name: trackName,
            fileName: file.name,
            sizeLabel: sizeMB,
            audioData: base64Audio,
            createdAt: Date.now()
        }).then(() => {
            nameEl.value = '';
            fileEl.value = '';
            setSyncStatus('online', 'Música salva na biblioteca');
            showToast(`"${trackName}" salvo! Clique em Tocar na Mesa quando quiser.`);
        }).catch(() => {
            setSyncStatus('offline', 'Erro ao enviar áudio');
            showToast('Erro ao salvar o áudio. Tente um arquivo menor.');
        });
    };
    reader.readAsDataURL(file);
}

function playMasterAudio(audioId, trackName) {
    if (!masterCampaignRef) return;
    masterCampaignRef.child('activeAudio').set({
        id: audioId,
        name: trackName,
        startedAt: Date.now()
    }).then(() => {
        showToast(`Tocando "${trackName}" para todos os jogadores!`);
    });
}

function stopActiveAudio() {
    if (!masterCampaignRef) return;
    masterCampaignRef.child('activeAudio').remove().then(() => {
        showToast('Música encerrada para toda a mesa.');
    });
}

function deleteMasterAudio(audioId) {
    if (!masterCampaignRef) return;
    if (currentActiveAudioId === audioId) stopActiveAudio();
    masterCampaignRef.child(`audioLibrary/${audioId}`).remove().then(() => {
        showToast('Música removida da biblioteca.');
    });
}

function renderMasterAudioList(audioObj) {
    const container = document.getElementById('master-audio-list');
    if (!container) return;

    const tracks = Object.values(audioObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (tracks.length === 0) {
        container.innerHTML = '<div class="empty-state-box">Nenhuma música salva ainda. Suba suas faixas acima e dê nomes fáceis de usar durante a sessão.</div>';
        return;
    }

    container.innerHTML = '';
    tracks.forEach(track => {
        const isPlaying = currentActiveAudioId === track.id;
        const safeName = escapeHtml(track.name).replace(/'/g, "\'");

        const card = document.createElement('div');
        card.className = `entity-card ${isPlaying ? 'is-visible' : 'is-hidden'}`;
        card.innerHTML = `
            <div class="entity-info">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <span class="entity-title">${escapeHtml(track.name)}</span>
                    <span class="visibility-pill ${isPlaying ? 'visible' : 'hidden-pill'}">${isPlaying ? 'TOCANDO NA MESA' : 'PRONTA'}</span>
                </div>
                <div class="entity-sub">Arquivo: ${escapeHtml(track.fileName || 'áudio')} (${escapeHtml(track.sizeLabel || '')})</div>
                <div class="entity-controls">
                    ${isPlaying
                        ? `<button type="button" class="btn-mini danger" onclick="stopActiveAudio()">Parar Música</button>`
                        : `<button type="button" class="btn-mini btn-success" onclick="playMasterAudio('${track.id}', '${safeName}')">Tocar na Mesa</button>`
                    }
                    <button type="button" class="btn-mini danger" onclick="deleteMasterAudio('${track.id}')">Excluir</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ==========================================================================
// CONTROLE DE PINOS NO MAPA (MESTRE)
// ==========================================================================
function addCustomMapPin() {
    if (!masterCampaignRef) return;
    const labelInput = document.getElementById('new-pin-label');
    const colorInput = document.getElementById('new-pin-color');
    const label = labelInput.value.trim();

    if (!label) {
        showToast('Digite um nome para o pino (ex: Infectado 01).');
        return;
    }

    const pinId = 'pin_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    masterCampaignRef.child(`mapPins/${pinId}`).set({
        id: pinId,
        label: label,
        color: colorInput.value || '#ef4444',
        x: 50,
        y: 50
    }).then(() => {
        labelInput.value = '';
        showToast(`Pino "${label}" colocado no centro do mapa!`);
    });
}

function syncPlayersToPins() {
    if (!masterCampaignRef) return;
    const entries = Object.entries(cachedCampaignPlayers);
    if (entries.length === 0) {
        showToast('Nenhum jogador conectado na campanha ainda.');
        return;
    }

    const updates = {};
    entries.forEach(([playerId, p], idx) => {
        const pinId = `player_pin_${playerId}`;
        const label = p.apelido || p.nome || playerId;
        updates[`mapPins/${pinId}`] = {
            id: pinId,
            label: label,
            color: '#3b82f6',
            x: Math.min(85, 25 + idx * 12),
            y: 50
        };
    });

    masterCampaignRef.update(updates).then(() => {
        showToast('Pinos dos sobreviventes adicionados ao mapa!');
    });
}

function clearAllMapPins() {
    if (!masterCampaignRef) return;
    masterCampaignRef.child('mapPins').remove().then(() => {
        showToast('Todos os pinos foram removidos do mapa.');
    });
}

// ==========================================================================
// ENVIO DIRETO DE ITEM PARA A MOCHILA DE UM JOGADOR ESPECÍFICO
// ==========================================================================
function updateGiftPlayerSelect(playersObj) {
    const select = document.getElementById('gift-target-player');
    if (!select) return;
    const prevValue = select.value;
    const entries = Object.entries(playersObj);

    if (entries.length === 0) {
        select.innerHTML = '<option value="">Nenhum jogador na mesa ainda</option>';
        return;
    }

    select.innerHTML = entries.map(([playerId, p]) => {
        const displayName = p.nome || p.apelido || playerId;
        return `<option value="${escapeHtml(playerId)}">${escapeHtml(displayName)} (${escapeHtml(playerId)})</option>`;
    }).join('');

    if (prevValue && playersObj[prevValue]) {
        select.value = prevValue;
    }
}

async function sendItemDirectlyToPlayer() {
    if (!masterCampaignRef) return;
    const targetId = document.getElementById('gift-target-player').value;
    const nameInput = document.getElementById('gift-item-name');
    const weightInput = document.getElementById('gift-item-weight');
    const descInput = document.getElementById('gift-item-desc');

    const itemName = nameInput.value.trim();
    if (!targetId) {
        showToast('Selecione um jogador destinatário.');
        return;
    }
    if (!itemName) {
        showToast('Digite o nome do item para enviar.');
        return;
    }

    const weightVal = parseFloat(weightInput.value);
    const finalWeight = isNaN(weightVal) ? 1 : weightVal;

    const playerRef = masterCampaignRef.child(`players/${targetId}`);
    const snap = await playerRef.once('value');
    const pData = snap.val() || {};
    const currentBag = Array.isArray(pData.mochila) ? pData.mochila : [];

    currentBag.push({
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        nome: itemName,
        descricao: descInput.value.trim(),
        peso: finalWeight,
        fromMaster: true
    });

    await playerRef.update({
        mochila: currentBag,
        updatedAt: Date.now()
    });

    nameInput.value = '';
    descInput.value = '';
    weightInput.value = '1';
    showToast(`"${itemName}" enviado direto para a mochila de ${targetId}!`);
}

// ==========================================================================
// BLOCOS DE NOTAS SECRETOS DO MESTRE
// ==========================================================================
function renderMasterSecretNotes(notesObj) {
    const grid = document.getElementById('master-notes-grid');
    if (!grid) return;

    if (!notesObj) {
        createMasterSecretNote('Anotações da Sessão 01');
        return;
    }

    const notes = Object.values(notesObj).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (grid.contains(document.activeElement) && grid.children.length === notes.length) return;

    grid.innerHTML = '';
    notes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'secret-note-card';
        card.innerHTML = `
            <div class="secret-note-header">
                <input type="text" class="input-control mono" style="font-weight: 700;" value="${escapeHtml(note.title || '')}" placeholder="Título do bloco...">
                <button type="button" class="btn-mini danger" title="Apagar bloco">X</button>
            </div>
            <textarea class="textarea-control" rows="7" placeholder="Segredos da trama, testes ocultos, pontos de vida de chefes...">${escapeHtml(note.content || '')}</textarea>
        `;

        const titleInput = card.querySelector('input');
        const textArea = card.querySelector('textarea');
        const delBtn = card.querySelector('button');

        const scheduleNoteSave = () => {
            setSyncStatus('syncing', 'Salvando nota secreta...');
            clearTimeout(noteSaveTimers[note.id]);
            noteSaveTimers[note.id] = setTimeout(() => {
                masterCampaignRef.child(`masterSecretNotes/${note.id}`).update({
                    title: titleInput.value,
                    content: textArea.value,
                    updatedAt: Date.now()
                }).then(() => setSyncStatus('online', 'Nota secreta salva'));
            }, 500);
        };

        titleInput.addEventListener('input', scheduleNoteSave);
        textArea.addEventListener('input', scheduleNoteSave);
        delBtn.addEventListener('click', () => {
            masterCampaignRef.child(`masterSecretNotes/${note.id}`).remove();
        });

        grid.appendChild(card);
    });
}

function createMasterSecretNote(defaultTitle = 'Novo Bloco Secreto') {
    if (!masterCampaignRef) return;
    const noteId = 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    masterCampaignRef.child(`masterSecretNotes/${noteId}`).set({
        id: noteId,
        title: defaultTitle,
        content: '',
        createdAt: Date.now()
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
            showToast('Erro ao enviar mapa.');
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
// CRIAÇÃO & VISIBILIDADE DE NPCS E PISTAS NA MESA
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
            showToast(`"${name}" salvo como OCULTO.`);
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
        const wStats = typeof calculateBackpackWeightStats === 'function'
            ? calculateBackpackWeightStats(p.mochila)
            : { usedWeight: 0, maxCapacity: 4 };

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
                <div class="stat-box"><span>CARGA</span><strong style="color: ${wStats.usedWeight > wStats.maxCapacity ? '#f87171' : '#6ee7b7'};">${wStats.usedWeight}/${wStats.maxCapacity}</strong></div>
            </div>
            <div class="section-hint">
                Instinto: <strong>${p.instinto ?? 1}</strong> &bull; Mente: <strong>${p.mente ?? 1}</strong> &bull; Corpo: <strong>${p.corpo ?? 1}</strong>
            </div>
        `;
        container.appendChild(card);
    });
}
