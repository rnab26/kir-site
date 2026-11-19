# KIR · Wall Studio — site catalogue de revêtements muraux

Site statique bilingue (hébreu par défaut, français sur `/fr/`) généré à partir du catalogue Google Sheets
« קטלוג פלטות וסרגלים — מחירים ». 231 produits, 520 pages, aucun serveur ni abonnement : hébergement gratuit sur GitHub Pages.

## Ce que contient le site

| Page | Rôle |
|---|---|
| Accueil | Mur rainuré « éclairé à la souris », matières, studio 3D, sélection, FAQ |
| Catalogue | Tous les produits, filtres type / aspect / couleur, recherche, tri par prix |
| 14 pages catégories | Lames, panneaux PVC/SPC, pierre flexible, panneaux 3D, miroirs LED… (une page = un mot-clé) |
| 8 pages « aspects » | Effet bois, travertin, marbre, tissu, béton, pierre, noir, blanc |
| 231 fiches produit | Photo zoomable, dimensions, prix TTC, prix au m² estimé, studio, calculateur |
| Studio | Pièce en perspective : on applique une texture au mur, jour/soir |
| Calculateur | Nombre de lames/panneaux + coût estimé selon les dimensions du mur |
| Guide | Contenu SEO : lames ou panneaux, PVC vs SPC, mesures, finitions |
| Liste de devis | Panier sans paiement, envoyé en un clic sur WhatsApp |

Fichiers SEO générés automatiquement : `sitemap.xml` (avec hreflang et images), `robots.txt` (robots IA autorisés),
`llms.txt`, `merchant-feed.xml` (Google Merchant Center), données structurées schema.org sur chaque page.

**Jamais publié** : prix d'achat, TVA d'achat, prix des concurrents. Seule la colonne « המחיר שלנו כולל מע״מ » apparaît.

## À faire en premier (5 minutes)

Ouvrez `data/site.json` et remplissez :

- `whatsapp` : numéro au format international sans `+` (ex. `972501234567`). **Indispensable** pour que la liste de devis soit envoyable.
- `phone`, `email`, `instagram`, `city`, `address`, `openingHours` si vous en avez.
- `brand` / `brandHe` / `brandFull` : « KIR » est un nom provisoire, remplacez-le par votre vraie marque.
- `googleSiteVerification` : le code fourni par Google Search Console (balise meta).

Poussez sur GitHub : le site se reconstruit et se redéploie tout seul (onglet *Actions*).

## Mettre à jour le catalogue

Les produits sont dans `data/products.json` (une ligne par produit) :

```json
{"sku":"082 20325","c":"slat","he":"…","fr":"…","s":"20/2.90","f":"","p":44,"oos":false,"img":"<id Google Drive>"}
```

- `c` : catégorie (`slat`, `panel`, `flex`, `deco`, `stone`, `outdoor`, `deck`, `mirror`, `cornice`, `skirting`, `molding`, `column`, `ornament`, `adhesive`)
- `s` : `largeur cm/longueur m` · `f` : `m` mat, `g` brillant · `p` : prix TTC ou `null` (= « prix sur demande ») · `oos` : `true` = sur commande
- `img` : l'identifiant Drive de la photo (celui de la formule `IMAGE` de la colonne « תמונה »)

Après avoir ajouté des produits : `scripts/fetch-images.ps1` télécharge les nouvelles photos. Le plus simple est de demander
à Claude : « synchronise le site avec le Google Sheet ».

Aspects et couleurs sont déduits automatiquement de la description hébraïque (règles dans `data/taxonomy.json`).
Tous les textes du site (hébreu et français) sont dans `data/content.json`.

## Construire et prévisualiser en local (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 -SiteUrl http://localhost:8765
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

Puis ouvrez http://localhost:8765. Aucun Node/Python requis.

## Nom de domaine

1. Achetez un domaine (ex. `.co.il`), puis dans GitHub : *Settings → Pages → Custom domain*.
2. Chez le registraire, ajoutez l'enregistrement DNS indiqué par GitHub.
3. Mettez la nouvelle adresse dans `baseUrl` de `data/site.json`.

Tant que le site est sur `utilisateur.github.io/kir-site`, le `robots.txt` n'est pas à la racine du domaine : soumettez le sitemap directement dans Search Console.

## Structure

```
build.ps1               générateur (PowerShell 5.1 / 7, ASCII uniquement)
data/                   products.json, content.json (textes), taxonomy.json, site.json, images.json
src/assets/             css/style.css, js/app.js, img/ (photos produits, logo, image de partage)
scripts/                fetch-images.ps1, make-assets.ps1, serve.ps1
docs/SEO-strategie.md   mots-clés, plan de contenu, actions de référencement
.github/workflows/      déploiement automatique GitHub Pages
```
