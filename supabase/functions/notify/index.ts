// Notifications mail de la plateforme achats (envoi via Brevo)
// Secrets à définir dans Supabase : BREVO_API_KEY, MAIL_FROM (adresse expéditeur validée dans Brevo)
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://nova-achats.github.io/';
const PREFIX = 'DA-27-';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const KEY = Deno.env.get('BREVO_API_KEY');
    const FROM = Deno.env.get('MAIL_FROM');
    if (!KEY || !FROM) return json({ skipped: 'BREVO_API_KEY ou MAIL_FROM manquant' });

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ error: 'Non connecté' }, 401);

    const { type, ids } = await req.json();
    const { data: dem } = await sb.from('demandes').select('*, lignes(*)').in('id', (ids || []).map(Number));
    const { data: profs } = await sb.from('profiles').select('id, nom, email, role');
    if (!dem?.length || !profs) return json({ sent: 0 });
    const P = (id: string) => profs.find((p) => p.id === id) || { nom: '—', email: null };
    const admins = profs.filter((p) => p.role === 'admin' && p.email).map((p) => p.email as string);

    const table = (d: any) => `<table cellpadding="6" style="border-collapse:collapse;font:14px Arial">
      <tr style="background:#eee"><th align="left">Article</th><th>Qté</th></tr>
      ${d.lignes.map((l: any) => `<tr><td style="border-top:1px solid #ddd">${esc(l.designation)}</td><td align="center" style="border-top:1px solid #ddd">${l.qte}</td></tr>`).join('')}</table>`;
    const total = (d: any) => d.lignes.reduce((t: number, l: any) => t + l.qte * Number(l.pu), 0);
    const urg = (d: any) => (d.urgent ? '[URGENT] ' : '');
    const corps = (titre: string, texte: string, d?: any) => `<div style="font:14px Arial;color:#222">
      <h2 style="font-size:18px">${esc(titre)}</h2><p>${texte}</p>${d ? table(d) : ''}
      <p><a href="${SITE}" style="background:#C2410C;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ouvrir la plateforme</a></p></div>`;

    const mails: { to: string[]; subject: string; html: string }[] = [];
    const add = (to: (string | null)[], subject: string, html: string) => {
      const t = [...new Set(to.filter(Boolean) as string[])];
      if (t.length) mails.push({ to: t, subject, html });
    };

    for (const d of dem) {
      const num = PREFIX + d.id;
      const dem_ = P(d.demandeur_id);
      const n1 = d.n1_id ? P(d.n1_id) : null;
      if (type === 'panier') {
        add(admins, `${urg(d)}Nouvelle demande à trier – ${dem_.nom}`, corps(`Nouvelle demande de ${dem_.nom}`, `Agence ${esc(d.agence)}${d.commentaire ? ' · ' + esc(d.commentaire) : ''}. À trier (achat ou stock).`, d));
      } else if (type === 'soumise') {
        if (n1) add([n1.email], `${urg(d)}${num} à valider – ${dem_.nom}`, corps(`Demande d’achat ${num} à valider`, `${esc(dem_.nom)} · Agence ${esc(d.agence)} · ${eur(total(d))} HT.`, d));
        else add(admins, `${urg(d)}${num} à traiter`, corps(`Demande d’achat ${num}`, `${esc(dem_.nom)} · transmise directement.`, d));
      } else if (type === 'validee') {
        add([dem_.email], `${num} validée`, corps(`Ta demande ${num} est validée`, `Elle part en commande.`, d));
        add(admins, `${urg(d)}${num} validée – à saisir Everwin`, corps(`${num} validée par ${esc(n1?.nom || '—')}`, `${esc(dem_.nom)} · Agence ${esc(d.agence)} · ${eur(total(d))} HT. À saisir sur Everwin.`, d));
      } else if (type === 'refusee') {
        add([dem_.email], `${num} refusée`, corps(`Ta demande ${num} a été refusée`, `Rapproche-toi de ${esc(n1?.nom || 'ton N+1')}.`, d));
      } else if (type === 'preparee') {
        add([dem_.email], `Ton carton ${num} est prêt`, corps(`Ton carton est prêt`, `Quand tu le reçois, clique sur « Réception » dans tes Demandes.`, d));
      }
    }

    let sent = 0;
    for (const m of mails) {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: FROM, name: 'NOVA Achats' }, to: m.to.map((email) => ({ email })), subject: m.subject, htmlContent: m.html })
      });
      if (!r.ok) return json({ error: 'Brevo : ' + (await r.text()) }, 500);
      sent++;
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
