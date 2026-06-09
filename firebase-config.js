// ╔══════════════════════════════════════════════════════════════╗
// ║  CONFIGURAÇÃO — EDITE ESTE ARQUIVO ANTES DE PUBLICAR         ║
// ╚══════════════════════════════════════════════════════════════╝
//
// 1) Acesse https://console.firebase.google.com/
// 2) Crie um projeto novo (o nome pode ser "bingo-prof" ou o que quiser)
// 3) No menu da esquerda: Build → Realtime Database → Criar banco de dados
//    - Escolha a localização "us-central1" (ou a mais próxima)
//    - Modo: "começar em modo de teste" (regras abertas por 30 dias — depois eu te explico como renovar)
// 4) Voltando ao painel: clique no ícone de engrenagem ⚙️ → "Configurações do projeto"
// 5) Role até "Seus aplicativos" → clique no ícone de </> (Web)
// 6) Apelido do app: "bingo" → Registrar
// 7) Copie o objeto `firebaseConfig` que apareceu e cole AQUI EMBAIXO,
//    SUBSTITUINDO o que está entre as chaves { ... }
// 8) ATENÇÃO: garanta que tem a linha "databaseURL" — se não tiver, abra o
//    Realtime Database e copie a URL que aparece no topo (algo como
//    https://seu-projeto-default-rtdb.firebaseio.com)

export const firebaseConfig = // ╔══════════════════════════════════════════════════════════════╗
// ║  CONFIGURAÇÃO — EDITE ESTE ARQUIVO ANTES DE PUBLICAR         ║
// ╚══════════════════════════════════════════════════════════════╝
//
// 1) Acesse https://console.firebase.google.com/
// 2) Crie um projeto novo (o nome pode ser "bingo-prof" ou o que quiser)
// 3) No menu da esquerda: Build → Realtime Database → Criar banco de dados
//    - Escolha a localização "us-central1" (ou a mais próxima)
//    - Modo: "começar em modo de teste" (regras abertas por 30 dias — depois eu te explico como renovar)
// 4) Voltando ao painel: clique no ícone de engrenagem ⚙️ → "Configurações do projeto"
// 5) Role até "Seus aplicativos" → clique no ícone de </> (Web)
// 6) Apelido do app: "bingo" → Registrar
// 7) Copie o objeto `firebaseConfig` que apareceu e cole AQUI EMBAIXO,
//    SUBSTITUINDO o que está entre as chaves { ... }
// 8) ATENÇÃO: garanta que tem a linha "databaseURL" — se não tiver, abra o
//    Realtime Database e copie a URL que aparece no topo (algo como
//    https://seu-projeto-default-rtdb.firebaseio.com)

export const firebaseConfig = {
  apiKey: "AIzaSyAOFKVqVGS_JDichlaHDA5iwa4VBH9plic",
  authDomain: "bingo-portugues.firebaseapp.com",
  databaseURL: "https://bingo-portugues-default-rtdb.firebaseio.com",
  projectId: "bingo-portugues",
  storageBucket: "bingo-portugues.firebasestorage.app",
  messagingSenderId: "637348287930",
  appId: "1:637348287930:web:70c31a72d9b56670f2f983",
  measurementId: "G-J75C0C6ND9"
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  SENHA DOS PROFESSORES                                       ║
// ╚══════════════════════════════════════════════════════════════╝
//
// Qualquer pessoa com essa senha consegue abrir o painel do professor
// e criar jogos. Compartilhe só com profs de confiança.
// Troque por algo só seu — evite "professor", "1234" ou nomes óbvios.

export const TEACHER_PIN = "professor";


// ╔══════════════════════════════════════════════════════════════╗
// ║  SENHA DOS PROFESSORES                                       ║
// ╚══════════════════════════════════════════════════════════════╝
//
// Qualquer pessoa com essa senha consegue abrir o painel do professor
// e criar jogos. Compartilhe só com profs de confiança.
// Troque por algo só seu — evite "professor", "1234" ou nomes óbvios.

export const TEACHER_PIN = "trocar-isto";
