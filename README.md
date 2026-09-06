# Participation orale relevée par les pairs

Deux pages web autonomes pour relever la participation orale en classe : deux élèves
observateurs tirés au sort relèvent les interventions de leurs camarades sur leur iPad, le
professeur fusionne les deux relevés, arbitre les écarts et valide.

Aucun serveur, aucune base de données, aucun compte. Tout reste sur les appareils. Les échanges
se font par QR code, dans les deux sens.

## Construire

```bash
python3 build.py
```

Produit `A01-professeur.html` et `A01-observateur.html` à la racine. Ces deux fichiers sont
générés : les corrections se font dans `src/`.

## Mettre en ligne

GitHub Pages, branche `main`, dossier racine. **HTTPS obligatoire** : sans lui, l'accès à la
caméra est refusé et rien ne fonctionne.

Le site doit vivre sur une **origine qui lui est propre** — pas dans un sous-dossier d'un site
existant. Le stockage du navigateur est cloisonné par origine : partager l'origine reviendrait à
exposer les listes de classes à tout autre script servi depuis le même domaine.

## Utiliser

1. Côté professeur, créer une classe : import d'un export `.xlsx` ou `.csv`, ou saisie manuelle.
   Choisir un modèle d'évaluation.
2. Ouvrir une séance, tirer les deux observateurs au sort, afficher les deux codes.
3. Chaque observateur scanne son code et relève la séance.
4. En fin de séance, scanner les deux QR de restitution, arbitrer les écarts, valider.
5. Exporter une sauvegarde chaque semaine. Safari efface le stockage après sept jours sans
   visite.

## Licence des bibliothèques intégrées

`vendor/qrcode.min.js` — qrcode-generator, licence MIT.
`vendor/jsQR.min.js` — jsQR, licence Apache 2.0.
