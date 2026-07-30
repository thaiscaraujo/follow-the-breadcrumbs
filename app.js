const STORAGE_KEY = 'agora_state_v1';
const CHECKIN_VALID_MS = 90 * 60 * 1000;

const NIVEL = { baixa: 1, media: 2, alta: 3 };
const NIVEL_LABEL = { baixa: 'baixa', media: 'média', alta: 'alta' };
const IMPACTO_LABEL = { baixo: 'baixo', medio: 'médio', alto: 'alto' };

const MOTIVOS_INTERRUPCAO = [
  'Cansaço', 'Interrupção externa', 'Ficou maior do que parecia', 'Perdi o foco', 'Acabou o tempo', 'Outro motivo'
];

const TEMPLATES_ROTINA = [
  {
    id: 'tpl-cafe', titulo: 'Tomar café da manhã',
    criterioConclusao: 'Você comeu/bebeu algo e está pronta para seguir o dia.',
    naoFazParte: 'Não é hora de checar celular ou planejar o dia — só o café.',
    passos: ['Ir até a cozinha', 'Preparar o café/comida', 'Sentar e comer com calma'],
    tempoEstimadoMin: 15, energiaMin: 'baixa', cognicaoMin: 'baixa', areaNome: 'Pessoal'
  },
  {
    id: 'tpl-banho', titulo: 'Tomar banho',
    criterioConclusao: 'Você saiu do banho.',
    naoFazParte: 'Não é hora de decidir roupa ainda — só o banho.',
    passos: ['Ir até o banheiro', 'Tomar banho', 'Se secar'],
    tempoEstimadoMin: 15, energiaMin: 'baixa', cognicaoMin: 'baixa', areaNome: 'Pessoal'
  },
  {
    id: 'tpl-sair', titulo: 'Se preparar para sair de casa',
    criterioConclusao: 'Você está vestida, com os itens essenciais em mãos, na porta.',
    naoFazParte: 'Não é hora de resolver pendências de última hora — só se arrumar.',
    passos: ['Escolher e vestir a roupa', 'Pegar chave, carteira e celular', 'Conferir a bolsa/mochila'],
    tempoEstimadoMin: 15, energiaMin: 'baixa', cognicaoMin: 'baixa', areaNome: 'Pessoal'
  },
  {
    id: 'tpl-agua', titulo: 'Beber um copo de água',
    criterioConclusao: 'Você bebeu o copo inteiro.',
    naoFazParte: '',
    passos: ['Pegar um copo de água', 'Beber'],
    tempoEstimadoMin: 3, energiaMin: 'baixa', cognicaoMin: 'baixa', areaNome: 'Saúde'
  }
];

const DEFAULT_AREAS = ['Trabalho', 'Casa', 'Saúde', 'Pessoal'];

function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through to fresh state */ }
  }
  return {
    areas: DEFAULT_AREAS.map(nome => ({ id: uid(), nome })),
    itens: [],
    entrada: [],
    checkin: null
  };
}

function saveState() {
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  agendarPush();
}

let state = loadState();

let currentView = 'agora';
let sessaoAtualId = null;
let transitionScreen = null;
let forceCheckin = false;
let timerHandle = null;

// ---------- Sincronização (nuvem) ----------
const CODIGO_KEY = 'breadcrumb_codigo';
let syncStatus = 'off'; // off | ok | erro | sincronizando
let pushTimer = null;

function getCodigo() {
  return localStorage.getItem(CODIGO_KEY) || '';
}
function setCodigo(c) {
  const limpo = String(c || '').trim().toLowerCase();
  if (limpo) localStorage.setItem(CODIGO_KEY, limpo);
  else localStorage.removeItem(CODIGO_KEY);
}

function agendarPush() {
  if (!getCodigo()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(enviarParaNuvem, 1200);
}

async function enviarParaNuvem() {
  const codigo = getCodigo();
  if (!codigo) return;
  syncStatus = 'sincronizando';
  atualizarBadgeSync();
  try {
    const resp = await fetch('/api/dados', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo, estado: state })
    });
    syncStatus = resp.ok ? 'ok' : 'erro';
  } catch (e) {
    syncStatus = 'erro';
  }
  atualizarBadgeSync();
}

async function puxarDaNuvem() {
  const codigo = getCodigo();
  if (!codigo) return;
  syncStatus = 'sincronizando';
  atualizarBadgeSync();
  try {
    const resp = await fetch('/api/dados?codigo=' + encodeURIComponent(codigo));
    if (!resp.ok) { syncStatus = 'erro'; atualizarBadgeSync(); return; }
    const data = await resp.json();
    const remoto = data && data.estado;
    if (remoto && (remoto.updatedAt || 0) > (state.updatedAt || 0)) {
      state = remoto;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      sessaoAtualId = null;
      render();
    }
    syncStatus = 'ok';
  } catch (e) {
    syncStatus = 'erro';
  }
  atualizarBadgeSync();
}

function atualizarBadgeSync() {
  const el = document.getElementById('sync-badge');
  if (!el) return;
  const mapa = { off: '', ok: '☁︎', erro: '⚠', sincronizando: '…' };
  el.textContent = mapa[syncStatus] || '';
}

function nivel(v) { return NIVEL[v] ?? 2; }

function areaNome(areaId) {
  const a = state.areas.find(x => x.id === areaId);
  return a ? a.nome : '';
}

function areaIdByNome(nome) {
  let a = state.areas.find(x => x.nome === nome);
  if (!a) { a = { id: uid(), nome }; state.areas.push(a); }
  return a.id;
}

function itemById(id) { return state.itens.find(i => i.id === id); }

function scoreItem(item, checkin) {
  let fit = 0;
  if (item.tempoEstimadoMin <= checkin.tempoMin) fit += 40;
  else if (item.tempoEstimadoMin <= checkin.tempoMin * 1.4) fit += 12;
  else fit -= 80;

  const de = nivel(checkin.energia) - nivel(item.energiaMin);
  if (de >= 0) fit += 28 + (de === 0 ? 4 : 0);
  else fit -= 35 * Math.abs(de);

  const dc = nivel(checkin.cognicao) - nivel(item.cognicaoMin);
  if (dc >= 0) fit += 28 + (dc === 0 ? 4 : 0);
  else fit -= 35 * Math.abs(dc);

  if (item.estadoContinuidade) fit += 18;

  let urgencia = 0;
  if (item.prazo) {
    const dias = Math.floor((new Date(item.prazo + 'T23:59:59').getTime() - Date.now()) / 86400000);
    if (dias <= 0) urgencia += 55;
    else if (dias <= 1) urgencia += 38;
    else if (dias <= 3) urgencia += 20;
    else if (dias <= 7) urgencia += 8;
  }
  urgencia += { baixo: 0, medio: 10, alto: 24 }[item.impacto || 'baixo'];

  return { fit, urgencia, total: fit + urgencia };
}

function buildJustificativa(scored, checkin) {
  const reasons = [];
  if (scored.item.estadoContinuidade) {
    reasons.push('é de onde você parou — fica fácil de retomar');
  } else if (scored.item.tipo === 'preparatoria') {
    reasons.push('é uma preparação leve para facilitar o que vem depois');
  } else {
    reasons.push(`cabe nos ${checkin.tempoMin} min que você tem`);
    reasons.push(`combina com sua energia ${NIVEL_LABEL[checkin.energia]}`);
    reasons.push(`dá pra fazer com a cabeça ${NIVEL_LABEL[checkin.cognicao]}`);
  }
  if (scored.urgencia >= 30) reasons.push('e é importante ou tem prazo perto agora');
  return 'Escolhi esta sessão porque ' + reasons.join(', ') + '.';
}

function pickSession(excludeId) {
  const candidatos = state.itens.filter(i => i.status === 'pendente' && i.id !== excludeId && i.tipo === 'normal');
  if (candidatos.length === 0) return { fallback: true, alerta: null };

  const checkin = state.checkin;
  const scored = candidatos.map(i => ({ item: i, ...scoreItem(i, checkin) }));
  scored.sort((a, b) => b.total - a.total);
  const best = scored[0];

  const alerta = scored.find(s => s.item.id !== best.item.id && s.urgencia >= 30 && s.fit < 10) || null;

  if (best.total < 15) return { fallback: true, alerta };

  return { item: best.item, score: best, justificativa: buildJustificativa(best, checkin), alerta };
}

function checkinValido() {
  return state.checkin && (Date.now() - state.checkin.quando) < CHECKIN_VALID_MS;
}

function pushRegistro(item, desfecho, motivo) {
  const estimado = item.tempoEstimadoMin;
  const real = item.iniciadoEm ? Math.max(1, Math.round((Date.now() - item.iniciadoEm) / 60000)) : null;
  item.registros = item.registros || [];
  item.registros.push({ estimadoMin: estimado, realMin: real, desfecho, motivo: motivo || null, quando: Date.now() });
  item.iniciadoEm = null;
}

// ---------- Render root ----------

function render() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === currentView));
  const app = document.getElementById('app');
  if (currentView === 'agora') app.innerHTML = renderAgoraHtml();
  else if (currentView === 'entrada') app.innerHTML = renderEntradaHtml();
  else if (currentView === 'tarefas') app.innerHTML = renderTarefasHtml();
  else if (currentView === 'rotinas') app.innerHTML = renderRotinasHtml();
  bindViewEvents();
}

// ---------- AGORA ----------

function renderAgoraHtml() {
  const temItensPendentes = state.itens.some(i => i.status === 'pendente');

  if (transitionScreen === 'concluido') return renderTransicaoConcluido();
  if (transitionScreen === 'encerrado') return renderEncerrado();

  if (!temItensPendentes && state.entrada.length === 0) {
    return `
      <div class="empty-state">
        <div class="big">🌱</div>
        <p>Sua lista está vazia. Jogue algo na Entrada ou comece uma rotina.</p>
        <div class="btn-row">
          <button class="btn btn-secondary" data-action="ir-entrada">Abrir Entrada</button>
          <button class="btn btn-secondary" data-action="ir-rotinas">Ver Rotinas</button>
        </div>
      </div>`;
  }

  if (!temItensPendentes) {
    return `
      <div class="empty-state">
        <div class="big">📥</div>
        <p>Você tem itens na Entrada esperando para virar sessões.</p>
        <button class="btn btn-primary" data-action="ir-entrada">Abrir Entrada</button>
      </div>`;
  }

  if (forceCheckin || !checkinValido()) {
    return renderCheckinFormHtml();
  }

  if (!sessaoAtualId) {
    const pick = pickSession(null);
    if (pick.fallback) return renderFallbackHtml(pick.alerta);
    sessaoAtualId = pick.item.id;
    pick.item.status = 'pendente';
    pick.item.iniciadoEm = pick.item.iniciadoEm || Date.now();
    lastJustificativa = pick.justificativa;
    lastAlerta = pick.alerta;
  }

  const item = itemById(sessaoAtualId);
  if (!item || item.status !== 'pendente') { sessaoAtualId = null; return renderAgoraHtml(); }
  if (!item.iniciadoEm) item.iniciadoEm = Date.now();

  return renderSessaoCard(item);
}

let lastJustificativa = '';
let lastAlerta = null;

function renderCheckinFormHtml() {
  const c = state.checkin || {};
  return `
    <div class="card">
      <h2>Como você está agora?</h2>
      <p class="muted">Três toques rápidos, e eu escolho o que faz sentido.</p>
      <div class="check-grid">
        <div>
          <div class="check-q">Quanto tempo você tem?</div>
          <div class="opt-row" data-group="tempoMin">
            ${[5, 15, 30, 45].map(v => `<button class="opt" data-val="${v}">${v} min</button>`).join('')}
          </div>
        </div>
        <div>
          <div class="check-q">Como está sua energia física?</div>
          <div class="opt-row" data-group="energia">
            ${['baixa', 'media', 'alta'].map(v => `<button class="opt" data-val="${v}">${NIVEL_LABEL[v]}</button>`).join('')}
          </div>
        </div>
        <div>
          <div class="check-q">Como está sua cabeça agora?</div>
          <div class="opt-row" data-group="cognicao">
            ${['baixa', 'media', 'alta'].map(v => `<button class="opt" data-val="${v}">${v === 'baixa' ? 'confusa' : v === 'media' ? 'normal' : 'muito focada'}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary btn-block" id="btn-confirmar-checkin" disabled>Ver minha sessão de agora</button>
      </div>
    </div>`;
}

function renderTransicaoConcluido() {
  return `
    <div class="card">
      <div class="empty-state">
        <div class="big">🎉</div>
        <p>Mandou bem! Sessão concluída.</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary btn-block" data-action="seguir">Seguir para a próxima</button>
        <button class="btn btn-ghost btn-block" data-action="parar-por-aqui">Parar por aqui</button>
      </div>
    </div>`;
}

function renderEncerrado() {
  return `
    <div class="card">
      <div class="empty-state">
        <div class="big">☕</div>
        <p>Tudo bem parar por aqui. O que ficou vai te esperar, sem pressa.</p>
      </div>
      <button class="btn btn-secondary btn-block" data-action="voltar-agora">Voltar</button>
    </div>`;
}

function renderFallbackHtml(alerta) {
  const prep = state.itens.find(i => i.status === 'pendente' && i.tipo === 'preparatoria');
  const leve = state.itens.find(i => i.status === 'pendente' && i.tipo === 'leve');

  let alertaHtml = '';
  if (alerta) {
    alertaHtml = `
      <div class="card">
        <p class="muted">⚠ <b>${escapeHtml(alerta.item.titulo)}</b> é importante mas não cabe no seu estado agora.</p>
        <div class="btn-row">
          <button class="btn btn-secondary btn-sm" data-action="preparar-terreno-para" data-id="${alerta.item.id}">Preparar terreno</button>
          <button class="btn btn-secondary btn-sm" data-action="reduzir-escopo" data-id="${alerta.item.id}">Reduzir escopo</button>
          <button class="btn btn-ghost btn-sm" data-action="renegociar-prazo" data-id="${alerta.item.id}">Renegociar prazo</button>
        </div>
      </div>`;
  }

  return `
    <div class="card">
      <h2>Nada encaixa bem agora</h2>
      <p class="muted">Sem problema. Aqui vão opções que respeitam seu estado atual.</p>
      <div class="btn-row" style="flex-direction:column;">
        ${prep ? `<button class="btn btn-secondary btn-block" data-action="iniciar-item" data-id="${prep.id}">Preparar terreno: ${escapeHtml(prep.titulo)}</button>` : ''}
        ${leve ? `<button class="btn btn-secondary btn-block" data-action="iniciar-item" data-id="${leve.id}">Algo leve: ${escapeHtml(leve.titulo)}</button>` : ''}
        <button class="btn btn-ghost btn-block" data-action="encerrar-dia">Encerrar por aqui</button>
      </div>
    </div>
    ${alertaHtml}
    <button class="btn btn-ghost btn-sm btn-block" data-action="mudou-estado">Mudou seu estado? Refazer as 3 perguntas</button>`;
}

function renderSessaoCard(item) {
  const passoAtual = item.passos[item.passoAtualIndex].texto;
  const dots = item.passos.map((p, idx) => {
    const cls = idx < item.passoAtualIndex ? 'done' : (idx === item.passoAtualIndex ? 'current' : '');
    return `<span class="${cls}"></span>`;
  }).join('');

  let retomandoHtml = '';
  if (item.estadoContinuidade) {
    const ec = item.estadoContinuidade;
    retomandoHtml = `<p class="muted">↩ Retomando — você já fez: ${escapeHtml(ec.feito) || '—'}.</p>`;
  }

  return `
    <div class="card">
      <div class="badge-area">${escapeHtml(areaNome(item.areaId) || 'Sem área')}</div>
      <h2>${escapeHtml(item.titulo)}</h2>
      ${retomandoHtml}
      ${item.passos.length > 1 ? `<div class="progress-dots">${dots}</div>` : ''}
      <div class="section-label">Passo atual</div>
      <div class="step-text">${escapeHtml(passoAtual)}</div>
      <div class="section-label">Como sei que posso parar</div>
      <p>${escapeHtml(item.criterioConclusao || '—')}</p>
      ${item.naoFazParte ? `<div class="nao-parte">🚫 Não faz parte desta sessão: ${escapeHtml(item.naoFazParte)}</div>` : ''}
      <div class="justificativa">${escapeHtml(lastJustificativa || '')}</div>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="concluir-passo" data-id="${item.id}">✅ Concluí</button>
        <button class="btn btn-secondary" data-action="parei-aqui" data-id="${item.id}">⏸️ Parei aqui</button>
        <button class="btn btn-danger" data-action="travei" data-id="${item.id}">😵 Travei</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" data-action="trocar" data-id="${item.id}">⏭️ Trocar</button>
        <button class="btn btn-ghost btn-sm" data-action="outra-tarefa" data-id="${item.id}">➕ Isso virou outra tarefa</button>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm btn-block" data-action="mudou-estado">Mudou seu estado? Refazer as 3 perguntas</button>`;
}

// ---------- ENTRADA ----------

function renderEntradaHtml() {
  const itens = state.entrada.map(e => `
    <div class="entrada-item">
      <div class="txt">${escapeHtml(e.texto)}</div>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" data-action="dividir-ia" data-id="${e.id}">✨ Transformar com IA</button>
        <button class="btn btn-secondary btn-sm" data-action="processar-entrada" data-id="${e.id}">✍️ Fazer manual</button>
        <button class="btn btn-ghost btn-sm" data-action="descartar-entrada" data-id="${e.id}">Descartar</button>
      </div>
    </div>`).join('');

  return `
    <div class="card">
      <h2>Despejar algo novo</h2>
      <div class="despejo-box">
        <textarea class="textarea" id="txt-despejo" rows="2" placeholder="Escreva qualquer coisa que precisa fazer..."></textarea>
        <button class="btn btn-primary" id="btn-add-despejo">Jogar na Entrada</button>
      </div>
    </div>
    <div class="section-label">Esperando virar sessão</div>
    ${itens || '<p class="muted">Nada por aqui. Ufa.</p>'}
  `;
}

// ---------- TAREFAS ----------

function renderTarefasHtml() {
  const pendentes = state.itens.filter(i => i.status === 'pendente');
  const concluidas = state.itens.filter(i => i.status === 'concluida');

  function itemLine(i) {
    return `
      <div class="list-item">
        <div class="badge-area">${escapeHtml(areaNome(i.areaId))}</div>
        <b>${escapeHtml(i.titulo)}</b>
        <div class="muted">${i.tempoEstimadoMin} min · energia ${NIVEL_LABEL[i.energiaMin]} · cognição ${NIVEL_LABEL[i.cognicaoMin]}${i.prazo ? ' · prazo ' + i.prazo : ''}</div>
        <div class="btn-row">
          ${i.status === 'pendente' ? `<button class="btn btn-secondary btn-sm" data-action="iniciar-item" data-id="${i.id}">Começar agora</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-action="excluir-item" data-id="${i.id}">Excluir</button>
        </div>
      </div>`;
  }

  return `
    <div class="card">
      <button class="btn btn-primary btn-block" id="btn-nova-sessao">+ Nova sessão manual</button>
    </div>
    <div class="section-label">Pendentes (${pendentes.length})</div>
    ${pendentes.map(itemLine).join('') || '<p class="muted">Nada pendente.</p>'}
    <div class="section-label">Concluídas recentemente</div>
    ${concluidas.slice(-8).reverse().map(itemLine).join('') || '<p class="muted">Ainda nada concluído.</p>'}
  `;
}

// ---------- ROTINAS ----------

function renderRotinasHtml() {
  return TEMPLATES_ROTINA.map(t => `
    <div class="card">
      <h2>${escapeHtml(t.titulo)}</h2>
      <p class="muted">${t.tempoEstimadoMin} min · energia baixa · cognição baixa</p>
      <button class="btn btn-primary btn-block" data-action="iniciar-rotina" data-id="${t.id}">Começar agora</button>
    </div>`).join('');
}

// ---------- MODALS ----------

function openModal(html) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">${html}</div>
    </div>`;
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

function sessaoFormHtml(prefill) {
  prefill = prefill || {};
  const areasOptions = state.areas.map(a => `<option value="${a.id}" ${prefill.areaId === a.id ? 'selected' : ''}>${escapeHtml(a.nome)}</option>`).join('');
  return `
    <h3>Transformar em sessão</h3>
    <div class="form-row">
      <label>Título</label>
      <input class="text-input" id="f-titulo" value="${escapeHtml(prefill.titulo || '')}">
    </div>
    <div class="form-row">
      <label>Área</label>
      <select class="text-input" id="f-area">${areasOptions}</select>
    </div>
    <div class="form-row">
      <label>Como sei que posso parar? (critério de conclusão)</label>
      <input class="text-input" id="f-criterio" value="${escapeHtml(prefill.criterioConclusao || '')}">
    </div>
    <div class="form-row">
      <label>O que NÃO faz parte desta sessão (opcional)</label>
      <input class="text-input" id="f-naoparte" value="${escapeHtml(prefill.naoFazParte || '')}">
    </div>
    <div class="form-row">
      <label>Passos (um por linha; deixe vazio para um passo só)</label>
      <textarea class="textarea" id="f-passos" rows="3">${escapeHtml((prefill.passos || []).join('\n'))}</textarea>
    </div>
    <div class="form-row">
      <label>Tempo estimado</label>
      <div class="opt-row" data-group="f-tempo">
        ${[5, 15, 30, 45].map(v => `<button type="button" class="opt ${prefill.tempoEstimadoMin === v ? 'selected' : ''}" data-val="${v}">${v} min</button>`).join('')}
      </div>
    </div>
    <div class="form-row">
      <label>Energia mínima necessária</label>
      <div class="opt-row" data-group="f-energia">
        ${['baixa', 'media', 'alta'].map(v => `<button type="button" class="opt ${prefill.energiaMin === v ? 'selected' : ''}" data-val="${v}">${NIVEL_LABEL[v]}</button>`).join('')}
      </div>
    </div>
    <div class="form-row">
      <label>Capacidade cognitiva mínima</label>
      <div class="opt-row" data-group="f-cognicao">
        ${['baixa', 'media', 'alta'].map(v => `<button type="button" class="opt ${prefill.cognicaoMin === v ? 'selected' : ''}" data-val="${v}">${NIVEL_LABEL[v]}</button>`).join('')}
      </div>
    </div>
    <div class="form-row">
      <label>Prazo (opcional)</label>
      <input class="text-input" type="date" id="f-prazo" value="${prefill.prazo || ''}">
    </div>
    <div class="form-row">
      <label>Impacto</label>
      <div class="opt-row" data-group="f-impacto">
        ${['baixo', 'medio', 'alto'].map(v => `<button type="button" class="opt ${(prefill.impacto || 'baixo') === v ? 'selected' : ''}" data-val="${v}">${IMPACTO_LABEL[v]}</button>`).join('')}
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary btn-block" id="btn-salvar-sessao">Salvar</button>
    </div>`;
}

function bindOptGroups(root) {
  root.querySelectorAll('.opt-row').forEach(row => {
    row.querySelectorAll('.opt').forEach(btn => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        maybeEnableConfirmCheckin();
      });
    });
  });
}

function readOptGroup(groupName) {
  const row = document.querySelector(`.opt-row[data-group="${groupName}"]`);
  const sel = row ? row.querySelector('.opt.selected') : null;
  return sel ? sel.dataset.val : null;
}

function maybeEnableConfirmCheckin() {
  const btn = document.getElementById('btn-confirmar-checkin');
  if (!btn) return;
  const t = readOptGroup('tempoMin'), e = readOptGroup('energia'), c = readOptGroup('cognicao');
  btn.disabled = !(t && e && c);
}

function collectSessaoForm(defaults) {
  const passosRaw = document.getElementById('f-passos').value.trim();
  const passosTexto = passosRaw ? passosRaw.split('\n').map(s => s.trim()).filter(Boolean) : [document.getElementById('f-titulo').value.trim()];
  return Object.assign({}, defaults, {
    titulo: document.getElementById('f-titulo').value.trim() || 'Sem título',
    areaId: document.getElementById('f-area').value,
    criterioConclusao: document.getElementById('f-criterio').value.trim(),
    naoFazParte: document.getElementById('f-naoparte').value.trim(),
    passos: passosTexto.map(t => ({ texto: t, feito: false })),
    tempoEstimadoMin: Number(readOptGroup('f-tempo') || 15),
    energiaMin: readOptGroup('f-energia') || 'media',
    cognicaoMin: readOptGroup('f-cognicao') || 'media',
    prazo: document.getElementById('f-prazo').value || null,
    impacto: readOptGroup('f-impacto') || 'baixo'
  });
}

function openProcessarEntradaModal(entradaId) {
  const e = state.entrada.find(x => x.id === entradaId);
  if (!e) return;
  openModal(sessaoFormHtml({ titulo: e.texto, tempoEstimadoMin: 15, energiaMin: 'media', cognicaoMin: 'media' }));
  bindOptGroups(document.getElementById('modal-root'));
  document.getElementById('btn-salvar-sessao').addEventListener('click', () => {
    const novo = collectSessaoForm({
      id: uid(), status: 'pendente', tipo: 'normal', estadoContinuidade: null, registros: [], iniciadoEm: null, passoAtualIndex: 0, criadoEm: Date.now()
    });
    state.itens.push(novo);
    state.entrada = state.entrada.filter(x => x.id !== entradaId);
    saveState();
    closeModal();
    currentView = 'agora';
    render();
  });
}

function openNovaSessaoModal() {
  openModal(sessaoFormHtml({}));
  bindOptGroups(document.getElementById('modal-root'));
  document.getElementById('btn-salvar-sessao').addEventListener('click', () => {
    const novo = collectSessaoForm({
      id: uid(), status: 'pendente', tipo: 'normal', estadoContinuidade: null, registros: [], iniciadoEm: null, passoAtualIndex: 0, criadoEm: Date.now()
    });
    state.itens.push(novo);
    saveState();
    closeModal();
    render();
  });
}

function openEditItemModal(itemId) {
  const item = itemById(itemId);
  if (!item) return;
  openModal(sessaoFormHtml(Object.assign({}, item, { passos: item.passos.map(p => p.texto) })));
  bindOptGroups(document.getElementById('modal-root'));
  document.getElementById('btn-salvar-sessao').addEventListener('click', () => {
    const atualizado = collectSessaoForm(item);
    Object.assign(item, atualizado);
    item.passoAtualIndex = Math.min(item.passoAtualIndex, item.passos.length - 1);
    saveState();
    closeModal();
    render();
  });
}

function openPareiAquiModal(itemId) {
  const item = itemById(itemId);
  if (!item) return;
  const proximoPasso = item.passos[item.passoAtualIndex] ? item.passos[item.passoAtualIndex].texto : '';
  openModal(`
    <h3>Parei aqui</h3>
    <p class="muted">Vou guardar isso para você não precisar lembrar depois.</p>
    <div class="form-row">
      <label>Próximo passo (já sugerido)</label>
      <input class="text-input" id="pa-proximo" value="${escapeHtml(proximoPasso)}">
    </div>
    <div class="form-row">
      <label>Por quê parou?</label>
      <div class="opt-row" data-group="pa-motivo">
        ${MOTIVOS_INTERRUPCAO.map(m => `<button type="button" class="opt" data-val="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="btn-confirmar-parei">Salvar e voltar</button>
  `);
  bindOptGroups(document.getElementById('modal-root'));
  document.getElementById('btn-confirmar-parei').addEventListener('click', () => {
    const motivo = readOptGroup('pa-motivo');
    const feitos = item.passos.slice(0, item.passoAtualIndex).map(p => p.texto).join('; ');
    item.estadoContinuidade = {
      feito: feitos,
      proximoPasso: document.getElementById('pa-proximo').value.trim(),
      contexto: item.naoFazParte
    };
    pushRegistro(item, 'interrompida', motivo);
    sessaoAtualId = null;
    lastJustificativa = '';
    saveState();
    closeModal();
    render();
  });
}

function openTraveiModal(itemId) {
  const item = itemById(itemId);
  if (!item) return;
  openModal(`
    <h3>Travei — o que ajuda agora?</h3>
    <button class="intervention-btn" data-action="int-timer" data-secs="120" data-id="${item.id}">⏱️ Fazer só o passo atual por 2 minutos</button>
    <button class="intervention-btn" data-action="int-dividir" data-id="${item.id}">✂️ Dividir este passo em dois</button>
    <button class="intervention-btn" data-action="int-preparar" data-id="${item.id}">🧩 Preparar terreno em vez disso</button>
    <button class="intervention-btn" data-action="int-timer" data-secs="300" data-id="${item.id}">⏲️ Cronômetro de 5 minutos</button>
    <button class="btn btn-ghost btn-block" data-action="int-fechar">Fechar</button>
  `);
  document.getElementById('modal-root').querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleTraveiAction(btn.dataset.action, btn.dataset.id, btn.dataset.secs));
  });
}

function handleTraveiAction(action, itemId, secs) {
  if (action === 'int-fechar') { closeModal(); return; }
  if (action === 'int-timer') { openTimerModal(Number(secs)); return; }
  if (action === 'int-dividir') { openDividirPassoModal(itemId); return; }
  if (action === 'int-preparar') { criarPreparatoriaPara(itemId); closeModal(); render(); return; }
}

function openTimerModal(totalSecs) {
  let restante = totalSecs;
  openModal(`
    <h3>Só isso, por agora</h3>
    <div class="timer-display" id="timer-display">${formatMMSS(restante)}</div>
    <button class="btn btn-primary btn-block" id="btn-parar-timer">Terminar</button>
  `);
  document.getElementById('btn-parar-timer').addEventListener('click', closeModal);
  timerHandle = setInterval(() => {
    restante -= 1;
    const disp = document.getElementById('timer-display');
    if (disp) disp.textContent = formatMMSS(Math.max(0, restante));
    if (restante <= 0) { clearInterval(timerHandle); timerHandle = null; closeModal(); }
  }, 1000);
}

function formatMMSS(s) {
  const m = Math.floor(s / 60), r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

function openDividirPassoModal(itemId) {
  const item = itemById(itemId);
  const passoAtual = item.passos[item.passoAtualIndex].texto;
  openModal(`
    <h3>Dividir o passo</h3>
    <p class="muted">Original: ${escapeHtml(passoAtual)}</p>
    <div class="form-row"><label>Primeira metade</label><input class="text-input" id="dp-1"></div>
    <div class="form-row"><label>Segunda metade</label><input class="text-input" id="dp-2"></div>
    <button class="btn btn-primary btn-block" id="btn-dividir-confirmar">Dividir</button>
  `);
  document.getElementById('btn-dividir-confirmar').addEventListener('click', () => {
    const a = document.getElementById('dp-1').value.trim();
    const b = document.getElementById('dp-2').value.trim();
    if (!a || !b) { closeModal(); return; }
    item.passos.splice(item.passoAtualIndex, 1, { texto: a, feito: false }, { texto: b, feito: false });
    saveState();
    closeModal();
    render();
  });
}

function criarPreparatoriaPara(itemId) {
  const item = itemById(itemId);
  if (!item) return;
  const prep = {
    id: uid(), status: 'pendente', tipo: 'preparatoria', estadoContinuidade: null, registros: [], iniciadoEm: null, passoAtualIndex: 0, criadoEm: Date.now(),
    titulo: 'Preparar terreno: ' + item.titulo,
    areaId: item.areaId,
    criterioConclusao: 'O material/contexto de "' + item.titulo + '" está pronto para a próxima sessão.',
    naoFazParte: 'Não é para avançar "' + item.titulo + '" em si, só preparar.',
    passos: [{ texto: 'Reunir o que for preciso para começar', feito: false }],
    tempoEstimadoMin: 10, energiaMin: 'baixa', cognicaoMin: 'baixa', prazo: null, impacto: 'baixo'
  };
  state.itens.push(prep);
  sessaoAtualId = prep.id;
  saveState();
}

function openOutraTarefaModal() {
  openModal(`
    <h3>Isso virou outra tarefa</h3>
    <div class="form-row">
      <label>O que apareceu?</label>
      <textarea class="textarea" id="ot-texto" rows="2"></textarea>
    </div>
    <button class="btn btn-primary btn-block" id="btn-confirmar-outra">Guardar na Entrada e continuar aqui</button>
  `);
  document.getElementById('btn-confirmar-outra').addEventListener('click', () => {
    const txt = document.getElementById('ot-texto').value.trim();
    if (txt) {
      state.entrada.push({ id: uid(), texto: txt, criadoEm: Date.now() });
      saveState();
    }
    closeModal();
  });
}

function openDespejoRapidoModal() {
  openModal(`
    <h3>Despejar algo novo</h3>
    <div class="form-row">
      <label>O que você precisa fazer?</label>
      <textarea class="textarea" id="dr-texto" rows="2"></textarea>
    </div>
    <button class="btn btn-primary btn-block" id="btn-confirmar-despejo-rapido">Jogar na Entrada</button>
  `);
  document.getElementById('btn-confirmar-despejo-rapido').addEventListener('click', () => {
    const txt = document.getElementById('dr-texto').value.trim();
    if (txt) {
      state.entrada.push({ id: uid(), texto: txt, criadoEm: Date.now() });
      saveState();
      if (currentView === 'entrada') render();
    }
    closeModal();
  });
}

function openRenegociarModal(itemId) {
  const item = itemById(itemId);
  openModal(`
    <h3>Renegociar prazo</h3>
    <p class="muted">${escapeHtml(item.titulo)}</p>
    <div class="form-row"><label>Novo prazo</label><input class="text-input" type="date" id="rn-prazo" value="${item.prazo || ''}"></div>
    <button class="btn btn-primary btn-block" id="btn-confirmar-renegociar">Salvar</button>
  `);
  document.getElementById('btn-confirmar-renegociar').addEventListener('click', () => {
    item.prazo = document.getElementById('rn-prazo').value || null;
    saveState();
    closeModal();
    render();
  });
}

// ---------- EVENT BINDING ----------

function bindViewEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => { currentView = tab.dataset.view; render(); };
  });

  if (currentView === 'agora') {
    if (forceCheckin || !checkinValido()) {
      bindOptGroups(document.getElementById('app'));
      const btn = document.getElementById('btn-confirmar-checkin');
      if (btn) btn.addEventListener('click', () => {
        state.checkin = {
          tempoMin: Number(readOptGroup('tempoMin')),
          energia: readOptGroup('energia'),
          cognicao: readOptGroup('cognicao'),
          quando: Date.now()
        };
        forceCheckin = false;
        sessaoAtualId = null;
        saveState();
        render();
      });
      return;
    }

    document.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', () => handleAgoraAction(el.dataset.action, el.dataset.id));
    });
  }

  if (currentView === 'entrada') {
    const btnAdd = document.getElementById('btn-add-despejo');
    if (btnAdd) btnAdd.addEventListener('click', () => {
      const txt = document.getElementById('txt-despejo').value.trim();
      if (!txt) return;
      state.entrada.push({ id: uid(), texto: txt, criadoEm: Date.now() });
      saveState();
      render();
    });
    document.querySelectorAll('[data-action="dividir-ia"]').forEach(el => {
      el.addEventListener('click', () => dividirComIA(el.dataset.id));
    });
    document.querySelectorAll('[data-action="processar-entrada"]').forEach(el => {
      el.addEventListener('click', () => openProcessarEntradaModal(el.dataset.id));
    });
    document.querySelectorAll('[data-action="descartar-entrada"]').forEach(el => {
      el.addEventListener('click', () => {
        state.entrada = state.entrada.filter(x => x.id !== el.dataset.id);
        saveState();
        render();
      });
    });
  }

  if (currentView === 'tarefas') {
    const btnNova = document.getElementById('btn-nova-sessao');
    if (btnNova) btnNova.addEventListener('click', openNovaSessaoModal);
    document.querySelectorAll('[data-action="iniciar-item"]').forEach(el => {
      el.addEventListener('click', () => {
        sessaoAtualId = el.dataset.id;
        currentView = 'agora';
        render();
      });
    });
    document.querySelectorAll('[data-action="excluir-item"]').forEach(el => {
      el.addEventListener('click', () => {
        state.itens = state.itens.filter(x => x.id !== el.dataset.id);
        saveState();
        render();
      });
    });
  }

  if (currentView === 'rotinas') {
    document.querySelectorAll('[data-action="iniciar-rotina"]').forEach(el => {
      el.addEventListener('click', () => {
        const tpl = TEMPLATES_ROTINA.find(t => t.id === el.dataset.id);
        const item = {
          id: uid(), status: 'pendente', tipo: 'normal', estadoContinuidade: null, registros: [], iniciadoEm: Date.now(), passoAtualIndex: 0, criadoEm: Date.now(),
          titulo: tpl.titulo, areaId: areaIdByNome(tpl.areaNome), criterioConclusao: tpl.criterioConclusao, naoFazParte: tpl.naoFazParte,
          passos: tpl.passos.map(t => ({ texto: t, feito: false })),
          tempoEstimadoMin: tpl.tempoEstimadoMin, energiaMin: tpl.energiaMin, cognicaoMin: tpl.cognicaoMin, prazo: null, impacto: 'baixo'
        };
        state.itens.push(item);
        sessaoAtualId = item.id;
        lastJustificativa = 'Você escolheu começar esta rotina agora.';
        saveState();
        currentView = 'agora';
        render();
      });
    });
  }
}

function handleAgoraAction(action, id) {
  if (action === 'mudou-estado') { forceCheckin = true; sessaoAtualId = null; render(); return; }
  if (action === 'ir-entrada') { currentView = 'entrada'; render(); return; }
  if (action === 'ir-rotinas') { currentView = 'rotinas'; render(); return; }
  if (action === 'seguir') { transitionScreen = null; sessaoAtualId = null; render(); return; }
  if (action === 'parar-por-aqui') { transitionScreen = 'encerrado'; render(); return; }
  if (action === 'voltar-agora') { transitionScreen = null; render(); return; }
  if (action === 'encerrar-dia') { transitionScreen = 'encerrado'; render(); return; }

  if (action === 'iniciar-item') { sessaoAtualId = id; lastJustificativa = 'Você escolheu esta agora.'; render(); return; }
  if (action === 'preparar-terreno-para') { criarPreparatoriaPara(id); render(); return; }
  if (action === 'reduzir-escopo') { openEditItemModal(id); return; }
  if (action === 'renegociar-prazo') { openRenegociarModal(id); return; }

  const item = itemById(id);
  if (!item) return;

  if (action === 'concluir-passo') {
    item.passoAtualIndex += 1;
    item.estadoContinuidade = null;
    if (item.passoAtualIndex >= item.passos.length) {
      item.status = 'concluida';
      pushRegistro(item, 'concluida', null);
      sessaoAtualId = null;
      lastJustificativa = '';
      transitionScreen = 'concluido';
    }
    saveState();
    render();
    return;
  }
  if (action === 'parei-aqui') { openPareiAquiModal(id); return; }
  if (action === 'travei') { openTraveiModal(id); return; }
  if (action === 'trocar') {
    pushRegistro(item, 'interrompida', 'Trocou de sessão');
    sessaoAtualId = null;
    lastJustificativa = '';
    saveState();
    render();
    return;
  }
  if (action === 'outra-tarefa') { openOutraTarefaModal(); return; }
}

// ---------- Toast (aviso rápido) ----------
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el) el.style.display = 'none'; }, 3200);
}

// ---------- Dividir com IA ----------
async function dividirComIA(entradaId) {
  const e = state.entrada.find(x => x.id === entradaId);
  if (!e) return;

  openModal(`<h3>✨ Dividindo com a IA…</h3><div class="spinner-line">Só um instante — estou transformando isso em passos.</div>`);

  let resposta;
  try {
    const r = await fetch('/api/dividir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto: e.texto })
    });
    resposta = { ok: r.ok, dados: await r.json().catch(() => null) };
  } catch (err) {
    resposta = { ok: false, dados: null };
  }

  closeModal();

  if (!resposta.ok || !resposta.dados || !Array.isArray(resposta.dados.sessoes) || !resposta.dados.sessoes.length) {
    toast('A IA não está disponível agora — abrindo o modo manual.');
    openProcessarEntradaModal(entradaId);
    return;
  }

  const criadas = resposta.dados.sessoes.map((s, idx) => criarItemDeSessaoIA(s, idx === 0 ? e.texto : null));
  state.itens.push(...criadas);
  state.entrada = state.entrada.filter(x => x.id !== entradaId);
  saveState();
  toast(criadas.length === 1 ? 'Pronto! Virou 1 sessão.' : `Pronto! Virou ${criadas.length} sessões.`);
  currentView = 'agora';
  sessaoAtualId = null;
  render();
}

function criarItemDeSessaoIA(s, origem) {
  const passos = Array.isArray(s.passos) && s.passos.length ? s.passos : [s.titulo || 'Fazer'];
  return {
    id: uid(), status: 'pendente', tipo: 'normal', estadoContinuidade: null, registros: [], iniciadoEm: null, passoAtualIndex: 0, criadoEm: Date.now(),
    titulo: s.titulo || 'Sem título',
    areaId: areaIdByNome(s.area || 'Pessoal'),
    criterioConclusao: s.criterioConclusao || '',
    naoFazParte: s.naoFazParte || '',
    passos: passos.map(t => ({ texto: String(t), feito: false })),
    tempoEstimadoMin: Number(s.tempoEstimadoMin) || 15,
    energiaMin: ['baixa', 'media', 'alta'].includes(s.energiaMin) ? s.energiaMin : 'media',
    cognicaoMin: ['baixa', 'media', 'alta'].includes(s.cognicaoMin) ? s.cognicaoMin : 'media',
    prazo: null,
    impacto: ['baixo', 'medio', 'alto'].includes(s.impacto) ? s.impacto : 'baixo',
    origemEntrada: origem || null
  };
}

// ---------- Configurações / Sincronização ----------
function openConfigModal() {
  const codigo = getCodigo();
  openModal(`
    <h3>⚙ Configurações</h3>
    <div class="form-row">
      <label>Código de sincronização (o mesmo no PC e no celular)</label>
      <input class="text-input" id="cfg-codigo" placeholder="ex.: minha-palavra-secreta" value="${escapeHtml(codigo)}">
      <p class="muted" style="margin-top:6px;">Escolha uma palavra/frase só sua. Digite a MESMA nos dois aparelhos para eles compartilharem a lista. Guarde bem — é ela que abre seus dados.</p>
    </div>
    <div class="btn-row" style="flex-direction:column;">
      <button class="btn btn-primary btn-block" id="cfg-salvar">Salvar e sincronizar</button>
      ${codigo ? '<button class="btn btn-ghost btn-block" id="cfg-desligar">Parar de sincronizar neste aparelho</button>' : ''}
    </div>
  `);
  document.getElementById('cfg-salvar').addEventListener('click', async () => {
    const novo = document.getElementById('cfg-codigo').value.trim().toLowerCase();
    if (!novo) { toast('Digite um código.'); return; }
    setCodigo(novo);
    closeModal();
    toast('Sincronizando…');
    await puxarDaNuvem();     // pega o que já existe na nuvem para este código
    await enviarParaNuvem();  // e envia o estado atual
    toast('Sincronização ligada ☁︎');
  });
  const btnOff = document.getElementById('cfg-desligar');
  if (btnOff) btnOff.addEventListener('click', () => {
    setCodigo('');
    syncStatus = 'off';
    atualizarBadgeSync();
    closeModal();
    toast('Sincronização desligada neste aparelho.');
  });
}

document.getElementById('fab-despejo').addEventListener('click', openDespejoRapidoModal);
document.getElementById('btn-config').addEventListener('click', openConfigModal);

render();
atualizarBadgeSync();
if (getCodigo()) { syncStatus = 'ok'; puxarDaNuvem(); }

