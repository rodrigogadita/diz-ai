// Diz Aí: fale a ideia, o Claude escreve o prompt, a extensão entrega no chat.
const vscode = require('vscode');
const crypto = require('crypto');
const { ler, gravar, pastaBase } = require('./config');
const blocos = require('./blocos');
const contexto = require('./contexto');
const motores = require('./motores');
const whisper = require('./motores/whisper');
const destinos = require('./destinos');
const lapidador = require('./lapidador');
const { Historico } = require('./historico');
const { Painel } = require('./painel');
const ondas = require('./ondas');
const log = require('./log');
const fs = require('fs');
const path = require('path');
const { listarModos } = require('./prompts');
const { extrairComandoFinal, aplicarAtalhos, formatarDuracao } = require('./texto');

const esperar = ms => new Promise(r => setTimeout(r, ms));
const resumo = t => crypto.createHash('sha1').update(String(t).trim()).digest('hex');

let ctxExt;
let barra;
let relogio = null;
let historico;
let painel;
let painelJaMostrado = false;
let inicioGravacao = 0;
const emCurso = new Map();   // dir do bloco -> { cts, promessa }
const agendados = new Map(); // dir do bloco -> timeout da pausa
let escrevendo = 0;          // >0 enquanto a própria extensão edita o prompt.md

// ---------- barra de status ----------
function nomeModo() {
  const m = listarModos(ler('modosPersonalizados'))[ler('modo')];
  return m ? m.nome : 'Prompt estruturado';
}

// Texto da barra enquanto ouve: as ondas mudam a cada leitura do medidor.
function textoOuvindo() {
  const e = motores.estado();
  if (e === 'gravando') return `$(circle-large-filled) ${ondas.barrinhas()} ${formatarDuracao(Date.now() - inicioGravacao)}`;
  if (e === 'abrindo') return `$(loading~spin) Abrindo o ditado ${ondas.barrinhas()}`;
  return `$(mic-filled) ${ondas.barrinhas()} Ouvindo`;
}

const ROTULOS = { abrindo: 'Abrindo o ditado…', ouvindo: 'Ouvindo', gravando: 'Gravando', transcrevendo: 'Transcrevendo…' };

function pintarBarra(detalhe = '') {
  const e = motores.estado();
  barra.backgroundColor = undefined;
  clearInterval(relogio);
  relogio = null;
  const ouvindo = ['abrindo', 'ouvindo', 'gravando'].includes(e);
  ondas.definirOuvindo(ouvindo);
  if (ouvindo) {
    if (e === 'gravando') {
      inicioGravacao ||= Date.now();
      relogio = setInterval(() => { barra.text = textoOuvindo(); }, 1000); // o relógio anda mesmo em silêncio
      barra.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    barra.text = textoOuvindo();
    barra.tooltip = e === 'abrindo' ? 'Esperando o ditado do Windows começar a ouvir' : 'Ctrl+Alt+D para parar · Esc cancela';
    painel.estado(e, ROTULOS[e], motores.motor() === 'windows' ? 'ditado do Windows' : motores.motor());
  } else if (e === 'transcrevendo') {
    inicioGravacao = 0;
    barra.text = '$(loading~spin) Transcrevendo';
    painel.estado(e, ROTULOS[e], 'Whisper');
  } else if (emCurso.size) {
    barra.text = '$(loading~spin) Lapidando';
    barra.tooltip = 'O Claude está escrevendo o prompt · Esc cancela';
    painel.estado('lapidando', 'Lapidando o prompt…', nomeModo());
  } else {
    inicioGravacao = 0;
    painel.estado('parado', 'Parado', detalhe || nomeModo());
    barra.text = '$(mic) Diz Aí';
    barra.tooltip = new vscode.MarkdownString(
      `**Diz Aí** · modo *${nomeModo()}* · motor *${motores.motor()}*\n\n` +
      '`Ctrl+Alt+D` ditar · `Ctrl+Alt+L` lapidar · `Ctrl+Alt+Enter` enviar · `Ctrl+Alt+R` ajustar · `Ctrl+Alt+M` ditar direto no chat');
  }
  vscode.commands.executeCommand('setContext', 'dizAi.lapidando', emCurso.size > 0);
}

// ---------- editores ----------
async function abrirFala(b) {
  const doc = await vscode.workspace.openTextDocument(b.fala);
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active, preview: false });
  // Continua de onde parou, numa linha nova.
  if (doc.getText().trim() && !doc.getText().endsWith('\n')) {
    await ed.edit(e => e.insert(doc.lineAt(doc.lineCount - 1).range.end, '\n'));
  }
  const fim = doc.lineAt(doc.lineCount - 1).range.end;
  ed.selection = new vscode.Selection(fim, fim);
  // O prompt.md fica aberto ao lado desde já: é ali que a descrição aparece ao vivo.
  await mostrarPrompt(b);
  mostrarBloco(b);
  return ed;
}

function mostrarBloco(b) {
  painel.bloco(path.basename(b.dir), fs.existsSync(b.fala.fsPath) ? fs.readFileSync(b.fala.fsPath, 'utf8') : '',
    fs.existsSync(b.prompt.fsPath) ? fs.readFileSync(b.prompt.fsPath, 'utf8') : '');
}

async function mostrarPrompt(b) {
  if (!fs.existsSync(b.prompt.fsPath)) fs.writeFileSync(b.prompt.fsPath, '', 'utf8');
  const visivel = vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === b.prompt.fsPath);
  if (visivel) return;
  const doc = await vscode.workspace.openTextDocument(b.prompt);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
}

// Escreve o texto em streaming no prompt.md sem enfileirar edições demais.
function escritor(uri) {
  let ultimo = null, ocupado = false;
  const bombear = async () => {
    if (ocupado || ultimo === null) return;
    ocupado = true;
    const t = ultimo; ultimo = null;
    escrevendo++;
    try { await blocos.trocarTexto(uri, t, { salvar: false }); } finally { escrevendo--; ocupado = false; }
    bombear();
  };
  return {
    escrever(t) { ultimo = t; painel.prompt(t, true); bombear(); },
    async terminar(t) {
      painel.prompt(t, false);
      while (ocupado) await esperar(20);
      ultimo = null;
      escrevendo++;
      try { await blocos.trocarTexto(uri, t, { salvar: true }); } finally { escrevendo--; }
    },
  };
}

// ---------- lapidar ----------
function textoDaFala(fala) {
  return aplicarAtalhos(extrairComandoFinal(fala, ler('comandosEnviar')).fala, ler('atalhosDeVoz') || {});
}

async function lapidarBloco(b, { silencioso = false } = {}) {
  const anterior = emCurso.get(b.dir);
  if (anterior) { anterior.cts.cancel(); await anterior.promessa.catch(() => {}); }

  await blocos.salvarSeAberto(b.fala);
  const fala = textoDaFala(await blocos.lerTexto(b.fala));
  if (!fala.trim()) {
    if (!silencioso) vscode.window.showInformationMessage('A fala está vazia. Aperte Ctrl+Alt+D e comece a falar.');
    return null;
  }

  const cts = new vscode.CancellationTokenSource();
  const promessa = (async () => {
    await mostrarPrompt(b);
    const saida = escritor(b.prompt);
    const modo = ler('modo');
    const prompt = await lapidador.lapidar(fala, contexto.coletar(), {
      modo,
      cancelar: cts.token,
      aoEscrever: t => saida.escrever(t),
    });
    await saida.terminar(prompt + '\n');
    blocos.gravarMeta(b, { lapidado: resumo(fala), modo, editadoAMao: false });
    return prompt;
  })();

  emCurso.set(b.dir, { cts, promessa });
  pintarBarra();
  try {
    return await promessa;
  } catch (e) {
    if (e.message !== 'cancelado') vscode.window.showErrorMessage(`Diz Aí: não consegui lapidar. ${e.message}`);
    return null;
  } finally {
    if (emCurso.get(b.dir)?.promessa === promessa) emCurso.delete(b.dir);
    cts.dispose();
    pintarBarra();
    historico.atualizar();
  }
}

// ---------- enviar ----------
async function enviarBloco(b, { crua = false } = {}) {
  blocos.usar(b);
  let texto;
  const ed = vscode.window.activeTextEditor;
  if (crua) {
    texto = textoDaFala(await blocos.lerTexto(b.fala));
  } else if (ed && ed.document.uri.fsPath === b.prompt.fsPath && ed.document.getText().trim()) {
    texto = ed.document.getText(); // vale o que você editou à mão
  } else {
    const andamento = emCurso.get(b.dir);
    if (andamento) await andamento.promessa.catch(() => {});
    const fala = textoDaFala(await blocos.lerTexto(b.fala));
    const meta = blocos.lerMeta(b);
    const prompt = await blocos.lerTexto(b.prompt);
    const emDia = prompt.trim() && (meta.editadoAMao || meta.lapidado === resumo(fala));
    texto = emDia ? prompt : await lapidarBloco(b);
  }
  if (!texto || !texto.trim()) {
    if (texto !== null) vscode.window.showInformationMessage('Nada para enviar ainda.');
    return;
  }
  await blocos.salvarSeAberto(b.prompt);
  await destinos.entregar(texto.trim());
  blocos.gravarMeta(b, { enviado: true, enviadoEm: new Date().toISOString() });
  historico.atualizar();
}

// ---------- lapidação ao vivo e comandos de voz ----------
function aoMudarFala(doc) {
  const b = blocos.deUri(doc.uri);
  if (!b) return;
  clearTimeout(agendados.get(b.dir));
  emCurso.get(b.dir)?.cts.cancel(); // a fala mudou: a lapidação em andamento ficou velha
  agendados.set(b.dir, setTimeout(async () => {
    agendados.delete(b.dir);
    const texto = doc.getText();
    const { fala, comando } = extrairComandoFinal(texto, ler('comandosEnviar'));
    if (comando) {
      escrevendo++; // a própria extensão tira o comando da fala: não é fala nova
      try { await blocos.trocarTexto(b.fala, fala + '\n'); } finally { escrevendo--; }
      vscode.window.setStatusBarMessage(`$(megaphone) "${comando}": enviando…`, 4000);
      return enviarBloco(b);
    }
    if (!ler('lapidarAoVivo') || !texto.trim() || emCurso.has(b.dir)) return;
    const meta = blocos.lerMeta(b);
    if (meta.editadoAMao || meta.lapidado === resumo(textoDaFala(texto))) return;
    lapidarBloco(b, { silencioso: true });
  }, Math.max(800, ler('pausaAoVivoMs') || 2000)));
}

function aoMudarDocumento(e) {
  if (!e.contentChanges.length) return;
  const uri = e.document.uri;
  if (blocos.dentro(uri)) ondas.desenharEditor(); // some a dica do arquivo vazio
  if (blocos.ehFala(uri)) {
    painel.fala(e.document.getText());
    if (!escrevendo) aoMudarFala(e.document);
  }
  else if (blocos.ehPrompt(uri) && !escrevendo && !emCurso.has(blocos.deUri(uri).dir)) {
    blocos.gravarMeta(blocos.deUri(uri), { editadoAMao: true });
  }
}

// ---------- texto vindo do Whisper ----------
let aoAjustar = null; // quando o Whisper grava um ajuste de prompt

async function aoTranscrever({ texto, alvo }) {
  texto = aplicarAtalhos(texto, ler('atalhosDeVoz') || {});
  if (alvo === 'ajuste' && aoAjustar) { const f = aoAjustar; aoAjustar = null; return f(texto); }
  if (alvo === 'campo') {
    const { fala, comando } = extrairComandoFinal(texto, ler('comandosEnviar'));
    return destinos.entregar(comando ? fala : texto);
  }
  const b = blocos.emUso() || blocos.criar();
  const doc = await vscode.workspace.openTextDocument(b.fala);
  const ed = vscode.window.visibleTextEditors.find(e => e.document === doc);
  const pos = ed ? ed.selection.active : doc.lineAt(doc.lineCount - 1).range.end;
  const antes = doc.getText(new vscode.Range(new vscode.Position(0, 0), pos));
  const sep = antes && !/\s$/.test(antes) ? ' ' : '';
  const e = new vscode.WorkspaceEdit();
  e.insert(doc.uri, pos, sep + texto);
  await vscode.workspace.applyEdit(e);
  await doc.save();
}

// ---------- comandos ----------
async function ditar() {
  // Já está ouvindo: o mesmo atalho para.
  if (['abrindo', 'ouvindo', 'gravando', 'transcrevendo'].includes(motores.estado())) return motores.alternar();
  const ed = vscode.window.activeTextEditor;
  const b = ed && blocos.ehFala(ed.document.uri) ? blocos.deUri(ed.document.uri) : blocos.paraDitar();
  blocos.usar(b);

  // Na primeira vez da sessão, mostra o painel Ao vivo (ondas, fala e prompt) sem tirar o cursor do bloco.
  if (!painelJaMostrado && ler('mostrarPainel')) {
    painelJaMostrado = true;
    await vscode.commands.executeCommand('dizAi.aoVivo.focus').then(undefined, () => {});
  }
  await abrirFala(b); // devolve o foco ao fala.md: é ali que o Win+H digita
  await motores.alternar('fala');
}

async function diagnosticar() {
  log.mostrar();
  log.info('--- diagnóstico do microfone ---');
  const r = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Diz Aí: fale alguma coisa por 3 segundos…' },
    () => motores.diagnosticar());
  r.linhas.forEach(l => log.info(l));
  const problemas = [];
  if (r.mic?.mudo) problemas.push('o microfone está no mudo');
  if (r.linhas.some(l => l.includes('DESLIGADO'))) problemas.push('a fala online do Windows está desligada');
  if (r.max !== null && r.max < 50) problemas.push('não chegou som do microfone');
  if (!problemas.length) {
    vscode.window.showInformationMessage(`Microfone ok. ${r.linhas.slice(1).join(' · ')}`);
    return;
  }
  const acao = await vscode.window.showWarningMessage(`Encontrei: ${problemas.join('; ')}.`, 'Liberar tudo', 'Configurações de som do Windows');
  if (acao === 'Liberar tudo') {
    if (r.mic?.mudo || (r.mic && r.mic.volume < 20)) log.info(`microfone: ${await motores.liberarMicrofone()}`);
    if (r.linhas.some(l => l.includes('DESLIGADO'))) { await motores.ligarFalaOnline(); log.info('fala online ligada'); }
    vscode.window.showInformationMessage('Liberado. Aperte Ctrl+Alt+D e fale.');
  } else if (acao) {
    vscode.env.openExternal(vscode.Uri.parse('ms-settings:sound'));
  }
}

async function ditarNoChat() {
  if (['abrindo', 'ouvindo', 'gravando'].includes(motores.estado())) return motores.alternar();
  // O Win+H digita onde estiver o foco: leva o foco para o chat antes.
  if (motores.motor() === 'windows' && await destinos.focar()) await esperar(300);
  await motores.alternar('campo');
}

async function ajustar() {
  const b = blocos.emUso();
  const prompt = b && (await blocos.lerTexto(b.prompt)).trim();
  if (!prompt) {
    vscode.window.showInformationMessage('Ainda não há prompt para ajustar. Dite e lapide primeiro (Ctrl+Alt+D, Ctrl+Alt+L).');
    return;
  }
  const aplicar = async ajuste => {
    if (!ajuste || !ajuste.trim()) return;
    const cts = new vscode.CancellationTokenSource();
    const promessa = (async () => {
      await mostrarPrompt(b);
      const saida = escritor(b.prompt);
      const novo = await lapidador.ajustar(prompt, ajuste, { cancelar: cts.token, aoEscrever: t => saida.escrever(t) });
      await saida.terminar(novo + '\n');
      blocos.gravarMeta(b, { editadoAMao: true }); // o prompt agora vale mais que a fala
      return novo;
    })();
    emCurso.set(b.dir, { cts, promessa });
    pintarBarra();
    try { await promessa; } catch (e) {
      if (e.message !== 'cancelado') vscode.window.showErrorMessage(`Diz Aí: não consegui ajustar. ${e.message}`);
    } finally { emCurso.delete(b.dir); cts.dispose(); pintarBarra(); historico.atualizar(); }
  };

  const motor = motores.motor();
  const caixa = vscode.window.showInputBox({
    title: 'Ajustar o prompt',
    prompt: motor === 'whisper' ? 'Fale o ajuste e aperte Enter (ou digite)' : 'Fale ou digite o ajuste',
    placeHolder: 'ex.: deixa mais curto · acrescenta que é pra usar pytest · tira a parte do login',
    ignoreFocusOut: true,
  });
  if (motor === 'whisper') {
    aoAjustar = aplicar;
    await motores.alternar('ajuste');
    const digitado = await caixa;
    if (digitado === undefined) { aoAjustar = null; return motores.cancelar(); }
    if (digitado.trim()) { aoAjustar = null; await motores.cancelar(); return aplicar(digitado); }
    return motores.alternar(); // Enter vazio: para e usa o que foi falado
  }
  if (motor === 'windows') setTimeout(() => motores.alternar('campo'), 250);
  return aplicar(await caixa);
}

async function trocarModo() {
  const modos = listarModos(ler('modosPersonalizados'));
  const atual = ler('modo');
  const r = await vscode.window.showQuickPick(
    Object.entries(modos).map(([id, m]) => ({ id, label: `${id === atual ? '$(check) ' : ''}${m.nome}`, detail: m.detalhe })),
    { title: 'Modo de escrita do prompt', placeHolder: 'Como a sua fala deve virar prompt' });
  if (!r) return;
  await gravar('modo', r.id);
  pintarBarra();
  const b = blocos.emUso();
  if (b && (await blocos.lerTexto(b.prompt)).trim() && !blocos.lerMeta(b).enviado) lapidarBloco(b);
}

async function trocarMotor() {
  const r = await vscode.window.showQuickPick([
    { id: 'windows', label: '$(window) Ditado do Windows (Win+H)', detail: 'Online, ótimo em português, pontua sozinho. Digita no campo em foco.' },
    { id: 'whisper', label: '$(radio-tower) Whisper', detail: 'O mais preciso para termos técnicos. Groq (grátis com limite), OpenAI ou servidor local.' },
    { id: 'vscode', label: '$(vm) VS Code Speech', detail: 'Offline, roda na sua máquina. Só dita em editores de texto.' },
  ], { title: 'Quem transforma a sua voz em texto' });
  if (!r) return;
  await gravar('motor', r.id);
  if (r.id === 'whisper') {
    const p = whisper.provedor();
    if (p.precisaChave && !(await ctxExt.secrets.get(whisper.nomeSegredo(p.id)))) await definirChaveWhisper();
  }
  motores.iniciar(ctxExt);
  pintarBarra();
}

async function definirChaveWhisper() {
  const p = await vscode.window.showQuickPick([
    { id: 'groq', label: 'Groq', detail: 'whisper-large-v3-turbo · muito rápido · chave em console.groq.com/keys' },
    { id: 'openai', label: 'OpenAI', detail: 'gpt-4o-transcribe · chave em platform.openai.com/api-keys' },
    { id: 'local', label: 'Servidor local', detail: 'Qualquer servidor compatível com /v1/audio/transcriptions (faster-whisper, speaches)' },
  ], { title: 'Provedor do Whisper' });
  if (!p) return;
  await gravar('whisper.provedor', p.id);
  if (p.id === 'local') {
    const url = await vscode.window.showInputBox({ title: 'Endereço do servidor', value: ler('whisper.url') || whisper.PROVEDORES.local.url });
    if (url) await gravar('whisper.url', url);
    return;
  }
  const chave = await vscode.window.showInputBox({ title: `Chave da API ${p.label}`, password: true, ignoreFocusOut: true, placeHolder: 'Fica guardada no cofre do VS Code, nunca em arquivo' });
  if (chave) {
    await ctxExt.secrets.store(whisper.nomeSegredo(p.id), chave.trim());
    vscode.window.showInformationMessage(`Chave do ${p.label} guardada.`);
  }
}

async function cancelar() {
  if (['abrindo', 'ouvindo', 'gravando'].includes(motores.estado())) return motores.cancelar();
  for (const { cts } of emCurso.values()) cts.cancel();
}

async function abrirBloco(b) {
  blocos.usar(b);
  const temPrompt = (await blocos.lerTexto(b.prompt)).trim();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(b.fala), { viewColumn: vscode.ViewColumn.Active, preview: false });
  if (temPrompt) await mostrarPrompt(b);
  mostrarBloco(b);
}

async function excluirBloco(b) {
  const ok = await vscode.window.showWarningMessage(`Excluir "${b.titulo}"?`, { modal: true, detail: 'A fala e o prompt vão para a lixeira.' }, 'Excluir');
  if (ok !== 'Excluir') return;
  await vscode.workspace.fs.delete(vscode.Uri.file(b.dir), { recursive: true, useTrash: true });
  historico.atualizar();
}

async function menu() {
  const itens = [
    { label: '$(mic) Ditar', description: 'Ctrl+Alt+D', cmd: 'dizAi.ditar' },
    { label: '$(comment-discussion) Ditar direto no chat', description: 'Ctrl+Alt+M', cmd: 'dizAi.ditarNoChat' },
    { label: '$(sparkle) Lapidar a fala', description: 'Ctrl+Alt+L', cmd: 'dizAi.lapidar' },
    { label: '$(edit) Ajustar o prompt por voz', description: 'Ctrl+Alt+R', cmd: 'dizAi.ajustar' },
    { label: '$(send) Enviar', description: 'Ctrl+Alt+Enter', cmd: 'dizAi.enviar' },
    { label: '$(quote) Enviar a fala sem lapidar', cmd: 'dizAi.enviarFala' },
    { kind: vscode.QuickPickItemKind.Separator, label: 'Ajustes' },
    { label: `$(symbol-namespace) Modo: ${nomeModo()}`, cmd: 'dizAi.trocarModo' },
    { label: `$(settings-gear) Motor de voz: ${motores.motor()}`, cmd: 'dizAi.trocarMotor' },
    { label: '$(new-file) Bloco novo', cmd: 'dizAi.novoBloco' },
    { label: '$(pulse) Painel ao vivo', cmd: 'dizAi.aoVivo.focus' },
    { label: '$(history) Histórico', cmd: 'dizAi.historico.focus' },
    { label: '$(debug) Testar o microfone', cmd: 'dizAi.diagnosticar' },
    { label: '$(folder-opened) Pasta dos prompts', cmd: 'dizAi.abrirPasta' },
    { label: '$(book) Primeiros passos', cmd: 'dizAi.primeirosPassos' },
    { label: '$(gear) Configurações', cmd: 'dizAi.configurar' },
  ];
  const r = await vscode.window.showQuickPick(itens, { title: 'Diz Aí' });
  if (r?.cmd) vscode.commands.executeCommand(r.cmd);
}

function atualizarContexto() {
  const ed = vscode.window.activeTextEditor;
  const uri = ed?.document.uri;
  const noBloco = !!uri && blocos.dentro(uri);
  vscode.commands.executeCommand('setContext', 'dizAi.noBloco', noBloco);
  contexto.lembrar(ed);
  ondas.desenharEditor();
  if (noBloco && painel) {
    const b = blocos.deUri(uri);
    if (b.dir !== atualizarContexto.ultimo) { atualizarContexto.ultimo = b.dir; mostrarBloco(b); }
  }
}

// Cada leitura do medidor: ondas no editor, no painel e na barra.
function aoNivel({ nivel }) {
  ondas.nivel(nivel);
  painel.nivel(nivel);
  if (['abrindo', 'ouvindo', 'gravando'].includes(motores.estado())) barra.text = textoOuvindo();
}

// ---------- ativação ----------
function activate(context) {
  ctxExt = context;
  blocos.iniciar(context);
  motores.iniciar(context);
  historico = new Historico();
  painel = new Painel();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('dizAi.aoVivo', painel, { webviewOptions: { retainContextWhenHidden: true } }));

  barra = vscode.window.createStatusBarItem('dizAi.status', vscode.StatusBarAlignment.Right, 100);
  barra.name = 'Diz Aí';
  barra.command = 'dizAi.menu';
  barra.show();
  pintarBarra();
  atualizarContexto();

  const view = vscode.window.createTreeView('dizAi.historico', { treeDataProvider: historico });
  historico.anexar(view);

  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  const comBloco = fn => async item => {
    const b = item?.dir ? item : blocos.emUso();
    if (!b) return vscode.window.showInformationMessage('Nenhum bloco ainda. Aperte Ctrl+Alt+D para ditar.');
    return fn(b);
  };

  context.subscriptions.push(
    barra, view,
    cmd('dizAi.ditar', ditar),
    cmd('dizAi.ditarNoChat', ditarNoChat),
    cmd('dizAi.lapidar', comBloco(b => lapidarBloco(b))),
    cmd('dizAi.enviar', comBloco(b => enviarBloco(b))),
    cmd('dizAi.enviarFala', comBloco(b => enviarBloco(b, { crua: true }))),
    cmd('dizAi.ajustar', ajustar),
    cmd('dizAi.cancelar', cancelar),
    cmd('dizAi.trocarModo', trocarModo),
    cmd('dizAi.trocarMotor', trocarMotor),
    cmd('dizAi.definirChaveWhisper', definirChaveWhisper),
    cmd('dizAi.novoBloco', async () => { await abrirFala(blocos.criar()); historico.atualizar(); }),
    cmd('dizAi.abrirBloco', abrirBloco),
    cmd('dizAi.reenviar', comBloco(async b => {
      const t = (await blocos.lerTexto(b.prompt)).trim() || textoDaFala(await blocos.lerTexto(b.fala));
      if (t) { await destinos.entregar(t); blocos.gravarMeta(b, { enviado: true }); historico.atualizar(); }
    })),
    cmd('dizAi.copiar', comBloco(async b => {
      await vscode.env.clipboard.writeText(((await blocos.lerTexto(b.prompt)) || (await blocos.lerTexto(b.fala))).trim());
      vscode.window.setStatusBarMessage('$(clippy) Copiado', 3000);
    })),
    cmd('dizAi.excluir', comBloco(excluirBloco)),
    cmd('dizAi.atualizarHistorico', () => historico.atualizar()),
    cmd('dizAi.abrirPasta', () => {
      fs.mkdirSync(pastaBase(), { recursive: true });
      vscode.env.openExternal(vscode.Uri.file(pastaBase()));
    }),
    cmd('dizAi.configurar', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:rodrigogadita.diz-ai')),
    cmd('dizAi.primeirosPassos', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'rodrigogadita.diz-ai#dizAi.primeirosPassos', false)),
    cmd('dizAi.configuracoesWindows', pagina => vscode.env.openExternal(vscode.Uri.parse(`ms-settings:${pagina || 'typing'}`))),
    cmd('dizAi.menu', menu),
    cmd('dizAi.diagnosticar', diagnosticar),
    cmd('dizAi.mostrarLog', () => log.mostrar()),
    log.canal(),
    motores.aoMudar(e => pintarBarra(e.detalhe)),
    motores.aoNivel(aoNivel),
    motores.aoTranscrever(aoTranscrever),
    vscode.window.onDidChangeActiveTextEditor(atualizarContexto),
    vscode.window.onDidChangeTextEditorSelection(e => contexto.lembrar(e.textEditor)),
    vscode.workspace.onDidChangeTextDocument(aoMudarDocumento),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('dizAi')) { pintarBarra(); historico.atualizar(); } }),
    { dispose: () => { clearInterval(relogio); motores.encerrar(); ondas.descartar(); } },
  );

  if (!context.globalState.get('dizAi.boasVindas')) {
    context.globalState.update('dizAi.boasVindas', true);
    vscode.commands.executeCommand('dizAi.primeirosPassos');
  }
}

function deactivate() {
  motores.encerrar();
}

module.exports = { activate, deactivate };
