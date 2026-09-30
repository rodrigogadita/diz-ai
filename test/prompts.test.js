const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/prompts');

test('todo modo embutido tem nome, detalhe e formato', () => {
  for (const [id, m] of Object.entries(p.MODOS)) {
    assert.ok(m.nome && m.detalhe && m.formato.startsWith('Formato:'), id);
  }
});

test('modo personalizado entra na lista e no sistema', () => {
  const pers = [{ id: 'tela', nome: 'Tela nova', instrucoes: 'Organize em Tela, Campos e Ações.' }];
  assert.equal(p.listarModos(pers).tela.nome, 'Tela nova');
  assert.match(p.montarSistema({ modo: 'tela', personalizados: pers }), /Organize em Tela, Campos e Ações/);
});

test('modo desconhecido cai no estruturado', () => {
  assert.match(p.montarSistema({ modo: 'nao-existe' }), /\*\*Objetivo\*\*/);
});

test('idioma inglês pede o prompt em inglês', () => {
  assert.match(p.montarSistema({ idioma: 'en' }), /English/);
});

test('entrada leva contexto, seleção e fala', () => {
  const e = p.montarEntrada('corrige esse erro', {
    pasta: 'loja', branch: 'main', arquivo: 'src/app.py', linguagem: 'python', linhas: 'linha 3',
    erros: ['linha 3: NameError'], glossario: ['FastAPI'], selecao: 'print(x)',
  });
  assert.match(e, /Projeto aberto: loja/);
  assert.match(e, /Arquivo em foco: src\/app.py \(python\), seleção nas linha 3/);
  assert.match(e, /- linha 3: NameError/);
  assert.match(e, /<selecao>\nprint\(x\)\n<\/selecao>/);
  assert.match(e, /<fala>\ncorrige esse erro\n<\/fala>/);
});

test('entrada sem contexto avisa', () => {
  assert.match(p.montarEntrada('oi'), /sem contexto extra/);
});
