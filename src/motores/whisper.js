// Transcrição por Whisper em qualquer servidor compatível com a API da OpenAI (Groq, OpenAI ou local).
const fs = require('fs');
const { ler } = require('../config');
const { limparAlucinacoes } = require('../texto');

const PROVEDORES = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', modelo: 'whisper-large-v3-turbo', chave: true },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', modelo: 'gpt-4o-transcribe', chave: true },
  local: { url: 'http://127.0.0.1:8000/v1/audio/transcriptions', modelo: 'Systran/faster-whisper-large-v3', chave: false },
};

function provedor() {
  const id = ler('whisper.provedor') || 'groq';
  const base = PROVEDORES[id] || PROVEDORES.groq;
  return {
    id,
    url: (ler('whisper.url') || '').trim() || base.url,
    modelo: (ler('whisper.modelo') || '').trim() || base.modelo,
    precisaChave: base.chave,
  };
}

const nomeSegredo = id => `dizAi.whisper.${id}`;

/** Envia o WAV e devolve o texto. `segredos` é o context.secrets da extensão. */
async function transcrever(arquivo, { glossario = [], segredos }) {
  const p = provedor();
  const chave = await segredos.get(nomeSegredo(p.id));
  if (p.precisaChave && !chave) {
    const e = new Error(`Falta a chave do ${p.id}. Rode "Diz Aí: definir chave do Whisper".`);
    e.semChave = true;
    throw e;
  }
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(arquivo)], { type: 'audio/wav' }), 'fala.wav');
  form.append('model', p.modelo);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  // O "prompt" do Whisper puxa a grafia dos termos e o estilo com pontuação.
  if (glossario.length) form.append('prompt', `Ditado técnico em português do Brasil, com pontuação. Termos: ${glossario.join(', ')}.`);

  const resp = await fetch(p.url, {
    method: 'POST',
    headers: chave ? { Authorization: `Bearer ${chave}` } : {},
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(`Whisper (${p.id}) respondeu ${resp.status}: ${corpo.slice(0, 200)}`);
  }
  const json = await resp.json();
  return limparAlucinacoes(json.text || '');
}

module.exports = { transcrever, provedor, nomeSegredo, PROVEDORES };
