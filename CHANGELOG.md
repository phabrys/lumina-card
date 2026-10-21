# Changelog

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
