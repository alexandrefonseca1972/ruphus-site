/** O que está no ar, para o rodapé do /admin: "v0.2.0 · a1b2c3d". */
export const VERSAO = `v${process.env.NEXT_PUBLIC_VERSAO ?? "0.0.0"}`;
export const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? "local";
export const ANO_INICIAL = 2026;
