# Digitale Hochzeitseinladung

Die Website funktioniert ohne Installation oder Build-Schritt. Zum lokalen Ansehen einfach `index.html` im Browser öffnen.

## Geschützte Einladungslinks

Die Website ist nur über zwei lange, nicht erratbare Link-Codes erreichbar. Im
Repository stehen ausschließlich deren SHA-256-Prüfwerte. Die eigentlichen Links
werden bewusst nicht im Repository dokumentiert.

- Ein Link zeigt Trauung und Feier.
- Ein Link zeigt ausschließlich die Feier.
- Die Startseite, alte `?invite=`-Links und unbekannte Codes zeigen eine Fehlerseite.

Die Link-Codes dürfen nicht geändert oder gekürzt werden. Wer einen Link erhält,
kann ihn allerdings weitergeben; die Lösung ist kein Ersatz für einen echten Login.

## Inhalte ändern

Alle variablen Angaben stehen am Anfang von `script.js` im Objekt `INVITATION`. Dort lassen sich Datum, Uhrzeiten, Orte, Parkhinweise und Dresscode zentral ändern. Der Einladungstext steht wenige Zeilen darunter im Eintrag `message`.

Die Seite ist absichtlich mit `noindex, nofollow` versehen, damit Suchmaschinen sie nicht regulär in Suchergebnisse aufnehmen. Das ersetzt keinen echten Passwortschutz.
