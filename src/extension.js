// Diz Aí: fale a ideia, o Claude escreve o prompt, a extensão entrega no chat.
// Tudo acontece no painel "Ao vivo": caixa 1 (você fala), caixa 2 (o prompt), Enviar, Limpar.
const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
const { listarModos } = require('./prompts');
const { extrairComandoFinal, aplicarAtalhos, formatarDuracao } = require('./texto');

const esperar = ms => new Promise(r => setTimeout(r, ms));
const resumo = t => crypto.createHash('sha1').update(String(t).trim()).digest('hex');
const OUVINDO = ['abrindo', 'ouvindo', 'gravando'];
// Abas do editor só quando a pessoa pede (ou quando o motor precisa de um editor de texto).
const comAbas = () => ler('abrirArquivos') === true || motores.motor() === 'vscode';

let ctxExt;
let barra;
let relogio = null;
let historico;
let painel;
let blocoNoPainel = null;
let inicioGravacao = 0;
let abasArrumadas = false;
const emCurso = new Map();   // dir do bloco -> { cts, promessa }
const agendados = new Map(); // dir do bloco -> timeout da pausa
let escrevendo = 0;          // >0 enquanto a própria extensão edita fala.md ou prompt.md

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
  const ouvindo = OUVINDO.includes(e);
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
    painel.estado('lapidando', 'Escrevendo o prompt…', nomeModo());
  } else {
    inicioGravacao = 0;
    painel.estado('parado', 'Pronto para falar', detalhe);
    barra.text = '$(mic) Diz Aí';
    barra.tooltip = new vscode.MarkdownString(
      `**Diz Aí** · modo *${nomeModo()}* · motor *${motores.motor()}*\n\n` +
      '`Ctrl+Alt+D` falar · `Ctrl+Alt+Enter` enviar · `Ctrl+Alt+R` ajustar · `Ctrl+Alt+M` falar direto no chat');
  }
  vscode.commands.executeCommand('setContext', 'dizAi.lapidando', emCurso.size > 0);
}

// ---------- painel e editores ----------
const lerArquivo = uri => (fs.existsSync(uri.fsPath) ? fs.readFileSync(uri.fsPath, 'utf8') : '');

function mostrarBloco(b, aviso = '') {
  blocoNoPainel = b.dir;
  const meta = blocos.lerMeta(b);
  const nota = aviso || (meta.enviado ? 'Enviado. Aperte Falar para começar outro prompt, ou Limpar para zerar tudo.'
    : meta.editadoAMao ? 'Você editou o prompt: ele não muda mais sozinho. Use Refazer para lapidar de novo.' : '');
  painel.bloco(path.basename(b.dir), lerArquivo(b.fala), lerArquivo(b.prompt), nota);
}

async function abrirFala(b) {
  const doc = await vscode.workspace.openTextDocument(b.fala);
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active, preview: false });
  // Continua de onde parou, numa linha nova.
  if (doc.getText().trim() && !doc.getText().endsWith('\n')) {
    await ed.edit(e => e.insert(doc.lineAt(doc.lineCount - 1).range.end, '\n'));
  }
  const fim = doc.lineAt(doc.lineCount - 1).range.end;
  ed.selection = new vscode.Selection(fim, fim);
  await prepararPrompt(b);
  return ed;
}

// Garante o prompt.md; só abre como aba ao lado no modo com abas.
async function prepararPrompt(b) {
  if (!fs.existsSync(b.prompt.fsPath)) fs.writeFileSync(b.prompt.fsPath, '', 'utf8');
  if (!comAbas()) return;
  const visivel = vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === b.prompt.fsPath);
  if (visivel) return;
  const doc = await vscode.workspace.openTextDocument(b.prompt);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
}

async function abrirArquivos(b) {
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(b.fala), { viewColumn: vscode.ViewColumn.Active, preview: false });
  if (!fs.existsSync(b.prompt.fsPath)) fs.writeFileSync(b.prompt.fsPath, '', 'utf8');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(b.prompt), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
}

// Escreve o texto em streaming no prompt.md e no painel sem enfileirar edições demais.
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
    if (!silencioso) vscode.window.showInformationMessage('A fala está vazia. Aperte Falar (Ctrl+Alt+D) e comece.');
    return null;
  }

  const cts = new vscode.CancellationTokenSource();
  const promessa = (async () => {
    await prepararPrompt(b);
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
  painel.aviso('');
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
    texto = ed.document.getText(); // vale o que você editou à mão na aba
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
    if (texto !== null) vscode.window.showInformationMessage('Nada para enviar ainda. Fale primeiro.');
    return;
  }
  await blocos.salvarSeAberto(b.prompt);
  let aviso;
  escrevendo++; // a colagem pode cair e ser desfeita num arquivo do bloco: não é edição sua
  try { aviso = await destinos.entregar(texto.trim()); } finally { escrevendo--; }
  blocos.gravarMeta(b, { enviado: true, enviadoEm: new Date().toISOString() });
  painel.aviso(`Enviado. ${aviso} Para outro prompt, aperte Falar; para zerar tudo, Limpar.`);
  historico.atualizar();
}

// ---------- lapidação ao vivo e comandos de voz ----------
function agendarFala(b, obterTexto) {
  clearTimeout(agendados.get(b.dir));
  emCurso.get(b.dir)?.cts.cancel(); // a fala mudou: a lapidação em andamento ficou velha
  agendados.set(b.dir, setTimeout(async () => {
    agendados.delete(b.dir);
    const texto = obterTexto();
    const { fala, comando } = extrairComandoFinal(texto, ler('comandosEnviar'));
    if (comando) {
      escrevendo++; // a própria extensão tira o comando da fala: não é fala nova
      try { await blocos.trocarTexto(b.fala, fala + '\n'); } finally { escrevendo--; }
      painel.fala(fala + '\n');
      vscode.window.setStatusBarMessage(`$(megaphone) "${comando}": enviando…`, 4000);
      return enviarBloco(b);
    }
    if (!ler('lapidarAoVivo') || !texto.trim() || emCurso.has(b.dir)) return;
    const meta = blocos.lerMeta(b);
    if (meta.editadoAMao || meta.lapidado === resumo(textoDaFala(texto))) return;
    lapidarBloco(b, { silencioso: true });
  }, Math.max(800, ler('pausaAoVivoMs') || 2000)));
}

// A pessoa mudou a caixa 1 do painel (falando ou digitando).
async function aoFalarNoPainel(texto) {
  let b = blocos.doDir(blocoNoPainel) || blocos.emUso();
  if (!b) { b = blocos.criar(); blocoNoPainel = b.dir; }
  blocos.usar(b);
  // Mexeu na fala de um prompt já enviado: ele volta a ser rascunho (o Falar continua nele).
  if (blocos.lerMeta(b).enviado) blocos.gravarMeta(b, { enviado: false });
  escrevendo++;
  try { await blocos.trocarTexto(b.fala, texto); } finally { escrevendo--; }
  agendarFala(b, () => painel.ultimo.fala);
}

// A pessoa editou a caixa 2 do painel.
async function aoEditarPromptNoPainel(texto) {
  const b = blocos.doDir(blocoNoPainel) || blocos.emUso();
  if (!b || emCurso.has(b.dir)) return;
  escrevendo++;
  try { await blocos.trocarTexto(b.prompt, texto); } finally { escrevendo--; }
  blocos.gravarMeta(b, { editadoAMao: true });
  painel.aviso('Você editou o prompt: ele não muda mais sozinho. Use Refazer para lapidar de novo.');
}

function aoMudarDocumento(e) {
  if (!e.contentChanges.length) return;
  const uri = e.document.uri;
  if (blocos.dentro(uri)) ondas.desenharEditor(); // some a dica do arquivo vazio
  if (escrevendo) return;
  if (blocos.ehFala(uri)) {
    const b = blocos.deUri(uri);
    if (b.dir === blocoNoPainel) painel.fala(e.document.getText());
    agendarFala(b, () => e.document.getText());
  } else if (blocos.ehPrompt(uri) && !emCurso.has(blocos.deUri(uri).dir)) {
    const b = blocos.deUri(uri);
    blocos.gravarMeta(b, { editadoAMao: true });
    if (b.dir === blocoNoPainel) painel.prompt(e.document.getText());
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
  // No painel, o texto entra onde estiver o cursor da caixa 1.
  if (!comAbas() && painel.visivel && blocoNoPainel === b.dir) return painel.inserirFala(texto);
  const doc = await vscode.workspace.openTextDocument(b.fala);
  const ed = vscode.window.visibleTextEditors.find(x => x.document === doc);
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
  if ([...OUVINDO, 'transcrevendo'].includes(motores.estado())) return motores.alternar();

  // Abas de fala/prompt de versões antigas ou de blocos velhos só confundem: fecha uma vez por sessão.
  if (!comAbas() && !abasArrumadas) { abasArrumadas = true; await blocos.fecharAbas(); }

  const ed = vscode.window.activeTextEditor;
  const b = ed && blocos.ehFala(ed.document.uri) ? blocos.deUri(ed.document.uri) : blocos.paraDitar();
  blocos.usar(b);
  if (b.dir !== blocoNoPainel) mostrarBloco(b);

  if (comAbas()) await abrirFala(b);                       // o VS Code Speech só dita em editor
  else if (motores.motor() === 'windows') await painel.focarFala(); // o Win+H digita na caixa 1
  else await vscode.commands.executeCommand('dizAi.aoVivo.focus');
  await motores.alternar('fala');
}

/** Limpar: fala e prompt novos e, se quiser, conversa nova no Claude Code. */
async function limpar({ conversa = true } = {}) {
  if (OUVINDO.includes(motores.estado())) await motores.cancelar();
  for (const { cts } of emCurso.values()) cts.cancel();
  for (const t of agendados.values()) clearTimeout(t);
  agendados.clear();
  await blocos.fecharAbas();

  const atual = blocos.emUso();
  const vazio = atual && !lerArquivo(atual.fala).trim() && !lerArquivo(atual.prompt).trim();
  const b = vazio ? atual : blocos.criar(); // o anterior fica no Histórico
  blocos.usar(b);

  let onde = null;
  if (conversa && ler('limparAbreConversaNova')) onde = await destinos.novaConversa();
  mostrarBloco(b, onde ? `Tudo limpo: prompt novo e conversa nova no ${onde}. Aperte Falar.` : 'Prompt novo. Aperte Falar.');
  historico.atualizar();
  await painel.focarFala();
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
    vscode.window.showInformationMessage('Microfone liberado. Aperte Falar (Ctrl+Alt+D).');
  } else if (acao) {
    vscode.env.openExternal(vscode.Uri.parse('ms-settings:sound'));
  }
}

async function ditarNoChat() {
  if (OUVINDO.includes(motores.estado())) return motores.alternar();
  // O Win+H digita onde estiver o foco: leva o foco para o chat antes.
  if (motores.motor() === 'windows' && await destinos.focar()) await esperar(300);
  await motores.alternar('campo');
}

async function ajustar() {
  const b = blocos.emUso();
  const prompt = b && (await blocos.lerTexto(b.prompt)).trim();
  if (!prompt) {
    vscode.window.showInformationMessage('Ainda não há prompt para ajustar. Fale primeiro (Ctrl+Alt+D).');
    return;
  }
  const aplicar = async ajuste => {
    if (!ajuste || !ajuste.trim()) return;
    const cts = new vscode.CancellationTokenSource();
    const promessa = (async () => {
      await prepararPrompt(b);
      const saida = escritor(b.prompt);
      const novo = await lapidador.ajustar(prompt, ajuste, { cancelar: cts.token, aoEscrever: t => saida.escrever(t) });
      await saida.terminar(novo + '\n');
      blocos.gravarMeta(b, { editadoAMao: true }); // o prompt ajustado vale mais que a fala
      return novo;
    })();
    emCurso.set(b.dir, { cts, promessa });
    pintarBarra();
    try {
      await promessa;
      painel.aviso(`Ajuste aplicado: "${ajuste.trim()}".`);
    } catch (e) {
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
  painel.modo(nomeModo());
  pintarBarra();
  const b = blocos.emUso();
  if (b && (await blocos.lerTexto(b.prompt)).trim() && !blocos.lerMeta(b).enviado) lapidarBloco(b);
}

async function trocarMotor() {
  const r = await vscode.window.showQuickPick([
    { id: 'windows', label: '$(window) Ditado do Windows (Win+H)', detail: 'Online, ótimo em português, pontua sozinho. Digita na caixa do painel.' },
    { id: 'whisper', label: '$(radio-tower) Whisper', detail: 'O mais preciso para termos técnicos. Groq (grátis com limite), OpenAI ou servidor local.' },
    { id: 'vscode', label: '$(vm) VS Code Speech', detail: 'Offline, roda na sua máquina. Dita num arquivo aberto em aba.' },
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
  if (OUVINDO.includes(motores.estado())) return motores.cancelar();
  for (const { cts } of emCurso.values()) cts.cancel();
}

// Clique no Histórico: o bloco volta para o painel (ou para as abas, no modo com abas).
async function abrirBloco(b) {
  blocos.usar(b);
  mostrarBloco(b);
  if (comAbas()) await abrirArquivos(b);
  else await vscode.commands.executeCommand('dizAi.aoVivo.focus');
}

async function excluirBloco(b) {
  const ok = await vscode.window.showWarningMessage(`Excluir "${b.titulo}"?`, { modal: true, detail: 'A fala e o prompt vão para a lixeira.' }, 'Excluir');
  if (ok !== 'Excluir') return;
  await vscode.workspace.fs.delete(vscode.Uri.file(b.dir), { recursive: true, useTrash: true });
  historico.atualizar();
}

async function menu() {
  const itens = [
    { label: '$(mic) Falar', description: 'Ctrl+Alt+D', cmd: 'dizAi.ditar' },
    { label: '$(send) Enviar', description: 'Ctrl+Alt+Enter', cmd: 'dizAi.enviar' },
    { label: '$(clear-all) Limpar', detail: 'Prompt novo e conversa nova no Claude Code', cmd: 'dizAi.limpar' },
    { label: '$(edit) Ajustar o prompt por voz', description: 'Ctrl+Alt+R', cmd: 'dizAi.ajustar' },
    { label: '$(comment-discussion) Falar direto no chat, sem lapidar', description: 'Ctrl+Alt+M', cmd: 'dizAi.ditarNoChat' },
    { kind: vscode.QuickPickItemKind.Separator, label: 'Ajustes' },
    { label: `$(symbol-namespace) Modo: ${nomeModo()}`, cmd: 'dizAi.trocarModo' },
    { label: `$(settings-gear) Motor de voz: ${motores.motor()}`, cmd: 'dizAi.trocarMotor' },
    { label: '$(pulse) Painel Ao vivo', cmd: 'dizAi.aoVivo.focus' },
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
    if (b.dir !== blocoNoPainel) { blocos.usar(b); mostrarBloco(b); }
  }
}

// Cada leitura do medidor: ondas no editor, no painel e na barra.
function aoNivel({ nivel }) {
  ondas.nivel(nivel);
  painel.nivel(nivel);
  if (OUVINDO.includes(motores.estado())) barra.text = textoOuvindo();
}

// ---------- ativação ----------
function activate(context) {
  ctxExt = context;
  blocos.iniciar(context);
  motores.iniciar(context);
  historico = new Historico();
  painel = new Painel();
  painel.aoFalar = aoFalarNoPainel;
  painel.aoEditarPrompt = aoEditarPromptNoPainel;
  painel.ultimo.modo = nomeModo();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('dizAi.aoVivo', painel, { webviewOptions: { retainContextWhenHidden: true } }));

  barra = vscode.window.createStatusBarItem('dizAi.status', vscode.StatusBarAlignment.Right, 100);
  barra.name = 'Diz Aí';
  barra.command = 'dizAi.menu';
  barra.show();
  pintarBarra();
  atualizarContexto();

  // Ao abrir o VS Code, o painel mostra o prompt em andamento (se não foi enviado).
  const atual = blocos.emUso();
  if (atual && !blocos.lerMeta(atual).enviado) mostrarBloco(atual);

  const view = vscode.window.createTreeView('dizAi.historico', { treeDataProvider: historico });
  historico.anexar(view);

  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  const comBloco = fn => async item => {
    const b = item?.dir ? item : blocos.emUso();
    if (!b) return vscode.window.showInformationMessage('Nada ainda. Aperte Falar (Ctrl+Alt+D).');
    return fn(b);
  };

  context.subscriptions.push(
    barra, view,
    cmd('dizAi.ditar', ditar),
    cmd('dizAi.ditarNoChat', ditarNoChat),
    cmd('dizAi.limpar', () => limpar()),
    cmd('dizAi.novoBloco', () => limpar({ conversa: false })),
    cmd('dizAi.lapidar', comBloco(b => lapidarBloco(b))),
    cmd('dizAi.enviar', comBloco(b => enviarBloco(b))),
    cmd('dizAi.enviarFala', comBloco(b => enviarBloco(b, { crua: true }))),
    cmd('dizAi.ajustar', ajustar),
    cmd('dizAi.cancelar', cancelar),
    cmd('dizAi.trocarModo', trocarModo),
    cmd('dizAi.trocarMotor', trocarMotor),
    cmd('dizAi.definirChaveWhisper', definirChaveWhisper),
    cmd('dizAi.abrirBloco', abrirBloco),
    cmd('dizAi.abrirArquivos', comBloco(abrirArquivos)),
    cmd('dizAi.reenviar', comBloco(async b => {
      const t = (await blocos.lerTexto(b.prompt)).trim() || textoDaFala(await blocos.lerTexto(b.fala));
      if (t) { await destinos.entregar(t); blocos.gravarMeta(b, { enviado: true }); historico.atualizar(); }
    })),
    cmd('dizAi.copiar', comBloco(async b => {
      await vscode.env.clipboard.writeText(((await blocos.lerTexto(b.prompt)) || (await blocos.lerTexto(b.fala))).trim());
      vscode.window.setStatusBarMessage('$(clippy) Prompt copiado', 3000);
      if (b.dir === blocoNoPainel) painel.aviso('Prompt copiado. Cole onde quiser com Ctrl+V.');
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
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('dizAi')) return;
      painel.modo(nomeModo());
      pintarBarra();
      historico.atualizar();
    }),
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
