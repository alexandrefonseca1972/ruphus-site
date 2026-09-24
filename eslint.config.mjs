import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { usos, ordem, ...resto } = x` é como se tira campo de um objeto.
      // Sem isto, o jeito idiomático de descartar vira aviso, e o aviso ensina a
      // renomear para _usos — ruído em vez de informação.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Assets servidos como estão, não compilados: fx.js é chamado por <script>
    // inline dos sites gerados, que o eslint não lê — então tudo ali parece
    // função morta e parâmetro sem uso.
    "public/**",
  ]),
]);

export default eslintConfig;
