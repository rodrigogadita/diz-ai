// Canal "Diz Aí" no painel Saída: o que aconteceu, para diagnosticar sem adivinhar.
const vscode = require('vscode');

let canal = null;
const obter = () => (canal ||= vscode.window.createOutputChannel('Diz Aí', { log: true }));

module.exports = {
  info: m => obter().info(m),
  warn: m => obter().warn(m),
  error: m => obter().error(m),
  mostrar: () => obter().show(true),
  canal: obter,
};
