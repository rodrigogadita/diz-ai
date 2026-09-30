// Processo do PowerShell que fica aberto: dispara Win+H e grava o microfone (MCI, sem instalar nada).
const cp = require('child_process');

const SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Threading; using System.Runtime.InteropServices;
public static class DizAi {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int mciSendString(string cmd, StringBuilder ret, int len, IntPtr cb);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern bool mciGetErrorString(int err, StringBuilder buf, int len);
  static bool Preso(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  // Espera soltar Ctrl/Alt/Shift do atalho, senão o Windows recebe Ctrl+Alt+Win+H e ignora.
  public static string WinH() {
    for (int i = 0; i < 70 && (Preso(0x10) || Preso(0x11) || Preso(0x12)); i++) Thread.Sleep(30);
    keybd_event(0x5B, 0, 0, UIntPtr.Zero); keybd_event(0x48, 0, 0, UIntPtr.Zero);
    keybd_event(0x48, 0, 2, UIntPtr.Zero); keybd_event(0x5B, 0, 2, UIntPtr.Zero);
    return "ok";
  }
  static string Mci(string c) {
    int r = mciSendString(c, new StringBuilder(128), 128, IntPtr.Zero);
    if (r == 0) return "ok";
    var e = new StringBuilder(256); mciGetErrorString(r, e, 256); return "erro " + e;
  }
  public static string Gravar() {
    Mci("close dizai");
    string r = Mci("open new Type waveaudio Alias dizai"); if (r != "ok") return r;
    r = Mci("set dizai bitspersample 16 channels 1 samplespersec 16000 bytespersec 32000 alignment 2"); if (r != "ok") return r;
    return Mci("record dizai");
  }
  public static string Parar(string arquivo) {
    Mci("stop dizai");
    string r = Mci("save dizai \\"" + arquivo + "\\"");
    Mci("close dizai");
    return r;
  }
  public static string Cancelar() { Mci("stop dizai"); return Mci("close dizai"); }
}
"@
[Console]::Out.WriteLine('pronto')
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null) { break }
  try {
    if ($l -eq 'winh') { $r = [DizAi]::WinH() }
    elseif ($l -eq 'gravar') { $r = [DizAi]::Gravar() }
    elseif ($l.StartsWith('parar ')) { $r = [DizAi]::Parar($l.Substring(6)) }
    elseif ($l -eq 'cancelar') { $r = [DizAi]::Cancelar() }
    else { $r = 'erro comando desconhecido' }
  } catch { $r = 'erro ' + $_.Exception.Message }
  [Console]::Out.WriteLine($r)
}
[DizAi]::Cancelar() | Out-Null
`;

let proc = null;
let pronto = null;
let fila = [];      // respostas pendentes, na ordem dos comandos
let buffer = '';

function iniciar() {
  if (proc && proc.exitCode === null && !proc.killed) return pronto;
  const cod = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  proc = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', cod],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  fila = [];
  buffer = '';
  pronto = new Promise((resolve, reject) => {
    const falhou = setTimeout(() => reject(new Error('O PowerShell não respondeu.')), 20000);
    proc.stdout.on('data', d => {
      buffer += d.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linha = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (linha === 'pronto') { clearTimeout(falhou); resolve(); continue; }
        const r = fila.shift();
        if (r) linha.startsWith('erro') ? r.reject(new Error(linha.slice(5) || 'falha no Windows')) : r.resolve(linha);
      }
    });
    proc.on('error', e => { clearTimeout(falhou); reject(e); });
    proc.on('exit', () => {
      for (const r of fila) r.reject(new Error('O auxiliar do Windows fechou.'));
      fila = [];
      proc = null;
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
  winH: () => comando('winh'),
  gravar: () => comando('gravar'),
  parar: arquivo => comando(`parar ${arquivo}`),
  cancelar: () => comando('cancelar'),
  encerrar,
};
