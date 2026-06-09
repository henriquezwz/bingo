# Bingo · Língua Portuguesa

Sistema de bingo online com painel ao vivo do professor, ranking final e
**upload de bingos novos direto pelo site** (sem precisar editar nada no GitHub
depois da configuração inicial).

> **Tempo de configuração inicial:** ~20 minutos. Depois é só usar.

---

## 📦 O que vem na caixa

```
bingo-online/
├── index.html              ← página principal (não edita)
├── app.js                  ← lógica do jogo (não edita)
├── styles.css              ← estilos (não edita)
├── firebase-config.js      ← VOCÊ EDITA com suas chaves
├── bingos/
│   ├── index.json          ← lista dos bingos padrão
│   ├── regencia.json       ← Regência Verbal (incluído)
│   └── adverbial.json      ← Orações Adverbiais (incluído)
└── README.md               ← este arquivo
```

Os dois bingos padrão (regência e adverbial) ficam sempre disponíveis. Bingos
novos você sobe **direto pelo painel do professor** — eles são salvos no
Firebase e aparecem automaticamente na lista.

---

## 🚀 Configuração inicial (faz uma vez só)

### Passo 1 · Criar projeto no Firebase

O Firebase é o serviço do Google que sincroniza os tablets em tempo real.
**Grátis** para o uso de uma sala de aula.

1. Acesse <https://console.firebase.google.com/> e entre com sua conta Google
2. Clique em **"Adicionar projeto"**
3. Nome: algo como `bingo-portugues` (não precisa ativar Analytics)
4. Aguarde a criação → **"Continuar"**

### Passo 2 · Ativar o Realtime Database

1. Menu esquerdo: **"Compilação" → "Realtime Database"**
2. **"Criar banco de dados"**
3. Localização: **`southamerica-east1`** (São Paulo) se aparecer; senão **`us-east1`**
4. Modo: marque **"Iniciar no modo de teste"** → **"Ativar"**

> ⚠️ O modo de teste expira em 30 dias. Veja [Renovar regras](#renovar-regras-do-firebase) no final.

### Passo 3 · Pegar as chaves

1. Painel lateral: clique no ícone **⚙️ engrenagem** → **"Configurações do projeto"**
2. Role até **"Seus aplicativos"** → clique no ícone **`</>`** (Web)
3. Apelido: `bingo` → **"Registrar app"** (NÃO marque "Firebase Hosting")
4. Aparece um bloco `const firebaseConfig = { ... }`. **Copie tudo dentro das chaves.**
5. **"Continuar para o console"**

### Passo 4 · Colar as chaves no arquivo

1. Abra `firebase-config.js` num editor de texto
2. Substitua o objeto `firebaseConfig` pelo que você copiou
3. **Confira** que tem a linha `databaseURL`. Se faltar, abra o Realtime
   Database no Firebase e copie a URL do topo (tipo
   `https://seu-projeto-default-rtdb.firebaseio.com`)
4. Troque também a linha `TEACHER_PIN` por uma senha sua:

   ```js
   export const TEACHER_PIN = "minhaSenhaSecreta2026";
   ```

   Evite senhas óbvias. Quem souber consegue criar/encerrar jogos.

### Passo 5 · Subir no GitHub

1. Crie repositório novo em <https://github.com/new>
   - Nome: `bingo` (ou o que preferir)
   - Marque **"Público"** (necessário pro GitHub Pages grátis)
   - **Não** crie README/gitignore/licença
2. **"Create repository"**
3. Na tela seguinte: **"uploading an existing file"**
4. Arraste TODOS os arquivos + a pasta `bingos/`
5. **"Commit changes"**

### Passo 6 · Ativar o GitHub Pages

1. No repositório: **"Settings"** (engrenagem no topo)
2. Menu esquerdo: **"Pages"**
3. Em "Source": **"Deploy from a branch"**
4. Em "Branch": **`main`** + pasta **`/ (root)`** → **"Save"**
5. Aguarde ~2 minutos → recarregue. No topo da página vai aparecer:
   > Your site is live at `https://seuusuario.github.io/bingo/`

**Esse é seu link.** Salva nos favoritos.

---

## 🎓 Como usar com a turma

**Você (no seu tablet ou projetor):**

1. Abre o link
2. **"sou o professor"** → digita a senha
3. Escolhe qual bingo rodar (ou sobe um novo — ver seção abaixo)
4. Aparece o link da aula em destaque e o painel vazio aguardando alunos
5. Compartilha o link (já está visível no painel; botão "copiar" copia pra você)
6. Quando os alunos começarem a aparecer, toca **"🎲 SORTEAR PRÓXIMA"** e lê
   a frase em voz alta, duas vezes
7. Acompanha o progresso ao vivo: quem acertou, quem errou, quem fez LINHA, quem fez BINGO
8. **"🏁 ENCERRAR · VER RANKING"** → aparece o pódio pra todo mundo
9. Pode **imprimir/salvar PDF** do ranking pelo botão dedicado

**Alunos (no tablet deles):**

1. Abrem o mesmo link
2. Digitam só o nome → entram
3. Recebem uma cartela 4x4 única (geração garantidamente única até 40+ alunos)
4. Tocam a célula com a resposta quando você ler a frase
5. Verde = acertou, vermelho = errou
6. No final, veem o ranking e onde ficaram

---

## ➕ Adicionar um bingo novo

**Fluxo completo (uns 2 minutos):**

1. **Peça aqui no chat:** *"Claude, faz um bingo sobre crase no mesmo formato
   dos outros."*
2. Eu te entrego um arquivo `crase.json`
3. **No painel do professor**, na tela de escolha de bingo, clique em
   **"+ ADICIONAR NOVO BINGO (arquivo .json)"**
4. Arraste o arquivo na zona de drop, ou clique em "selecionar arquivo"
5. O sistema valida na hora e mostra um preview
6. Se tiver problema, mostra o que está errado e você pede pro Claude corrigir
7. Confirma → o bingo já aparece na lista, pronto pra rodar

Os bingos personalizados ficam salvos no Firebase, então persistem entre
sessões. Você pode apagar a qualquer momento clicando no **×** vermelho no
canto do card (só funciona pros bingos enviados por você, não pros padrão).

---

## 🧱 Estrutura de um arquivo de bingo

Para referência, caso queira saber o que está no .json:

```json
{
  "id": "crase",
  "name": "Crase",
  "subtitle": "uso obrigatório, facultativo ou proibido",
  "sentences": [
    { "text": "Vou À escola todos os dias.", "context": "vou + a (locativo fem.)", "answer": "OBRIGATÓRIA" },
    ...
  ],
  "distribution": ["OBRIGATÓRIA", "OBRIGATÓRIA", ...16 itens],
  "hint": {
    "OBRIGATÓRIA": "a + a = à",
    "PROIBIDA": "antes de verbo, masculino..."
  }
}
```

- **`sentences`**: 30-40 frases é o ideal (jogo de 20-25 min)
- **`distribution`**: 16 itens que vão na cartela 4x4 (categorias mais comuns repetem)
- **`hint`**: dica em itálico abaixo da categoria (opcional)

O sistema valida automaticamente antes de aceitar: precisa ter os campos
obrigatórios, distribution com 16 itens, e as respostas das frases têm que
bater com os itens da distribution.

---

## 🛠️ Renovar regras do Firebase

O modo de teste expira em 30 dias. Para deixar funcionando sem prazo (e ainda gratuito):

1. Firebase → Realtime Database → aba **"Regras"**
2. Substitua o conteúdo por:

   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```

3. **"Publicar"**

Como não tem dados sensíveis (só nomes e marcações de bingo), deixar aberto
está OK. Se quiser mais segurança, dá pra adicionar regras por path depois.

---

## 🆘 Problemas comuns

**"Firebase não configurado"** → você não colou as chaves no
`firebase-config.js` ou esqueceu de salvar no GitHub.

**Tela em branco para os alunos** → provavelmente erro de sintaxe no
`firebase-config.js`. Confira vírgulas entre as chaves e aspas duplas nas strings.

**O upload de bingo dá erro** → o arquivo `.json` precisa estar no formato
correto. O sistema mostra exatamente o que está errado. Se em dúvida, peça pro
Claude refazer o arquivo.

**Os alunos somem da lista** → você (ou alguém) clicou em RESETAR. Esse botão
limpa tudo. Use só quando quiser começar uma turma nova.

**Quero usar em duas turmas no mesmo dia** → terminou uma turma, clica
ENCERRAR (mostra ranking), depois NOVO JOGO. As marcações antigas somem e tudo
fica limpo pra próxima turma.

**Pode rodar com 40 alunos?** → sim, foi pensado pra isso. As cartelas são
geradas com checagem de unicidade — cada aluno recebe uma combinação distinta.

---

Qualquer ajuste — som ao acertar, modo "BIIP" (frases com lacuna), tema
escuro, exportar relatórios em CSV — é só pedir aqui no chat.
