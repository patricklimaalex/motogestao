import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import Stripe from "https://esm.sh/stripe@11.14.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2022-11-15",
    httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
    // Config CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
    }

    try {
        const { action, empresa_id, placa, moto_id } = await req.json();
        const authHeader = req.headers.get('Authorization')!;

        const supabaseServer = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // Poder root admin
        );

        // 1. Verificar quem é o user chamando isso (Segurança)
        const supabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: authErr } = await supabaseClient.auth.getUser();
        if (authErr || !user) return new Response("Não autorizado", { status: 401 });

        // Checar role
        const { data: membro } = await supabaseServer.from('empresa_membros').select('role').eq('empresa_id', empresa_id).eq('user_id', user.id).single();
        if (!membro || (membro.role !== 'admin' && membro.role !== 'owner')) {
            return new Response("Permissão negada. Apenas admin e owner podem criar motos via billing.", { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
        }

        if (action === 'add') {
            // Insere a moto ativa
            await supabaseServer.from('motos').insert({ empresa_id, placa, active: true }).throwOnError();
        } else if (action === 'remove' || action === 'deactivate') {
            await supabaseServer.from('motos').update({ active: false }).eq('id', moto_id).throwOnError();
        }

        // 2. RECALCULA O NÚMERO DE MOTOS ATIVAS DESTA EMPRESA
        const { count } = await supabaseServer.from('motos')
            .select('id', { count: 'exact', head: true })
            .eq('empresa_id', empresa_id)
            .eq('active', true);

        const finalCount = count || 0;

        // 3. RECUPERA A SUBSCRIPTION DO BANCO
        const { data: sub } = await supabaseServer.from('subscriptions')
            .select('*').eq('empresa_id', empresa_id).single();

        if (sub && (sub.status === 'active' || sub.status === 'trialing')) { // Tem assinatura ativa, atualiza o qty
            const subscriptionItem = await stripe.subscriptions.retrieve(sub.id);
            const itemId = subscriptionItem.items.data[0].id; // Pega o ID do item da fatura

            // O Stripe cobra prorated values automaticamennte baseados neste update
            await stripe.subscriptionItems.update(itemId, {
                quantity: finalCount,
                proration_behavior: 'always_invoice' // Cobra/Credita proporção na hora
            });

            // Atualiza cache quantity interno
            await supabaseServer.from('subscriptions').update({ quantity: finalCount }).eq('id', sub.id);
        }

        return new Response(JSON.stringify({ success: true, newQuantity: finalCount }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
});
