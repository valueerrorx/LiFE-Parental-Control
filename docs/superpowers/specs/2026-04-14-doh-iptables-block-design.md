## Ziel

DoH soll systemweit schwerer zu umgehen sein, indem bekannte DoH-Resolver-IP-Adressen via `iptables` (und optional `ip6tables`, falls verfügbar) geblockt werden. Die Konfiguration erfolgt in der bestehenden Webfilter-UI und wird wie üblich in `default.json` persistiert; der Root-Daemon setzt die Regeln idempotent und entfernt sie beim Abschalten vollständig.

## Nicht-Ziele

- Kein “vollständiges DoH-Verbot” gegen beliebige, neue oder private DoH-Endpunkte.
- Keine manuell editierbaren IP-Listen in der UI.
- Kein automatisches Listen-Update beim App-Start; Updates erfolgen nur manuell wie bei den anderen HaGeZi-Listen.

## Datenquelle (HaGeZi)

- Neue HaGeZi-IP-Liste: `ips/doh.txt`
- URL: `https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/ips/doh.txt`
- Verhalten:
  - Wird beim bestehenden manuellen “Listen aktualisieren” mit aktualisiert.
  - Wird im bestehenden Cache/Blocklist-Verzeichnis persistiert (offline-fähig).
  - Der Daemon nutzt ausschließlich den zuletzt erfolgreich synchronisierten Stand.

## Config-Schema (`default.json`)

Erweiterung unter `webfilter`:

- `webfilter.dohIptablesEnabled: boolean`
  - Default: `false`
  - Semantik:
    - `true` → Daemon stellt DoH-IP-Blockade per iptables/ip6tables her.
    - `false` → Daemon entfernt alle zu LiFE gehörenden DoH-iptables-Regeln vollständig.

Backward compatibility: fehlt das Feld, gilt `false`.

## UI: `src/renderer/src/pages/WebFilterPage.vue`

Neue Card/Sektion unterhalb der DNS-Upstream-Auswahl:

- Toggle: “DoH blockieren (iptables)”
- Statusanzeige (read-only):
  - “Aktiv” / “Inaktiv”
  - Detail: IPv4 aktiv/inaktiv; IPv6 aktiv/inaktiv/”nicht verfügbar”
- Hinweistext:
  - Blockt bekannte DoH-Resolver-IP-Adressen aus HaGeZi `ips/doh.txt`.
  - Erfordert Root (wird durch den Daemon umgesetzt).

UX-Regeln:

- Der Toggle darf unabhängig vom restlichen Webfilter UI-Disable funktionieren, aber der Apply-Button ist weiterhin der einzige Persist/Apply-Mechanismus (kein sofortiges Apply beim Toggle).
- Status wird beim Laden der Seite abgefragt und nach “Apply” aktualisiert.

## IPC / Main Prozess

Erweiterungen in `src/main/ipc/webFilterIpc.js`:

- `webfilter:getList` liefert zusätzlich:
  - `dohIptablesEnabled` (aus `default.json`)
  - optional `dohIptablesStatus` (siehe Status-Endpoint) oder getrennt via eigener IPC-Route.
- `webfilter:saveAll` akzeptiert zusätzlich:
  - `dohIptablesEnabled` und persistiert es via `patchDefaultJson`.

Neue IPC-Route:

- `webfilter:getDohIptablesStatus` → fragt den Daemon nach aktuellem Status (nicht nur Config).
  - Rückgabe: `{ ok: true, v4Active: boolean, v6Active: boolean|null, v6Available: boolean }` oder `{ ok: false, error }`

## Daemon: Umsetzung per iptables/ip6tables

### Rule-Strategie (idempotent, cleanup-sicher)

- Verwende eigene Chains:
  - IPv4: `LIFE_DOH_BLOCK`
  - IPv6: `LIFE_DOH_BLOCK6`
- Hook in `OUTPUT`:
  - Stelle sicher, dass `OUTPUT` genau einen Jump in die LiFE-Chain enthält.
  - Kein “Rule-Spam”: vor dem Add immer existence-check (oder setze durch Flush+Recreate mit festem Hook).

### Rules

- Blockiere zu jeder IP in der HaGeZi-Liste:
  - TCP dport 443 (HTTPS) zu dieser Ziel-IP
  - Default-Aktion: `REJECT`
- IPv6:
  - Nur wenn `ip6tables` verfügbar ist.
  - Wenn IPv6 am System deaktiviert ist, behandelt der Daemon das als “v6Available=false” und setzt keine v6-Regeln.

### Cleanup beim Abschalten

- Entferne Hook aus `OUTPUT` (nur den LiFE-spezifischen Jump).
- Flush und delete der LiFE-Chains (v4/v6 getrennt).
- Cleanup ist “best effort” aber muss in der Praxis vollständig sein, solange iptables/ip6tables funktionieren.

### Status-Query

Der Daemon liefert Status basierend auf “Rule tatsächlich vorhanden” (nicht nur Config):

- v4Active: Jump + Chain existiert und enthält erwartbare Pattern (mindestens 1 Rule oder explizit gesetzt)
- v6Active analog, nur falls v6Available.

### Apply-Trigger

Die Daemon-Tick/Default-Sync Kette liest `default.json` und wendet iptables entsprechend an:

- Wenn `webfilter.dohIptablesEnabled` true → ensure enabled (inkl. Laden/Parsen der HaGeZi-IP-Liste aus Cache).
- Wenn false → ensure disabled (Cleanup).

## HaGeZi Sync Erweiterung

Erweiterung in dem bestehenden HaGeZi-Sync-Modul (aktuell `src/main/ipc/webFilterHagezi.js`):

- Download + Cache für `ips/doh.txt`.
- Parser:
  - Akzeptiert IPv4 + IPv6
  - Ignoriert Kommentare/Leerzeilen
  - Dedup + sort
- Rückgabe in `getFeedsMetaForUi` optional erweitern um “DoH-IP list cachedAt/version”, oder minimal nur still im Cache halten.

## Sicherheits- und Kompatibilitätsnotizen

- Es werden nur LiFE-spezifische Chains/Hooks manipuliert; vorhandene Nutzer-Firewall-Regeln bleiben unberührt.
- Falls `iptables` nicht verfügbar ist, soll der Daemon eine klare Fehlermeldung liefern (UI zeigt “konnte nicht aktiviert werden”).
- Das Feature ist eine Härtung, keine vollständige Garantie gegen DoH.

## Testplan (manuell)

- Toggle an → Apply → Status zeigt aktiv (v4, ggf. v6) und `iptables -S` enthält LiFE-Chain/Hook.
- Toggle aus → Apply → Status inaktiv, `iptables -S` enthält keine `LIFE_DOH_BLOCK` mehr.
- HaGeZi Update → IP-Liste im Cache aktualisiert; erneutes Apply aktualisiert Ruleset (idempotent).

