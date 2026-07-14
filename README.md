# Digitale Hochzeitseinladung

Die Website funktioniert ohne Installation oder Build-Schritt. Zum lokalen Ansehen einfach `index.html` im Browser öffnen.

## Zwei Einladungslinks

- Trauung und Feier: `index.html?invite=all`
- Nur Feier: `index.html?invite=party`

Nach dem späteren Veröffentlichen wird `index.html` durch die Domain ersetzt, zum Beispiel:

- `https://unsere-hochzeit.de/?invite=all`
- `https://unsere-hochzeit.de/?invite=party`

## Inhalte ändern

Alle variablen Angaben stehen am Anfang von `script.js` im Objekt `INVITATION`. Dort lassen sich Datum, Uhrzeiten, Orte, Parkhinweise und Dresscode zentral ändern. Der Einladungstext steht wenige Zeilen darunter im Eintrag `message`.

Die Seite ist absichtlich mit `noindex, nofollow` versehen, damit Suchmaschinen sie nicht regulär in Suchergebnisse aufnehmen. Das ersetzt keinen echten Passwortschutz.
