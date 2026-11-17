/* Plateforme achats — bêta */
const C = window.CONFIG;
document.title = C.TITRE || 'Achats';
if (C.ICONE) { const ic = document.createElement('link'); ic.rel = 'icon'; ic.href = C.ICONE; document.head.appendChild(ic); }
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const NEED_PWD = /type=(invite|recovery)/.test(location.hash);

const S = { me: null, profils: [], agences: [], fourn: [], produits: [], demandes: [], screen: null, cat: 'Tout', search: '', tailles: {}, triStock: {}, adminTab: 'users', edit: null };
let cart = {};
try { cart = JSON.parse(localStorage.getItem('panier') || '{}'); } catch (e) { cart = {}; }
const saveCart = () => { try { localStorage.setItem('panier', JSON.stringify(cart)); } catch (e) {} };

const NAV = {
  technicien: ['catalogue', 'panier', 'demandes'],
  n1: ['validation', 'demandes', 'stats', 'catalogue', 'panier'],
  assistance: ['prestation', 'catalogue', 'panier', 'demandes', 'stats'],
  admin: ['tri', 'besoins', 'traiter', 'demandes', 'stats', 'catalogue', 'panier', 'prestation', 'admin']
};
const LABEL = { catalogue: 'Catalogue', panier: 'Panier', prestation: 'Demande d’achat', demandes: 'Demandes', validation: 'À valider', tri: 'À trier', besoins: 'Besoins', traiter: 'À saisir Everwin', stats: 'Stats fournisseurs', admin: 'Administration' };
const STATUT = { tri: ['Chez le resp. achats', 'b-wait'], besoin: ['En préparation (stock)', 'b-wait'], preparee: ['Prête · à réceptionner', 'b-ok'], attente: ['En attente N+1', 'b-wait'], validee: ['Validée · à saisir Everwin', 'b-ok'], everwin: ['BC saisi Everwin', 'b-done'], refusee: ['Refusée', 'b-ko'], recue: ['Reçue', 'b-done'] };
const statutDe = (d) => (['validee', 'everwin', 'preparee'].includes(d.statut) && d.lignes.some((l) => l.qte_recue > 0)) ? ['Reçue partiellement', 'b-ok'] : STATUT[d.statut];
const recevable = (d) => d.type !== 'prestation' && ['validee', 'everwin', 'preparee'].includes(d.statut);
const estBesoin = (d) => d.statut === 'besoin' || (d.lignes.length > 0 && d.lignes.every((l) => l.prepare));
const SPL = `<tr class="spl"><td><input name="l_designation" required placeholder="Désignation (comme sur le devis)"></td><td style="width:90px"><input name="l_qte" type="number" min="1" value="1" required></td><td style="width:130px"><input name="l_pu" inputmode="decimal" required placeholder="0,00"></td><td style="width:40px"><button type="button" class="link" style="color:#B42318" data-a="speMoins" aria-label="Supprimer la ligne">✕</button></td></tr>`;
const num = (v) => parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.'));
function speTotal() {
  const f = document.querySelector('form[data-form=speciale]'); if (!f) return;
  let t = num(f.port.value) || 0;
  f.querySelectorAll('tr.spl').forEach((r) => { t += (num(r.querySelector('[name=l_qte]').value) || 0) * (num(r.querySelector('[name=l_pu]').value) || 0); });
  $('#spTot').textContent = eur(t);
}
document.addEventListener('input', (e) => { if (e.target.closest('form[data-form=speciale]')) speTotal(); });
const DEVIS = (d) => (d.devis_path ? `<button class="btn" data-a="devis" data-k="${d.id}">Devis</button>` : '');
const URG = (d) => (d.urgent ? '<span class="badge b-ko">URGENT</span> ' : '');
function prochainEnvoi() {
  const j = Number(S.me.delai_jours) || 0;
  const der = (S.envois || []).find((e) => e.user_id === S.me.id && !e.urgent);
  if (!j || !der) return null;
  const t = new Date(new Date(der.created_at).getTime() + j * 864e5);
  return t > new Date() ? t : null;
}
const ROLE = { technicien: 'Technicien', n1: 'N+1', admin: 'Admin', assistance: 'Assistance technique' };

/* ---------- utilitaires ---------- */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dfr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const daNum = (id) => C.DA_PREFIX + id;
const nomDe = (id) => (S.profils.find((p) => p.id === id) || {}).nom || '—';
const fournD = (d) => (d.fournisseur_id && S.fourn.some((f) => f.id === d.fournisseur_id)) ? fournDe(d.fournisseur_id) : (d.fournisseur_nom || '—');
const fournDe = (id) => (S.fourn.find((f) => f.id === id) || {}).nom || '—';
const prodDe = (id) => S.produits.find((p) => p.id === id);
const totalDA = (d) => d.lignes.reduce((t, l) => t + l.qte * Number(l.pu), 0);
const opts = (list, sel) => list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('');

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = 'toast'; }, 5000);
}
function fail(e) { console.error(e); toast((e && e.message) || String(e), true); }
async function fnErr(e) { try { const j = await e.context.json(); return new Error(j.error || e.message); } catch (_) { return e; } }
function notifier(body) {
  if (!C.NOTIFS) return;
  sb.functions.invoke('notify', { body }).then(async ({ error }) => {
    if (error) toast('Enregistré, mais le mail n’est pas parti : ' + (await fnErr(error)).message, true);
  });
}

/* ---------- données ---------- */
async function loadAll() {
  const r = await Promise.all([
    sb.from('profiles').select('*').order('nom'),
    sb.from('fournisseurs').select('*').order('nom'),
    sb.from('agences').select('nom').order('nom'),
    sb.from('produits').select('*').order('nom'),
    sb.from('demandes').select('*, lignes(*)').order('id', { ascending: false }),
    sb.from('envois').select('*').order('id', { ascending: false })
  ]);
  r.forEach((x) => { if (x.error) throw x.error; });
  r.forEach((x) => { if (x.error) throw x.error; });
  S.agences = r[2].data.map((a) => a.nom);
  r.splice(2, 1);
  [S.profils, S.fourn, S.produits, S.demandes, S.envois] = r.map((x) => x.data);
  S.me = S.profils.find((p) => p.id === S.me.id) || S.me;
}

/* ---------- démarrage / connexion ---------- */
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && NEED_PWD) return renderPwd();
  if (!session) return renderLogin();
  await boot(session.user);
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') renderPwd(); });

async function boot(user) {
  const { data: me } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!me) {
    $('#app').innerHTML = `<div class="login"><div class="card"><h1>Compte non configuré</h1><p class="mut">Ton compte existe mais n’a pas de profil. Contacte l’admin.</p><button class="btn" data-a="logout">Déconnexion</button></div></div>`;
    return;
  }
  S.me = me;
  await loadAll();
  S.screen = NAV[me.role][0];
  render();
  let vu = false, off = false;
  try { vu = sessionStorage.getItem('tuto_vu') === me.id; off = localStorage.getItem('tuto_off_' + me.id) === '1'; } catch (e) {}
  if (!vu && !off) openTuto();
}

function renderLogin() {
  $('#app').innerHTML = `<div class="login"><form class="card" data-form="login">
    <img src="${C.LOGO}" alt="${esc(C.NOM_SOCIETE)}" onerror="this.remove()">
    <div><h1>Connexion</h1><p class="mut" style="margin:0">Catalogue interne et demandes d'achat</p></div>
    <label>Email<input type="email" name="email" required autocomplete="username"></label>
    <label>Mot de passe<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn primary" type="submit">Se connecter</button>
    ${C.MAILS ? '<button class="link" type="button" data-a="forgot">Mot de passe oublié ?</button>' : ''}
  </form></div>`;
}
function renderPwd() {
  $('#app').innerHTML = `<div class="login"><form class="card" data-form="pwd">
    <img src="${C.LOGO}" alt="${esc(C.NOM_SOCIETE)}" onerror="this.remove()">
    <div><h1>Choisis ton mot de passe</h1><p class="mut" style="margin:0">8 caractères minimum.</p></div>
    <label>Mot de passe<input type="password" name="p1" required minlength="8" autocomplete="new-password"></label>
    <label>Confirmation<input type="password" name="p2" required minlength="8" autocomplete="new-password"></label>
    <button class="btn primary" type="submit">Valider</button>
  </form></div>`;
}

/* ---------- rendu ---------- */
function badge(k) {
  if (k === 'panier') return Object.values(cart).reduce((a, b) => a + b, 0);
  if (k === 'validation') return S.demandes.filter((d) => d.n1_id === S.me.id && d.statut === 'attente').length;
  if (k === 'tri') return S.demandes.filter((d) => d.statut === 'tri').length;
  if (k === 'besoins') return S.demandes.filter((d) => d.statut === 'besoin').length;
  if (k === 'traiter') return S.demandes.filter((d) => d.statut === 'validee').length;
  return 0;
}
function render() {
  const nav = NAV[S.me.role].map((k) => {
    const n = badge(k);
    return `<button class="nav ${S.screen === k ? 'on' : ''}" data-a="go" data-k="${k}">${LABEL[k]}${n ? `<span class="pill">${n}</span>` : ''}</button>`;
  }).join('');
  $('#app').innerHTML = `<header class="top">
      <div class="brand"><img src="${C.LOGO_BLANC}" alt="${esc(C.NOM_SOCIETE)}" style="height:34px;display:block"></div>
      <input type="search" id="q" class="topsearch" placeholder="Rechercher un article, une référence, un fournisseur…" value="${esc(S.search)}" aria-label="Rechercher dans le catalogue">
      <div class="who">${esc(S.me.nom)} <span>· ${ROLE[S.me.role]}</span><button class="link light" data-a="tuto">Tuto</button><button class="link light" data-a="logout">Déconnexion</button></div>
      <nav aria-label="Navigation">${nav}</nav>
    </header><main class="wrap">${VIEWS[S.screen]()}</main>`;
}

const VIEWS = {
  catalogue() {
    const actifs = S.produits.filter((p) => p.actif);
    const cats = ['Tout', ...C.CATEGORIES.filter((c) => actifs.some((p) => p.categorie === c))];
    return `<div class="cols">
      <aside class="side"><h2 class="lbl" style="margin-bottom:8px">Catégories</h2>${cats.map((c) => `<button class="catb ${S.cat === c ? 'on' : ''}" data-a="cat" data-k="${esc(c)}"><span>${esc(c)}</span><span>${c === 'Tout' ? actifs.length : actifs.filter((p) => p.categorie === c).length}</span></button>`).join('')}</aside>
      <section class="grow"><div class="bar"><h1>${S.cat === 'Tout' ? 'Catalogue' : esc(S.cat)}</h1>${S.me.n1_id ? '<button class="btn" data-a="go" data-k="speciale">Demande spéciale (avec devis)</button>' : ''}</div>
      <div id="grid" class="grid">${gridHtml()}</div></section></div>`;
  },

  panier() {
    const keys = Object.keys(cart).filter((k) => { const p = prodDe(+k.split('|')[0]); return p && p.actif; });
    if (!keys.length) return `<h1>Panier</h1><div class="card empty"><p>Ton panier est vide.</p><button class="btn primary" data-a="go" data-k="catalogue">Parcourir le catalogue</button></div>`;
    const groups = {};
    keys.forEach((k) => { const p = prodDe(+k.split('|')[0]); (groups[p.fournisseur_id] = groups[p.fournisseur_id] || []).push(k); });
    let total = 0;
    const blocs = Object.entries(groups).map(([f, ks]) => {
      let st = 0;
      const rows = ks.map((k) => {
        const [id, t] = k.split('|'); const p = prodDe(+id); const q = cart[k];
        st += p.prix * q;
        return `<tr><td>${esc(p.nom)}${t ? ' — T ' + esc(t) : ''}</td>
          <td><div class="step sm"><button data-a="qty" data-k="${esc(k)}" data-d="-1" aria-label="Retirer un">−</button><b>${q}</b><button data-a="qty" data-k="${esc(k)}" data-d="1" aria-label="Ajouter un">+</button></div></td>
          <td class="nw">${eur(p.prix)}</td><td class="nw"><b>${eur(p.prix * q)}</b></td>
          <td><button class="link" data-a="qty" data-k="${esc(k)}" data-d="-9999">Retirer</button></td></tr>`;
      }).join('');
      total += st;
      return `<section class="card"><div class="gh"><div><span class="lbl">Demande d'achat · fournisseur</span><b>${esc(fournDe(+f))}</b></div><b>${eur(st)} HT</b></div>
        <div class="tw"><table class="tbl" style="min-width:560px"><thead><tr><th>Désignation</th><th>Quantité</th><th>PU HT</th><th>Total HT</th><th><span class="sr">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('');
    const n1 = S.me.n1_id ? nomDe(S.me.n1_id) : 'Aucun — contacte l’admin';
    return `<div><h1>Panier</h1><p class="mut" style="margin:0">Une demande est créée par fournisseur, puis envoyée au responsable achats.</p></div>
      <div class="cols"><div class="grow stack">${blocs}</div>
      <form class="card side2 stack" data-form="envoyer"><h2>Récapitulatif</h2>
        <div class="row"><span class="mut">Demandes d'achat</span><b>${Object.keys(groups).length}</b></div>
        <div class="row big"><span>Total HT</span><b>${eur(total)}</b></div>
        <label>Agence<select name="agence">${opts(S.agences, S.me.agence)}</select></label>
        <label>Commentaire<textarea name="commentaire" rows="3" placeholder="Ex. réassort chantier, dotation EPI…"></textarea></label>
        <div class="row"><span class="mut">Valideur</span><b>${esc(n1)}</b></div>
        ${S.me.delai_jours ? `<p class="mut" style="margin:0;font-size:13px">Tu peux envoyer ton panier une fois tous les ${S.me.delai_jours} jours.${prochainEnvoi() ? ` <b style="color:#B42318">Prochain envoi possible le ${prochainEnvoi().toLocaleDateString('fr-FR')} à ${prochainEnvoi().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.</b>` : ''}</p>` : ''}
        <label style="flex-direction:row;align-items:center;gap:8px;font-weight:600;color:#B42318"><input type="checkbox" name="urgent" style="width:18px;height:18px"> Besoin urgent</label>
        <button class="btn primary" type="submit">Envoyer la demande</button>
      </form></div>`;
  },

  demandes() {
    if (!S.demandes.length) return `<h1>Demandes d'achat</h1><div class="card empty"><p>Aucune demande pour l’instant.</p></div>`;
    return `<h1>Demandes d'achat</h1><div class="card tw"><table class="tbl" style="min-width:920px">
      <thead><tr><th>N°</th><th>Date</th><th>Demandeur</th><th>Agence</th><th>Fournisseur</th><th>Montant HT</th><th>Statut</th><th>DA</th></tr></thead><tbody>
      ${S.demandes.map((d) => `<tr><td class="mono nw">${URG(d)}${esc(daNum(d.id))}</td><td class="nw">${dfr(d.created_at)}</td><td>${esc(nomDe(d.demandeur_id))}</td><td>${esc(d.agence)}</td><td>${esc(fournD(d))}</td><td class="nw"><b>${eur(totalDA(d))}</b></td><td><span class="badge ${statutDe(d)[1]}">${statutDe(d)[0]}</span></td><td class="nw"><button class="btn" data-a="doc" data-k="${d.id}">Voir</button>${d.devis_path ? ` <button class="btn" data-a="devis" data-k="${d.id}">Devis</button>` : ''}${recevable(d) && (d.demandeur_id === S.me.id || S.me.role === 'admin') ? `<button class="btn" style="margin-left:6px" data-a="reception" data-k="${d.id}">Réception</button>` : ''}${S.me.role === 'admin' ? `<button class="link" style="color:#B42318;margin-left:6px" data-a="delDA" data-k="${d.id}">Supprimer</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  },

  validation() {
    const list = S.demandes.filter((d) => d.n1_id === S.me.id && d.statut === 'attente');
    const head = `<div><h1>Demandes à valider</h1><p class="mut" style="margin:0">Une fois validée, la demande part chez le responsable achats pour saisie du bon de commande sur Everwin.</p></div>`;
    if (!list.length) return head + `<div class="card empty"><p>Rien à valider pour le moment.</p></div>`;
    return head + list.map((d) => `<section class="card">
      <div class="gh"><div><span class="mono mut">${URG(d)}${esc(daNum(d.id))} · ${dfr(d.created_at)}</span><b style="font-size:17px">${esc(fournD(d))}</b><span class="mut">Demandé par ${esc(nomDe(d.demandeur_id))} · Agence ${esc(d.agence)}${d.commentaire ? ' · ' + esc(d.commentaire) : ''}</span></div><b style="font-size:20px">${eur(totalDA(d))}</b></div>
      <div class="tw"><table class="tbl" style="min-width:480px"><thead><tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>Total HT</th></tr></thead><tbody>
      ${d.lignes.map((l) => `<tr><td>${esc(l.designation)}</td><td>${l.qte}</td><td class="nw">${eur(l.pu)}</td><td class="nw"><b>${eur(l.qte * l.pu)}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="acts"><span style="margin-right:auto;display:flex;gap:8px"><button class="btn" data-a="doc" data-k="${d.id}">Voir la DA</button>${DEVIS(d)}</span><button class="btn ko" data-a="decide" data-k="${d.id}" data-d="0">Refuser</button><button class="btn ok" data-a="decide" data-k="${d.id}" data-d="1">Valider</button></div>
    </section>`).join('');
  },

  tri() {
    const list = S.demandes.filter((d) => d.statut === 'tri');
    const head = `<div><h1>Demandes à trier</h1><p class="mut" style="margin:0">Pour chaque article : <b>Achat</b> = part dans la DA chez le N+1, <b>Stock</b> = tu l’as en stock général, ça va dans la fiche besoin de la personne.</p></div>`;
    if (!list.length) return head + `<div class="card empty"><p>Rien à trier.</p></div>`;
    return head + list.map((d) => `<section class="card">
      <div class="gh"><div><span class="mono mut">${URG(d)}${esc(daNum(d.id))} · ${dfr(d.created_at)}</span><b style="font-size:17px">${esc(fournD(d))}</b><span class="mut">${esc(nomDe(d.demandeur_id))} · Agence ${esc(d.agence)} · N+1 ${esc(nomDe(d.n1_id))}${d.commentaire ? ' · ' + esc(d.commentaire) : ''}</span></div><b style="font-size:20px">${eur(totalDA(d))}</b></div>
      <div class="tw"><table class="tbl" style="min-width:560px"><thead><tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>Total HT</th><th>Où ?</th></tr></thead><tbody>
      ${d.lignes.map((l) => { const st = !!S.triStock[l.id]; return `<tr><td>${esc(l.designation)}${d.type === 'speciale' && d.fournisseur_id && l.designation !== 'Frais de port' ? ` <button class="link" style="font-size:12px" data-a="auCatalogue" data-k="${l.id}">+ catalogue</button>` : ''}</td><td>${l.qte}</td><td class="nw">${eur(l.pu)}</td><td class="nw"><b>${eur(l.qte * l.pu)}</b></td><td class="nw"><button class="btn ${st ? '' : 'primary'}" data-a="triLigne" data-k="${l.id}" data-d="0">Achat</button> <button class="btn ${st ? 'primary' : ''}" data-a="triLigne" data-k="${l.id}" data-d="1">Stock</button></td></tr>`; }).join('')}</tbody></table></div>
      <div class="acts"><span style="margin-right:auto;display:flex;gap:8px"><button class="btn" data-a="doc" data-k="${d.id}">Voir</button>${DEVIS(d)}</span><button class="btn primary" data-a="trier" data-k="${d.id}">Valider le tri</button></div>
    </section>`).join('');
  },

  besoins() {
    const list = S.demandes.filter((d) => d.statut === 'besoin');
    const prets = S.demandes.filter((d) => d.statut === 'preparee');
    const head = `<div><h1>Besoins à préparer</h1><p class="mut" style="margin:0">Coche au fur et à mesure que tu remplis le carton. Quand tout est coché, c’est déduit du stock général et le demandeur peut réceptionner.</p></div>`;
    const cartes = list.length ? list.map((d) => `<section class="card">
      <div class="gh"><div><span class="mono mut">${URG(d)}${esc(daNum(d.id))} · ${dfr(d.created_at)}</span><b style="font-size:17px">${esc(nomDe(d.demandeur_id))} · Agence ${esc(d.agence)}</b><span class="mut">${d.lignes.filter((l) => l.prepare).length} / ${d.lignes.length} articles dans le carton${d.commentaire ? ' · ' + esc(d.commentaire) : ''}</span></div><button class="btn" data-a="doc" data-k="${d.id}">Fiche</button></div>
      <div class="tw"><table class="tbl" style="min-width:420px"><thead><tr><th style="width:60px">Carton</th><th>Désignation</th><th>Qté</th></tr></thead><tbody>
      ${d.lignes.map((l) => `<tr style="${l.prepare ? 'opacity:.55' : ''}"><td><input type="checkbox" style="width:20px;height:20px" data-a="cocher" data-k="${l.id}" data-d="${l.prepare ? 0 : 1}" ${l.prepare ? 'checked' : ''} aria-label="Dans le carton"></td><td>${l.prepare ? `<s>${esc(l.designation)}</s>` : esc(l.designation)}${(prodDe(l.produit_id) || {}).ref ? `<br><span class="ref">${esc(prodDe(l.produit_id).ref)}</span>` : ''}</td><td><b>${l.qte}</b></td></tr>`).join('')}</tbody></table></div>
    </section>`).join('') : '<div class="card empty"><p>Aucun besoin à préparer.</p></div>';
    return head + cartes + `<div style="margin-top:12px"><h1>Cartons prêts · en attente de réception</h1></div>` +
      (prets.length ? `<div class="card tw"><table class="tbl" style="min-width:560px"><thead><tr><th>N°</th><th>Demandeur</th><th>Agence</th><th>Préparé le</th><th></th></tr></thead><tbody>${prets.map((d) => `<tr><td class="mono">${esc(daNum(d.id))}</td><td>${esc(nomDe(d.demandeur_id))}</td><td>${esc(d.agence)}</td><td>${dfr(d.valide_le)}</td><td class="nw"><button class="btn" data-a="doc" data-k="${d.id}">Voir</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty"><p>Aucun carton en attente.</p></div>');
  },

  traiter() {
    const carte = (d, boutons) => `<section class="card pad" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:14px">
      <div style="display:flex;flex-direction:column;gap:4px"><span class="mono mut">${URG(d)}${esc(daNum(d.id))} · ${dfr(d.created_at)}</span><b style="font-size:17px">${esc(fournD(d))} · ${eur(totalDA(d))} HT</b><span class="mut">${esc(nomDe(d.demandeur_id))} · Agence ${esc(d.agence)} · ${d.n1_id ? 'validée par ' + esc(nomDe(d.n1_id)) + ' le ' + dfr(d.valide_le) : 'transmise directement le ' + dfr(d.valide_le)}${d.lignes.some((l) => l.qte_recue > 0) ? ' · <b>reçue partiellement</b>' : ''}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px"><button class="btn" data-a="doc" data-k="${d.id}">Voir la DA</button>${DEVIS(d)}${boutons}</div>
    </section>`;
    const aSaisir = S.demandes.filter((d) => d.statut === 'validee');
    const aRecevoir = S.demandes.filter((d) => d.statut === 'everwin' && recevable(d));
    return `<div><h1>DA validées à saisir sur Everwin</h1><p class="mut" style="margin:0">Ouvre la DA, saisis le bon de commande sur Everwin, puis marque-la comme saisie.</p></div>
      ${aSaisir.length ? aSaisir.map((d) => carte(d, `<button class="btn primary" data-a="everwin" data-k="${d.id}">BC saisi sur Everwin</button>`)).join('') : '<div class="card empty"><p>Tout est saisi.</p></div>'}
      <div style="margin-top:12px"><h1>En attente de réception</h1><p class="mut" style="margin:0">C’est la personne qui a commandé qui réceptionne depuis son onglet Demandes. Tu peux le faire à sa place si besoin.</p></div>
      ${aRecevoir.length ? aRecevoir.map((d) => carte(d, `<button class="btn primary" data-a="reception" data-k="${d.id}">Réception</button>`)).join('') : '<div class="card empty"><p>Aucune commande en attente.</p></div>'}`;
  },

  stats() {
    const act = S.demandes.filter((d) => !['refusee', 'tri'].includes(d.statut) && !estBesoin(d));
    const tot = act.reduce((t, d) => t + totalDA(d), 0);
    const cards = S.fourn.map((f) => {
      const list = act.filter((d) => d.fournisseur_id === f.id);
      const m = list.reduce((t, d) => t + totalDA(d), 0);
      const parArt = {}; let qty = 0;
      list.forEach((d) => d.lignes.forEach((l) => { qty += l.qte; parArt[l.designation] = (parArt[l.designation] || 0) + l.qte; }));
      const top = Object.entries(parArt).sort((a, b) => b[1] - a[1])[0];
      const pct = tot ? Math.round((m / tot) * 100) : 0;
      return { f, m, html: `<section class="card pad stack">
        <div class="row"><h2 style="font-size:17px">${esc(f.nom)}</h2><span class="mut nw">${S.produits.filter((p) => p.fournisseur_id === f.id).length} réf.</span></div>
        <div class="stack" style="gap:6px"><div class="row"><span class="mut">Part des achats</span><b>${pct} %</b></div><div class="meter"><div style="width:${pct}%"></div></div></div>
        <div class="two"><div><span class="lbl">Montant</span><br><b>${eur(m)}</b></div><div><span class="lbl">Demandes</span><br><b>${list.length}</b></div><div><span class="lbl">Articles commandés</span><br><b>${qty}</b></div><div><span class="lbl">Moyenne / demande</span><br><b>${list.length ? eur(m / list.length) : '—'}</b></div></div>
        <div style="padding-top:10px;border-top:1px solid var(--line2);font-size:13px"><span class="mut">Article le plus commandé : </span>${top ? esc(top[0]) + ' (' + top[1] + ')' : '—'}</div></section>` };
    }).filter((x) => S.me.role === 'admin' || x.m > 0).sort((a, b) => b.m - a.m).map((x) => x.html).join('');
    const parPers = {};
    const P = (k) => (parPers[k] = parPers[k] || { n: 0, m: 0, e: 0, u: 0 });
    act.forEach((d) => { const v = P(d.demandeur_id); v.n++; v.m += totalDA(d); });
    (S.envois || []).forEach((e) => { const v = P(e.user_id); v.e++; if (e.urgent) v.u++; });
    const pers = Object.entries(parPers).sort((a, b) => b[1].u - a[1].u || b[1].m - a[1].m)
      .map(([id, v]) => `<tr><td><b>${esc(nomDe(id))}</b></td><td>${v.e}</td><td>${v.u ? `<b style="color:#B42318">${v.u}</b> <span class="mut">(${Math.round((v.u / v.e) * 100)} %)</span>` : '0'}</td><td>${v.n}</td><td class="nw"><b>${eur(v.m)}</b></td><td class="nw">${v.n ? eur(v.m / v.n) : '—'}</td></tr>`).join('');
    const perim = S.me.role === 'admin' ? 'toutes les demandes' : S.me.role === 'n1' ? 'tes demandes et celles de ton équipe' : 'tes demandes';
    return `<div><h1>Fournisseurs</h1><p class="mut" style="margin:0">Calculé sur ${perim}, validées et en attente (hors refusées).</p></div>
      <div class="kpis"><div class="card kpi"><span class="mut">Montant total commandé</span><b>${eur(tot)}</b></div><div class="card kpi"><span class="mut">Demandes d'achat</span><b>${act.length}</b></div><div class="card kpi"><span class="mut">Montant moyen par demande</span><b>${act.length ? eur(tot / act.length) : '—'}</b></div></div>
      <div class="fgrid">${cards || '<div class="card empty"><p>Aucune dépense pour le moment.</p></div>'}</div>
      ${pers ? `<h2 style="margin-top:8px">Par personne</h2><div class="card tw"><table class="tbl" style="min-width:480px"><thead><tr><th>Demandeur</th><th>Paniers envoyés</th><th>Dont urgents</th><th>DA</th><th>Montant HT</th><th>Moyenne / DA</th></tr></thead><tbody>${pers}</tbody></table></div>` : ''}`;
  },

  speciale() {
    const four = S.fourn.map((f) => `<option value="${esc(f.nom)}">`).join('');
    return `<div><h1>Demande spéciale</h1><p class="mut" style="margin:0">Pour un article qui n’est pas au catalogue, avec un devis. Elle arrive chez le responsable achats comme un panier, sans compter dans ta limite d’envoi.</p></div>
    <form class="card pad stack" data-form="speciale" style="max-width:760px">
      <datalist id="dl-four">${four}</datalist>
      <div class="two">
        <label>Fournisseur<input name="fournisseur" required list="dl-four" placeholder="Choisis ou tape un nouveau"></label>
        <label>N° du devis (optionnel)<input name="devis_num"></label>
        <label>Agence<select name="agence">${opts(S.agences, S.me.agence)}</select></label>
        <label>Devis (PDF ou photo)<input name="devis" type="file" accept="application/pdf,image/*"></label>
      </div>
      <h2 style="margin-top:6px">Lignes du devis</h2>
      <div class="tw"><table class="tbl" style="min-width:520px"><thead><tr><th>Désignation</th><th>Qté</th><th>PU HT (€)</th><th></th></tr></thead><tbody id="spl">${SPL.repeat(1)}</tbody></table></div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><button type="button" class="btn" data-a="spePlus">+ Ajouter une ligne</button>
        <label style="flex-direction:row;align-items:center;gap:8px">Frais de port HT (€)<input name="port" inputmode="decimal" placeholder="0,00" style="width:110px"></label>
        <b style="margin-left:auto">Total HT : <span id="spTot">0,00 €</span></b></div>
      <label>Commentaire<textarea name="commentaire" rows="3" placeholder="Pourquoi, pour quelle affaire…"></textarea></label>
      <label style="flex-direction:row;align-items:center;gap:8px;font-weight:600;color:#B42318"><input type="checkbox" name="urgent" style="width:18px;height:18px;flex:none"> Besoin urgent</label>
      <div><button class="btn primary" type="submit">Envoyer la demande</button></div>
    </form>`;
  },

  prestation() {
    const four = S.fourn.map((f) => `<option value="${esc(f.nom)}">`).join('');
    const lieux = S.agences.map((a) => `<option value="${esc(a)}">`).join('');
    const dest = S.me.n1_id ? 'Elle sera envoyée à ' + esc(nomDe(S.me.n1_id)) + ' pour validation.' : 'Elle sera transmise directement au responsable achats.';
    return `<div><h1>Demande d'achat</h1><p class="mut" style="margin:0">Pour une prestation ou un achat hors catalogue. ${dest}</p></div>
    <form class="card pad stack" data-form="prestation" style="max-width:860px">
      <datalist id="dl-four">${four}</datalist><datalist id="dl-lieux">${lieux}</datalist>
      <h2>Fournisseur</h2>
      <div class="two">
        <label>Fournisseur<input name="fournisseur" required list="dl-four" placeholder="Ex. SGS"></label>
        <label>Email du contact<input name="contact_email" type="email"></label>
        <label>Nom du contact<input name="contact_nom"></label>
        <label>Prénom du contact<input name="contact_prenom"></label>
      </div>
      <h2 style="margin-top:8px">Prestation</h2>
      <div class="two">
        <label>Nom du consultant<input name="consultant"></label>
        <label>Mission<input name="mission" required placeholder="Ex. Agent qualité"></label>
        <label>Date de démarrage<input name="date_debut" type="date" required data-calc></label>
        <label>Date de fin<input name="date_fin" type="date" required data-calc></label>
        <label>Nombre de jours<input name="jours" type="number" min="1" required data-calc data-jours></label>
        <label>TJ HT (€)<input name="tj" inputmode="decimal" required data-calc placeholder="0,00"></label>
      </div>
      <div class="row big"><span>Montant total HT</span><b id="presta-total">0,00 €</b></div>
      <p class="mut" style="margin:0;font-size:13px">Le nombre de jours est calculé automatiquement (jours ouvrés, hors jours fériés). Tu peux le corriger.</p>
      <h2 style="margin-top:8px">Imputation</h2>
      <div class="two">
        <label>Imputation (N° affaire)<input name="affaire" placeholder="Ex. 0507-PI-27"></label>
        <label>Localisation<input name="localisation" list="dl-lieux" value="${esc(S.me.agence || '')}"></label>
        <label>Rubrique achat<input name="rubrique" value="SST-Sous traitance sur affaires"></label>
      </div>
      <label>Commentaires<textarea name="commentaire" rows="3" placeholder="Ex. Nouvelle affaire"></textarea></label>
      <button class="btn primary" type="submit" style="align-self:flex-start">Envoyer la demande</button>
    </form>`;
  },

  admin() {
    const tabs = [['users', 'Utilisateurs'], ['produits', 'Produits'], ['fournisseurs', 'Fournisseurs'], ['agences', 'Agences']]
      .map(([k, l]) => `<button class="tab ${S.adminTab === k ? 'on' : ''}" role="tab" aria-selected="${S.adminTab === k}" data-a="tab" data-k="${k}">${l}</button>`).join('');
    return `<h1>Administration</h1><div class="tabs" role="tablist">${tabs}</div>${ADMIN[S.adminTab]()}`;
  }
};

function keyOf(p) { const t = p.tailles && p.tailles.length ? (S.tailles[p.id] || p.tailles[0]) : ''; return p.id + '|' + t; }
function gridHtml() {
  const q = S.search.trim().toLowerCase();
  const list = S.produits.filter((p) => p.actif && (S.cat === 'Tout' || p.categorie === S.cat) &&
    (!q || (p.nom + ' ' + (p.ref || '') + ' ' + fournDe(p.fournisseur_id)).toLowerCase().includes(q)));
  if (!list.length) return `<p class="mut">Aucun article.</p>`;
  return list.map((p) => {
    const k = keyOf(p); const q2 = cart[k] || 0; const t = k.split('|')[1];
    const tailles = p.tailles && p.tailles.length ? `<label class="tl">Taille <select data-on="taille" data-id="${p.id}">${opts(p.tailles, t)}</select></label>` : '';
    const btn = q2
      ? `<div class="step"><button data-a="qty" data-k="${esc(k)}" data-d="-1" aria-label="Retirer un">−</button><b>${q2} au panier</b><button data-a="qty" data-k="${esc(k)}" data-d="1" aria-label="Ajouter un">+</button></div>`
      : `<button class="btn primary" data-a="qty" data-k="${esc(k)}" data-d="1">Ajouter au panier</button>`;
    return `<article class="card prod"><div class="ph">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : 'Pas de photo'}</div>
      <div class="pb"><span class="ref">${esc(p.ref || '')}</span><h3>${esc(p.nom)}</h3><span class="mut" style="font-size:13px">${esc(fournDe(p.fournisseur_id))}</span>
      <div class="price"><b>${eur(p.prix)}</b><span>HT / ${esc(p.unite)}</span></div>${tailles}${btn}</div></article>`;
  }).join('');
}

/* ---------- administration ---------- */
const ADMIN = {
  agences() {
    return `<div class="cols"><form class="card side2 stack" data-form="agence">
      <h2>Ajouter une agence</h2>
      <label>Nom de l'agence<input name="nom" required></label>
      <button class="btn primary" type="submit">Ajouter l'agence</button>
    </form><div class="card grow tw"><table class="tbl" style="min-width:420px"><thead><tr><th>Agence</th><th>Utilisateurs</th><th><span class="sr">Action</span></th></tr></thead><tbody>
      ${S.agences.map((a) => `<tr><td><b>${esc(a)}</b></td><td>${S.profils.filter((p) => p.agence === a).length}</td><td><button class="link" data-a="delAgence" data-k="${esc(a)}">Supprimer</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  },

  users() {
    const u = S.edit ? S.profils.find((p) => p.id === S.edit) : null;
    const valideurs = S.profils.filter((p) => p.role !== 'technicien').map((p) => [p.id, p.nom]);
    return `<div class="cols"><form class="card side2 stack" data-form="user">
      <h2>${u ? 'Modifier ' + esc(u.nom) : 'Créer un compte'}</h2>
      <label>Nom<input name="nom" required value="${esc(u && u.nom)}" placeholder="Prénom Nom"></label>
      <label>Email<input name="email" type="email" ${u ? 'disabled' : 'required'} value="${esc(u && u.email)}" placeholder="prenom.nom@societe.fr"></label>
      ${!u && !C.MAILS ? '<label>Mot de passe provisoire (à donner à la personne)<input name="password" required minlength="8" placeholder="8 caractères minimum"></label>' : ''}
      <label>Rôle<select name="role">${opts([['technicien', 'Technicien (demandeur)'], ['n1', 'N+1 (valideur)'], ['assistance', 'Assistance technique'], ['admin', 'Admin / resp. logistique']], u ? u.role : 'technicien')}</select></label>
      <label>Agence<select name="agence">${opts(S.agences, u && u.agence)}</select></label>
      <label>N+1 qui valide ses demandes<select name="n1_id"><option value="">— Aucun —</option>${opts(valideurs, u && u.n1_id)}</select></label>
      <label>Copie des DA par mail (optionnel)<input name="mail_copie" type="email" value="${esc(u && u.mail_copie)}" placeholder="Ex. responsable qui veut voir les DA"></label>
      <label>Envoi du panier : 1 fois tous les … jours (0 = sans limite)<input name="delai_jours" type="number" min="0" step="1" value="${u ? u.delai_jours || 0 : 7}"></label>
      <button class="btn primary" type="submit">${u ? 'Enregistrer' : (C.MAILS ? 'Créer le compte et envoyer l’invitation' : 'Créer le compte')}</button>
      ${u ? '<button class="link" type="button" data-a="cancel">Annuler</button>' : ''}
    </form><div class="card grow tw"><table class="tbl" style="min-width:640px"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Agence</th><th>N+1</th><th>Panier</th><th><span class="sr">Action</span></th></tr></thead><tbody>
      ${S.profils.map((p) => `<tr><td><b>${esc(p.nom)}</b></td><td>${esc(p.email)}</td><td>${ROLE[p.role]}</td><td>${esc(p.agence || '—')}</td><td>${p.n1_id ? esc(nomDe(p.n1_id)) : '—'}</td><td class="nw">${p.delai_jours ? 'tous les ' + p.delai_jours + ' j' : 'libre'}</td><td><button class="link" data-a="edit" data-k="${p.id}">Modifier</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  },

  produits() {
    if (!S.fourn.length) return `<div class="card empty"><p>Ajoute d’abord un fournisseur.</p><button class="btn primary" data-a="tab" data-k="fournisseurs">Aller aux fournisseurs</button></div>`;
    const p = S.edit ? S.produits.find((x) => String(x.id) === S.edit) : null;
    return `<div class="cols"><form class="card side2 stack" data-form="produit">
      <h2>${p ? 'Modifier le produit' : 'Ajouter un produit'}</h2>
      <label>Désignation<input name="nom" required value="${esc(p && p.nom)}"></label>
      <label>Référence<input name="ref" value="${esc(p && p.ref)}"></label>
      <div class="two">
        <label>Catégorie<select name="categorie">${opts(C.CATEGORIES, p && p.categorie)}</select></label>
        <label>Fournisseur<select name="fournisseur_id">${opts(S.fourn.map((f) => [f.id, f.nom]), p && p.fournisseur_id)}</select></label>
        <label>Prix HT (€)<input name="prix" required inputmode="decimal" value="${esc(p ? String(p.prix).replace('.', ',') : '')}" placeholder="0,00"></label>
        <label>Unité<input name="unite" value="${esc(p ? p.unite : 'pièce')}"></label>
      </div>
      <label>Tailles (optionnel, séparées par des virgules)<input name="tailles" value="${esc(p && p.tailles ? p.tailles.join(', ') : '')}" placeholder="Ex. 40, 41, 42 ou S, M, L"></label>
      <label>Photo${p && p.photo_url ? ' (laisser vide pour garder l’actuelle)' : ''}<input name="photo" type="file" accept="image/*"></label>
      <button class="btn primary" type="submit">${p ? 'Enregistrer' : 'Ajouter au catalogue'}</button>
      ${p ? '<button class="link" type="button" data-a="cancel">Annuler</button>' : ''}
    </form><div class="grow stack"><input type="search" id="qa" placeholder="Rechercher un produit, une référence, un fournisseur…" value="${esc(S.adminSearch || '')}" aria-label="Rechercher un produit">
      <div class="card tw" style="max-height:760px"><table class="tbl" style="min-width:760px"><thead><tr><th><span class="sr">Photo</span></th><th>Désignation</th><th>Catégorie</th><th>Fournisseur</th><th>Prix HT</th><th>Tailles</th><th><span class="sr">Actions</span></th></tr></thead><tbody id="admin-prod">${lignesProduitsAdmin()}</tbody></table></div></div></div>`;
  },

  fournisseurs() {
    const f = S.edit ? S.fourn.find((x) => String(x.id) === S.edit) : null;
    return `<div class="cols"><form class="card side2 stack" data-form="fournisseur">
      <h2>${f ? 'Modifier le fournisseur' : 'Ajouter un fournisseur'}</h2>
      <label>Nom<input name="nom" required value="${esc(f && f.nom)}"></label>
      <label>Email commandes<input name="email" type="email" value="${esc(f && f.email)}"></label>
      <label>Téléphone<input name="tel" type="tel" value="${esc(f && f.tel)}"></label>
      <button class="btn primary" type="submit">${f ? 'Enregistrer' : 'Ajouter le fournisseur'}</button>
      ${f ? '<button class="link" type="button" data-a="cancel">Annuler</button>' : ''}
    </form><div class="card grow tw"><table class="tbl" style="min-width:560px"><thead><tr><th>Nom</th><th>Email commandes</th><th>Téléphone</th><th>Produits</th><th><span class="sr">Action</span></th></tr></thead><tbody>
      ${S.fourn.map((x) => `<tr><td><b>${esc(x.nom)}</b></td><td>${esc(x.email || '—')}</td><td class="nw">${esc(x.tel || '—')}</td><td>${S.produits.filter((p) => p.fournisseur_id === x.id).length}</td><td><button class="link" data-a="edit" data-k="${x.id}">Modifier</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
};

function lignesProduitsAdmin() {
  const r = S.produits.filter((x) => { const q = (S.adminSearch || '').trim().toLowerCase(); return !q || (x.nom + ' ' + (x.ref || '') + ' ' + fournDe(x.fournisseur_id) + ' ' + x.categorie).toLowerCase().includes(q); }).map((x) => `<tr style="${x.actif ? '' : 'opacity:.5'}"><td>${x.photo_url ? `<img class="thumb" src="${esc(x.photo_url)}" alt="">` : ''}</td><td><b>${esc(x.nom)}</b><br><span class="ref">${esc(x.ref || '')}</span></td><td>${esc(x.categorie)}</td><td>${esc(fournDe(x.fournisseur_id))}</td><td class="nw">${eur(x.prix)}</td><td>${x.tailles ? esc(x.tailles.join(', ')) : '—'}</td>
        <td class="nw"><button class="link" data-a="edit" data-k="${x.id}">Modifier</button><button class="link" data-a="actif" data-k="${x.id}">${x.actif ? 'Désactiver' : 'Réactiver'}</button><button class="link" style="color:#B42318" data-a="delProduit" data-k="${x.id}">Supprimer</button></td></tr>`).join('');
  return r || '<tr><td colspan="7" class="mut">Aucun produit trouvé.</td></tr>';
}

/* ---------- aperçu DA ---------- */
function openDoc(id) {
  const d = S.demandes.find((x) => x.id === id);
  if (!d) return;
  if (estBesoin(d)) return openFiche(d);
  const ok = d.statut === 'validee' || d.statut === 'everwin' || (d.statut === 'recue' && !estBesoin(d));
  const visa = estBesoin(d) ? '<span class="mut" style="font-style:italic">Servi sur stock général</span>'
    : d.statut === 'tri' ? '<span class="mut" style="font-style:italic">Chez le responsable achats</span>'
    : ok && d.n1_id
    ? `<span class="sig">${esc(nomDe(d.n1_id))}</span><span>${dfr(d.valide_le)}</span>`
    : `<span class="mut" style="font-style:italic">${ok ? '' : d.statut === 'refusee' ? 'Refusée' : 'En attente de validation'}</span>`;
  const x = d.details || {};
  const contact = [x.contact_prenom, x.contact_nom].filter(Boolean).join(' ') + (x.contact_email ? ' (' + x.contact_email + ')' : '');
  const infos = d.type === 'prestation' ? [
    x.consultant && 'Consultant : ' + x.consultant,
    contact.trim() && 'Contact fournisseur : ' + contact.trim(),
    x.date_debut && 'Période : du ' + dfr(x.date_debut) + ' au ' + dfr(x.date_fin) + ' (' + x.jours + ' jours)'
  ].filter(Boolean) : [];
  const vides = Math.max(0, 4 - d.lignes.length);
  $('#modal').innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-label="Demande d'achat">
    <div class="mbar"><b>Demande d'achat ${esc(daNum(d.id))}</b><div style="display:flex;gap:8px"><button class="btn primary" data-a="print">Télécharger en PDF</button><button class="btn" data-a="close">Fermer</button></div></div>
    <div class="mbody"><div class="da">
      <div class="t"><div class="t1"><span>DEMANDE D'APPROVISIONNEMENT</span><span>DA N° : ${esc(daNum(d.id))}</span></div><div class="t2"><img src="${C.LOGO}" alt="${esc(C.NOM_SOCIETE)}" onerror="this.remove()"></div></div>
      <div class="band">GÉNÉRALITÉS :</div>
      <div class="gen"><div><b>Demandeur : </b>${esc(nomDe(d.demandeur_id))}</div><div><b>Fournisseur : </b>${esc(fournD(d))}</div><div><b>Date : </b>${dfr(d.created_at)}</div>
        <div><b>N° affaire : </b>${esc(d.n_affaire || '')}</div><div><b>Devis N° : </b>${esc(d.devis_num || (d.devis_path ? 'joint' : ''))}</div><div><b>EIPS : </b>NON</div></div>
      <div class="band">ARTICLES :</div>
      <table><thead><tr><th style="text-align:left">Libellé</th><th>Qté</th><th>PU HT (av. remise)</th><th>Remise</th><th>PT HT</th><th>Rubrique achat</th><th>Date livraison</th><th>Lieu de livraison</th><th>Observation</th></tr></thead><tbody>
        ${d.lignes.map((l) => `<tr><td>${esc(l.designation)}</td><td class="c">${l.qte}</td><td class="r">${eur(l.pu)}</td><td></td><td class="r g">${eur(l.qte * l.pu)}</td><td>${esc(l.rubrique || '')}</td><td class="c">${dfr(l.date_livraison)}</td><td>${esc(l.lieu || d.agence || '')}</td><td></td></tr>`).join('')}
        ${'<tr><td>&nbsp;</td><td></td><td></td><td></td><td class="r g">0,00 €</td><td></td><td></td><td></td><td></td></tr>'.repeat(vides)}
        <tr><td colspan="4" class="r"><b>MONTANT TOTAL :</b></td><td class="r g"><b>${eur(totalDA(d))}</b></td><td colspan="4"></td></tr></tbody></table>
      <div class="foot"><div><b>Commentaires :</b><span style="white-space:pre-line">${esc([d.urgent && 'BESOIN URGENT', d.commentaire, ...infos].filter(Boolean).join('\n'))}</span></div>
        <div><b>Visa et date demandeur :</b><span class="sig">${esc(nomDe(d.demandeur_id))}</span><span>${dfr(d.created_at)}</span></div>
        <div><b>Visa et date responsable :</b>${visa}</div></div>
    </div></div></div>`;
  $('#modal').classList.add('show');
}
function openReception(id) {
  const d = S.demandes.find((x) => x.id === id);
  if (!d) return;
  $('#modal').innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-label="Réception">
    <div class="mbar"><b>Réception · ${esc(daNum(d.id))} · ${esc(fournD(d))} · Agence ${esc(d.agence || '—')}</b><button class="btn" data-a="close">Fermer</button></div>
    <form class="mbody stack" data-form="reception"><input type="hidden" name="demande" value="${d.id}">
      <p class="mut" style="margin:0">Indique ce qui est arrivé. Tu peux réceptionner en plusieurs fois.</p>
      <div class="tw"><table class="tbl" style="min-width:560px"><thead><tr><th>Désignation</th><th>Commandé</th><th>Déjà reçu</th><th>Reçu maintenant</th></tr></thead><tbody>
      ${d.lignes.map((l) => { const reste = l.qte - (l.qte_recue || 0); return `<tr><td>${esc(l.designation)}</td><td>${l.qte}</td><td>${l.qte_recue || 0}</td><td>${reste > 0 ? `<input type="number" name="q_${l.id}" min="0" max="${reste}" value="${reste}" style="width:110px" aria-label="Quantité reçue">` : '<span class="mut">complet</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <button class="btn primary" type="submit" style="align-self:flex-start">Valider la réception</button>
    </form></div>`;
  $('#modal').classList.add('show');
}
function openFiche(d) {
  $('#modal').innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-label="Fiche besoin">
    <div class="mbar"><b>Fiche besoin ${esc(daNum(d.id))}</b><div style="display:flex;gap:8px"><button class="btn primary" data-a="print">Télécharger en PDF</button><button class="btn" data-a="close">Fermer</button></div></div>
    <div class="mbody"><div class="da">
      <div class="t"><div class="t1"><span>FICHE BESOIN · STOCK GÉNÉRAL</span><span>N° : ${esc(daNum(d.id))}</span></div><div class="t2"><img src="${C.LOGO}" alt="${esc(C.NOM_SOCIETE)}" onerror="this.remove()"></div></div>
      <div class="band">POUR :</div>
      <div class="gen"><div><b>Personne : </b>${esc(nomDe(d.demandeur_id))}</div><div><b>Agence : </b>${esc(d.agence || '')}</div><div><b>Date : </b>${dfr(d.created_at)}</div></div>
      <div class="band">ARTICLES :</div>
      <table><thead><tr><th style="text-align:left">Désignation</th><th>Référence</th><th>Qté</th><th>Dans le carton</th><th>Reçu</th></tr></thead><tbody>
        ${d.lignes.map((l) => `<tr><td>${esc(l.designation)}</td><td class="c">${esc((prodDe(l.produit_id) || {}).ref || '')}</td><td class="c"><b>${l.qte}</b></td><td class="c">${l.prepare ? '✔' : '☐'}</td><td class="c">${l.qte_recue ? l.qte_recue : '☐'}</td></tr>`).join('')}
      </tbody></table>
      <div class="foot"><div><b>Commentaires :</b><span style="white-space:pre-line">${esc([d.urgent && 'BESOIN URGENT', d.commentaire].filter(Boolean).join('\n'))}</span></div>
        <div><b>Préparé le :</b><span>${d.statut === 'besoin' ? '' : dfr(d.valide_le)}</span></div>
        <div><b>Statut :</b><span>${esc(statutDe(d)[0])}</span></div></div>
    </div></div></div>`;
  $('#modal').classList.add('show');
}
/* ---------- tuto ---------- */
const TUTO_DEMANDEUR = [
  ['Le catalogue', 'Cherche un article avec la barre de recherche en haut ou par catégorie, choisis la taille si besoin et ajoute-le au panier.'],
  ['Le panier', 'Choisis ton agence, ajoute un commentaire si besoin et clique sur « Envoyer la demande ». Tu peux envoyer ton panier une fois par période (affichée dans le panier) : regroupe tes besoins.'],
  ['Besoin urgent', 'Si ça ne peut vraiment pas attendre, coche « Besoin urgent » avant d’envoyer. Ça passe tout de suite, mais les urgences sont comptées et suivies par ton N+1.'],
  ['Ce qui se passe ensuite', 'Le responsable achats regarde chaque article : s’il l’a en stock, il te prépare un carton. Sinon, il en fait une demande d’achat que ton N+1 valide avant la commande.'],
  ['La réception', 'Dans « Demandes », tu suis où en est chaque demande. Quand tu reçois ton colis ou ton carton, clique sur « Réception » et indique ce qui est arrivé : le stock de ton agence est mis à jour tout seul.']
];
const TUTO = {
  technicien: TUTO_DEMANDEUR,
  assistance: [TUTO_DEMANDEUR[0], ['Demande d’achat', 'Pour une prestation ou un achat hors catalogue (sous-traitance, consultant…), utilise l’onglet « Demande d’achat » : remplis le fournisseur, l’affaire et les lignes, ça part en validation.'], ...TUTO_DEMANDEUR.slice(1)],
  n1: [
    ['À valider', 'Les demandes d’achat de ton équipe arrivent ici. Ouvre la DA si besoin, puis clique sur « Valider » ou « Refuser ». Une fois validée, elle part chez le responsable achats pour la commande.'],
    ['Demandes', 'Tu y vois tes demandes et celles de ton équipe, avec leur statut. Les demandes urgentes ont un badge rouge URGENT.'],
    ['Stats fournisseurs', 'Les dépenses de ton équipe par fournisseur et par personne, avec le nombre de paniers envoyés et d’urgences par personne : pratique pour repérer un souci d’organisation.'],
    ['Commander pour toi', 'Tu peux aussi commander depuis le catalogue et le panier, comme ton équipe. Quand tu reçois, clique sur « Réception » dans « Demandes ».']
  ],
  admin: [
    ['À trier', 'Chaque panier envoyé arrive ici. Pour chaque article, choisis « Achat » (ça part en DA chez le N+1) ou « Stock » (tu l’as au magasin), puis « Valider le tri ».'],
    ['Besoins', 'Les articles « Stock » sont regroupés dans une fiche par personne, peu importe le fournisseur. Coche au fur et à mesure que tu remplis le carton : quand tout est coché, c’est déduit du stock général et la personne peut réceptionner.'],
    ['À saisir Everwin', 'Les DA validées par les N+1 arrivent ici. Ouvre la DA, saisis le bon de commande sur Everwin puis clique sur « BC saisi sur Everwin ».'],
    ['Réceptions', 'C’est la personne qui a commandé qui réceptionne depuis ses « Demandes ». Tu peux le faire à sa place si besoin. Chaque réception part dans le fichier Excel stock de l’agence.'],
    ['Stats fournisseurs', 'Les dépenses par fournisseur et par personne, avec les paniers envoyés et les urgences.'],
    ['Administration', 'Crée les comptes (rôle, agence, N+1, fréquence d’envoi du panier), les produits, les fournisseurs et les agences.']
  ]
};
function openTuto(i = 0) {
  try { sessionStorage.setItem('tuto_vu', S.me.id); } catch (e) {}
  const steps = TUTO[S.me.role] || TUTO.technicien;
  const [t, txt] = steps[i];
  let off = false;
  try { off = localStorage.getItem('tuto_off_' + S.me.id) === '1'; } catch (e) {}
  $('#modal').innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-label="Tuto" style="max-width:520px;margin-top:8vh">
    <div class="mbar"><b>Bienvenue ${esc(S.me.nom.split(' ')[0])} · ${i + 1} / ${steps.length}</b><button class="btn" data-a="close">Passer</button></div>
    <div class="mbody stack"><h2 style="font-size:20px">${esc(t)}</h2><p style="margin:0;line-height:1.55">${esc(txt)}</p>
      <div style="display:flex;gap:6px">${steps.map((_, k) => `<span style="width:8px;height:8px;border-radius:50%;background:${k === i ? 'var(--accent, #C2410C)' : '#D6D6CF'}"></span>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-top:6px">
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13px;font-weight:400;flex:1;min-width:180px"><input type="checkbox" style="width:16px;height:16px;flex:none" data-a="tutoOff" ${off ? 'checked' : ''}> Ne plus afficher à la connexion</label>
        <div style="display:flex;gap:8px">${i > 0 ? `<button class="btn" data-a="tuto" data-k="${i - 1}">Précédent</button>` : ''}${i < steps.length - 1 ? `<button class="btn primary" data-a="tuto" data-k="${i + 1}">Suivant</button>` : '<button class="btn primary" data-a="close">C’est parti</button>'}</div>
      </div></div></div>`;
  $('#modal').classList.add('show');
}
function closeDoc() { $('#modal').classList.remove('show'); $('#modal').innerHTML = ''; }

/* ---------- actions (clics) ---------- */
const ACTIONS = {
  go: (k) => { S.screen = k; S.edit = null; render(); window.scrollTo(0, 0); },
  cat: (k) => { S.cat = k; render(); },
  qty: (k, d) => { const n = (cart[k] || 0) + Number(d); if (n > 0) cart[k] = n; else delete cart[k]; saveCart(); render(); },
  delAgence: async (k) => {
    if (!confirm('Supprimer l’agence ' + k + ' ? Les demandes et comptes existants ne sont pas modifiés.')) return;
    const { error } = await sb.from('agences').delete().eq('nom', k);
    if (error) throw error;
    await loadAll(); render(); toast('Agence supprimée.');
  },
  tab: (k) => { S.adminTab = k; S.edit = null; render(); },
  edit: (k) => { S.edit = k; render(); window.scrollTo(0, 0); },
  cancel: () => { S.edit = null; render(); },
  doc: (k) => openDoc(Number(k)),
  devis: async (k) => {
    const d = S.demandes.find((x) => x.id === Number(k));
    const w = window.open('', '_blank');
    const { data, error } = await sb.storage.from('devis').createSignedUrl(d.devis_path, 600);
    if (error) { if (w) w.close(); throw error; }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  },
  spePlus: () => { $('#spl').insertAdjacentHTML('beforeend', SPL); $('#spl tr:last-child input').focus(); },
  speMoins: (k, d, el) => { if ($('#spl').children.length > 1) { el.closest('tr').remove(); speTotal(); } },
  auCatalogue: async (k) => {
    const l = S.demandes.flatMap((x) => x.lignes.map((y) => ({ ...y, d: x }))).find((y) => y.id === Number(k));
    const d = l.d;
    if (!d.fournisseur_id) throw new Error('Fournisseur inconnu.');
    if (!confirm('Ajouter « ' + l.designation + ' » au catalogue à ' + eur(l.pu) + ' HT ?')) return;
    const { error } = await sb.from('produits').insert({ nom: l.designation, categorie: 'Divers', fournisseur_id: d.fournisseur_id, prix: l.pu, unite: 'pièce', actif: true });
    if (error) throw error;
    await loadAll(); render(); toast('Ajouté au catalogue (catégorie Divers). Tu peux compléter la photo et la référence dans Administration.');
  },
  tuto: (k) => openTuto(Number(k) || 0),
  tutoOff: () => { try { const k = 'tuto_off_' + S.me.id; if (localStorage.getItem(k) === '1') localStorage.removeItem(k); else localStorage.setItem(k, '1'); } catch (e) {} },
  close: closeDoc,
  print: () => window.print(),
  logout: async () => { await sb.auth.signOut(); S.me = null; renderLogin(); },
  forgot: async () => {
    const email = (document.querySelector('[name=email]') || {}).value;
    if (!email) return toast('Tape ton email d’abord.', true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    toast('Si ce compte existe, un mail de réinitialisation vient de partir.');
  },
  decide: async (k, d) => {
    const ok = d === '1';
    if (!ok && !confirm('Refuser cette demande ?')) return;
    const { error } = await sb.rpc('valider_demande', { p_id: Number(k), p_ok: ok });
    if (error) throw error;
    await loadAll(); render();
    toast(ok ? 'Demande validée.' : 'Demande refusée.');
  },
  everwin: async (k) => {
    const { error } = await sb.rpc('marquer_everwin', { p_id: Number(k) });
    if (error) throw error;
    await loadAll(); render(); toast('Marquée comme saisie sur Everwin.');
  },
  reception: (k) => openReception(Number(k)),
  triLigne: (k, d) => { if (d === '1') S.triStock[k] = 1; else delete S.triStock[k]; render(); },
  trier: async (k) => {
    const d = S.demandes.find((x) => x.id === Number(k));
    const stock = d.lignes.filter((l) => S.triStock[l.id]).map((l) => l.id);
    const achat = d.lignes.length - stock.length;
    const { error } = await sb.rpc('trier_lignes', { p_id: d.id, p_stock: stock });
    if (error) throw error;
    stock.forEach((id) => delete S.triStock[id]);
    await loadAll(); render();
    toast([achat && achat + ' article(s) envoyé(s) au N+1', stock.length && stock.length + ' article(s) dans la fiche besoin'].filter(Boolean).join(' · ') + '.');
  },
  cocher: async (k, d) => {
    const dem = S.demandes.find((x) => x.lignes.some((l) => String(l.id) === k));
    const { data, error } = await sb.rpc('cocher_ligne', { p_ligne: Number(k), p_ok: d === '1' });
    if (error) { render(); throw error; }
    await loadAll(); render();
    if (data === 'preparee') toast('Carton complet : déduit du stock général, le demandeur peut réceptionner.');
  },
  delDA: async (k) => {
    if (!confirm('Supprimer définitivement la demande ' + daNum(k) + ' ? Cette action est irréversible.')) return;
    const { error, count } = await sb.from('demandes').delete({ count: 'exact' }).eq('id', Number(k));
    if (error) throw error;
    if (!count) throw new Error('Suppression refusée.');
    closeDoc(); await loadAll(); render(); toast('Demande ' + daNum(k) + ' supprimée.');
  },
  delProduit: async (k) => {
    const p = S.produits.find((x) => String(x.id) === k);
    if (!p || !confirm('Supprimer définitivement « ' + p.nom + ' » ?\nLes demandes d’achat déjà faites ne sont pas modifiées.')) return;
    const { error } = await sb.from('produits').delete().eq('id', p.id);
    if (error) throw error;
    Object.keys(cart).forEach((c) => { if (c.split('|')[0] === String(p.id)) delete cart[c]; }); saveCart();
    if (S.edit === k) S.edit = null;
    await loadAll(); render(); toast('Produit supprimé.');
  },
  actif: async (k) => {
    const p = S.produits.find((x) => String(x.id) === k);
    const { error } = await sb.from('produits').update({ actif: !p.actif }).eq('id', p.id);
    if (error) throw error;
    await loadAll(); render();
  }
};

/* ---------- formulaires ---------- */
const FORMS = {
  async login(fd) {
    const { data, error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
    if (error) throw new Error('Email ou mot de passe incorrect.');
    await boot(data.user);
  },
  async pwd(fd) {
    if (fd.get('p1') !== fd.get('p2')) throw new Error('Les deux mots de passe ne sont pas identiques.');
    const { data, error } = await sb.auth.updateUser({ password: fd.get('p1') });
    if (error) throw error;
    history.replaceState(null, '', location.pathname);
    await boot(data.user);
    toast('Mot de passe enregistré.');
  },
  async envoyer(fd) {
    const items = Object.entries(cart).map(([k, q]) => { const [id, t] = k.split('|'); return { produit_id: Number(id), taille: t, qte: q }; });
    const { data: ids, error } = await sb.rpc('creer_demandes', { p_agence: fd.get('agence'), p_commentaire: fd.get('commentaire'), p_items: items, p_urgent: fd.get('urgent') === 'on' });
    if (error) throw error;
    cart = {}; saveCart();
    await loadAll(); S.screen = 'demandes'; render();
    toast(ids.length > 1 ? ids.length + ' demandes envoyées au responsable achats.' : 'Demande envoyée au responsable achats.');
  },
  async user(fd) {
    const row = { nom: fd.get('nom').trim(), role: fd.get('role'), agence: fd.get('agence'), n1_id: fd.get('n1_id') || null };
    const delai_jours = Math.max(0, parseInt(fd.get('delai_jours'), 10) || 0);
    const mail_copie = (fd.get('mail_copie') || '').trim() || null;
    if (S.edit) {
      const { error } = await sb.from('profiles').update({ ...row, delai_jours, mail_copie }).eq('id', S.edit);
      if (error) throw error;
      toast('Compte modifié.');
    } else {
      const email = fd.get('email').trim();
      const password = C.MAILS ? undefined : fd.get('password');
      const { error } = await sb.functions.invoke('invite-user', { body: { ...row, email, password, redirect: location.origin + location.pathname } });
      if (error) throw await fnErr(error);
      await sb.from('profiles').update({ delai_jours, mail_copie }).eq('email', email);
      toast(C.MAILS ? 'Invitation envoyée à ' + email + '.' : 'Compte créé. Donne à ' + row.nom + ' son email et son mot de passe provisoire.');
    }
    S.edit = null; await loadAll(); render();
  },
  async produit(fd) {
    const prix = parseFloat(String(fd.get('prix')).replace(',', '.'));
    if (isNaN(prix)) throw new Error('Prix invalide.');
    const tailles = fd.get('tailles').split(',').map((s) => s.trim()).filter(Boolean);
    const row = { nom: fd.get('nom').trim(), ref: fd.get('ref').trim() || null, categorie: fd.get('categorie'), fournisseur_id: Number(fd.get('fournisseur_id')), prix, unite: fd.get('unite').trim() || 'pièce', tailles: tailles.length ? tailles : null };
    const file = fd.get('photo');
    if (file && file.size) {
      const path = Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_');
      const { error } = await sb.storage.from('photos').upload(path, file);
      if (error) throw error;
      row.photo_url = sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    }
    const { error } = S.edit ? await sb.from('produits').update(row).eq('id', S.edit) : await sb.from('produits').insert(row);
    if (error) throw error;
    toast(S.edit ? 'Produit modifié.' : 'Produit ajouté au catalogue.');
    S.edit = null; await loadAll(); render();
  },
  async reception(fd) {
    const items = [];
    for (const [k, v] of fd.entries()) if (k.startsWith('q_') && Number(v) > 0) items.push({ ligne_id: Number(k.slice(2)), qte: Number(v) });
    if (!items.length) throw new Error('Saisis au moins une quantité.');
    const { error } = await sb.rpc('recevoir', { p_demande: Number(fd.get('demande')), p_items: items });
    if (error) throw error;
    closeDoc(); await loadAll(); render(); toast('Réception enregistrée. Le stock Excel de l’agence sera mis à jour à sa prochaine ouverture.');
  },
  async speciale(fd) {
    const d_ = fd.getAll('l_designation'), q_ = fd.getAll('l_qte'), p_ = fd.getAll('l_pu');
    const lignes = d_.map((d, i) => ({ designation: d.trim(), qte: parseInt(q_[i], 10), pu: num(p_[i]) }));
    if (lignes.some((l) => isNaN(l.pu))) throw new Error('Un prix est invalide.');
    const port = num(fd.get('port'));
    if (port > 0) lignes.push({ designation: 'Frais de port', qte: 1, pu: port });
    let devis_path = null;
    const file = fd.get('devis');
    if (file && file.size) {
      devis_path = S.me.id + '/' + Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_');
      const { error } = await sb.storage.from('devis').upload(devis_path, file);
      if (error) throw error;
    }
    const p = { fournisseur: fd.get('fournisseur'), devis_num: fd.get('devis_num'), lignes,
      agence: fd.get('agence'), commentaire: fd.get('commentaire'), urgent: fd.get('urgent') === 'on', devis_path };
    const { data: id, error } = await sb.rpc('creer_speciale', { p });
    if (error) throw error;
    await loadAll(); S.screen = 'demandes'; render();
    toast('Demande ' + daNum(id) + ' envoyée au responsable achats.');
  },
  async prestation(fd) {
    const p = Object.fromEntries(fd.entries());
    p.tj = parseFloat(String(p.tj).replace(',', '.'));
    p.jours = parseInt(p.jours, 10);
    if (isNaN(p.tj)) throw new Error('TJ invalide.');
    if (p.date_fin < p.date_debut) throw new Error('La date de fin est avant la date de démarrage.');
    const { data: id, error } = await sb.rpc('creer_prestation', { p });
    if (error) throw error;
    if (S.me.mail_copie) notifier({ type: 'prestation', ids: [id] });
    await loadAll(); S.screen = 'demandes'; render();
    toast('Demande ' + daNum(id) + (S.me.n1_id ? ' envoyée à ton N+1.' : ' transmise au responsable achats.'));
  },
  async agence(fd) {
    const nom = fd.get('nom').trim();
    if (S.agences.some((a) => a.toLowerCase() === nom.toLowerCase())) throw new Error('Cette agence existe déjà.');
    const { error } = await sb.from('agences').insert({ nom });
    if (error) throw error;
    await loadAll(); render(); toast('Agence ' + nom + ' ajoutée.');
  },
  async fournisseur(fd) {
    const row = { nom: fd.get('nom').trim(), email: fd.get('email').trim() || null, tel: fd.get('tel').trim() || null };
    const { error } = S.edit ? await sb.from('fournisseurs').update(row).eq('id', S.edit) : await sb.from('fournisseurs').insert(row);
    if (error) throw error;
    toast(S.edit ? 'Fournisseur modifié.' : 'Fournisseur ajouté.');
    S.edit = null; await loadAll(); render();
  }
};

/* ---------- écouteurs ---------- */
document.addEventListener('click', async (e) => {
  if (e.target.id === 'modal') return closeDoc();
  const el = e.target.closest('[data-a]');
  if (!el || !ACTIONS[el.dataset.a]) return;
  el.disabled = true;
  try { await ACTIONS[el.dataset.a](el.dataset.k, el.dataset.d, el); } catch (err) { fail(err); } finally { if (el.isConnected) el.disabled = false; }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const b = f.querySelector('[type=submit]');
  if (b) b.disabled = true;
  try { await FORMS[f.dataset.form](new FormData(f)); } catch (err) { fail(err); } finally { if (b && b.isConnected) b.disabled = false; }
});
function joursOuvres(a, b) {
  const d0 = new Date(a + 'T12:00:00'), d1 = new Date(b + 'T12:00:00');
  if (isNaN(d0) || isNaN(d1) || d1 < d0) return 0;
  const f = new Set();
  for (let y = d0.getFullYear(); y <= d1.getFullYear(); y++) {
    ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].forEach((md) => f.add(y + '-' + md));
    const g = y % 19, c = Math.floor(y / 100), h = (c - Math.floor(c / 4) - Math.floor((8 * c + 13) / 25) + 19 * g + 15) % 30;
    const i = h - Math.floor(h / 28) * (1 - Math.floor(29 / (h + 1)) * Math.floor((21 - g) / 11));
    const j = (y + Math.floor(y / 4) + i + 2 - c + Math.floor(c / 4)) % 7;
    const l = i - j, m = 3 + Math.floor((l + 40) / 44), dd = l + 28 - 31 * Math.floor(m / 4);
    const paques = new Date(y, m - 1, dd, 12);
    [1, 39, 50].forEach((n) => { const x = new Date(paques); x.setDate(x.getDate() + n); f.add(x.toISOString().slice(0, 10)); });
  }
  let n = 0;
  for (const x = new Date(d0); x <= d1; x.setDate(x.getDate() + 1)) {
    const w = x.getDay();
    if (w !== 0 && w !== 6 && !f.has(x.toISOString().slice(0, 10))) n++;
  }
  return n;
}
function majPrestation(e) {
  const f = e.target.closest('form[data-form=prestation]');
  if (!f) return;
  if (e.target.name === 'date_debut' || e.target.name === 'date_fin') {
    const n = joursOuvres(f.date_debut.value, f.date_fin.value);
    if (n) f.jours.value = n;
  }
  const tj = parseFloat(String(f.tj.value).replace(',', '.')) || 0;
  $('#presta-total').textContent = eur(tj * (parseInt(f.jours.value, 10) || 0));
}
document.addEventListener('change', majPrestation);
document.addEventListener('input', majPrestation);
document.addEventListener('input', (e) => {
  if (e.target.id === 'qa') { S.adminSearch = e.target.value; $('#admin-prod').innerHTML = lignesProduitsAdmin(); return; }
  if (e.target.id === 'q') {
    S.search = e.target.value;
    if (S.screen !== 'catalogue') {
      S.screen = 'catalogue'; S.edit = null; render();
      const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
    } else $('#grid').innerHTML = gridHtml();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.on === 'taille') { S.tailles[e.target.dataset.id] = e.target.value; $('#grid').innerHTML = gridHtml(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('show')) closeDoc(); });

init().catch(fail);
