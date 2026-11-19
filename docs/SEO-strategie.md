# Stratégie SEO et visibilité IA

Objectif : que le site soit trouvé, lu et cité correctement par Google et par les assistants IA, avec des standards publics
(HTML lisible, schema.org, sitemap, robots.txt, llms.txt). Personne ne peut « forcer » une recommandation d'IA : on rend
les faits clairs et accessibles, c'est tout.

## Les 5 actions qui comptent (par impact)

| # | Action | Qui | Statut |
|---|---|---|---|
| 1 | Renseigner WhatsApp / téléphone / ville dans `data/site.json` (conversion + données LocalBusiness) | Vous | À faire |
| 2 | Vrai nom de marque + domaine `.co.il` (le `robots.txt` et la confiance Google en dépendent) | Vous | À faire |
| 3 | Google Search Console : vérifier le site, soumettre `sitemap.xml` | Vous (10 min) | À faire |
| 4 | Fiche Google Business Profile si vous avez un showroom/dépôt (catégorie « Magasin de revêtements muraux ») | Vous | À faire |
| 5 | Compléter les ~120 prix et dimensions manquants + ajouter des photos d'ambiance réelles | Vous + Claude | À faire |

Déjà en place dans le site : HTML statique (lisible sans JavaScript), balises title/description uniques, canonical,
hreflang he/fr, sitemap avec images, données structurées (Organization, WebSite, BreadcrumbList, ItemList, Product + Offer
quand le prix est connu, FAQPage, Article), `robots.txt` ouvrant GPTBot, ClaudeBot, PerplexityBot, Google-Extended…,
`llms.txt`, Open Graph, flux Google Merchant Center, site rapide (aucun framework, images en lazy-loading).

## Carte des mots-clés (à valider dans Google Keyword Planner / Search Console)

Volumes non mesurés ici (outil Ahrefs non connecté) : la priorité est basée sur l'intention d'achat.

### Hébreu (marché principal)

| Mot-clé | Intention | Page cible |
|---|---|---|
| חיפוי קירות · חיפוי קיר | Générique, forte | `/` et `/catalog/` |
| פאנלים לקיר · פאנלים דקורטיביים לקיר | Achat | `/catalog/`, `/c/3d-panels/` |
| סרגלים לקיר · סרגלים מחורצים לקיר · חיפוי סרגלים | Achat | `/c/slats/` |
| חיפוי קיר טלוויזיה · קיר טלוויזיה מחופה | Projet | `/c/slats/` + article à écrire |
| חיפוי קיר דמוי עץ · פאנלים דמוי עץ | Achat | `/look/wood-look/` |
| חיפוי דמוי שיש · פלטות דמוי שיש · לוחות PVC דמוי שיש | Achat | `/look/marble-look/` |
| חיפוי טרוורטין · דמוי טרוורטין לקיר | Tendance | `/look/travertine-look/` |
| חיפוי אבן גמיש · אבן גמישה לקיר | Achat | `/c/stone/` |
| לוחות SPC לקיר · פאנל SPC | Technique | `/c/panels/` + guide |
| חיפוי אקוסטי לקיר · פאנל אקוסטי | Achat | `/look/fabric-look/`, `/c/flexible-panels/` |
| קרניזים לתקרה · שיפולים · פרופילי עיטור | Accessoires | `/c/cornices/`, `/c/skirting/`, `/c/moldings/` |
| מראת LED עגולה · מראה עם תאורה אחורית | Achat | `/c/led-mirrors/` |
| דק WPC · חיפוי חוץ | Achat | `/c/decking/`, `/c/outdoor/` |
| + nom de ville (תל אביב, ירושלים, נתניה, אשדוד, חיפה…) | Local | Fiche Google + page contact quand l'adresse est connue |

### Français (communauté francophone en Israël, peu concurrencée)

| Mot-clé | Page cible |
|---|---|
| revêtement mural Israël · panneau mural Israël | `/fr/` |
| tasseaux muraux · lames murales rainurées | `/fr/c/slats/` |
| panneau effet marbre · lambris PVC effet marbre | `/fr/look/marble-look/` |
| panneau effet travertin | `/fr/look/travertine-look/` |
| pierre flexible murale | `/fr/c/stone/` |
| panneau acoustique bois | `/fr/look/fabric-look/` |
| rénovation appartement Israël décoration murale | `/fr/guide/` + articles |

## Plan de contenu (1 article toutes les 2 semaines)

Chaque article : une question réelle de client, réponse dans le premier paragraphe, liens vers 3–6 produits.

1. קיר טלוויזיה מסרגלים: מדריך מידות, מרווחים ותאורה / Mur TV en tasseaux : mesures et éclairage
2. PVC או SPC — מה עדיף לחדר רחצה? / PVC ou SPC pour la salle de bain ?
3. טרוורטין בלי אבן: 5 דרכים לשלב דמוי טרוורטין בבית
4. כמה עולה לחפות קיר? חישוב לפי מ״ר (avec le calculateur du site)
5. ראש מיטה מחופה: סרגלים מול פאנל אקוסטי
6. Avant / après : 3 projets clients (photos réelles = meilleur contenu possible)
7. איך מתקינים סרגלים בדבק — שלב אחר שלב (vidéo courte + texte)
8. מראות LED: איך בוחרים גודל וגוון תאורה

## Visibilité hors site

- Google Business Profile (adresse, horaires, photos, avis réels de clients — jamais d'avis inventés).
- Google Merchant Center : fiches gratuites dans Google Shopping avec `merchant-feed.xml` (produits avec prix uniquement ; nécessite d'y déclarer livraison et retours).
- Instagram / Pinterest : les textures et le studio sont très visuels ; lien vers les pages « aspects ».
- Annuaires : Easy (איזי), B144, groupes Facebook francophones d'Israël (Netanya, Ashdod, Jérusalem).

## Test de visibilité IA (à refaire chaque mois, noter les résultats tels quels)

Poser à ChatGPT, Claude, Perplexity et Gemini :

- « איפה קונים חיפוי קיר דמוי טרוורטין בישראל? »
- « סרגלים מחורצים לקיר מחיר »
- « Où acheter des panneaux muraux effet marbre en Israël ? »

Noter : la marque apparaît-elle, quels concurrents, quelles sources sont citées. Les résultats varient d'une fois à l'autre :
c'est la tendance sur plusieurs mois qui compte. Premier contrôle utile : 30 jours après la mise en ligne et l'indexation.
