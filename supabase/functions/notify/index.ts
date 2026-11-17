// Copie par mail d'une demande d'achat à l'adresse « mail_copie » du demandeur (envoi via Brevo)
// Secrets Supabase : BREVO_API_KEY, MAIL_FROM (adresse expéditeur validée dans Brevo)
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
const dfr = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { type, ids } = await req.json();
    if (type !== 'prestation') return json({ skipped: 'type ignoré' });
    const KEY = Deno.env.get('BREVO_API_KEY');
    const FROM = Deno.env.get('MAIL_FROM');
    if (!KEY || !FROM) return json({ skipped: 'BREVO_API_KEY ou MAIL_FROM manquant' });

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ error: 'Non connecté' }, 401);

    const { data: dem } = await sb.from('demandes').select('*, lignes(*)').in('id', (ids || []).map(Number)).eq('demandeur_id', user.id);
    const { data: profs } = await sb.from('profiles').select('id, nom, email, role, mail_copie');
    const P = (id: string | null) => (profs || []).find((p) => p.id === id);

    let sent = 0;
    for (const d of dem || []) {
      const auteur = P(d.demandeur_id);
      const dest = auteur?.mail_copie;
      if (!auteur || !dest) continue;
      const x = d.details || {};
      const num = PREFIX + d.id;
      const total = d.lignes.reduce((t: number, l: any) => t + l.qte * Number(l.pu), 0);
      const contact = [x.contact_prenom, x.contact_nom].filter(Boolean).join(' ') + (x.contact_email ? ' (' + x.contact_email + ')' : '');
      const infos = [
        ['Demandeur', auteur.nom], ['Fournisseur', d.fournisseur_nom], ['N° affaire', d.n_affaire], ['Agence', d.agence],
        ['Consultant', x.consultant], ['Contact fournisseur', contact.trim()],
        ['Période', x.date_debut ? `du ${dfr(x.date_debut)} au ${dfr(x.date_fin)} (${x.jours} jours)` : ''],
        ['Commentaire', d.commentaire]
      ].filter(([, v]) => v);
      const td = 'style="border:1px solid #ccc;padding:6px"';
      const html = `<div style="font:14px Arial;color:#222">
        <p>Bonjour,</p>
        <p>Pour information, ${esc(auteur.nom)} vient d’envoyer la demande d’achat <b>${num}</b> :</p>
        <table style="border-collapse:collapse;font:14px Arial">${infos.map(([k, v]) => `<tr><td ${td}><b>${esc(k)}</b></td><td ${td}>${esc(v)}</td></tr>`).join('')}</table>
        <p></p>
        <table style="border-collapse:collapse;font:14px Arial">
          <tr style="background:#eee"><th ${td} align="left">Libellé</th><th ${td}>Qté</th><th ${td}>PU HT</th><th ${td}>PT HT</th><th ${td}>Rubrique</th></tr>
          ${d.lignes.map((l: any) => `<tr><td ${td}>${esc(l.designation)}</td><td ${td} align="center">${l.qte}</td><td ${td} align="right">${eur(Number(l.pu))}</td><td ${td} align="right">${eur(l.qte * Number(l.pu))}</td><td ${td}>${esc(l.rubrique || '')}</td></tr>`).join('')}
          <tr><td ${td} colspan="3" align="right"><b>Montant total</b></td><td ${td} align="right"><b>${eur(total)}</b></td><td ${td}></td></tr>
        </table>
        <p>Ce mail est envoyé pour information, aucune action n’est nécessaire.</p></div>`;
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: FROM, name: 'NOVA Achats' }, to: [{ email: dest }], subject: `Demande d’achat ${num} – ${auteur.nom} – ${d.fournisseur_nom || ''}`, htmlContent: html })
      });
      if (!r.ok) return json({ error: 'Brevo : ' + (await r.text()) }, 500);
      sent++;
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
