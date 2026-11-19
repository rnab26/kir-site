# חיפוי ישראל · Hipui Israel — site de revêtements muraux

Site statique trilingue (hébreu par défaut, anglais sur `/en/`, français sur `/fr/`) généré à partir du catalogue Google Sheets
« קטלוג פלטות וסרגלים — מחירים ». 231 produits, ~500 pages, aucun serveur ni abonnement : hébergement gratuit sur GitHub Pages.

Showroom : צבי שכטרמן 2, נתניה · WhatsApp / téléphone : 055-294-2609 (`data/site.json`).

## Ce que contient le site

| Page | Rôle |
|---|---|
| Accueil | Mur rainuré « éclairé à la souris », matières, studio, sélection, FAQ, bloc « venez au showroom » + carte |
| Catalogue | Tous les produits regroupés par famille (variantes), filtres type / aspect / couleur, recherche, tri par prix |
| 14 pages catégories / 8 pages « aspects » | Une page = un mot-clé (lames acoustiques, effet bois, marbre, travertin…) |
| Fiches produit | Plaque entière en perspective + loupe, photo réelle, variantes, prix TTC live, stock live, quantité, ajout au panier |
| Panier `/cart/` | Quantités, total TTC, articles sur commande signalés |
| Commande `/checkout/` | Coordonnées, livraison ou retrait au showroom, envoi de la commande sur WhatsApp |
| Confirmation `/order/` + Mes commandes `/orders/` | Numéro HI-AAMMJJ-XXXX, récapitulatif, impression, renvoi WhatsApp (historique gardé dans le navigateur du client) |
| Contact | WhatsApp, téléphone, adresse, horaires, Google Maps intégré, boutons Maps / Waze |
| Pages légales | Conditions générales, confidentialité, livraison/retours (loi israélienne 14 jours), déclaration d'accessibilité (IS 5568) |
| Studio, calculateur, guide | Simulation de mur, calcul du nombre de lames (+ ajout direct au panier), contenu SEO |

Sur toutes les pages : sélecteur de langue עב / EN / FR dans l'en-tête (et suggestion automatique selon la langue du navigateur),
bouton WhatsApp flottant (message pré-rempli avec le produit consulté), menu d'accessibilité, « vus récemment ».

Google Search Console : propriété `https://rnab26.github.io/kir-site/` validée par le fichier `src/google98de61acccef0461.html`
(ne pas le supprimer) et sitemap envoyé le 2026-11-19.

SEO : `sitemap.xml` (hreflang he/en/fr + images), `robots.txt` (robots IA autorisés), `llms.txt`, `merchant-feed.xml`,
schema.org (entreprise locale avec adresse/horaires/carte, ProductGroup/Product/Offer, FAQ, fil d'Ariane).

**Jamais publié** : prix d'achat, TVA d'achat, prix des fournisseurs/concurrents. Seule la colonne « המחיר שלנו כולל מע״מ » apparaît.

## Gérer le site depuis le Google Sheet (en direct)

Dans l'onglet du catalogue, chaque ligne a deux cases :

- **« במלאי (אתר) »** (colonne Q) : cochée = en stock ; décochée = « sur commande » sur le site.
- **« להסיר מהאתר »** (colonne R) : cochée = le produit disparaît du site (plus de stock et plus de réassort).

Prix (colonne « המחיר שלנו כולל מע״מ »), références, descriptions, dimensions : toute modification d'une ligne est reprise
automatiquement. Un prix vide s'affiche « prix sur demande ».

Comment ça s'actualise :

1. **En direct dans le navigateur** : chaque visiteur lit l'onglet publié « לאתר » (CSV). Prix, stock et produits retirés
   sont mis à jour dans la page sous ~5 minutes (délai du cache Google), sans republier.
2. **Toutes les 10 minutes sur GitHub** (*Actions → Sync catalogue*) : l'onglet est relu, les nouveaux produits et leurs photos
   sont ajoutés (traduction automatique marquée `frAuto`), puis le site est reconstruit pour Google.

L'onglet « לאתר » se remplit tout seul par formules : ne pas le modifier à la main. Seul cet onglet est publié sur le Web.

## Commandes et paiement

Pas de paiement en ligne pour l'instant : la commande arrive sur WhatsApp avec le détail (produits, quantités, total TTC,
coordonnées, livraison ou retrait). Vous confirmez disponibilité, livraison et paiement avec le client.
Pour ajouter un paiement par carte plus tard (Grow/Meshulam, PayPlus, Tranzila…), il suffira de remplacer l'étape WhatsApp
de `/checkout/` par le lien de paiement du prestataire.

## Textes et traductions

- `data/content.json` (hébreu + français), `data/content-en.json` (anglais), `data/content-shop.json` (panier, commande, pages légales, accessibilité).
- Noms de produits : français dans `products.json` (`fr`), anglais généré par règles depuis l'hébreu (`data/he-en.json`) — on peut forcer un nom avec `"en"` dans `products.json`.
- Les pages légales sont des modèles : à faire relire (nom légal, numéro d'entreprise ע.מ/ח.פ, délais).

## Construire et prévisualiser en local (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 -SiteUrl http://localhost:8765
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

Puis ouvrez http://localhost:8765. Aucun Node/Python requis. `scripts/make-assets.ps1` régénère le logo et l'image de partage.

## Nom de domaine

1. Achetez un domaine (ex. `.co.il`), puis dans GitHub : *Settings → Pages → Custom domain*.
2. Chez le registraire, ajoutez l'enregistrement DNS indiqué par GitHub.
3. Mettez la nouvelle adresse dans `baseUrl` de `data/site.json`.

## Structure

```
build.ps1               générateur (PowerShell 5.1 / 7, ASCII uniquement)
data/                   products.json, content*.json, he-en.json, taxonomy.json, site.json
src/assets/             css/style.css, js/app.js (panier, commandes, données live), img/
scripts/                sync-sheet.ps1, process-images.ps1, ai-upscale.ps1, make-assets.ps1, serve.ps1
docs/SEO-strategie.md   mots-clés, plan de contenu, actions de référencement
.github/workflows/      deploy.yml (GitHub Pages), sync.yml (Sheet toutes les 10 min)
```

## Photos HD (sur le PC)

- `scripts/process-images.ps1` : repère les cadres rouges des photos sources, recadre le produit redressé en pleine résolution, corrige la lumière et génère : la photo réelle (`tex/`), le rendu « plaque entière + loupe » (`pack/`) et la vignette (`thumb/`).
- `scripts/ai-upscale.ps1` : rend nettes les photos trop petites avec l'IA Real-ESRGAN. Relancer ensuite `process-images.ps1` puis `build.ps1`.
- Les photos sources et l'outil IA sont dans `../tools-ext/` (non publiés).
