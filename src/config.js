const vscode = require('vscode');
const os = require('os');
const path = require('path');

const SECAO = 'dizAi';

const cfg = () => vscode.workspace.getConfiguration(SECAO);
const ler = (chave, padrao) => cfg().get(chave, padrao);
const gravar = (chave, valor) => cfg().update(chave, valor, vscode.ConfigurationTarget.Global);

function pastaBase() {
  const p = (ler('pasta') || '').trim();
  return p || path.join(os.homedir(), 'Documents', 'Diz Aí');
}

module.exports = { SECAO, cfg, ler, gravar, pastaBase };
