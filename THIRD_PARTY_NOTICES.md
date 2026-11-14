# Composants et ressources

LumiLooks est une application indépendante créée pour LuminosWeb. Magic Bullet Looks est une marque de Maxon ; les effets d’objectif de LumiLooks (Haze/Flare, flare anamorphique, aberration chromatique, distorsion, diffusion optique) sont des implémentations originales en WebGL et aucun composant ni preset Maxon n’est inclus.

- Tauri 2 (MIT / Apache 2.0) : https://github.com/tauri-apps/tauri — l’application utilise la vue web du système (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous Linux).
- React (MIT) : https://github.com/facebook/react · zustand (MIT) : https://github.com/pmndrs/zustand.
- Icônes d’interface : collection MingCute (variantes « fill », icônes pleines) du catalogue Icônes / Iconify, Apache 2.0, https://icones.js.org/collection/mingcute et https://github.com/Richard9394/MingCute/blob/main/LICENSE. Les tracés SVG sont inclus localement ; aucun accès réseau n’est nécessaire pour les afficher.
- Logo LumiLooks (diaphragme) : fourni par LuminosWeb.
- Pack DAEDAL Cinematic : huit LUTs créatives 3D de 33 points pour images SDR / Rec.709, distribuées sous CC0 1.0. Fichiers d’origine conservés sans modification, intensité initiale réglée à 80 % dans LumiLooks. Source : https://daedal.art/resources/cinematic-pack/ ; téléchargement : https://github.com/luciansofronie/daedal-downloads/releases/download/packs-v1/DAEDAL_Cinematic_Pack.zip. Licence et recommandations du pack fournies dans assets/luts/DAEDAL-LICENSE.txt et DAEDAL-README.txt.
- Film argentique : sélection de 24 profils de la RawTherapee Film Simulation Collection, auteurs Pat David, Pavlov Dmitry et Michael Ezra, distribuée par https://github.com/cedeber/hald-clut (332 étoiles constatées le 7 novembre 2026). La licence spécifique du dossier Film Simulation est CC BY-SA 4.0 : https://github.com/cedeber/hald-clut/blob/master/HaldCLUT/Film%20Simulation/README.txt. Modifications par LumiLooks : conversion des images Hald sRGB en tables RGB Float32 de 33 points par interpolation trilinéaire ; ces tables restent sous CC BY-SA 4.0. Les fichiers assets/luts/film/ATTRIBUTION.txt, SOURCE-README.txt et CC-BY-SA-4.0.txt fournissent les attributions, les sources et la licence complète. Les identifiants de commit et liens vers chaque image originale sont conservés dans le manifeste src/preset-packs/film.json. Les noms de films décrivent les simulations ; aucune affiliation avec les marques n’est revendiquée.
- FFmpeg 6.1.1 : binaires statiques de la version b6.1.1 de ffmpeg-static (Windows : www.gyan.dev ; macOS et Linux : builds statiques référencés par le projet), GPL v3. FFmpeg est exécuté comme programme séparé (sidecar). Configuration et licence de chaque binaire fournies dans le dossier licenses/ de l’application ; sources et instructions : https://github.com/eugeneware/ffmpeg-static et https://ffmpeg.org.
- Logo et police de référence issus du site https://luminosweb.com, fournis dans le contexte de la commande de son propriétaire.

Depuis la version 1.3.1, les tables DAEDAL et Film argentique sont distribuées dans assets/lut-packs/*.llut : compression réversible des mêmes valeurs Float32, sans réduction de résolution ni de précision. Les originaux restent conservés dans le projet de développement. Les licences et attributions sont fournies dans assets/licenses/ ; le changement de stockage ne modifie pas les licences des tables.

Les fichiers personnels sont traités sur l’ordinateur. Aucun service distant, compte ni télémétrie n’est utilisé par l’application.

## slay Cinematic LUTs

Five original 33-point LUTs by slay, CC BY 4.0. Source: https://github.com/slaycamera/luts (commit a1709044efe115640dde1dee17d4185fc059af0d). License and original README accompany the pack. LUTs: slay — https://www.slaycamera.com/ (CC BY 4.0). When publishing work using these LUTs, credit slay as requested by the author. LumiLooks only packages the original table values losslessly.

## OpenLUTs

Fourteen LUTs by Tanishq Pal (darkyboys), CC0 1.0 Universal. Source: https://github.com/darkyboys/openluts (commit b30533c4d292a66e0733b69981bde709cc3fda68). Original license, README and attribution accompany the pack. Technical transforms are identified separately from creative looks in the library. Original resolution and Float32 values are preserved.
