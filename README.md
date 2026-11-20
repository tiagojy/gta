<p align="center">
  <img src="./story/favicon.svg" alt="Logo GTA — Guanabara Testando Agentes" width="84" height="84">
</p>

<h1 align="center">GTA (Guanabara Testando Agentes)</h1>

<p align="center">
  <strong>Um jogo retrô de mundo aberto em visão superior construído com WebGL, Canvas 2D e JavaScript puro — aberto para você jogar, estudar e criar suas próprias histórias.</strong>
</p>

<p align="center">
  <img src="./story/splash/splash-start.png" alt="Tela de abertura de GTA: Missão Vibe Coding" width="760">
</p>

---

## Sobre o Projeto

**GTA (Guanabara Testando Agentes)** nasceu como um laboratório prático e divertido para explorar o desenvolvimento de aplicações completas com apoio de agentes de inteligência artificial — sem abrir mão de arquitetura limpa, testes automatizados e experiência polida em desktop e celular.

Todo o motor roda diretamente no navegador, sem frameworks ou dependências externas em tempo de execução, combinando **ES Modules**, **WebGL** para renderização da cidade, **Canvas 2D** para minimapa e mapa ampliado, **Service Worker** para cache offline e suporte completo a **PWA** (incluindo *Adicionar à Tela de Início* no iPhone e iPad).

---

## A História Atual: *Missão Vibe Coding*

Nesta edição, a pasta [`story/`](./story) traz a campanha **Missão Vibe Coding**.

<table>
  <tr>
    <td width="190" align="center">
      <img src="./story/characters/guanabara.png" alt="Personagem Guanabara" width="160">
    </td>
    <td>
      Você controla <strong>Guanabara</strong>, um motorista experiente que conhece cada rua, esquina e atalho da ilha.<br><br>
      Tudo começa com uma encomenda misteriosa: uma <strong>caixa secreta</strong> que precisa cruzar a cidade. A partir daí, uma sequência de entregas, imprevistos tecnológicos, bugs improváveis e figuras inspiradas no universo de tecnologia e inteligência artificial transforma um simples trajeto em uma corrida cheia de humor — envolvendo GPUs, servidores, robôs e muito café.<br><br>
      <em>Sem spoilers:</em> explore a cidade com calma, converse com moradores nas calçadas e fique atento aos itens colecionáveis espalhados pelos quarteirões!
    </td>
  </tr>
</table>

---

## Crie Sua Própria História (Fork & Personalize)

Este é um projeto **Open Source** pensado para ser modificado. Você pode fazer um **fork** deste repositório e transformar o jogo em uma campanha totalmente nova — com seus próprios personagens, falas, itens, cenários e missões — editando apenas arquivos Markdown e imagens dentro de [`story/`](./story), sem precisar mexer no motor do jogo:

```text
story/
├── story.md              # Título, subtítulo, título da aba, lista de personagens, itens e missões
├── favicon.svg           # Ícone da aba do navegador e do Web App (suporta .svg, .png ou .ico)
├── npc-lines.md          # Frases aleatórias para balões HQ dos moradores na rua (até 60 caracteres)
├── wrong-item-lines.md   # Reações genéricas ao tentar entregar um item errado (até 60 caracteres)
├── splash/
│   ├── splash-start.png  # Imagem da tela inicial e de compartilhamento em redes sociais
│   └── splash-end.png    # Imagem exibida na conclusão da campanha
├── characters/           # Fichas (.md) e retratos (.png) dos personagens das cutscenes
├── items/                # Definições (.md) e ícones (.svg/.png) de itens de missão e extras
├── missions/             # Roteiros das missões (.md), locais, cutscenes, escolhas e entregas
└── map/                  # Mapeamento dos códigos da cidade (map.md) e cenários das cutscenes
```

Basta trocar os textos e imagens dessa pasta para publicar sua própria aventura no GitHub Pages!

---

## Recursos do Motor e Jogabilidade

- **Cidade-ilha procedural (30×30 quarteirões)**: ruas nomeadas, casas, comércios, praças, 40 hospitais com recuperação de vida, áreas portuárias e barcos circulando ao redor da ilha.
- **Tráfego e pedestres vivos**: carros, motos e vans com comportamento distinto, curvas suaves em esquinas, semáforos, faixas de pedestres, frenagem preventiva diante do jogador a pé, colisões com dano proporcional à velocidade e explosões em cadeia.
- **Balões de diálogo estilo HQ**: moradores na rua e reações no inventário exibem balões animados acima do alvo com efeito de digitação.
- **Mapa ampliado inteligente**: enquadramento automático de jogador e destino ao abrir, zoom por pinça/scroll/botões e rota traçada pelas ruas até o objetivo.
- **Controles multiplataforma**:
  - **Teclado**: `Setas` ou `WASD` para mover, `W`/`↑` para acelerar e `S`/`↓` (ou `Shift`/`X`) para frear/dar ré, `F` para entrar/roubar veículo, `Espaço` para ação/conversar, botão esquerdo do mouse para atirar, botão direito para marcar o NPC (e, no mapa ampliado, marcar um destino), `I`/`Tab` para inventário, `M` para mapa ampliado e `Esc`/`P` para pausa.
  - **Joystick / Gamepad**: suporte completo em menus, diálogos e direção.
  - **Tela de toque (iOS/Android)**: analógico virtual a pé, volante horizontal com âncora relativa ao primeiro toque ao dirigir, além de HUD adaptativo para modo retrato e paisagem.
- **Armas e Armaria**: pistola, submetralhadora e escopeta (teclas `1`–`3` ou roda do mouse trocam de arma, `R` recarrega). A **Armaria Bom Preço** (telhado vermelho no mapa) vende armas e munição no balcão (`Espaço`). O dinheiro vem de missões e dos NPCs abatidos; `F2` abre o console de cheats (`dinheiro`, `municao`, `vida`, `ajuda`).
- **Progresso salvo no navegador**: missões desbloqueadas, inventário e posição são preservados entre recarregamentos.

---

## Como Executar Localmente e Rodar os Testes

Como o projeto utiliza **ES Modules**, sirva esta pasta por um servidor HTTP local (não abra o `index.html` diretamente via `file://`):

```bash
# Opção 1: Python
python3 -m http.server 8080

# Opção 2: Node.js
npx serve .
```

Depois, acesse `http://localhost:8080` no navegador.

Para executar a suíte de testes unitários com Node.js:

```bash
node --test tests/*.test.js
```

---

## Propósito Educacional — Curso em Vídeo

Este projeto foi idealizado e criado por **Gustavo Guanabara**, professor e fundador do [**Curso em Vídeo**](https://www.youtube.com/cursoemvideo) no YouTube.

O objetivo do **GTA — Guanabara Testando Agentes** vai muito além do jogo: ele existe para **incentivar pessoas de todas as idades a aprenderem a desenvolver soluções reais**, mostrando na prática como tecnologia, criatividade, lógica e ferramentas modernas podem caminhar juntas. O **Curso em Vídeo** tem como missão democratizar o ensino de tecnologia em língua portuguesa e **formar a próxima geração de desenvolvedores do mercado**.

Curtiu o projeto? Faça um **fork**, crie sua própria história em [`story/`](./story), compartilhe com a comunidade e continue aprendendo!
