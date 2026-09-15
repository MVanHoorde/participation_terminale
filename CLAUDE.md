# Consignes de travail sur ce dépôt

## Ce que fait le projet

Deux pages web autonomes qui servent à relever la participation orale en classe de
physique-chimie au lycée. Deux élèves observateurs, tirés au sort à chaque séance, relèvent les
interventions de leurs camarades sur leur iPad. Le professeur reçoit les deux relevés, les
fusionne, arbitre les écarts et valide.

- `A01-observateur.html` — utilisé par les deux élèves observateurs
- `A01-professeur.html` — utilisé par l'enseignant

Cible : iPad sous Safari, en classe, souvent sans réseau. Environ 33 élèves par classe.

## Contraintes d'architecture — décidées, ne pas rediscuter

1. **Aucun serveur, aucune base de données, aucun compte.** Tout vit dans `localStorage`.
2. **Aucune ressource chargée depuis le réseau.** Pas de CDN, pas de police distante, pas
   d'appel `fetch` sortant. Les pages doivent fonctionner en mode avion.
3. **Une page = un seul fichier HTML autonome**, produit par `build.py`.
4. **Le QR code est le seul transport**, dans les deux sens. L'AirDrop a été écarté : il est
   souvent bloqué par le MDM de l'établissement.
5. **Aucun nom d'élève dans le dépôt ni sur l'hébergeur.** Les listes ne circulent que dans les
   charges utiles des QR et dans le `localStorage` du professeur.
6. **Pas de dépendance npm ajoutée.** Les deux bibliothèques de `vendor/` sont figées.

## Principes pédagogiques à préserver

Ils ont été discutés longuement, ils priment sur toute considération technique.

1. **Un oubli d'observateur ne pénalise pas l'élève observé.** Les points relevés par un seul
   observateur sont retenus par défaut. Seuls les écarts marqués remontent au professeur pour
   arbitrage individuel.
2. **Aucune catégorie négative.** Les élèves ne signalent jamais un comportement, seulement des
   interventions. Ne jamais proposer d'ajouter « perturbation » ou équivalent.
3. **Une hypothèse fausse vaut autant qu'un raisonnement abouti.** C'est volontaire : l'erreur
   doit rester possible à voix haute.
4. **L'objectif de période est fixe, jamais relatif à la classe.** Pas de classement déguisé.
5. **Le professeur décide.** Les élèves relèvent, ils ne notent pas.

## Construire

```bash
python3 build.py
```

Assemble `src/` et `vendor/` en deux fichiers HTML à la racine. **Les fichiers
`A01-*.html` de la racine sont générés : ne jamais les éditer directement.** Toute correction
se fait dans `src/`, puis on relance le script.

Après chaque modification, vérifier au minimum :

```bash
python3 build.py
node --check <(python3 -c "import re,pathlib;print(re.findall(r'<script>([\s\S]*?)</script>',pathlib.Path('A01-professeur.html').read_text())[-1])")
```

## Organisation de src/

| Fichier | Rôle |
|---|---|
| `common.css` | Styles partagés par les deux pages |
| `common.js` | Barème par défaut, modèles d'évaluation, encodage et décodage des charges QR, générateur et lecteur de QR |
| `import.js` | Lecture `.xlsx` et `.csv`, détection de l'en-tête, mappage des colonnes, découpage `NOM Prénom`, lecture du trombinoscope PDF |
| `app-prof.js` | Toute la logique de l'application professeur |
| `observateur.src.html` | Gabarit + logique de l'application observateur |
| `professeur.src.html` | Gabarit de l'application professeur |

Les marqueurs `/*__CSS__*/`, `/*__COMMON__*/`, `/*__QRGEN__*/`, `/*__JSQR__*/` et `/*__APP__*/`
sont remplacés à la construction.

## Pièges déjà rencontrés

- **Encodage UTF-8 du QR.** `qrcode-generator` encode en latin-1 par défaut. Avec un prénom
  accentué, `jsQR` renvoie une chaîne vide et tout casse en silence. La ligne
  `qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']` dans `build.py` est obligatoire.
- **Lecture `.xlsx` sans bibliothèque.** On décompresse le zip avec `DecompressionStream`
  (natif, Safari 16.4+) et on lit le XML avec `DOMParser`. Ne pas ajouter SheetJS.
- **Export École Directe.** L'en-tête n'est pas en première ligne, et nom et prénom sont réunis
  dans une seule colonne sous la forme `NOM Prénom`, patronyme en capitales, y compris pour les
  noms composés de plusieurs mots.
- **Safari efface le stockage** d'un site après sept jours sans visite. D'où l'ajout à l'écran
  d'accueil et l'alerte de sauvegarde.
- **Le `localStorage` est cloisonné par origine**, pas par dossier. Ce site doit vivre sur une
  origine qui lui est propre.
- **Changer d'URL fait perdre les données.** Exporter une sauvegarde avant toute migration.
- **Les photos passent par une planche unique, pas par 21 fichiers.** Un seul JPEG en
  grille de sept colonnes, cellules de 48×64, découpé à l'affichage avec
  `background-position`. Vingt et une images séparées pèsent 19,8 Ko contre 13,3 Ko pour la
  planche : l'écart, ce sont vingt en-têtes JPEG en trop.
- **Fragments de 900 caractères.** C'est ce qui maintient chaque QR en version 22, soit
  105 modules — la densité qui se lit de façon fiable d'un iPad à l'autre. Un QR version 40
  diviserait le nombre de fragments par trois mais devient capricieux à la lecture, et un
  transfert raté coûte plus cher en classe que trois secondes de défilé.
- **L'empreinte de la planche est vérifiée à l'arrivée.** Sans elle, un fragment abîmé donne
  une image tronquée sans que personne s'en aperçoive.
- **Trombinoscope École Directe.** C'est un PDF produit par WinDev, sans bibliothèque pour le
  lire : on analyse la structure à la main, on décompresse les pages avec `DecompressionStream`
  et on rattache à chaque photo (JPEG 96×128) le texte posé juste dessous, sur une ou deux
  lignes. Les élèves sans photo reçoivent tous la même silhouette, un seul objet répété :
  toute image posée plus d'une fois est écartée, sinon vingt élèves héritent d'une fausse
  photo. Le rattachement passe toujours par un écran de vérification.
- **Les photos ne quittent jamais l'appareil du professeur autrement que par QR.** Elles
  vivent dans `classes[cls].photos`, partent donc dans les sauvegardes, et sont effacées de
  l'iPad de l'élève par « Effacer et quitter » en fin de séance.

## Formats des charges QR

- Séance, du professeur vers l'observateur :
  `PVS3|jeton|poste|classe|date|plafond|barème|planche|noms`
- Relevé, de l'observateur vers le professeur :
  `PVR2|jeton|départ|évènements|absents`
- Planche de photos, du professeur vers l'observateur, en fragments :
  `PVP1|planche|index|total|données base64`

Toute modification de ces formats casse la compatibilité entre les deux pages : incrémenter le
numéro de version et adapter les deux côtés dans le même commit.

## Reste à faire, par ordre de priorité

1. **Chiffrer le côté professeur** — phrase de passe à l'ouverture, dérivation de clé par
   `crypto.subtle`, chiffrement de tout ce qui est stocké. Aujourd'hui les listes de classes
   sont en clair. C'est le point le plus important.
2. **Notion de période** — l'objectif est dit « de période » mais le suivi cumule toute
   l'année. Il faut des bornes : remise à zéro des points, report du compteur de rôles.
3. **Purge automatique** du relevé sur l'iPad de l'élève après transmission. Les photos, elles,
   partent déjà avec « Effacer et quitter ».
4. **Verrouillage automatique** de la page professeur après quelques minutes d'inactivité.
5. **Fusion d'élève** quand l'orthographe d'un nom déjà enregistré est corrigée : son historique
   se détache aujourd'hui.
6. Import d'un export multi-classes (seule la première feuille est lue).

## Ce qu'il ne faut pas faire

- Ajouter un backend, une authentification en ligne, une synchronisation cloud.
- Committer un fichier de sauvegarde `.json` : il contient des données nominatives d'élèves.
- Modifier les fichiers générés de la racine.
- Élargir le périmètre sans le signaler explicitement.
