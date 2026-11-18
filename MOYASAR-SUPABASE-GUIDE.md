# ربط Moyasar مع Supabase لمتجر طفلي للألعاب

## الفكرة الأمنية

لا تضع مفتاح Moyasar السري داخل `index.html` أو `app.js` أو GitHub. يمكن وضع **publishable key** في نموذج Moyasar داخل المتصفح، أما المفتاح السري فيبقى داخل Supabase Edge Function Secrets. نموذج الدفع يرسل العميل إلى 3-D Secure عند الحاجة، ثم يعيد `payment_id` عبر `callback_url`. بعد ذلك تتحقق Edge Function من الدفع عبر Moyasar قبل اعتبار الطلب مدفوعًا.

Moyasar يستخدم الهللات، لذلك `89 ر.س` ترسل كـ `8900`، ويجب التحقق من `status` و`amount` و`currency` قبل تنفيذ الطلب.

## 1. تجهيز حساب Moyasar

1. افتح لوحة Moyasar وأنشئ حسابًا.
2. ابدأ بوضع Sandbox واستخدم مفاتيح الاختبار.
3. فعّل طرق الدفع المطلوبة: mada وApple Pay.
4. استخرج `publishable key` لاستخدامه في نموذج الدفع.
5. احتفظ بـ `secret key` لاستخدامه في Supabase فقط.
6. سجّل نطاق GitHub Pages في إعدادات Apple Pay داخل Moyasar، مثل:

```text
https://YOUR-USERNAME.github.io
```

استخدم الموقع المنشور عبر HTTPS، وليس `localhost`، عند اختبار Apple Pay الحقيقي.

## 2. تعديل قاعدة بيانات الطلبات

أضف أعمدة الدفع إلى جدول `orders`:

```sql
alter table public.orders
  add column if not exists payment_id text unique,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_status text;

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('awaiting_payment','pending','paid','confirmed','shipped','completed','cancelled','failed'));
```

في التدفق الجديد، ينشأ الطلب أولًا بحالة `awaiting_payment`. لا تخصم المخزون ولا تعرضه كإيراد قبل تأكيد الدفع.

## 3. إضافة مفاتيح Edge Function

من Supabase:

```text
Project Settings → Edge Functions → Secrets
```

أضف:

```text
MOYASAR_SECRET_KEY=sk_test_...
DB_SERVICE_ROLE_KEY=...
```

لا تضع أيًا منهما في GitHub أو داخل JavaScript المتصفح. مفتاح `DB_SERVICE_ROLE_KEY` يتجاوز RLS ويُستخدم داخل Edge Function فقط.

## 4. إنشاء Edge Function للتحقق

أنشئ ملفًا:

```text
supabase/functions/verify-moyasar-payment/index.ts
```

واستخدم الهيكل التالي:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const { payment_id, order_id } = await req.json()
    if (!payment_id || !order_id) {
      return Response.json({ error: 'payment_id and order_id are required' }, { status: 400, headers: cors })
    }

    const moyasarSecret = Deno.env.get('MOYASAR_SECRET_KEY')
    const serviceRoleKey = Deno.env.get('DB_SERVICE_ROLE_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    if (!moyasarSecret || !serviceRoleKey || !supabaseUrl) {
      return Response.json({ error: 'Payment service is not configured' }, { status: 500, headers: cors })
    }

    const auth = btoa(`${moyasarSecret}:`)
    const paymentResponse = await fetch(`https://api.moyasar.com/v1/payments/${payment_id}`, {
      headers: { Authorization: `Basic ${auth}` }
    })

    const payment = await paymentResponse.json()
    if (!paymentResponse.ok) {
      return Response.json({ error: 'Could not fetch payment' }, { status: 502, headers: cors })
    }

    const db = createClient(supabaseUrl, serviceRoleKey)
    const { data: order, error: orderError } = await db
      .from('orders')
      .select('id,total,status')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return Response.json({ error: 'Order not found' }, { status: 404, headers: cors })
    }

    const expectedAmount = Math.round(Number(order.total) * 100)
    const validAmount = payment.amount === expectedAmount
    const validCurrency = payment.currency === 'SAR'
    const paid = payment.status === 'paid'

    if (!paid || !validAmount || !validCurrency) {
      await db.from('orders').update({
        payment_id,
        payment_status: payment.status || 'unknown',
        status: 'failed'
      }).eq('id', order_id)

      return Response.json({ ok: false, status: payment.status }, { status: 400, headers: cors })
    }

    const { error: updateError } = await db.from('orders').update({
      payment_id,
      payment_status: 'paid',
      status: 'paid',
      paid_at: new Date().toISOString()
    }).eq('id', order_id).in('status', ['awaiting_payment', 'pending'])

    if (updateError) {
      return Response.json({ error: 'Could not update order' }, { status: 500, headers: cors })
    }

    return Response.json({ ok: true, order_id, payment_id }, { headers: cors })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500, headers: cors })
  }
})
```

ثم انشرها:

```bash
supabase functions deploy verify-moyasar-payment
```

أو استخدم محرر Edge Functions في لوحة Supabase إذا كنت لا تستخدم CLI.

## 5. وضع نموذج Moyasar في صفحة الدفع

أضف مكتبة Moyasar الرسمية باستخدام رابط الإصدار الحالي من وثائق Moyasar، ثم أضف:

```html
<div class="mysr-form"></div>
```

بعد تجهيز الطلب:

```js
const amountInHalalas = Math.round(total * 100)

Moyasar.init({
  element: '.mysr-form',
  amount: amountInHalalas,
  currency: 'SAR',
  description: `Tafli order ${orderId}`,
  publishable_api_key: 'pk_test_REPLACE_ME',
  callback_url: `${location.origin}/payment-result.html?order_id=${orderId}`,
  supported_networks: ['visa', 'mastercard', 'mada', 'unionpay'],
  methods: ['creditcard'],
  on_completed: async function (payment) {
    await fetch(`${SUPABASE_URL}/functions/v1/verify-moyasar-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ payment_id: payment.id, order_id: orderId })
    })
  }
})
```

بالنسبة لـ Apple Pay، استخدم إعداد Moyasar التالي بدل `methods: ['creditcard']`:

```js
methods: ['applepay'],
apple_pay: {
  country: 'SA',
  label: 'طفلي للألعاب',
  validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate'
}
```

يمكنك عرض خيارين منفصلين أو استخدام إعداد النموذج الذي يسمح بالطرق المدعومة في حسابك. Apple Pay يظهر فقط على الأجهزة والمتصفحات المدعومة وبعد تفعيل النطاق في Moyasar.

## 6. صفحة نتيجة الدفع

أنشئ `payment-result.html`، واقرأ `id` و`order_id` من الرابط، ثم اطلب Edge Function للتحقق مرة أخرى. لا تعتبر وجود `status=paid` في الرابط دليلًا كافيًا وحده.

```js
const params = new URLSearchParams(location.search)
const paymentId = params.get('id')
const orderId = params.get('order_id')

const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-moyasar-payment`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
  body: JSON.stringify({ payment_id: paymentId, order_id: orderId })
})

const result = await response.json()
document.querySelector('#result').textContent = result.ok
  ? 'تم الدفع وتأكيد الطلب بنجاح'
  : 'لم يتم تأكيد الدفع، تواصل مع الدعم إذا تم الخصم من بطاقتك'
```

## 7. المخزون والإيرادات

غيّر لوحة المدير لتعرض الإيراد من الطلبات التي حالتها `paid` أو `completed` فقط. لا تعتمد على `pending` أو `awaiting_payment` كإيراد.

كذلك لا تستخدم trigger يخصم المخزون لحظة إدخال `order_items` إذا كنت تنشئ العناصر قبل الدفع؛ سيُخصم المخزون حتى عند فشل الدفع. الأفضل أحد الخيارين:

1. إنشاء `order_items` بعد نجاح التحقق من الدفع.
2. أو تنفيذ خصم المخزون داخل دالة SQL آمنة عند انتقال الطلب إلى `paid`، مع منع الخصم المكرر.

## 8. الاختبار قبل التشغيل الحقيقي

1. استخدم مفاتيح Sandbox.
2. اختبر دفع مدى وبطاقة اختبار من وثائق Moyasar.
3. اختبر فشل الدفع ورفض 3-D Secure.
4. أغلق المتصفح بعد الدفع وتأكد أن التحقق من `payment_id` ما زال يعيد النتيجة الصحيحة.
5. جرّب إرسال نفس `payment_id` مرتين وتأكد أن الطلب لا يتحول أو يخصم المخزون مرتين.
6. تحقق أن السعر في قاعدة البيانات هو السعر المرجعي، وليس السعر القادم من المتصفح.
7. بعد نجاح كل الاختبارات، بدّل المفاتيح إلى Live فقط من Secrets وMoyasar Dashboard.

## مصادر رسمية

- [Moyasar Developer Documentation](https://docs.moyasar.com/)
- [Moyasar Card Payments Basic Integration](https://docs.moyasar.com/guides/card-payments/basic-integration)
- [Moyasar Apple Pay Basic Integration](https://docs.moyasar.com/guides/apple-pay/basic-integration)
- [Moyasar Create Payment API](https://docs.moyasar.com/api/payments/01-create-payment)
- [Moyasar Fetch Payment API](https://docs.moyasar.com/api/payments/02-fetch-payment)
- [Supabase Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
