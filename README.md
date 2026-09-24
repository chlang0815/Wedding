# Digitale Hochzeitseinladung

Build-freie, statische Hochzeitseinladung für GitHub Pages. Die Website wird
über die eigene Domain `lang-mueller.de` ausgeliefert. Eine private Fotogalerie
ergänzt die Einladung; deren kleiner FastAPI-Dienst wird separat betrieben und
speichert Originale ausschließlich in privatem Hetzner Object Storage.

## Öffentliche Links

| Variante | Link | Inhalt |
| --- | --- | --- |
| Vollständige Einladung | <https://lang-mueller.de/einladung/trauung> | Trauung, Feier und Nachricht |
| Nur Feier | <https://lang-mueller.de/einladung/feier> | Feier und Nachricht |
| Private Fotogalerie | <https://lang-mueller.de/fotos/> | Passwortgeschützter Upload und Galerie |

Die Startseite und unbekannte Pfade zeigen die Fehlerseite. Die lesbaren Pfade
sind nicht geheim und stellen keinen Zugriffsschutz dar.

## Projektstruktur

```text
Wedding/
├── .github/workflows/
│   └── deploy-pages.yml       Veröffentlicht ausschließlich frontend/
├── backend/                   Separat deploybare FastAPI-/S3-Anwendung
├── docs/
│   └── photo-gallery.md       Betrieb, Hetzner, Sicherheit und Datenschutz
├── infrastructure/hetzner/
│   └── bucket-cors.json       CORS-Regel für direkte Browser-Uploads
└── frontend/                  Vollständiger statischer GitHub-Pages-Inhalt
    ├── assets/                Bilder, Papiertexturen und lokale Schrift
    ├── fotos/
    │   ├── admin/index.html   Geschützte Verwaltungsoberfläche
    │   └── index.html         Private Galerieoberfläche
    ├── tools/
    │   ├── check.ps1          Syntax- und Konsistenzprüfung
    │   └── serve.py           Lokaler Server mit Pages-Fallback
    ├── 404.html               Fallback für Einladungsrouten
    ├── CNAME                  Eigene GitHub-Pages-Domain
    ├── index.html             Gemeinsame Seitenstruktur
    ├── gallery.config.js      Öffentliche API-Origin-Konfiguration
    ├── gallery-admin.js       Admin-Anmeldung und Mehrfachlöschung
    ├── gallery.js             Galerie, Uploadqueue und Lightbox
    ├── gallery.css            Responsives Galeriedesign
    ├── invitation.config.js   Inhalte und lesbare URL-Routen
    ├── script.js              Rendering, Routing und Interaktionen
    └── styles.css             Einladungsdesign und Responsive-Regeln
```

Lokale Screenshots und private Einladungslinks liegen in `frontend/local/`;
dieses Verzeichnis wird weder versioniert noch über GitHub Pages veröffentlicht.

`index.html` und `404.html` müssen identisch bleiben. GitHub Pages liefert für
die Einladungsrouten die Fallback-Seite; JavaScript wertet anschließend den
Pfad aus und zeigt die passende Kartenkombination.

## Lokal starten

Voraussetzung ist Python 3. Im Projektordner:

```powershell
python frontend/tools/serve.py
```

Danach sind die Varianten unter folgenden Adressen erreichbar:

- <http://localhost:8000/einladung/trauung>
- <http://localhost:8000/einladung/feier>

Die lokale Fehlerseite liegt unter <http://localhost:8000/>. Der Server wird
mit `Strg+C` beendet.

Die Galerie liegt unter <http://localhost:8000/fotos/>. Für Login und Uploads
muss zusätzlich der FastAPI-Dienst laufen. Vollständige lokale Einrichtung,
Hetzner-CORS, Deployment, Löschung und Datenschutzentscheidungen stehen in der
[Galerie-Dokumentation](docs/photo-gallery.md).

Die Admin-Ansicht liegt unter <http://localhost:8000/fotos/admin/>.

## Inhalte und Routen ändern

Texte, Termine, Adressen und die Zuordnung der URL-Pfade stehen in
`frontend/invitation.config.js`. Mehrzeilige Inhalte werden als Arrays gepflegt.

```js
export const INVITATION_ROUTES = Object.freeze({
  "einladung/trauung": "all",
  "einladung/feier": "party",
});
```

## Projekt prüfen

Node.js und Git müssen verfügbar sein:

```powershell
powershell -ExecutionPolicy Bypass -File frontend/tools/check.ps1
```

Der Check prüft JavaScript-Syntax, die Identität von `index.html` und
`404.html`, die konfigurierte Domain sowie Whitespace-Fehler.

## Domain bei IONOS einrichten

1. Alle Projektänderungen committen und zu GitHub pushen. Der Pages-Workflow
   prüft und veröffentlicht ausschließlich den Inhalt von `frontend/`.
2. Im GitHub-Repository `Settings > Pages` öffnen und als Quelle **GitHub
   Actions** auswählen.
3. Unter `Custom domain` den Wert `lang-mueller.de` speichern. Die Datei
   `frontend/CNAME` wird mit dem Pages-Artefakt veröffentlicht.
4. Bei IONOS unter `Domain & SSL > lang-mueller.de > DNS` die bisherigen
   Webspace-Einträge für die Hauptdomain durch diese vier A-Records ersetzen:

| Typ | Hostname | Wert |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `chlang0815.github.io` |

MX- und TXT-Einträge für E-Mail dürfen dabei nicht entfernt werden. Auch ein
Wildcard-DNS-Eintrag (`*`) sollte nicht angelegt werden.

Nach der DNS-Aktualisierung kann es einige Zeit dauern, bis GitHub das
Zertifikat ausstellt. Sobald die Option verfügbar ist, in den Pages-Einstellungen
`Enforce HTTPS` aktivieren.

## Sicherheit

Die Seite nutzt `noindex`, damit Suchmaschinen sie nicht absichtlich
indexieren. Das ist kein Zugriffsschutz: Wer einen Link kennt oder den Pfad
errät, kann die Einladung öffnen. Für echte Zugangskontrolle wäre ein Dienst
mit serverseitiger Anmeldung oder vorgeschaltetem Passwortschutz erforderlich.
