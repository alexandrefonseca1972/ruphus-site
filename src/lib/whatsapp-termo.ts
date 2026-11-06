// Texto do termo da integração WhatsApp (gateway próprio, atendys). Fonte única
// exibida em dois lugares: aviso na gaveta do /admin e termo de aceite no painel
// do dono — antes dele habilitar o uso. Sem "server-only" de propósito: os dois
// lados renderizam.

export const TERMO_WHATSAPP = {
  titulo: "Antes de conectar o WhatsApp",
  paragrafos: [
    "A conexão funciona como o WhatsApp Web: o número do negócio fica ligado à Ruphus como um aparelho conectado, e as confirmações e lembretes saem dele, com o nome do seu negócio. Como não é a API oficial do WhatsApp Business, o WhatsApp pode limitar ou bloquear o número se entender que os envios estão automáticos demais.",
    "Para reduzir esse risco, a Ruphus envia aos poucos, com intervalo entre as mensagens, limite por dia e respeito a quem pede para não receber. A decisão final é do WhatsApp: a Ruphus não garante que o canal fique sempre disponível e não responde por limitação, bloqueio ou instabilidade do número.",
  ],
  itens: [
    "Prefira um número só do negócio, não o seu número pessoal.",
    "Deixe outro contato visível no site (telefone ou e-mail).",
    "A agenda e o histórico ficam salvos no painel, mesmo se o WhatsApp parar.",
    "Se o número for bloqueado, é só conectar outro nesta tela: a agenda continua funcionando.",
  ],
};
