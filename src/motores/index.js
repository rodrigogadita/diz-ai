// Liga/desliga o ditado com o motor escolhido e avisa a interface quando o estado muda.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aux = require('./auxiliarWindows');
const whisper = require('./whisper');
const { ler, gravar } = require('../config');

const DITADO_INICIAR = 'workbench.action.editorDictation.start';
const DITADO_PARAR = 'workbench.action.editorDictation.stop';
const MAX_GRAVACAO_MS = 10 * 60 * 1000;

const aoMudar = new vscode.EventEmitter();   // { estado, desde }
const aoTranscrever = new vscode.EventEmitter(); // { texto, alvo }

let estado = 'parado'; // parado | gravando | transcrevendo | ditando
let desde = 0;
let alvoAtual = 'fala';
let limite = null;
let segredos = null;

function mudar(novo) {
  estado = novo;
  desde = Date.now();
  vscode.commands.executeCommand('setContext', 'dizAi.gravando', novo === 'gravando');
  aoMudar.fire({ estado, desde });
}

async function temComando(id) {
  return (await vscode.commands.getCommands(true)).includes(id);
}

const motor = () => ler('motor') || (process.platform === 'win32' ? 'windows' : 'vscode');

// ---------- Whisper ----------
async function comecarGravacao(alvo) {
  if (process.platform !== 'win32') throw new Error('A gravação para o Whisper por enquanto só existe no Windows.');
  await aux.gravar();
  alvoAtual = alvo;
  mudar('gravando');
  limite = setTimeout(() => pararGravacao(), MAX_GRAVACAO_MS);
}

async function pararGravacao() {
  if (estado !== 'gravando') return;
  clearTimeout(limite);
  const arquivo = path.join(os.tmpdir(), `diz-ai-${Date.now()}.wav`);
  mudar('transcrevendo');
  try {
    await aux.parar(arquivo);
    const texto = await whisper.transcrever(arquivo, { glossario: ler('glossario') || [], segredos });
    if (texto) aoTranscrever.fire({ texto, alvo: alvoAtual });
    else vscode.window.setStatusBarMessage('$(info) Não ouvi nada. Confira o microfone.', 5000);
  } catch (e) {
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
    mudar('parado');
    vscode.window.setStatusBarMessage('$(close) Gravação descartada.', 3000);
  } else if (estado === 'ditando' && motor() === 'vscode') {
    await vscode.commands.executeCommand(DITADO_PARAR);
    mudar('parado');
  }
}

// ---------- entrada única ----------
/** alvo: 'fala' (bloco do Diz Aí) ou 'campo' (qualquer campo em foco, como a caixa do Claude Code). */
async function alternar(alvo = 'fala') {
  const m = motor();
  if (m === 'whisper') {
    if (estado === 'gravando') return pararGravacao();
    if (estado === 'transcrevendo') return;
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
    const ligar = estado !== 'ditando';
    await vscode.commands.executeCommand(ligar ? DITADO_INICIAR : DITADO_PARAR);
    mudar(ligar ? 'ditando' : 'parado');
    return;
  }

  if (process.platform !== 'win32') {
    vscode.window.showWarningMessage('O ditado do Windows só existe no Windows. Escolha o motor "vscode" ou "whisper".');
    await gravar('motor', 'vscode');
    return;
  }
  await aux.winH(); // o Win+H alterna sozinho e digita no campo em foco
}

function iniciar(context) {
  segredos = context.secrets;
  if (process.platform === 'win32' && motor() !== 'vscode') aux.iniciar().catch(() => { /* tenta de novo no primeiro uso */ });
}

module.exports = {
  alternar, cancelar, iniciar, temComando, motor,
  estado: () => estado,
  aoMudar: aoMudar.event,
  aoTranscrever: aoTranscrever.event,
  encerrar: () => { clearTimeout(limite); aux.encerrar(); },
};
