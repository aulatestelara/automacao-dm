// =====================================================================
// CONFIGURACAO
//
// Troque os dois valores abaixo pelos do SEU projeto Supabase.
// Voce acha os dois em: Supabase > seu projeto > Settings > API
//
// Pode deixar esses dois valores publicos no site, sem medo. Quem tranca
// o banco e o RLS (as regras de acesso), nao essa chave. A chave que NUNCA
// pode aparecer aqui e a de service_role.
//
// ENQUANTO ESTIVER TESTANDO EM LOCALHOST: pode deixar como esta. O modo de
// teste local nao usa o Supabase pra nada.
// =====================================================================

window.CONFIG = {
  SUPABASE_URL: 'SEU_VALOR_AQUI',      // ex: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'SEU_VALOR_AQUI', // a chave "anon public"
}
