// Ondas da voz: na barra de status e ao lado do cursor no bloco de fala, mais dicas nos arquivos vazios.
const vscode = require('vscode');
const blocos = require('./blocos');

const BLOCOS = ' ▁▂▃▄▅▆▇█';
const LARGURA = 9;
let historico = new Array(LARGURA).fill(0);
let ouvindo = false;
let ultimoDesenho = 0;

const decoOnda = vscode.window.createTextEditorDecorationType({
  after: { margin: '0 0 0 1.2em', color: new vscode.ThemeColor('charts.green'), fontWeight: 'bold' },
});
const decoDica = vscode.window.createTextEditorDecorationType({
  after: { color: new vscode.ThemeColor('editorGhostText.foreground'), fontStyle: 'italic' },
});

const DICA_FALA = 'Fale agora. O que você disser entra aqui (Ctrl+Alt+D liga e desliga o microfone).';
const DICA_PROMPT = 'O prompt lapidado aparece aqui, ao vivo, a cada pausa na sua fala. Ctrl+Alt+Enter envia.';

/** Barrinhas com o histórico recente de nível: "▂▄▆█▆▄▂". */
function barrinhas() {
  return historico.map(v => BLOCOS[Math.min(BLOCOS.length - 1, Math.round(v * (BLOCOS.length - 1)))] || ' ').join('').replace(/ /g, '▁');
}

function empurrar(nivel) {
  historico.push(nivel);
  historico = historico.slice(-LARGURA);
}

function desenharEditor() {
  for (const ed of vscode.window.visibleTextEditors) {
    const uri = ed.document.uri;
    if (!blocos.dentro(uri)) continue;
    const vazio = !ed.document.getText().trim();
    const fala = blocos.ehFala(uri);

    // Onda ao lado do cursor, só no bloco de fala e só enquanto ouve.
    if (fala && ouvindo) {
      const linha = ed.selection.active.line;
      ed.setDecorations(decoOnda, [{
        range: new vscode.Range(linha, Number.MAX_SAFE_INTEGER, linha, Number.MAX_SAFE_INTEGER),
        renderOptions: { after: { contentText: `🎙 ${barrinhas()} ouvindo` } },
      }]);
    } else {
      ed.setDecorations(decoOnda, []);
    }

    const dica = vazio && !(fala && ouvindo) ? (fala ? DICA_FALA : blocos.ehPrompt(uri) ? DICA_PROMPT : '') : '';
    ed.setDecorations(decoDica, dica ? [{ range: new vscode.Range(0, 0, 0, 0), renderOptions: { after: { contentText: dica } } }] : []);
  }
}

/** Chamado a cada leitura do medidor (~12 por segundo). */
function nivel(v) {
  empurrar(v);
  const agora = Date.now();
  if (agora - ultimoDesenho < 70) return;
  ultimoDesenho = agora;
  desenharEditor();
}

function definirOuvindo(sim) {
  ouvindo = sim;
  if (!sim) historico = new Array(LARGURA).fill(0);
  desenharEditor();
}

module.exports = {
  nivel, definirOuvindo, barrinhas, desenharEditor,
  ouvindo: () => ouvindo,
  descartar: () => { decoOnda.dispose(); decoDica.dispose(); },
};
