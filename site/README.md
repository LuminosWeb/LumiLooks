# Site lumilooks.luminosweb.com

Site statique de présentation de LumiLooks (HTML, CSS et JavaScript, sans étape de build).

## Mise en ligne

1. Copiez le contenu de ce dossier à la racine du site sur le serveur.
2. Placez dans `downloads/` les fichiers de la [Release](https://github.com/LuminosWeb/LumiLooks/releases/latest) correspondante :
   `LumiLooks-<version>-Setup.exe`, `LumiLooks-<version>-macos-arm64.zip`, `LumiLooks-<version>-macos-x64.zip`,
   `lumilooks_<version>_amd64.deb`, `LumiLooks-<version>-linux-x86_64.AppImage` et `SHA256SUMS.txt`.
3. Vérifiez-les : `cd downloads && sha256sum -c SHA256SUMS.txt`.

Le serveur doit accepter les fichiers de plus de 100 Mo (AppImage ≈ 191 Mo). Les installateurs ne sont pas versionnés dans Git.

## Contenu

- Thème clair par défaut, thème sombre au choix (mémorisé dans le navigateur).
- Hero avant/après (Kodak Portra 400), bouton « Télécharger pour Windows », boutons macOS / Linux selon le système détecté.
- Démo en ligne : le moteur couleur (`lumi-engine.js`) étalonne une photo ou une vidéo dans le navigateur, sans envoi.
- Captures de l’application 2.0 (`assets/screens/`), section fonctionnalités, film de présentation lu depuis le CDN LuminosWeb.
- Pied de page avec accès au dépôt GitHub, aux notes de version et aux sommes SHA-256.

Lors d’une nouvelle version, mettez à jour les noms de fichiers, tailles et numéro de version dans `index.html` (sections hero, téléchargements, bandeau final et pied de page).
