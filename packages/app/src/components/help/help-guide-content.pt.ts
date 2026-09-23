import type { HelpGuide } from "./help-guide-content";

export const PT_HELP_GUIDE: HelpGuide = {
  title: "Como funciona um orçamento",
  intro:
    "Você adiciona suas contas — todo lugar onde seu dinheiro está — para ver o quadro financeiro completo em um só lugar. Seu orçamento é então uma lista de transações: cada saldo e cada gráfico que o app mostra é calculado a partir dela. Mantenha a lista correta e todo o resto se resolve sozinho.",
  sections: [
    {
      id: "accounts",
      title: "Contas",
      blocks: [
        {
          kind: "paragraph",
          text: "Qualquer lugar onde haja valor: conta corrente, dinheiro em espécie, poupança, cartões de crédito, empréstimos, cripto. Você nunca digita um saldo — ele é a soma das transações da conta. Dívidas são saldos negativos, então suas contas somadas dão o seu patrimônio líquido.",
        },
      ],
    },
    {
      id: "transactions",
      title: "Transações",
      blocks: [
        { kind: "paragraph", text: "Toda vez que o dinheiro se move, é de um destes três tipos:" },
        {
          kind: "list",
          items: [
            { term: "Despesa", text: "dinheiro saindo." },
            { term: "Receita", text: "dinheiro entrando." },
            {
              term: "Transferência",
              text: "dinheiro entre suas próprias contas (para a poupança, pagando um cartão de crédito). Não é gasto.",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "Uma compra no cartão de crédito é uma despesa; pagar a fatura depois é uma transferência, não um gasto novo — essa é a única coisa que vale a pena acertar.",
        },
      ],
    },
    {
      id: "categories",
      title: "Categorias",
      blocks: [
        {
          kind: "paragraph",
          text: "Para onde vai seu dinheiro, agrupado por quanto controle você tem sobre ele (custos fixos, dia a dia, irregulares). Já vêm com padrões sensatos desde o começo; mude à vontade.",
        },
      ],
    },
    {
      id: "importing",
      title: "Importação",
      blocks: [
        {
          kind: "paragraph",
          text: "Registre as transações à mão ou entregue ao Capy um CSV do banco, uma captura de tela do extrato ou uma foto de um recibo — ele registra e categoriza tudo para você. Importe seu histórico e você já começa com meses de dados em vez de uma folha em branco.",
        },
      ],
    },
    {
      id: "analytics",
      title: "Análises",
      blocks: [
        { kind: "paragraph", text: "Cada visão responde a uma pergunta:" },
        {
          kind: "list",
          items: [
            { term: "Gastos", text: "para onde o dinheiro foi?" },
            { term: "Fluxo de caixa", text: "meu padrão de vida é sustentável?" },
            { term: "Patrimônio líquido", text: "estou poupando?" },
            { term: "Comparar", text: "como as categorias evoluem umas em relação às outras?" },
            {
              term: "Orçamento mensal",
              text: "estou no caminho certo neste mês? É uma visão voltada para a frente, montada a partir dos seus gastos passados, então ela fica útil depois de alguns meses de histórico.",
            },
          ],
        },
      ],
    },
    {
      id: "capy",
      title: "Capy",
      blocks: [
        {
          kind: "paragraph",
          text: "O Capy é a camada de IA, que é opcional. Peça a ele para importar e categorizar transações, encontrar cobranças recorrentes como assinaturas ou qualquer outra coisa que você mesmo faria no app. O aplicativo funciona por completo sem ele.",
        },
      ],
    },
  ],
};
