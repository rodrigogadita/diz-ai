// Liga/desliga o ditado com o motor escolhido, mede o nível do microfone e avisa a interface.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aux = require('./auxiliarWindows');
const whisper = require('./whisper');
const log = require('../log');
const { ler, gravar } = require('../config');

const DITADO_INICIAR = 'workbench.action.editorDictation.start';
const DITADO_PARAR = 'workbench.action.editorDictation.stop';
const MAX_GRAVACAO_MS = 10 * 60 * 1000;
const ESPERA_WINDOWS_MS = 6000;   // tempo para o ditado do Windows começar a ouvir
const FOLGA_PARADA_MS = 1500;     // o Windows parou de ouvir há esse tempo: encerra

const aoMudar = new vscode.EventEmitter();       // { estado, detalhe }
const aoTranscrever = new vscode.EventEmitter(); // { texto, alvo }
const aoNivel = new vscode.EventEmitter();       // { nivel 0..1, falando }

let estado = 'parado'; // parado | abrindo | ouvindo | gravando | transcrevendo
let alvoAtual = 'fala';
let limite = null;
let segredos = null;
let medindo = false;
let windowsConfirmado = false;
let windowsParouEm = 0;
let esperaWindows = null;
const ehWindows = process.platform === 'win32';

function mudar(novo, detalhe = '') {
  estado = novo;
  vscode.commands.executeCommand('setContext', 'dizAi.gravando', novo === 'gravando');
  vscode.commands.executeCommand('setContext', 'dizAi.ouvindo', ['abrindo', 'ouvindo', 'gravando'].includes(novo));
  log.info(`estado: ${novo}${detalhe ? ` (${detalhe})` : ''}`);
  aoMudar.fire({ estado, detalhe });
}

async function temComando(id) {
  return (await vscode.commands.getCommands(true)).includes(id);
}

const motor = () => ler('motor') || (ehWindows ? 'windows' : 'vscode');

// ---------- medidor ----------
// Pico 0..32767 -> 0..1 em escala de decibéis (-60 dB a -10 dB).
function nivelDe(pico) {
  if (pico <= 0) return 0;
  const db = 20 * Math.log10(pico / 32767);
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

function aoNivelBruto({ pico, ditadoWindows }) {
  if (pico < 0) { log.warn('medidor: não abri o microfone'); return; }
  const nivel = nivelDe(pico);
  aoNivel.fire({ nivel, falando: nivel > 0.45 });

  if (motor() !== 'windows' || !['abrindo', 'ouvindo'].includes(estado)) return;
  if (ditadoWindows) {
    windowsParouEm = 0;
    if (!windowsConfirmado) {
      windowsConfirmado = true;
      clearTimeout(esperaWindows);
      mudar('ouvindo', 'o ditado do Windows confirmou');
    }
  } else if (windowsConfirmado) {
    // O Windows fecha o ditado sozinho depois de um silêncio: acompanha.
    windowsParouEm ||= Date.now();
    if (Date.now() - windowsParouEm > FOLGA_PARADA_MS) encerrarSessao('o ditado do Windows parou de ouvir');
  }
}

async function ligarMedidor() {
  if (!ehWindows || medindo) return;
  medindo = true;
  try { await aux.medir(); } catch (e) { medindo = false; log.warn(`medidor: ${e.message}`); }
}

async function desligarMedidor() {
  if (!medindo) return;
  medindo = false;
  try { await aux.pararMedir(); } catch { /* auxiliar fechado */ }
  aoNivel.fire({ nivel: 0, falando: false });
}

function encerrarSessao(motivo) {
  clearTimeout(esperaWindows);
  windowsConfirmado = false;
  windowsParouEm = 0;
  desligarMedidor();
  mudar('parado', motivo);
}

// ---------- checagem antes de ouvir ----------
async function checarMicrofone() {
  if (!ehWindows) return true;
  try {
    const mic = await aux.micEstado();
    if (mic && (mic.mudo || mic.volume < 20)) {
      const r = await vscode.window.showWarningMessage(
        mic.mudo ? 'Seu microfone está no mudo. Ninguém vai te ouvir assim.' : `O volume do microfone está em ${mic.volume}%.`,
        'Liberar o microfone', 'Ignorar');
      if (r === 'Liberar o microfone') log.info(`microfone liberado: ${await aux.micLiberar()}`);
      else if (mic.mudo) return false;
    }
    if (motor() === 'windows' && !(await aux.falaOnline())) {
      const r = await vscode.window.showWarningMessage(
        'O ditado do Windows precisa do reconhecimento de fala online, que está desligado.', 'Ligar agora', 'Usar outro motor');
      if (r === 'Ligar agora') { await aux.ligarFalaOnline(); log.info('fala online ligada'); }
      else { if (r === 'Usar outro motor') vscode.commands.executeCommand('dizAi.trocarMotor'); return false; }
    }
  } catch (e) {
    log.warn(`checagem do microfone: ${e.message}`);
  }
  return true;
}

// ---------- Whisper ----------
async function comecarGravacao(alvo) {
  if (!ehWindows) throw new Error('A gravação para o Whisper por enquanto só existe no Windows.');
  await aux.gravar();
  alvoAtual = alvo;
  mudar('gravando');
  ligarMedidor();
  limite = setTimeout(() => pararGravacao(), MAX_GRAVACAO_MS);
}

async function pararGravacao() {
  if (estado !== 'gravando') return;
  clearTimeout(limite);
  desligarMedidor();
  const arquivo = path.join(os.tmpdir(), `diz-ai-${Date.now()}.wav`);
  mudar('transcrevendo');
  try {
    await aux.parar(arquivo);
    const texto = await whisper.transcrever(arquivo, { glossario: ler('glossario') || [], segredos });
    log.info(`whisper: ${texto.length} caracteres`);
    if (texto) aoTranscrever.fire({ texto, alvo: alvoAtual });
    else vscode.window.setStatusBarMessage('$(info) Não ouvi nada. Rode "Diz Aí: diagnosticar o microfone".', 6000);
  } catch (e) {
    log.error(`whisper: ${e.message}`);
    const acao = e.semChave ? await vscode.window.showErrorMessage(e.message, 'Definir chave') : (vscode.window.showErrorMessage(`Diz Aí: ${e.message}`), null);
    if (acao) vscode.commands.executeCommand('dizAi.definirChaveWhisper');
  } finally {
    fs.rm(arquivo, { force: true }, () => {});
    mudar('parado');
  }
}

async function cancelar() {
  if (estado === 'gravando') {
    clearTimeout(limite);
    await aux.cancelar().catch(() => {});
    desligarMedidor();
    mudar('parado', 'gravação descartada');
    vscode.window.setStatusBarMessage('$(close) Gravação descartada.', 3000);
  } else if (['abrindo', 'ouvindo'].includes(estado)) {
    if (motor() === 'vscode') await vscode.commands.executeCommand(DITADO_PARAR);
    else if (motor() === 'windows' && windowsConfirmado) await aux.winH();
    encerrarSessao('cancelado');
  }
}

// ---------- entrada única ----------
/** alvo: 'fala' (bloco do Diz Aí), 'campo' (campo em foco, como o chat) ou 'ajuste'. */
async function alternar(alvo = 'fala') {
  const m = motor();
  if (m === 'whisper') {
    if (estado === 'gravando') return pararGravacao();
    if (estado === 'transcrevendo') return;
    if (!(await checarMicrofone())) return;
    return comecarGravacao(alvo);
  }

  if (m === 'vscode') {
    if (alvo === 'campo') {
      vscode.window.showInformationMessage('O VS Code Speech só dita em editores de texto. Para ditar direto no chat, use o motor "windows" ou "whisper".');
      return;
    }
    if (!(await temComando(DITADO_INICIAR))) {
      const r = await vscode.window.showWarningMessage('O motor "vscode" precisa da extensão VS Code Speech.', 'Instalar', 'Usar outro motor');
      if (r === 'Instalar') await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode.vscode-speech');
      if (r === 'Usar outro motor') vscode.commands.executeCommand('dizAi.trocarMotor');
      return;
    }
    if (estado === 'ouvindo') {
      await vscode.commands.executeCommand(DITADO_PARAR);
      return encerrarSessao('você parou');
    }
    if (!(await checarMicrofone())) return;
    await vscode.commands.executeCommand(DITADO_INICIAR);
    mudar('ouvindo');
    ligarMedidor();
    return;
  }

  if (!ehWindows) {
    vscode.window.showWarningMessage('O ditado do Windows só existe no Windows. Escolha o motor "vscode" ou "whisper".');
    await gravar('motor', 'vscode');
    return;
  }

  // Windows (Win+H): o atalho alterna. O registro do Windows diz se ele está mesmo ouvindo.
  if (['abrindo', 'ouvindo'].includes(estado)) {
    await aux.winH();
    return encerrarSessao('você parou');
  }
  if (!(await checarMicrofone())) return;
  alvoAtual = alvo;
  windowsConfirmado = false;
  windowsParouEm = 0;
  mudar('abrindo');
  await ligarMedidor();
  await aux.winH();
  esperaWindows = setTimeout(async () => {
    if (windowsConfirmado || estado !== 'abrindo') return;
    encerrarSessao('o ditado do Windows não abriu');
    const r = await vscode.window.showWarningMessage(
      'O ditado do Windows não começou a ouvir. O cursor precisa estar num campo de texto e o VS Code em primeiro plano.',
      'Tentar de novo', 'Diagnosticar');
    if (r === 'Tentar de novo') vscode.commands.executeCommand('dizAi.ditar');
    if (r === 'Diagnosticar') vscode.commands.executeCommand('dizAi.diagnosticar');
  }, ESPERA_WINDOWS_MS);
}

/** Lê tudo o que importa para o microfone funcionar e devolve linhas para o relatório. */
async function diagnosticar() {
  const linhas = [];
  linhas.push(`Motor: ${motor()}`);
  if (!ehWindows) return { linhas, mic: null, max: null };
  const mic = await aux.micEstado().catch(e => ({ erro: e.message }));
  linhas.push(mic?.erro ? `Microfone padrão: ${mic.erro}` : `Microfone padrão: ${mic.mudo ? 'NO MUDO' : 'ligado'}, volume ${mic.volume}%`);
  linhas.push(`Reconhecimento de fala online: ${(await aux.falaOnline().catch(() => false)) ? 'ligado' : 'DESLIGADO'}`);
  const picos = [];
  const sub = aux.aoNivel(n => picos.push(n.pico));
  const jaMedia = medindo;
  if (!jaMedia) await aux.medir();
  await new Promise(r => setTimeout(r, 3000));
  if (!jaMedia) await aux.pararMedir();
  sub.dispose();
  const max = Math.max(0, ...picos);
  linhas.push(`Sinal em 3 s: pico ${max} de 32767 (${Math.round(nivelDe(max) * 100)}%) ${max < 50 ? 'quase zero: confira mudo, tecla do microfone e o dispositivo padrão' : max < 800 ? 'baixo, fale mais perto' : 'bom'}`);
  return { linhas, mic, max };
}

function iniciar(context) {
  segredos = context.secrets;
  if (ehWindows && !iniciar.feito) {
    iniciar.feito = true;
    aux.aoNivel(aoNivelBruto);
    aux.iniciar().catch(e => log.warn(`auxiliar do Windows: ${e.message}`));
  }
}

module.exports = {
  alternar, cancelar, iniciar, diagnosticar, temComando, motor,
  estado: () => estado,
  liberarMicrofone: () => aux.micLiberar(),
  ligarFalaOnline: () => aux.ligarFalaOnline(),
  aoMudar: aoMudar.event,
  aoTranscrever: aoTranscrever.event,
  aoNivel: aoNivel.event,
  encerrar: () => { clearTimeout(limite); clearTimeout(esperaWindows); aux.encerrar(); },
};
