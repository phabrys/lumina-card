# Changelog

## 0.8.1 — 2026-10-26

- Pièce sans capteur de luminosité (Lumina 0.14) : en journée, la lumière indique « S'allume après le coucher du soleil » au lieu de « S'allume à ton arrivée ». Après une extinction au lever du soleil, la carte affiche « Soleil levé » et la note « Soleil levé, pas d'allumage », au lieu de « Lumière du jour suffisante ».

## 0.8.0 — 2026-10-26

- Option `compact` : la consigne de la clim se règle depuis la pastille, avec − / + comme dans le panneau complet (« Froid  − 24,0 °C + »). Elle est envoyée une fois que tu arrêtes d'appuyer.

## 0.7.1 — 2026-10-26

- Réglages : la valeur entre les boutons − et + n'a plus le fond gris arrondi des boutons, apparu en 0.6.1 quand elle est devenue un bouton pour le clavier.
- Démo et captures du README : les lampes allumées ont une teinte (« Lumière · 3 000 K »).

## 0.7.0 — 2026-10-25

- Option `compact` : chaque panneau devient une pastille (icône, valeur, consigne de la clim), avec une main pour rendre la main en contrôle manuel. Pour un tableau de bord qui regroupe toutes les pièces.
- Option `hide_panes` : retire la lumière, le ventilateur ou la clim de la carte, sans changer ce que Lumina en fait.
- Option `hide_settings` : retire la roue dentée des réglages.
- Les trois options se règlent aussi depuis l'éditeur visuel.

## 0.6.1 — 2026-10-25

- Clavier : le focus reste sur l'élément en cours après chaque mise à jour de la carte (changement d'état, − / +, curseur…), au lieu de sortir de la carte. En ouvrant les réglages, il passe au bouton Retour, et à la roue dentée en les fermant.
- Onglets des réglages : les flèches, Origine et Fin passent d'un onglet à l'autre ; seul l'onglet choisi est dans l'ordre de tabulation.
- Lecteurs d'écran : les boutons − / + des réglages disent ce qu'ils règlent (« Augmenter : Extinction après ton départ »), la valeur ouvre la fiche au clavier, les pastilles Auto / Manuel annoncent leur effet, le curseur annonce « 44 % ».
- Curseur au clavier : la nouvelle valeur s'affiche tout de suite, sans attendre la réponse de Home Assistant.

## 0.6.0 — 2026-10-25

- Réglages : les délais s'affichent en durée lisible (« 15 min », « 2 min 30 s ») au lieu de secondes brutes ; la valeur brute reste en infobulle. Les boutons − / + avancent par durées rondes (30 s, 5 min, 15 min…).
- Les indications des panneaux suivent le même format : « S'éteint 1 min 30 s après ton départ » au lieu de « 2 min ».
- Ambiance : toucher la température, l'humidité ou la luminosité ouvre la fiche du capteur, avec son historique.
- Notes : au-delà de deux, un bouton **+1** affiche les suivantes au lieu de les taire.
- Panneau lumière : la teinte des lampes allumées en blanc s'affiche après le titre (« Lumière · 2 700 K »).

## 0.5.1 — 2026-10-25

- Comptes à rebours : la carte ne se redessine plus entière chaque seconde, seuls les textes changent. L'hélice du ventilateur ne saccade plus et le focus du clavier reste en place pendant un avertissement ou une échéance en pièce vide. Un lecteur d'écran ne lit plus le compte à rebours à chaque seconde.
- Pastille **Auto** touchée par erreur : un message « Automatisme des lumières en pause » s'affiche avec un bouton **Annuler**, qui réactive l'automatisme et fait revenir le panneau.
- Plus léger sur les grosses installations : les entités de la pièce ne sont plus recherchées dans tout le registre à chaque changement d'état.

## 0.5.0 — 2026-10-25

- Soirée de Lumina 0.13 : la pastille affiche **Soirée** entre le début de la soirée et la nuit. Réglages, onglet Lumière : **Luminosité en soirée** sous la luminosité du jour, **Teinte en soirée** sous la teinte du jour ; onglet Nuit : **Début de la soirée** avant le début de la nuit. Ces réglages n'apparaissent qu'avec Lumina 0.13.

## 0.4.2 — 2026-10-25

- Détecteurs de présence muets (piles, connexion) : la carte le signale toujours, en tête des notes, avec la date ou l'heure de la panne (« PIR chambre indisponible depuis le 15/10 »). Avant, elle ne disait rien quand la pièce était vide, ou quand un seul détecteur sur plusieurs était muet.
- Avec Lumina 0.12, une pièce vide dont aucun détecteur ne répond affiche « Lumina n'éteint plus rien ».

## 0.4.1 — 2026-10-24

- Installation via HACS : la release ne joint plus `lumina-card.js`, HACS le prend dans `dist/` du tag. Cela évite l'erreur `LineTooLong` (« Got more than 8190 bytes when reading ») des versions récentes de Home Assistant, due à un en-tête de plus de 8 Ko sur la redirection des fichiers joints de GitHub.

## 0.4.0 — 2026-10-24

- Réglages, onglet Nuit : avec Lumina 0.11, les heures **Fin de la nuit, jours de repos** (week-end et jours fériés) et **Fin de la nuit, en vacances** apparaissent sous la fin de nuit, qui devient **Fin de la nuit, en semaine**. Chacune n'est affichée que si la pièce a sa source dans Lumina (Workday, calendrier de vacances).

## 0.3.6 — 2026-10-22

- Réglages, onglet Nuit : le réglage reprend le titre « Extinction à la main la nuit », comme dans Lumina, car il vaut aussi pour les ventilateurs d'une pièce sans lumière. Les choix restent Durée réglée, Jusqu'au départ et Jusqu'au réveil.

## 0.3.5 — 2026-10-22

- Réglages, onglet Nuit : « Extinction à la main la nuit » devient « Lumière éteinte à la main la nuit », avec les choix **Durée réglée**, **Jusqu'au départ** et **Jusqu'au réveil** au lieu de Manuel, Salon et Chambre.
- Démo : horloge figée à 17:30 (`?now=HH:MM` pour une autre heure), pour des heures rondes sur les captures du README.

## 0.3.4 — 2026-10-22

- README : captures d'écran mises à jour (nouveaux libellés des réglages de la lumière).

## 0.3.3 — 2026-10-22

- Réglages : sous « Extinction à la main la nuit », l'aide décrit l'option choisie (Manuel, Salon ou Chambre) au lieu de ne parler que de Chambre.

## 0.3.2 — 2026-10-22

- Réglages : « Lumières à allumer » et « Ventilateurs à allumer » deviennent « Si une lumière est déjà allumée » et « Si un ventilateur tourne déjà », avec les choix « Allumer les autres » ou « Ne rien toucher », comme dans Lumina 0.10.3.

## 0.3.1 — 2026-10-21

- Réveil du matin : avec Lumina 0.10.2, la note et l'indication du panneau donnent l'heure de fin du répit (« Réveil : lumière gardée éteinte jusqu'à 07:30 ») au lieu de « jusqu'à ton départ ».

## 0.3.0 — 2026-10-21

Suit le sommeil de Lumina 0.10.

- Sommeil : la phrase devient « En sommeil jusqu'à 07:00 », avec un bouton **Réveiller**. Une note précise au besoin que la pièce est présumée occupée malgré le détecteur, qu'elle se réveillera quand elle se videra (sommeil deviné au salon), ou quelle entité elle suit. Une lampe allumée à la main pendant le sommeil apparaît en note avec son heure de reprise.
- En-tête : bouton **Sommeil** à côté de la pastille Jour / Nuit, qu'il remplace pendant le sommeil.
- Panneaux : « Pas d'allumage pendant le sommeil » ou « Veilleuse à 5 % pendant le sommeil » pour la lumière, « Tourne jusqu'au réveil » pour un ventilateur sans capteur de température, « Lumina la laisse tourner pendant le sommeil » pour la clim. Les délais et seuils affichés sont ceux de nuit pendant une sieste.
- Contrôle manuel : « jusqu'au réveil » au lieu de « jusqu'au matin », lu dans `overrides_until_wake`.
- Réveil du matin : note et indication « Lumière gardée éteinte jusqu'à ton départ ».
- Réglages, onglet Nuit : Sommeil, Extinction à la main la nuit (Manuel / Salon / Chambre) et Veilleuse en sommeil. « Contrôle manuel jusqu'au matin » reste affiché avec un Lumina antérieur à 0.10.
- La pièce est dite occupée ou vide d'après l'attribut `occupied` de Lumina, et non plus d'après l'état du capteur, qui peut valoir « En sommeil ».

## 0.2.3 — 2026-10-21

- Un groupe que Lumina ne gère plus (automatisme en pause) n'a plus de panneau : lumière, ventilateur ou clim disparaît de la carte et réapparaît dès que l'automatisme est réactivé. Une note signale toujours la pause.

## 0.2.2 — 2026-10-21

Suit les nouveautés de Lumina 0.9.

- Contrôle manuel la nuit : chaque groupe affiche sa propre échéance (« Ventilateur en manuel jusqu'à 23:40, lumière jusqu'au matin »), lue dans l'attribut `overrides_until_morning` de Lumina 0.9.2. Un allumage à la main qui finit à l'heure de fin de nuit n'est plus annoncé « jusqu'au matin ». Avec un Lumina plus ancien, l'échéance reste déduite de l'heure de fin de nuit.
- Réglages : l'aide de « Contrôle manuel jusqu'au matin » précise qu'une extinction tient jusqu'au matin et qu'un allumage garde la durée réglée.
- Clims : une clim en simple ventilation affiche « En ventilation, Lumina ne la touche pas » au lieu d'une extinction prévue.
- Détecteur de présence indisponible : une note explique que la pièce reste occupée.

## 0.2.1 — 2026-10-20

- Réglages de la clim : l'option « +2 °C » devient « Modérer », juste aussi en chauffage où la consigne est abaissée.

## 0.2.0 — 2026-10-20

Suit les nouveautés de Lumina 0.7 et 0.8.

- Clims : nouveau panneau avec le mode en cours (froid, chauffage, eco…) dans sa couleur, la consigne réglable par − / +, la pastille Auto / Manuel / Pause et ce que Lumina fera en ton absence.
- Pièce vide : l'action prévue sur la clim rejoint les comptes à rebours (« La clim passe en eco dans 9:40 »), puis une note signale qu'elle a été éteinte, mise en eco ou modérée et sera rétablie à ton retour.
- Contrôle manuel : la clim est comptée avec la lumière et le ventilateur ; la nuit, la phrase indique « jusqu'au matin » quand le geste tient jusqu'à la fin de la nuit.
- Ventilateurs pendant la clim : le panneau indique le brassage à vitesse fixe ou l'arrêt.
- Réglages : onglet Clim (gestion auto, action en pièce vide le jour et la nuit, délai, ventilateurs pendant la clim, vitesse de brassage), « Ventilateurs à allumer » dans l'onglet Ventilateur, « Contrôle manuel jusqu'au matin » dans l'onglet Nuit.
- « Réactiver » relance aussi la gestion de la clim.

## 0.1.0 — 2026-10-20

- Première version : phrase « maintenant » dynamique, panneaux lumière et ventilateur avec curseurs, ambiance, mode nuit et réglages complets de la pièce par onglets.
- Éditeur visuel, configuration par appareil ou par entité Lumina.
- Thèmes clair et sombre, français et anglais.
- Nécessite Lumina 0.6.0 ou plus récent.
