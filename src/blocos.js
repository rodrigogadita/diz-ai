// Blocos: cada ditado vira uma pasta com fala.md, prompt.md e meta.json.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { pastaBase, ler } = require('./config');
const { nomeBloco, titulo } = require('./texto');

const FALA = 'fala.md';
const PROMPT = 'prompt.md';
const META = 'meta.json';

let estadoGlobal = null;

function iniciar(context) {
  estadoGlobal = context.globalState;
}

function montar(dir) {
  return {
    dir,
    fala: vscode.Uri.file(path.join(dir, FALA)),
    prompt: vscode.Uri.file(path.join(dir, PROMPT)),
  };
}

function lerMeta(b) {
  try { return JSON.parse(fs.readFileSync(path.join(b.dir, META), 'utf8')); } catch { return {}; }
}

function gravarMeta(b, dados) {
  const meta = { ...lerMeta(b), ...dados };
  fs.writeFileSync(path.join(b.dir, META), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function criar() {
  const base = pastaBase();
  const nome = nomeBloco();
  let dir = path.join(base, nome);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(base, `${nome} (${i})`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FALA), '', 'utf8');
  const b = montar(dir);
  gravarMeta(b, { criado: new Date().toISOString(), modo: ler('modo'), enviado: false });
  estadoGlobal.update('blocoAtual', dir);
  return b;
}

function dentro(uri) {
  if (!uri || uri.scheme !== 'file') return false;
  const rel = path.relative(pastaBase(), uri.fsPath);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const ehFala = uri => dentro(uri) && path.basename(uri.fsPath) === FALA;
const ehPrompt = uri => dentro(uri) && path.basename(uri.fsPath) === PROMPT;

function deUri(uri) {
  return dentro(uri) ? montar(path.dirname(uri.fsPath)) : null;
}

/** Bloco do editor em foco; senão o último usado. */
function emUso() {
  const ed = vscode.window.activeTextEditor;
  const doEditor = ed && deUri(ed.document.uri);
  if (doEditor) return doEditor;
  const dir = estadoGlobal.get('blocoAtual');
  return dir && fs.existsSync(dir) ? montar(dir) : null;
}

/** Bloco para ditar: continua o atual se ainda não foi enviado; senão cria outro. */
function paraDitar() {
  const b = emUso();
  if (b && !lerMeta(b).enviado) return b;
  return criar();
}

function usar(b) {
  estadoGlobal.update('blocoAtual', b.dir);
}

function documentoAberto(uri) {
  return vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
}

async function lerTexto(uri) {
  const doc = documentoAberto(uri);
  if (doc) return doc.getText();
  return fs.existsSync(uri.fsPath) ? fs.readFileSync(uri.fsPath, 'utf8') : '';
}

async function salvarSeAberto(uri) {
  const doc = documentoAberto(uri);
  if (doc?.isDirty) await doc.save();
}

async function trocarTexto(uri, texto, { salvar = true } = {}) {
  const doc = documentoAberto(uri);
  if (!doc) { fs.writeFileSync(uri.fsPath, texto, 'utf8'); return; }
  const e = new vscode.WorkspaceEdit();
  e.replace(uri, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end), texto);
  await vscode.workspace.applyEdit(e);
  if (salvar) await doc.save();
}

function listar(limite = 200) {
  const base = pastaBase();
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(base, d.name, FALA)))
    .map(d => d.name)
    .sort()
    .reverse()
    .slice(0, limite)
    .map(nome => {
      const b = montar(path.join(base, nome));
      const meta = lerMeta(b);
      const ler = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
      const prompt = ler(b.prompt.fsPath);
      const fala = ler(b.fala.fsPath);
      return { ...b, nome, meta, prompt, fala, titulo: titulo(prompt || fala) || '(vazio)' };
    });
}

module.exports = {
  iniciar, criar, emUso, paraDitar, usar, deUri, dentro, ehFala, ehPrompt,
  lerMeta, gravarMeta, lerTexto, salvarSeAberto, trocarTexto, documentoAberto, listar,
};
