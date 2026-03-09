import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import Stripe from "https://esm.sh/stripe@11.14.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2022-11-15",
    httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
    const signature = req.headers.get("Stripe-Signature");
    const body = await req.text();
    let event;

    try {
        // Valida criptografia de webhook - Ninguem forja webhooks fora o stripe
        event = stripe.webhooks.constructEvent(body, signature!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!);
    } catch (err) {
        return new Response(`Erro de Assinatura: ${err.message}`, { status: 400 });
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Idempotência
    const { data: existingEvent } = await supabaseAdmin.from('billing_events').select('id').eq('id', event.id).single();
    if (existingEvent) return new Response("Evento já processado", { status: 200 });
    await supabaseAdmin.from('billing_events').insert({ id: event.id, type: event.type });

    const obj = event.data.object as any;

    // Lógica principal de roteamento
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const { id: sub_id, customer, status, items, current_period_end } = obj;

        const { data: empresa } = await supabaseAdmin.from('empresas').select('id').eq('stripe_customer_id', customer).single();

        if (empresa) {
            // Usa UPSERT (Insert ou Update) para refletir 1:1 pro banco
            await supabaseAdmin.from('subscriptions').upsert({
                id: sub_id,
                empresa_id: empresa.id,
                stripe_customer_id: customer,
                status: status, // "active", "past_due", "canceled"
                price_id: items.data[0].price.id,
                quantity: items.data[0].quantity,
                current_period_end: new Date(current_period_end * 1000).toISOString()
            });
        }
    }

    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
