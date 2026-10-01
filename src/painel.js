// Painel "Ao vivo": ondas da voz, estado, o que você disse e o prompt nascendo em tempo real.
const vscode = require('vscode');
const crypto = require('crypto');

class Painel {
  constructor() {
    this.view = null;
    this.ultimo = { estado: { estado: 'parado', rotulo: 'Parado' }, fala: '', prompt: '', escrevendo: false, bloco: '' };
    this.niveis = [];
    this.relogio = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html(crypto.randomBytes(16).toString('hex'));
    view.webview.onDidReceiveMessage(m => {
      if (m.tipo === 'pronto') this.tudo();
      if (m.tipo === 'comando') vscode.commands.executeCommand(m.id);
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.tudo(); });
    view.onDidDispose(() => { this.view = null; });
  }

  enviar(m) {
    if (this.view?.visible) this.view.webview.postMessage(m);
  }

  tudo() {
    this.enviar({ tipo: 'tudo', ...this.ultimo });
  }

  // Junta as leituras e manda em lotes, para não inundar o painel.
  nivel(v) {
    this.niveis.push(v);
    if (this.relogio) return;
    this.relogio = setTimeout(() => {
      this.relogio = null;
      this.enviar({ tipo: 'niveis', valores: this.niveis });
      this.niveis = [];
    }, 80);
  }

  estado(estado, rotulo, detalhe = '') {
    this.ultimo.estado = { estado, rotulo, detalhe };
    this.enviar({ tipo: 'estado', ...this.ultimo.estado });
  }

  fala(texto) {
    this.ultimo.fala = texto;
    this.enviar({ tipo: 'fala', texto });
  }

  prompt(texto, escrevendo = false) {
    this.ultimo.prompt = texto;
    this.ultimo.escrevendo = escrevendo;
    this.enviar({ tipo: 'prompt', texto, escrevendo });
  }

  bloco(nome, fala, prompt) {
    Object.assign(this.ultimo, { bloco: nome, fala, prompt, escrevendo: false });
    this.tudo();
  }
}

function html(nonce) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --verde: var(--vscode-charts-green, #22c55e); --amarelo: var(--vscode-charts-yellow, #facc15); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 10px 12px 16px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); background: transparent; }
  .topo { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .ponto { width: 9px; height: 9px; border-radius: 50%; background: var(--vscode-disabledForeground); flex: none; }
  .ponto.vivo { background: var(--verde); animation: pulsar 1.2s ease-in-out infinite; }
  .ponto.gravando { background: var(--vscode-charts-red, #ef4444); animation: pulsar 1s ease-in-out infinite; }
  .ponto.ocupado { background: var(--amarelo); animation: pulsar .8s ease-in-out infinite; }
  @keyframes pulsar { 50% { opacity: .35; } }
  .rotulo { font-weight: 600; }
  .detalhe { color: var(--vscode-descriptionForeground); font-size: .92em; margin-left: auto; text-align: right; }
  canvas { display: block; width: 100%; height: 64px; border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #8884)); }
  h3 { margin: 14px 0 4px; font-size: .8em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); display: flex; gap: 6px; align-items: center; }
  .caixa { border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #8884)); padding: 8px; min-height: 44px; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .vazio { color: var(--vscode-descriptionForeground); font-style: italic; }
  .escrevendo::after { content: '▍'; color: var(--verde); animation: pulsar .8s steps(2) infinite; }
  .botoes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  button { font: inherit; border: 1px solid transparent; padding: 4px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
  kbd { font-family: var(--vscode-editor-font-family); font-size: .85em; opacity: .75; margin-left: 4px; }
  .rodape { margin-top: 14px; color: var(--vscode-descriptionForeground); font-size: .9em; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; }
</style></head>
<body>
  <div class="topo"><span id="ponto" class="ponto"></span><span id="rotulo" class="rotulo">Parado</span><span id="detalhe" class="detalhe"></span></div>
  <canvas id="ondas" height="64"></canvas>
  <div class="botoes">
    <button data-cmd="dizAi.ditar">Ditar<kbd>Ctrl+Alt+D</kbd></button>
    <button class="sec" data-cmd="dizAi.diagnosticar">Testar microfone</button>
  </div>

  <h3>Você disse</h3>
  <div id="fala" class="caixa vazio">Aperte Ctrl+Alt+D e fale. A transcrição aparece aqui e no fala.md.</div>

  <h3>Prompt <span id="escrevendo"></span></h3>
  <div id="prompt" class="caixa vazio">A cada pausa na fala, o Claude reescreve tudo aqui e no prompt.md, ao lado.</div>
  <div class="botoes">
    <button data-cmd="dizAi.enviar">Enviar<kbd>Ctrl+Alt+Enter</kbd></button>
    <button class="sec" data-cmd="dizAi.ajustar">Ajustar<kbd>Ctrl+Alt+R</kbd></button>
    <button class="sec" data-cmd="dizAi.copiar">Copiar</button>
    <button class="sec" data-cmd="dizAi.trocarModo">Modo</button>
  </div>

  <div class="rodape" id="rodape">Tudo fica salvo em <a data-cmd="dizAi.abrirPasta">Documentos/Diz Aí</a>, um bloco por ditado.</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  document.body.addEventListener('click', e => {
    const alvo = e.target.closest('[data-cmd]');
    if (alvo) vscode.postMessage({ tipo: 'comando', id: alvo.dataset.cmd });
  });

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
      const v = vivo ? Math.max(0.04, barras[i]) : 0.04;
      const bh = Math.max(2, v * (h - 8));
      ctx.fillRect(i * passo + (passo - larg) / 2, (h - bh) / 2, larg, bh);
    }
    requestAnimationFrame(desenhar);
  }
  requestAnimationFrame(desenhar);

  // ---- mensagens ----
  const CLASSES = { abrindo: 'ocupado', ouvindo: 'vivo', gravando: 'gravando', transcrevendo: 'ocupado', lapidando: 'ocupado' };
  function estado(m) {
    $('rotulo').textContent = m.rotulo || 'Parado';
    $('detalhe').textContent = m.detalhe || '';
    $('ponto').className = 'ponto ' + (CLASSES[m.estado] || '');
    vivo = ['ouvindo', 'gravando', 'abrindo'].includes(m.estado);
    if (!vivo) barras = new Array(N).fill(0);
  }
  function texto(id, t, vazio) {
    const el = $(id);
    el.textContent = t && t.trim() ? t.trim() : vazio;
    el.classList.toggle('vazio', !(t && t.trim()));
    el.scrollTop = el.scrollHeight;
  }
  const VAZIO_FALA = 'Aperte Ctrl+Alt+D e fale. A transcrição aparece aqui e no fala.md.';
  const VAZIO_PROMPT = 'A cada pausa na fala, o Claude reescreve tudo aqui e no prompt.md, ao lado.';
  function prompt(t, escrevendo) {
    texto('prompt', t, VAZIO_PROMPT);
    $('prompt').classList.toggle('escrevendo', !!escrevendo);
    $('escrevendo').textContent = escrevendo ? '· escrevendo…' : '';
  }
  window.addEventListener('message', ({ data: m }) => {
    if (m.tipo === 'niveis') barras = barras.concat(m.valores).slice(-N);
    else if (m.tipo === 'estado') estado(m);
    else if (m.tipo === 'fala') texto('fala', m.texto, VAZIO_FALA);
    else if (m.tipo === 'prompt') prompt(m.texto, m.escrevendo);
    else if (m.tipo === 'tudo') {
      estado(m.estado);
      texto('fala', m.fala, VAZIO_FALA);
      prompt(m.prompt, m.escrevendo);
      if (m.bloco) $('rodape').innerHTML = 'Bloco <b></b> em <a data-cmd="dizAi.abrirPasta">Documentos/Diz Aí</a>: fala.md e prompt.md.';
      if (m.bloco) $('rodape').querySelector('b').textContent = m.bloco;
    }
  });
  vscode.postMessage({ tipo: 'pronto' });
</script>
</body></html>`;
}

module.exports = { Painel };
