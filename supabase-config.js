// ضع بيانات مشروع Supabase هنا بعد إنشاء المشروع.
// المفتاح المسمى anon أو publishable آمن للاستخدام في الواجهة مع RLS.
window.SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
window.SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY';

if (window.supabase && !window.SUPABASE_URL.includes('YOUR-') && !window.SUPABASE_ANON_KEY.includes('YOUR_')) {
  window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}
