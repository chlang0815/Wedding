# Digitale Hochzeitseinladung

## Projektstruktur

```text
Wedding/
├── .editorconfig              Editor- und Formatierungsregeln
├── .gitattributes             Zeilenenden und Binärdateien
├── assets/                    Bilder, Papiertexturen und lokale Schrift
├── tools/
│   ├── check.ps1              Syntax- und Konsistenzprüfung
│   └── serve.py               Lokaler Server mit Pages-Fallback
├── 404.html                   GitHub-Pages-Fallback für private Pfade
├── index.html                 HTML-Einstiegspunkt
├── invitation.config.js       Änderbare Inhalte und Zugangscode-Hashes
├── script.js                  Rendering, Routing und Interaktionen
└── styles.css                 Design, Kartenlayout und Responsive-Regeln
```

## Lokal starten

Voraussetzung ist Python 3. Im Projektordner:

```powershell
python tools/serve.py
```

## Projekt prüfen

Node.js und Git müssen verfügbar sein. Unter PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File tools/check.ps1
```

Der Check prüft:

1. JavaScript-Syntax beider Module
2. Identität von `index.html` und `404.html`
3. Whitespace-Fehler im Git-Diff
