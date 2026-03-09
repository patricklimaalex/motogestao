import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import Stripe from "https://esm.sh/stripe@11.14.0"; // Versão v11 compatível com Deno

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
  // Config CORS for frontend browser invocation
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  try {
    const { empresa_id, price_id } = await req.json();
    const authHeader = req.headers.get('Authorization')!;

    // Validação Segura do Usuário Logado
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response("Não autorizado", { status: 401 });

    // Buscar Empresa bypassando RLS server-side usando Service Role Key 
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    
    // Check if user is in this empresa
    const { data: isInEmpresa } = await supabaseAdmin.from('empresa_membros').select('id').eq('empresa_id', empresa_id).eq('user_id', user.id).single();
    if (!isInEmpresa) return new Response("Você não pertence a esta empresa", { status: 403 });

    const { data: empresa } = await supabaseAdmin.from('empresas').select('*').eq('id', empresa_id).single();
    if (!empresa) return new Response("Empresa não encontrada", { status: 404 });

    let customerId = empresa.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { empresa_id },
        email: user.email 
      });
      customerId = customer.id;
      await supabaseAdmin.from('empresas').update({ stripe_customer_id: customerId }).eq('id', empresa_id);
    }

    // Header checks for origin
    let origin = req.headers.get("origin") || req.headers.get("referer") || "http://localhost:3000";
    if (origin.endsWith('/')) origin = origin.slice(0, -1); // remove trailing slash

    // Criar Sessão do Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: price_id, quantity: 1 }], // Minimo de 1 "moto virtual" ou licença base
      metadata: { empresa_id },
      success_url: `${origin}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?canceled=true`,
    });

    return new Response(JSON.stringify({ sessionId: session.id, url: session.url }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      },
    });
  } catch(error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
