/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Sprint 8: engine TOM internal API. Em dev o secret entra no bundle do
  // cliente — tradeoff aceito documentado em docs/PROJECT-WIZARD.md.
  readonly VITE_TOM_API_BASE?: string;
  readonly VITE_INTERNAL_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
