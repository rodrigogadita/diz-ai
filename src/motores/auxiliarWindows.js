// Conversa com o auxiliar.ps1: Win+H, gravação (MCI), medidor de nível, mudo do microfone e fala online.
const cp = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'auxiliar.ps1');

let proc = null;
let pronto = null;
let fila = [];      // respostas pendentes, na ordem dos comandos
let buffer = '';
const ouvintesNivel = new Set();

function tratarLinha(linha) {
  if (linha.startsWith('nivel ')) {
    const [, pico, ouvindo] = linha.split(' ');
    const n = { pico: Number(pico), ditadoWindows: ouvindo === '1' };
    for (const f of ouvintesNivel) f(n);
    return;
  }
  if (!linha.startsWith('r ')) return;
  const resposta = linha.slice(2);
  const r = fila.shift();
  if (!r) return;
  if (resposta.startsWith('erro')) r.reject(new Error(resposta.slice(5) || 'falha no Windows'));
  else r.resolve(resposta);
}

function iniciar() {
  if (proc && proc.exitCode === null && !proc.killed) return pronto;
  proc = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  fila = [];
  buffer = '';
  const atual = proc;
  pronto = new Promise((resolve, reject) => {
    const falhou = setTimeout(() => reject(new Error('O PowerShell não respondeu.')), 30000);
    atual.stdout.on('data', d => {
      buffer += d.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linha = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (linha === 'pronto') { clearTimeout(falhou); resolve(); continue; }
        tratarLinha(linha);
      }
    });
    atual.on('error', e => { clearTimeout(falhou); reject(e); });
    atual.on('exit', () => {
      for (const r of fila) r.reject(new Error('O auxiliar do Windows fechou.'));
      fila = [];
      if (proc === atual) proc = null;
    });
  });
  return pronto;
}

async function comando(texto) {
  await iniciar();
  return new Promise((resolve, reject) => {
    fila.push({ resolve, reject });
    proc.stdin.write(texto + '\n');
  });
}

function encerrar() {
  if (proc) { try { proc.stdin.end(); } catch { /* já fechou */ } proc.kill(); }
}

module.exports = {
  iniciar,
  encerrar,
  winH: () => comando('winh'),
  gravar: () => comando('gravar'),
  parar: arquivo => comando(`parar ${arquivo}`),
  cancelar: () => comando('cancelar'),
  medir: () => comando('medir'),
  pararMedir: () => comando('parar_medir'),
  ditadoWindows: async () => (await comando('ditado_windows')) === '1',
  async micEstado() {
    const r = await comando('mic_estado');
    const m = r.match(/mudo=(\d) volume=(\d+)/);
    return m ? { mudo: m[1] === '1', volume: Number(m[2]) } : null;
  },
  micLiberar: () => comando('mic_liberar'),
  falaOnline: async () => (await comando('fala_online')) === '1',
  ligarFalaOnline: () => comando('ligar_fala_online'),
  aoNivel(f) { ouvintesNivel.add(f); return { dispose: () => ouvintesNivel.delete(f) }; },
};
