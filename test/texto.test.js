const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/texto');

const COMANDOS = ['pode enviar', 'manda ver', 'envia aí'];

test('normalizar tira acento, pontuação e caixa', () => {
  assert.equal(t.normalizar('  Envia AÍ!!  '), 'envia ai');
  assert.equal(t.normalizar('Função, não; ação.'), 'funcao nao acao');
});

test('comando de voz no fim da fala é reconhecido e removido', () => {
  assert.deepEqual(t.extrairComandoFinal('Cria o endpoint de pedidos. Pode enviar.', COMANDOS),
    { fala: 'Cria o endpoint de pedidos', comando: 'pode enviar' });
  assert.deepEqual(t.extrairComandoFinal('corrige o teste, manda ver', COMANDOS),
    { fala: 'corrige o teste', comando: 'manda ver' });
  assert.equal(t.extrairComandoFinal('arruma isso e envia ai', COMANDOS).comando, 'envia aí');
});

test('comando no meio da fala não dispara', () => {
  const r = t.extrairComandoFinal('pode enviar o e-mail só depois do teste passar', COMANDOS);
  assert.equal(r.comando, null);
  assert.equal(r.fala, 'pode enviar o e-mail só depois do teste passar');
});

test('fala só com o comando vira fala vazia', () => {
  assert.deepEqual(t.extrairComandoFinal('Pode enviar.', COMANDOS), { fala: '', comando: 'pode enviar' });
});

test('atalhos de voz ignoram acento e caixa', () => {
  const atalhos = { 'meu repositório': 'github.com/fulano/projeto' };
  assert.equal(t.aplicarAtalhos('sobe pro Meu Repositorio agora', atalhos), 'sobe pro github.com/fulano/projeto agora');
  assert.equal(t.aplicarAtalhos('nada a trocar', atalhos), 'nada a trocar');
});

test('atalhos trocam todas as ocorrências', () => {
  assert.equal(t.aplicarAtalhos('regra, regra e regra', { regra: 'R' }), 'R, R e R');
});

test('alucinações clássicas do Whisper somem', () => {
  assert.equal(t.limparAlucinacoes('Legendas pela comunidade Amara.org'), '');
  assert.equal(t.limparAlucinacoes('Cria a tela de login. Obrigado por assistir.'), 'Cria a tela de login.');
});

test('contagem de palavras entende acento', () => {
  assert.equal(t.contarPalavras('Não é função, é ação!'), 5);
});

test('título pula cabeçalhos de seção', () => {
  assert.equal(t.titulo('**Objetivo**\nCriar a tela de metas por loja'), 'Criar a tela de metas por loja');
  assert.equal(t.titulo('a'.repeat(100), 10).length, 10);
});

test('eventos do stream-json', () => {
  assert.deepEqual(t.lerEventoStream('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Oi"}}}'), { delta: 'Oi' });
  assert.deepEqual(t.lerEventoStream('{"type":"result","subtype":"success","is_error":false,"result":"Pronto"}'), { final: 'Pronto' });
  assert.deepEqual(t.lerEventoStream('{"type":"result","is_error":true,"result":"Not logged in"}'), { erro: 'Not logged in' });
  assert.deepEqual(t.lerEventoStream('lixo'), {});
});

test('duração e nome do bloco', () => {
  assert.equal(t.formatarDuracao(67000), '1:07');
  assert.match(t.nomeBloco(new Date(2026, 8, 30, 9, 5, 3)), /^2026-09-30 09h05m03$/);
});
