// إعدادات Supabase العامة لمتجر طفلي للألعاب.
// هذا المفتاح publishable/anon مخصص للواجهة مع تفعيل RLS في قاعدة البيانات.
window.SUPABASE_URL = 'https://zrfotqumadxengrrwtqv.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_sw7jOI3_ICrbg1IhEvoeWA_hqMghhfQ';

if (window.supabase && !window.SUPABASE_URL.includes('YOUR-') && !window.SUPABASE_ANON_KEY.includes('YOUR_')) {
  window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}
