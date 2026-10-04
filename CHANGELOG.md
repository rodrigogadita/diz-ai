# Novidades

## 1.2.0

- **Tudo num lugar só**: o painel **Ao vivo** virou o centro. Caixa 1 é o que você fala (o ditado do Windows digita direto nela), caixa 2 é o prompt nascendo. Nenhuma aba é aberta; os arquivos são salvos em segundo plano para o Histórico.
- **Limpar**: zera as duas caixas, fecha abas antigas do Diz Aí e abre uma conversa nova no Claude Code (desligue em `dizAi.limparAbreConversaNova`).
- No primeiro Falar da sessão, as abas de fala.md e prompt.md que tinham ficado abertas são fechadas.
- Botão **Refazer** no painel e **Ctrl+Enter** dentro das caixas para enviar.
- Clicar no Histórico traz o prompt de volta ao painel; "Abrir em abas" fica no menu de contexto.
- O ditado do Windows não é desligado sem querer: se ele já estiver ouvindo, o Falar só acompanha. A folga para considerar que ele parou subiu para 3 s.
- A colagem no envio não marca mais o prompt como "editado à mão" (isso congelava a lapidação ao vivo).
- Blocos vazios não aparecem no Histórico.
- Configuração nova `dizAi.abrirArquivos` para quem prefere as abas; `dizAi.mostrarPainel` saiu.

## 1.1.0

- **Ondas da voz ao vivo**: na barra de status, ao lado do cursor no `fala.md` e grandes no painel novo **Ao vivo**.
- **Painel Ao vivo** na barra lateral: estado, o que você disse e o prompt nascendo em tempo real, com Enviar, Ajustar, Copiar e Modo.
- **"Ouvindo" de verdade**: o Diz Aí lê do Windows se o ditado está mesmo escutando. Se ele não abrir, avisa em 6 s; se ele parar no silêncio, a extensão acompanha.
- **Checagem antes de ouvir**: detecta microfone no mudo, volume baixo e reconhecimento de fala online desligado, e libera com um clique.
- **Testar o microfone**: mede o sinal por 3 s, mostra o diagnóstico e oferece "Liberar tudo".
- O `prompt.md` abre ao lado já no primeiro ditado, com uma dica dizendo o que vai aparecer ali.
- Canal **Diz Aí** no painel Saída para diagnóstico.
- O auxiliar do Windows virou `src/motores/auxiliar.ps1`.

## 1.0.0

Primeira versão pública.

- Ditado com três motores: Windows (Win+H), Whisper (Groq, OpenAI ou local) e VS Code Speech.
- Lapidação ao vivo e em streaming com o Claude Code CLI, sem chave de API.
- Regras de reescrita feitas para o português do Brasil: fidelidade ao pedido, correções no meio da fala, nomes técnicos e código falado por extenso.
- Sete modos de escrita (estruturado, limpo, bug, funcionalidade, refatoração, revisão, pergunta) e modos personalizados.
- Comandos de voz no fim da fala: "pode enviar", "manda ver", "manda bala".
- Ajuste do prompt por voz (`Ctrl+Alt+R`).
- Contexto do editor: arquivo, seleção, erros e branch.
- Destinos: Claude Code, chat do VS Code (Copilot), terminal e área de transferência.
- Histórico na barra lateral com reenvio, cópia e estatística de palavras ditadas.
- Glossário, atalhos de voz e prompt em inglês a partir da fala em português.
- Passo a passo de primeiros passos.
