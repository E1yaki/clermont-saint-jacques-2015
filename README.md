# Clermont Saint-Jacques 2015 — Vidéothèque privée

Interface statique destinée à GitHub Pages. Les vidéos restent dans le bucket R2 privé et transitent par le Worker Cloudflare.

## Configuration

L'URL du Worker est configurée dans `app.js` :

```js
const API = 'https://clermont-videotheque.gariffi.workers.dev';
```

## Publication GitHub Pages

1. Ajouter les quatre fichiers (`index.html`, `styles.css`, `app.js`, `README.md`) à la racine du dépôt `E1yaki/clermont-saint-jacques-2015`.
2. Dans GitHub, ouvrir **Settings → Pages**.
3. Dans **Build and deployment**, choisir **Deploy from a branch**.
4. Choisir la branche `main` et le dossier `/ (root)`, puis enregistrer.
5. Attendre la publication. L'adresse sera normalement `https://e1yaki.github.io/clermont-saint-jacques-2015/`.

## Accès visiteurs

Le code secret configuré dans le secret Cloudflare `VIEWER_TOKEN` doit être partagé sous forme de fragment d'URL :

`https://e1yaki.github.io/clermont-saint-jacques-2015/#access=VOTRE_CODE_SECRET`

Le fragment après `#` n'est pas envoyé au serveur web. Le navigateur l'échange immédiatement contre une session et nettoie l'adresse affichée.

## Sécurité et limites de cette première version

- Le bucket R2 doit rester privé, sans accès public `r2.dev`.
- Ne jamais placer `ADMIN_PASSWORD`, `VIEWER_TOKEN` ou `SESSION_SECRET` dans les fichiers GitHub.
- Les sessions sont conservées dans `sessionStorage` et expirent selon le Worker (12 h admin, 24 h visiteur).
- Le ticket de lecture vidéo ajouté au Worker permet au lecteur HTML5 d'utiliser les requêtes HTTP Range sans exposer le bucket.
- Le Worker actuel ne propose pas encore de route pour interrompre/nettoyer un upload abandonné. En cas d'échec d'envoi, vérifier la table `uploads` et le stockage avant de recommencer plusieurs fois.
- Les statistiques de durée sont estimées à partir de signaux de progression envoyés toutes les 30 secondes, pas à partir d'une mesure certifiée.
- Cette première version n'inclut pas de miniature vidéo générée automatiquement ni de modification des métadonnées après publication.

## À vérifier après publication

1. Ouvrir la page publique sans fragment : l'écran de connexion doit apparaître.
2. Ouvrir le lien avec le fragment secret : la vidéothèque doit s'ouvrir.
3. Se connecter à l'administration avec le mot de passe Cloudflare.
4. Ajouter un petit MP4 de test et vérifier la lecture, le déplacement dans la vidéo et la suppression.
