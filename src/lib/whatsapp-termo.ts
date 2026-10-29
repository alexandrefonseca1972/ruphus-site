// Texto do termo da integração WhatsApp (gateway próprio, wtsfy). Fonte única
// exibida em dois lugares: aviso na gaveta do /admin e termo de aceite no painel
// do dono — antes dele habilitar o uso. Sem "server-only" de propósito: os dois
// lados renderizam.

export const TERMO_WHATSAPP = {
  titulo: "Sobre o WhatsApp do seu negócio — leia antes de conectar",
  paragrafos: [
    "Esta integração usa a tecnologia de aparelhos conectados do WhatsApp por um protocolo alternativo. O WhatsApp pode restringir, suspender ou banir números que usam esse tipo de acesso, a qualquer momento e sem aviso prévio.",
    "A Ruphus aplica boas práticas que reduzem o risco (envio gradualmente aquecido, ritmo entre mensagens, respeito a opt-out, limites diários), mas não controla e não pode garantir a continuidade do canal. Por depender de tecnologia de terceiros fora do nosso controle, a Ruphus não se responsabiliza por bloqueios, suspensões, banimentos ou instabilidade do WhatsApp, nem pela indisponibilidade temporária ou definitiva desta integração.",
  ],
  itens: [
    "Use um número dedicado ao negócio — nunca o seu número pessoal principal.",
    "Mantenha um canal alternativo visível no site (telefone ou e-mail).",
    "A agenda e o histórico ficam salvos aqui no painel, mesmo se o WhatsApp cair.",
    "Se o número for bloqueado, conecte outro número nesta tela — a agenda continua de pé.",
  ],
};
