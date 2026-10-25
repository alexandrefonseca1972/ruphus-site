// Ponto de partida de processos do servidor: aqui sobem os jobs em background
// do runtime Node. (No runtime de borda — middleware etc. — não roda nada.)

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const lembretes = await import("@/lib/lembretes-whatsapp.server");
    // LEMBRETES_INTERVALO_MS aproxima os ciclos em teste; produção fica nos 10 min
    const intervalo = Number(process.env.LEMBRETES_INTERVALO_MS);
    lembretes.iniciarLembretesWhatsApp(Number.isFinite(intervalo) && intervalo >= 15_000 ? intervalo : undefined);
  }
}
