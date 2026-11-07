// O manifesto é o do painel e só existe em www: no subdomínio o pedido virava 404 no console
export const metadata = { manifest: null };

export default function AgendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
