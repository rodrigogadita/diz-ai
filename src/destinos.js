// Leva o prompt pronto para onde você conversa com a IA.
const vscode = require('vscode');
const { ler } = require('./config');

const CLAUDE_FOCO = 'claude-vscode.focus';
const CHAT_ABRIR = 'workbench.action.chat.open';
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function temComando(id) {
  return (await vscode.commands.getCommands(true)).includes(id);
}

// Nenhuma extensão digita direto no chat do Claude Code: foca a caixa e cola.
async function paraClaude(texto) {
  await vscode.env.clipboard.writeText(texto);
  await vscode.commands.executeCommand(CLAUDE_FOCO);
  if (!ler('colarAutomatico') || !vscode.window.state.focused) {
    return 'Prompt copiado e caixa do Claude em foco: Ctrl+V e Enter';
  }
  await esperar(ler('esperaColar') || 350);
  const ed = vscode.window.activeTextEditor;
  const versao = ed?.document.version;
  await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
  await esperar(80);
  // O foco ainda estava num editor e a colagem caiu no arquivo: desfaz e pede o Ctrl+V.
  if (ed && ed.document.version !== versao) {
    await vscode.commands.executeCommand('undo');
    await vscode.commands.executeCommand(CLAUDE_FOCO);
    return 'Prompt copiado: clique na caixa do Claude e Ctrl+V';
  }
  return 'Prompt na caixa do Claude Code. Revise e aperte Enter.';
}

// Claude Code (ou outro agente) rodando no terminal: cola sem apertar Enter.
async function paraTerminal(texto) {
  const t = vscode.window.terminals.find(x => /claude/i.test(x.name)) || vscode.window.activeTerminal;
  if (!t) {
    await vscode.env.clipboard.writeText(texto);
    return 'Nenhum terminal aberto. Prompt copiado.';
  }
  t.show(false);
  // Colagem "entre colchetes" do terminal: o texto com várias linhas não é enviado antes da hora.
  t.sendText(`\x1b[200~${texto}\x1b[201~`, false);
  return `Prompt no terminal "${t.name}". Revise e aperte Enter.`;
}

async function paraChat(texto) {
  await vscode.commands.executeCommand(CHAT_ABRIR, { query: texto, isPartialQuery: true });
  return 'Prompt no chat. Revise e aperte Enter.';
}

// "auto": Claude Code se estiver instalado, senão o chat do VS Code (Copilot), senão a área de transferência.
async function resolverDestino() {
  const destino = ler('destino') || 'auto';
  if (destino === 'claude') return await temComando(CLAUDE_FOCO) ? 'claude' : 'area';
  if (destino === 'chat') return await temComando(CHAT_ABRIR) ? 'chat' : 'area';
  if (destino !== 'auto') return destino;
  if (await temComando(CLAUDE_FOCO)) return 'claude';
  if (await temComando(CHAT_ABRIR)) return 'chat';
  return 'area';
}

/** Põe o foco na caixa de mensagem do destino. Devolve false se não há onde focar. */
async function focar() {
  const destino = await resolverDestino();
  if (destino === 'claude') await vscode.commands.executeCommand(CLAUDE_FOCO);
  else if (destino === 'chat') await vscode.commands.executeCommand(CHAT_ABRIR);
  else if (destino === 'terminal') {
    const t = vscode.window.terminals.find(x => /claude/i.test(x.name)) || vscode.window.activeTerminal;
    if (!t) return false;
    t.show(false);
  } else return false;
  return true;
}

async function entregar(texto) {
  const destino = await resolverDestino();
  let aviso;
  if (destino === 'claude') aviso = await paraClaude(texto);
  else if (destino === 'terminal') aviso = await paraTerminal(texto);
  else if (destino === 'chat') aviso = await paraChat(texto);
  else {
    await vscode.env.clipboard.writeText(texto);
    aviso = 'Prompt copiado. Cole onde quiser com Ctrl+V.';
  }
  vscode.window.setStatusBarMessage(`$(check) ${aviso}`, 8000);
  return aviso;
}

/** Começa uma conversa nova no destino. Devolve o nome do lugar, ou null se não houver como. */
async function novaConversa() {
  const destino = await resolverDestino();
  if (destino === 'claude' && await temComando('claude-vscode.newConversation')) {
    await vscode.commands.executeCommand('claude-vscode.newConversation');
    return 'Claude Code';
  }
  if (destino === 'chat' && await temComando('workbench.action.chat.newChat')) {
    await vscode.commands.executeCommand('workbench.action.chat.newChat');
    return 'chat';
  }
  return null;
}

module.exports = { entregar, focar, novaConversa, temComando };
