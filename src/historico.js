// Barra lateral: histórico de prompts ditados, com reenvio em um clique.
const vscode = require('vscode');
const blocos = require('./blocos');
const { contarPalavras, minutosPoupados } = require('./texto');

function quando(nome) {
  // nome = "AAAA-MM-DD HHhMMmSSs"
  const m = nome.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})h(\d{2})/);
  if (!m) return nome;
  const [, a, me, d, h, mi] = m;
  const data = new Date(+a, +me - 1, +d);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((hoje - data) / 86400000);
  const dia = dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `${d}/${me}`;
  return `${dia} ${h}:${mi}`;
}

class Historico {
  constructor() {
    this._mudou = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._mudou.event;
    this.view = null;
  }

  anexar(view) {
    this.view = view;
    this.atualizar();
  }

  atualizar() {
    this.itens = blocos.listar();
    const palavras = this.itens.reduce((s, b) => s + contarPalavras(b.fala), 0);
    const enviados = this.itens.filter(b => b.meta.enviado).length;
    if (this.view) {
      this.view.message = this.itens.length
        ? `${palavras.toLocaleString('pt-BR')} palavras ditadas · ${enviados} prompts enviados · ~${Math.round(minutosPoupados(palavras))} min poupados`
        : undefined;
    }
    this._mudou.fire();
  }

  getChildren() {
    return this.itens || [];
  }

  getTreeItem(b) {
    const item = new vscode.TreeItem(b.titulo);
    item.description = `${quando(b.nome)}${b.meta.modo ? ` · ${b.meta.modo}` : ''}`;
    item.iconPath = new vscode.ThemeIcon(b.meta.enviado ? 'pass' : b.prompt ? 'sparkle' : 'mic');
    item.contextValue = 'dizAi.bloco';
    const corpo = (b.prompt || b.fala || '').slice(0, 1500);
    item.tooltip = new vscode.MarkdownString(`**${b.meta.enviado ? 'Enviado' : b.prompt ? 'Lapidado' : 'Só a fala'}** · ${quando(b.nome)}\n\n---\n\n${corpo}`);
    item.command = { command: 'dizAi.abrirBloco', title: 'Abrir', arguments: [b] };
    return item;
  }
}

module.exports = { Historico };
