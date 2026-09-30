// Funções puras de texto (sem VS Code): testáveis com `npm test`.

/** Minúsculas, sem acento, sem pontuação, espaços simples. */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Procura um comando de voz no FIM da fala ("pode enviar", "manda ver").
 * Devolve a fala sem o comando e qual comando foi dito.
 */
function extrairComandoFinal(fala, comandos) {
  const palavras = [...String(fala || '').matchAll(/\S+/g)];
  const norm = palavras.map(m => normalizar(m[0]));
  for (const comando of comandos || []) {
    const alvo = normalizar(comando).split(' ').filter(Boolean);
    if (!alvo.length || alvo.length > norm.length) continue;
    // Ignora pedaços que viraram vazios na normalização (ex.: "." solto no fim).
    let i = norm.length - 1;
    while (i >= 0 && !norm[i]) i--;
    const inicio = i - alvo.length + 1;
    if (inicio < 0) continue;
    const trecho = norm.slice(inicio, i + 1).join(' ');
    if (trecho === alvo.join(' ')) {
      const corte = palavras[inicio].index;
      const resto = fala.slice(0, corte).replace(/[\s,;:.!?-]+$/u, '').trimEnd();
      return { fala: resto, comando };
    }
  }
  return { fala, comando: null };
}

/**
 * Atalhos de voz: frase falada -> texto fixo. Ex.: "meu repositório" -> "github.com/fulano/projeto".
 * Não diferencia maiúsculas nem acento na frase falada.
 */
function aplicarAtalhos(texto, atalhos) {
  let saida = String(texto || '');
  for (const [gatilho, expansao] of Object.entries(atalhos || {})) {
    const alvo = normalizar(gatilho).split(' ').filter(Boolean);
    if (!alvo.length) continue;
    // Compara palavra a palavra na forma normalizada; troca de trás para frente para não mexer nos índices.
    const tokens = [...saida.matchAll(/[\p{L}\p{N}]+/gu)];
    for (let i = tokens.length - alvo.length; i >= 0; i--) {
      const janela = tokens.slice(i, i + alvo.length);
      if (janela.map(t => normalizar(t[0])).join(' ') !== alvo.join(' ')) continue;
      const ini = janela[0].index;
      const fim = janela[janela.length - 1].index + janela[janela.length - 1][0].length;
      saida = saida.slice(0, ini) + expansao + saida.slice(fim);
      i -= alvo.length - 1; // não reaproveita palavras já trocadas
    }
  }
  return saida;
}

// Frases que o Whisper inventa em trechos de silêncio (clássicas em português).
const ALUCINACOES = [
  'legendas pela comunidade amara org',
  'legenda adriana zanotto',
  'obrigado por assistir',
  'obrigada por assistir',
  'inscreva se no canal',
  'e ai pessoal tudo bem',
  'tchau tchau',
  'sous titrage',
];

function limparAlucinacoes(texto) {
  const frases = String(texto || '').split(/(?<=[.!?])\s+/);
  const boas = frases.filter(f => {
    const n = normalizar(f);
    return n && !ALUCINACOES.some(a => n === a || n.startsWith(a));
  });
  return boas.join(' ').trim();
}

function contarPalavras(texto) {
  return (String(texto || '').match(/[\p{L}\p{N}]+/gu) || []).length;
}

// Digitando ~40 palavras/min contra falando ~150: tempo poupado em minutos.
function minutosPoupados(palavras) {
  return Math.max(0, palavras / 40 - palavras / 150);
}

function nomeBloco(d = new Date()) {
  const dois = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}h${dois(d.getMinutes())}m${dois(d.getSeconds())}`;
}

/** Primeira linha útil de um texto, sem marcação Markdown, cortada em `max`. */
function titulo(texto, max = 60) {
  const linha = String(texto || '')
    .split('\n')
    .map(l => l.replace(/[*#>`_-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .find(l => l && !/^(objetivo|contexto|o que fazer|restri[cç][oõ]es|pronto quando)\s*:?$/i.test(l)) || '';
  return linha.length > max ? linha.slice(0, max - 1).trimEnd() + '…' : linha;
}

/** Lê uma linha do `claude -p --output-format stream-json`. */
function lerEventoStream(linha) {
  let ev;
  try { ev = JSON.parse(linha); } catch { return {}; }
  if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
    return { delta: ev.event.delta.text };
  }
  if (ev.type === 'result') {
    return ev.is_error ? { erro: ev.result || ev.subtype || 'erro' } : { final: ev.result };
  }
  return {};
}

function formatarDuracao(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = {
  normalizar, extrairComandoFinal, aplicarAtalhos, limparAlucinacoes, contarPalavras,
  minutosPoupados, nomeBloco, titulo, lerEventoStream, formatarDuracao,
};
