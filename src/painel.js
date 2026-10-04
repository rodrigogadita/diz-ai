// Painel "Ao vivo": o lugar único do Diz Aí. Você fala na primeira caixa, o prompt nasce na segunda, você envia.
const vscode = require('vscode');
const crypto = require('crypto');

class Painel {
  constructor() {
    this.view = null;
    this.ultimo = { estado: { estado: 'parado', rotulo: 'Pronto para falar', detalhe: '' }, fala: '', prompt: '', escrevendo: false, bloco: '', aviso: '', modo: '' };
    this.niveis = [];
    this.relogio = null;
    this.aoFalar = () => {};   // a pessoa mudou o texto da fala (digitando ou pelo ditado do Windows)
    this.aoEditarPrompt = () => {};
    this._pronto = null;
    this._aoFocar = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    let avisar;
    this._pronto = new Promise(r => { avisar = r; });
    view.webview.options = { enableScripts: true };
    view.webview.html = html(crypto.randomBytes(16).toString('hex'));
    view.webview.onDidReceiveMessage(m => {
      if (m.tipo === 'pronto') { this.tudo(); avisar(); }
      else if (m.tipo === 'comando') vscode.commands.executeCommand(m.id);
      else if (m.tipo === 'fala') { this.ultimo.fala = m.texto; this.aoFalar(m.texto); }
      else if (m.tipo === 'prompt') { this.ultimo.prompt = m.texto; this.aoEditarPrompt(m.texto); }
      else if (m.tipo === 'focado' && this._aoFocar) { this._aoFocar(); this._aoFocar = null; }
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.tudo(); });
    view.onDidDispose(() => { this.view = null; this._pronto = null; });
  }

  get visivel() { return !!this.view?.visible; }

  enviar(m) {
    if (this.view) this.view.webview.postMessage(m);
  }

  tudo() {
    this.enviar({ tipo: 'tudo', ...this.ultimo });
  }

  /** Abre o painel e põe o cursor na caixa da fala: é ali que o ditado do Windows digita. */
  async focarFala() {
    await vscode.commands.executeCommand('dizAi.aoVivo.focus');
    for (let i = 0; i < 40 && !this._pronto; i++) await new Promise(r => setTimeout(r, 50));
    if (this._pronto) await Promise.race([this._pronto, new Promise(r => setTimeout(r, 3000))]);
    await new Promise(r => {
      this._aoFocar = r;
      this.enviar({ tipo: 'focarFala' });
      setTimeout(r, 1500);
    });
  }

  // Junta as leituras do medidor e manda em lotes, para não inundar o painel.
  nivel(v) {
    this.niveis.push(v);
    if (this.relogio) return;
    this.relogio = setTimeout(() => {
      this.relogio = null;
      if (this.visivel) this.enviar({ tipo: 'niveis', valores: this.niveis });
      this.niveis = [];
    }, 80);
  }

  estado(estado, rotulo, detalhe = '') {
    this.ultimo.estado = { estado, rotulo, detalhe };
    this.enviar({ tipo: 'estado', ...this.ultimo.estado });
  }

  /** A extensão mudou a fala (bloco trocado, comando de voz retirado, arquivo editado). */
  fala(texto) {
    this.ultimo.fala = texto;
    this.enviar({ tipo: 'fala', texto });
  }

  /** Texto do Whisper: entra onde estiver o cursor da caixa. */
  inserirFala(texto) {
    this.enviar({ tipo: 'inserirFala', texto });
  }

  prompt(texto, escrevendo = false) {
    this.ultimo.prompt = texto;
    this.ultimo.escrevendo = escrevendo;
    this.enviar({ tipo: 'prompt', texto, escrevendo });
  }

  aviso(texto) {
    this.ultimo.aviso = texto;
    this.enviar({ tipo: 'aviso', texto });
  }

  modo(nome) {
    this.ultimo.modo = nome;
    this.enviar({ tipo: 'modo', nome });
  }

  bloco(nome, fala, prompt, aviso = '') {
    Object.assign(this.ultimo, { bloco: nome, fala, prompt, escrevendo: false, aviso });
    this.tudo();
  }
}

function html(nonce) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 10px 12px 16px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); background: transparent; }
  .topo { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; min-height: 20px; }
  .ponto { width: 9px; height: 9px; border-radius: 50%; background: var(--vscode-disabledForeground); flex: none; }
  .ponto.vivo { background: var(--vscode-charts-green, #22c55e); animation: pulsar 1.2s ease-in-out infinite; }
  .ponto.gravando { background: var(--vscode-charts-red, #ef4444); animation: pulsar 1s ease-in-out infinite; }
  .ponto.ocupado { background: var(--vscode-charts-yellow, #facc15); animation: pulsar .8s ease-in-out infinite; }
  @keyframes pulsar { 50% { opacity: .35; } }
  .rotulo { font-weight: 600; }
  .detalhe { color: var(--vscode-descriptionForeground); font-size: .92em; margin-left: auto; text-align: right; }
  canvas { display: block; width: 100%; height: 48px; border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #8884)); }
  .linha { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  h3 { margin: 16px 0 6px; font-size: .8em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); display: flex; gap: 6px; align-items: baseline; }
  h3 .n { color: var(--vscode-foreground); }
  h3 .extra { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 400; }
  textarea { display: block; width: 100%; resize: vertical; padding: 8px; line-height: 1.45; font: inherit;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #8884)); border-radius: 0; outline: none; }
  textarea:focus { border-color: var(--vscode-focusBorder); }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  textarea[readonly] { opacity: .85; }
  #fala { min-height: 96px; }
  #prompt { min-height: 150px; }
  button { font: inherit; border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 0;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.ouvindo { background: var(--vscode-charts-red, #c62828); color: #fff; }
  kbd { font-family: var(--vscode-editor-font-family); font-size: .85em; opacity: .75; margin-left: 6px; }
  .aviso { margin-top: 8px; min-height: 1.2em; color: var(--vscode-descriptionForeground); }
  .aviso.ok { color: var(--vscode-charts-green, #22c55e); }
  .rodape { margin-top: 18px; color: var(--vscode-descriptionForeground); font-size: .9em; line-height: 1.6; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head>
<body>
  <div class="topo"><span id="ponto" class="ponto"></span><span id="rotulo" class="rotulo">Pronto para falar</span><span id="detalhe" class="detalhe"></span></div>
  <canvas id="ondas" height="48"></canvas>
  <div class="linha">
    <button id="falar" data-cmd="dizAi.ditar">Falar<kbd>Ctrl+Alt+D</kbd></button>
    <button class="sec" data-cmd="dizAi.limpar" title="Apaga a fala e o prompt e abre uma conversa nova no Claude Code">Limpar</button>
  </div>

  <h3><span class="n">1</span> Você fala</h3>
  <textarea id="fala" spellcheck="false" placeholder="Aperte Falar (Ctrl+Alt+D) e fale do seu jeito. O texto entra aqui. Pode digitar e corrigir também."></textarea>

  <h3><span class="n">2</span> O prompt <span id="extra" class="extra"></span></h3>
  <textarea id="prompt" spellcheck="false" placeholder="A cada pausa na sua fala, o Claude reescreve tudo aqui, organizado. Pode editar à vontade."></textarea>

  <div class="linha">
    <button data-cmd="dizAi.enviar" title="Leva o prompt para a caixa do Claude Code">Enviar<kbd>Ctrl+Alt+Enter</kbd></button>
    <button class="sec" data-cmd="dizAi.ajustar" title="Fale ou digite um ajuste: deixa mais curto, acrescenta tal coisa…">Ajustar</button>
    <button class="sec" data-cmd="dizAi.lapidar" title="Reescreve o prompt a partir da fala">Refazer</button>
    <button class="sec" data-cmd="dizAi.copiar">Copiar</button>
  </div>
  <div id="aviso" class="aviso"></div>

  <div class="rodape">
    Modo: <a id="modo" data-cmd="dizAi.trocarModo">Prompt estruturado</a> ·
    <a data-cmd="dizAi.diagnosticar">Testar microfone</a><br>
    Cada ditado fica salvo no <a data-cmd="dizAi.historico.focus">Histórico</a> e em <a data-cmd="dizAi.abrirPasta">Documentos/Diz Aí</a>.
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const fala = $('fala'), prompt = $('prompt');

  document.body.addEventListener('click', e => {
    const alvo = e.target.closest('[data-cmd]');
    if (alvo) vscode.postMessage({ tipo: 'comando', id: alvo.dataset.cmd });
  });

  // Ctrl+Enter dentro das caixas também envia.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Enter') { e.preventDefault(); vscode.postMessage({ tipo: 'comando', id: 'dizAi.enviar' }); }
  });

  // Manda o texto para a extensão um instante depois de parar de mudar.
  function adiar(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  const mandarFala = adiar(() => vscode.postMessage({ tipo: 'fala', texto: fala.value }), 150);
  const mandarPrompt = adiar(() => vscode.postMessage({ tipo: 'prompt', texto: prompt.value }), 300);
  fala.addEventListener('input', mandarFala);
  prompt.addEventListener('input', () => { if (!prompt.readOnly) mandarPrompt(); });

  // ---- ondas ----
  const tela = $('ondas'), ctx = tela.getContext('2d');
  const N = 48;
  let barras = new Array(N).fill(0), vivo = false;
  function cor(nome, reserva) { return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || reserva; }
  function desenhar() {
    const w = tela.clientWidth, h = tela.clientHeight, dpr = window.devicePixelRatio || 1;
    if (tela.width !== w * dpr) { tela.width = w * dpr; tela.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const passo = w / N, larg = Math.max(2, passo * 0.55);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, cor('--vscode-charts-green', '#22c55e'));
    grad.addColorStop(1, cor('--vscode-charts-yellow', '#facc15'));
    ctx.fillStyle = vivo ? grad : cor('--vscode-disabledForeground', '#888');
    for (let i = 0; i < N; i++) {
      const v = vivo ? Math.max(0.05, barras[i]) : 0.05;
      const bh = Math.max(2, v * (h - 6));
      ctx.fillRect(i * passo + (passo - larg) / 2, (h - bh) / 2, larg, bh);
    }
    requestAnimationFrame(desenhar);
  }
  requestAnimationFrame(desenhar);

  // ---- mensagens da extensão ----
  const CLASSES = { abrindo: 'ocupado', ouvindo: 'vivo', gravando: 'gravando', transcrevendo: 'ocupado', lapidando: 'ocupado' };
  function estado(m) {
    $('rotulo').textContent = m.rotulo || 'Pronto para falar';
    $('detalhe').textContent = m.detalhe || '';
    $('ponto').className = 'ponto ' + (CLASSES[m.estado] || '');
    vivo = ['ouvindo', 'gravando', 'abrindo'].includes(m.estado);
    if (!vivo) barras = new Array(N).fill(0);
    const b = $('falar');
    b.classList.toggle('ouvindo', vivo);
    b.firstChild.textContent = vivo ? 'Parar' : 'Falar';
  }
  function trocarFala(t) {
    if (fala.value === t) return;
    const noFim = fala.selectionStart >= fala.value.length;
    fala.value = t;
    if (noFim) { fala.selectionStart = fala.selectionEnd = t.length; fala.scrollTop = fala.scrollHeight; }
  }
  function trocarPrompt(t, escrevendo) {
    prompt.readOnly = !!escrevendo;
    if (prompt.value !== t && (escrevendo || document.activeElement !== prompt)) { prompt.value = t; if (escrevendo) prompt.scrollTop = prompt.scrollHeight; }
    $('extra').textContent = escrevendo ? 'escrevendo…' : '';
  }
  function aviso(t) {
    $('aviso').textContent = t || '';
    $('aviso').className = 'aviso' + (/^Enviado/.test(t || '') ? ' ok' : '');
  }
  window.addEventListener('message', ({ data: m }) => {
    if (m.tipo === 'niveis') barras = barras.concat(m.valores).slice(-N);
    else if (m.tipo === 'estado') estado(m);
    else if (m.tipo === 'fala') trocarFala(m.texto || '');
    else if (m.tipo === 'inserirFala') {
      const antes = fala.value.slice(0, fala.selectionStart);
      const sep = antes && !/\\s$/.test(antes) ? ' ' : '';
      fala.setRangeText(sep + m.texto, fala.selectionStart, fala.selectionEnd, 'end');
      mandarFala();
    }
    else if (m.tipo === 'prompt') trocarPrompt(m.texto || '', m.escrevendo);
    else if (m.tipo === 'aviso') aviso(m.texto);
    else if (m.tipo === 'modo') $('modo').textContent = m.nome;
    else if (m.tipo === 'focarFala') {
      fala.focus();
      fala.selectionStart = fala.selectionEnd = fala.value.length;
      vscode.postMessage({ tipo: 'focado' });
    }
    else if (m.tipo === 'tudo') {
      estado(m.estado);
      fala.value = m.fala || '';
      prompt.value = m.prompt || '';
      trocarPrompt(m.prompt || '', m.escrevendo);
      aviso(m.aviso);
      if (m.modo) $('modo').textContent = m.modo;
    }
  });
  vscode.postMessage({ tipo: 'pronto' });
</script>
</body></html>`;
}

module.exports = { Painel };
