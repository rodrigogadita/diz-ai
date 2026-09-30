// Chama o Claude Code CLI (mesmo login do VS Code) e devolve o texto em streaming.
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ler } = require('./config');
const { lerEventoStream } = require('./texto');
const { montarSistema, montarSistemaAjuste, montarEntrada, montarEntradaAjuste } = require('./prompts');

const LIMITE_MS = 120000;

// claude.exe: configuração > extensão oficial do Claude Code > PATH.
function acharClaude() {
  const manual = (ler('claudeCaminho') || '').trim();
  if (manual) return manual;
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  if (ext) {
    const bin = path.join(ext.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (fs.existsSync(bin)) return bin;
  }
  return 'claude';
}

/**
 * Roda uma chamada única ao modelo.
 * `aoEscrever(textoAteAgora)` recebe o texto parcial conforme chega.
 */
function executar({ sistema, entrada, aoEscrever, cancelar }) {
  const args = [
    '-p', '--safe-mode', '--tools', '', '--no-session-persistence',
    '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--model', ler('modelo') || 'sonnet',
    '--system-prompt', sistema,
  ];

  return new Promise((resolve, reject) => {
    let texto = '', final = null, erroModelo = null, stderr = '', resto = '', acabou = false;
    const proc = cp.spawn(acharClaude(), args, { cwd: os.tmpdir(), windowsHide: true });
    const fim = (fn, v) => { if (acabou) return; acabou = true; clearTimeout(relogio); fn(v); };
    const relogio = setTimeout(() => { proc.kill(); fim(reject, new Error('O Claude demorou mais de 2 minutos.')); }, LIMITE_MS);
    const assinatura = cancelar?.onCancellationRequested(() => { proc.kill(); fim(reject, new Error('cancelado')); });

    proc.stdout.on('data', d => {
      const linhas = (resto + d.toString('utf8')).split('\n');
      resto = linhas.pop();
      for (const l of linhas) {
        const ev = lerEventoStream(l);
        if (ev.delta) { texto += ev.delta; aoEscrever?.(texto); }
        if (ev.final !== undefined) final = ev.final;
        if (ev.erro) erroModelo = ev.erro;
      }
    });
    proc.stderr.on('data', d => { stderr += d.toString('utf8'); });
    proc.on('error', e => fim(reject, new Error(e.code === 'ENOENT'
      ? 'Não achei o Claude Code CLI. Instale a extensão Claude Code ou informe "dizAi.claudeCaminho".'
      : e.message)));
    proc.on('close', codigo => {
      assinatura?.dispose();
      if (resto) { const ev = lerEventoStream(resto); if (ev.final !== undefined) final = ev.final; if (ev.erro) erroModelo = ev.erro; }
      const saida = (final ?? texto).trim();
      if (codigo === 0 && saida && !erroModelo) return fim(resolve, saida);
      const motivo = erroModelo || stderr.trim().split('\n').slice(-2).join(' ') || `claude saiu com código ${codigo}`;
      fim(reject, new Error(/login|auth|401/i.test(motivo) ? `${motivo}. Abra o Claude Code e faça login.` : motivo));
    });
    proc.stdin.end(entrada, 'utf8');
  });
}

function lapidar(fala, contexto, { modo, aoEscrever, cancelar } = {}) {
  const sistema = montarSistema({
    modo: modo || ler('modo'),
    idioma: ler('idiomaDoPrompt'),
    extras: ler('instrucoesExtras') || '',
    personalizados: ler('modosPersonalizados') || [],
  });
  return executar({ sistema, entrada: montarEntrada(fala, contexto), aoEscrever, cancelar });
}

function ajustar(prompt, ajuste, { aoEscrever, cancelar } = {}) {
  return executar({
    sistema: montarSistemaAjuste({ idioma: ler('idiomaDoPrompt') }),
    entrada: montarEntradaAjuste(prompt, ajuste),
    aoEscrever, cancelar,
  });
}

module.exports = { lapidar, ajustar, acharClaude };
