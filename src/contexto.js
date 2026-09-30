// O que o lapidador precisa saber do editor para entender "esse arquivo", "esse erro", "aqui".
const vscode = require('vscode');
const blocos = require('./blocos');
const { ler } = require('./config');

const MAX_SELECAO = 4000;
let ultimo = null; // último editor de código (fora da pasta do Diz Aí)

function lembrar(ed) {
  if (ed && ed.document.uri.scheme === 'file' && !blocos.dentro(ed.document.uri)) ultimo = ed;
}

function branchAtual(uri) {
  try {
    const git = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
    const repo = git?.getRepository?.(uri) || git?.repositories?.[0];
    return repo?.state?.HEAD?.name || '';
  } catch { return ''; }
}

function coletar() {
  const incluir = new Set(ler('contexto') || []);
  const ctx = {
    pasta: vscode.workspace.name || '',
    glossario: ler('glossario') || [],
  };
  const ed = ultimo && vscode.window.visibleTextEditors.includes(ultimo) ? ultimo
    : vscode.window.visibleTextEditors.find(e => e.document.uri.scheme === 'file' && !blocos.dentro(e.document.uri));
  if (!ed) return ctx;

  const doc = ed.document;
  if (incluir.has('arquivo')) {
    ctx.arquivo = vscode.workspace.asRelativePath(doc.uri);
    ctx.linguagem = doc.languageId;
  }
  const s = ed.selection;
  if (incluir.has('selecao') && s && !s.isEmpty) {
    ctx.linhas = s.start.line === s.end.line ? `linha ${s.start.line + 1}` : `linhas ${s.start.line + 1} a ${s.end.line + 1}`;
    ctx.selecao = doc.getText(s).slice(0, MAX_SELECAO);
  }
  if (incluir.has('erros')) {
    ctx.erros = vscode.languages.getDiagnostics(doc.uri)
      .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
      .slice(0, 5)
      .map(d => `linha ${d.range.start.line + 1}: ${d.message.split('\n')[0]}`);
  }
  if (incluir.has('branch')) ctx.branch = branchAtual(doc.uri);
  return ctx;
}

module.exports = { lembrar, coletar };
