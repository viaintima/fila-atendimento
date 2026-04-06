━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SISTEMA DE ATENDIMENTO — Site (Vite + React + Firebase)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

O que você vai precisar (todos gratuitos):
  • Node.js        → https://nodejs.org  (versão LTS)
  • Conta Google   → para usar Firebase
  • Conta Vercel   → https://vercel.com  (hospedagem grátis)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PASSO 1 — Criar o Firebase
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Acesse https://console.firebase.google.com
2. Clique em "Criar projeto" → dê um nome (ex: "atendimento-loja")
3. Desative o Google Analytics (opcional) → Criar projeto

4. No menu lateral → "Firestore Database"
   → Clique "Criar banco de dados"
   → Escolha "Iniciar no modo de produção"
   → Selecione uma região próxima (ex: us-east1)

5. No menu lateral → "Configurações do projeto" (ícone ⚙️)
   → Aba "Geral" → rolar até "Seus apps"
   → Clique em "</>" (Web)
   → Registre o app (qualquer nome)
   → COPIE os dados de configuração (apiKey, authDomain, etc.)

6. Ainda no Firestore → aba "Regras"
   → Cole o conteúdo do arquivo  firestore.rules
   → Clique "Publicar"


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PASSO 2 — Configurar o projeto
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Copie o arquivo  .env.example  e renomeie para  .env
2. Preencha com os dados do Firebase copiados no passo 1:

   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=meu-projeto.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=meu-projeto
   VITE_FIREBASE_STORAGE_BUCKET=meu-projeto.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abc...

3. No terminal, dentro desta pasta, rode:
   npm install

4. Para testar localmente:
   npm run dev
   → Abre em http://localhost:5173


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PASSO 3 — Subir no Vercel (grátis)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Opção A — Via interface (mais fácil):
  1. Crie conta em https://vercel.com (pode usar a conta Google)
  2. Instale o CLI: npm install -g vercel
  3. Rode: vercel
  4. Siga os passos (Enter em tudo)
  5. Quando pedir "Environment Variables", adicione cada linha do .env
  6. Pronto! Você receberá um link como:
     https://atendimento-suaempresa.vercel.app

Opção B — Via GitHub (recomendado para atualizações):
  1. Suba o projeto no GitHub (sem o arquivo .env!)
  2. Em vercel.com → "Add New Project" → importe do GitHub
  3. Em "Environment Variables" adicione as variáveis do .env
  4. Deploy! Qualquer push no GitHub atualiza o site automaticamente.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PASSO 4 — Primeira configuração
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Acesse o site publicado
2. Clique na aba "Administrador"
3. Na primeira vez, ele pede para criar o PIN de admin
4. Crie o PIN → entre no painel
5. Em "🏪 Lojas" → "+ Nova Loja" → adicione cada loja com nome e PIN
6. Passe o endereço do site + PIN para cada loja — pronto!


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 COMO FUNCIONA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Lojas:
  • Acessam o site → selecionam a loja → digitam o PIN
  • Funcionam normalmente: fila, atendimentos, pausas, relatório/PDF
  • Dados salvos em tempo real no Firebase (qualquer tablet vê igual)

Administrador:
  • Acessa com o PIN de admin
  • Vê TODAS as lojas com métricas de hoje em tempo real
  • Clica em uma loja para ver o relatório completo
  • Pode exportar PDF de qualquer loja
  • Gerencia lojas (adicionar, editar PIN, ativar/desativar)

Dados:
  • Cada dia começa zerado automaticamente
  • Dados ficam armazenados no Firestore (nuvem Google)
  • Plano gratuito do Firebase suporta até 50.000 leituras/dia
    (mais que suficiente para dezenas de lojas)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ESTRUTURA DOS ARQUIVOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  src/
    main.jsx        → ponto de entrada React
    App.jsx         → toda a lógica e interface
    firebase.js     → conexão com Firebase
  index.html        → HTML base
  vite.config.js    → configuração do build
  package.json      → dependências
  .env              → suas chaves do Firebase (NÃO enviar ao GitHub)
  .env.example      → template das variáveis
  firestore.rules   → regras de segurança do banco

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
