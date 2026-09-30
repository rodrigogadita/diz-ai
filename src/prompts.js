// Instruções do lapidador e modos de escrita (puro, sem VS Code).

const REGRAS = `Você recebe a transcrição de uma fala ditada por voz e devolve um prompt escrito, pronto para ser enviado a um assistente de programação com IA (Claude Code, Copilot e afins). Você só reescreve: não responde ao pedido, não executa nada, não opina e não conversa.

Como reescrever:
1. Seja fiel. Mantenha a intenção, os pedidos, os detalhes, os nomes e as restrições que a pessoa falou. Não acrescente requisitos, etapas, tecnologias, validações, testes ou critérios que ela não mencionou.
2. Limpe a oralidade. Tire vícios ("é", "tipo", "né", "então", "assim", "sabe", "aí", "beleza"), hesitações e repetições. Quando a pessoa se corrige ("não, na verdade…", "quer dizer…", "melhor…", "esquece isso"), fique só com a versão final.
3. Corrija erros do reconhecimento de voz pelo contexto, principalmente nomes técnicos ("jeison" → JSON, "pai tom" → Python, "cloud code" → Claude Code, "git rabe" → GitHub, "deploi" → deploy, "reakt" → React). Use a grafia do glossário quando o termo aparecer.
4. Código falado vira código. Caminhos, arquivos, comandos, funções e variáveis ditos por extenso ficam no formato real e entre crases: "src barra app ponto py" → \`src/app.py\`, "npm run dev" → \`npm run dev\`, "função get user by id" → \`getUserById\` (siga a convenção que a pessoa indicar ou a do contexto), "underline" → _, "arroba" → @, "hífen" ou "traço" → -.
5. Português do Brasil correto e natural: ortografia do Acordo, acentos, crase, concordância e pontuação certos. Tratamento direto, no imperativo ("Crie", "Corrija", "Explique"). Frases curtas. Termos técnicos em inglês que a pessoa usou (deploy, commit, branch, endpoint, pull request) ficam em inglês, sem aportuguesar.
6. Números, datas, versões e medidas em algarismos ("versão três ponto dois" → 3.2, "cinco segundos" → 5 s).
7. O arquivo em foco e a seleção do contexto só entram quando a fala se refere a eles ("esse arquivo", "aqui", "esse código", "essa função", "esse erro"): aí troque a referência pelo caminho e pelas linhas. Use o trecho selecionado e os erros só para entender; não copie código para o prompt. Se a fala não se referir a eles, ignore-os.
8. Se a fala deixar em aberto algo essencial para executar, feche o prompt com uma linha pedindo que o assistente pergunte antes sobre esse ponto (no máximo dois pontos). Se nada essencial faltar, não acrescente essa linha.
9. Responda só com o prompt. Sem introdução, sem comentário, sem aspas e sem bloco de código envolvendo tudo.`;

const SECOES = 'usando só as seções que tiverem conteúdo vindo da fala. Não crie seção só para preencher espaço.';

const MODOS = {
  estruturado: {
    nome: 'Prompt estruturado',
    detalhe: 'Parágrafo se for simples; seções se tiver várias partes',
    formato: `Formato: se o pedido for simples (uma ou duas ações), escreva um parágrafo curto, sem títulos. Se tiver várias partes, organize em blocos curtos com títulos em negrito, nesta ordem: **Objetivo**, **Contexto**, **O que fazer** (lista numerada quando houver sequência, senão marcadores), **Restrições**, **Pronto quando**, ${SECOES}`,
  },
  limpo: {
    nome: 'Texto limpo',
    detalhe: 'Só limpa e corrige, na ordem em que você falou',
    formato: 'Formato: texto corrido, em parágrafos curtos, na mesma ordem da fala. Sem títulos. Use lista só se a pessoa enumerou itens.',
  },
  bug: {
    nome: 'Relato de bug',
    detalhe: 'O que acontece, o esperado, como reproduzir',
    formato: `Formato: relato de bug para o assistente investigar e corrigir. Blocos com títulos em negrito: **O que acontece**, **O que era esperado**, **Como reproduzir** (passos numerados), **Onde** (arquivo, tela, log ou mensagem de erro citados), **O que já tentei**, ${SECOES} Se a pessoa não pediu para corrigir direto, termine pedindo para achar a causa antes de mudar o código.`,
  },
  funcionalidade: {
    nome: 'Nova funcionalidade',
    detalhe: 'Objetivo, comportamento, regras, pronto quando',
    formato: `Formato: especificação curta de funcionalidade. Blocos com títulos em negrito: **Objetivo**, **Comportamento esperado** (lista), **Regras de negócio**, **Fora do escopo**, **Pronto quando**, ${SECOES}`,
  },
  refatoracao: {
    nome: 'Refatoração',
    detalhe: 'O que mudar, por quê e o que não pode quebrar',
    formato: `Formato: pedido de refatoração. Blocos com títulos em negrito: **O que mudar**, **Por quê**, **O que não pode mudar** (comportamento, API, contratos citados), **Como validar**, ${SECOES}`,
  },
  revisao: {
    nome: 'Revisão de código',
    detalhe: 'Pede revisão com o foco que você falou',
    formato: `Formato: pedido de revisão de código. Diga o que revisar (arquivo, trecho, branch) e liste em marcadores os focos que a pessoa citou (bugs, desempenho, segurança, legibilidade). Peça os achados em ordem de gravidade. ${SECOES}`,
  },
  pergunta: {
    nome: 'Pergunta',
    detalhe: 'Uma pergunta direta, com o contexto necessário',
    formato: 'Formato: uma pergunta clara e direta, precedida só do contexto que a pessoa deu. Sem títulos. Se a pessoa pediu exemplo, comparação ou passo a passo, diga isso na pergunta.',
  },
};

const IDIOMAS = {
  'pt-BR': 'Escreva o prompt em português do Brasil.',
  en: 'Write the final prompt in clear, natural English (the speech is in Portuguese; translate faithfully, keeping file names, code and product names as they are).',
  mesmo: 'Escreva o prompt no mesmo idioma da fala.',
};

/** Junta os modos embutidos com os personalizados das configurações. */
function listarModos(personalizados = []) {
  const todos = { ...MODOS };
  for (const m of personalizados || []) {
    if (!m || !m.id || !m.instrucoes) continue;
    todos[m.id] = { nome: m.nome || m.id, detalhe: m.detalhe || 'Modo personalizado', formato: `Formato: ${m.instrucoes}` };
  }
  return todos;
}

function montarSistema({ modo = 'estruturado', idioma = 'pt-BR', extras = '', personalizados = [] } = {}) {
  const modos = listarModos(personalizados);
  const m = modos[modo] || modos.estruturado;
  return [REGRAS, m.formato, IDIOMAS[idioma] || IDIOMAS['pt-BR'], extras.trim() && `Preferências fixas da pessoa:\n${extras.trim()}`]
    .filter(Boolean).join('\n\n');
}

const REGRAS_AJUSTE = `Você recebe um prompt pronto e um ajuste pedido pela pessoa (às vezes ditado por voz). Devolva o prompt inteiro já com o ajuste aplicado. Mude só o que o ajuste pede; mantenha o resto igual, inclusive o formato. Corrija erros de reconhecimento de voz no ajuste pelo contexto. Responda só com o prompt atualizado, sem comentário.`;

function montarSistemaAjuste({ idioma = 'pt-BR' } = {}) {
  return `${REGRAS_AJUSTE}\n\n${IDIOMAS[idioma] || IDIOMAS['pt-BR']}`;
}

/** Mensagem enviada ao modelo: contexto do editor + fala. */
function montarEntrada(fala, ctx = {}) {
  const linhas = [];
  if (ctx.pasta) linhas.push(`Projeto aberto: ${ctx.pasta}`);
  if (ctx.branch) linhas.push(`Branch: ${ctx.branch}`);
  if (ctx.arquivo) linhas.push(`Arquivo em foco: ${ctx.arquivo}${ctx.linguagem ? ` (${ctx.linguagem})` : ''}${ctx.linhas ? `, seleção nas ${ctx.linhas}` : ''}`);
  if (ctx.erros?.length) linhas.push(`Erros no arquivo:\n${ctx.erros.map(e => `- ${e}`).join('\n')}`);
  if (ctx.glossario?.length) linhas.push(`Glossário (grafia correta): ${ctx.glossario.join(', ')}`);
  const partes = [`<contexto>\n${linhas.join('\n') || 'sem contexto extra'}\n</contexto>`];
  if (ctx.selecao) partes.push(`<selecao>\n${ctx.selecao}\n</selecao>`);
  partes.push(`<fala>\n${String(fala).trim()}\n</fala>`);
  return partes.join('\n\n');
}

function montarEntradaAjuste(prompt, ajuste) {
  return `<prompt>\n${String(prompt).trim()}\n</prompt>\n\n<ajuste>\n${String(ajuste).trim()}\n</ajuste>`;
}

module.exports = { MODOS, listarModos, montarSistema, montarSistemaAjuste, montarEntrada, montarEntradaAjuste };
