import type { HelpGuide } from "./help-guide-content";

export const ES_HELP_GUIDE: HelpGuide = {
  title: "Cómo funciona el presupuesto",
  intro:
    "Añades tus cuentas —dondequiera que tengas dinero— para ver toda tu situación financiera en un solo lugar. Tu presupuesto es entonces una lista de transacciones: cada saldo y cada gráfico que muestra la app se calculan a partir de ella. Mantén la lista al día y todo lo demás se resuelve solo.",
  sections: [
    {
      id: "accounts",
      title: "Cuentas",
      blocks: [
        {
          kind: "paragraph",
          text: "Cualquier sitio donde haya valor: cuenta corriente, efectivo, ahorros, tarjetas de crédito, préstamos, cripto. Nunca escribes un saldo: es la suma de las transacciones de la cuenta. Las deudas son saldos negativos, así que tus cuentas juntas suman tu patrimonio neto.",
        },
      ],
    },
    {
      id: "transactions",
      title: "Transacciones",
      blocks: [
        { kind: "paragraph", text: "Cada vez que el dinero se mueve, es de uno de estos tres tipos:" },
        {
          kind: "list",
          items: [
            { term: "Gasto", text: "dinero que sale." },
            { term: "Ingreso", text: "dinero que entra." },
            {
              term: "Transferencia",
              text: "dinero entre tus propias cuentas (a ahorros, pagar una tarjeta de crédito). No es un gasto.",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "Una compra con tarjeta de crédito es un gasto; pagar esa tarjeta más adelante es una transferencia, no un gasto nuevo: lo único que conviene tener claro.",
        },
      ],
    },
    {
      id: "categories",
      title: "Categorías",
      blocks: [
        {
          kind: "paragraph",
          text: "Adónde va tu dinero, agrupado según cuánto control tienes sobre ello (gastos fijos, del día a día, irregulares). Categorías sensatas desde el principio; cámbialas con total libertad.",
        },
      ],
    },
    {
      id: "importing",
      title: "Importar",
      blocks: [
        {
          kind: "paragraph",
          text: "Introduce las transacciones a mano, o dale a Capy un CSV del banco, una captura de un extracto o la foto de un recibo: él las introduce y las categoriza por ti. Importa tu historial y empezarás con meses de datos en lugar de con la hoja en blanco.",
        },
      ],
    },
    {
      id: "analytics",
      title: "Análisis",
      blocks: [
        { kind: "paragraph", text: "Cada vista responde a una pregunta:" },
        {
          kind: "list",
          items: [
            { term: "Gastos", text: "¿adónde fue a parar?" },
            { term: "Flujo de caja", text: "¿es sostenible mi nivel de vida?" },
            { term: "Patrimonio neto", text: "¿estoy ahorrando?" },
            { term: "Comparar", text: "¿cómo evolucionan las categorías unas frente a otras?" },
            {
              term: "Presupuesto mensual",
              text: "¿voy bien este mes? Una vista de futuro construida a partir de tus gastos pasados, así que se vuelve útil cuando ya tienes un par de meses de historial.",
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
          text: "Capy es la capa de IA opcional. Pídele que importe y categorice transacciones, que encuentre cargos recurrentes como suscripciones, o cualquier otra cosa que harías tú mismo en la app. La app funciona por completo sin él.",
        },
      ],
    },
  ],
};
