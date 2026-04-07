# DNS-Absicherung durch dnsmasq

## Überblick

LiFE Parental Control verwendet **dnsmasq** als lokalen DNS-Resolver, um Domain-Blocking systemweit durchzusetzen. Die Einrichtung erfolgt einmalig über den privilegierten Daemon und ist danach gegen Manipulation durch andere Systemdienste geschützt.

---

## Einmaliges Setup (`setup-dnsmasq`)

| Schritt | Aktion | Grund |
|---------|--------|-------|
| 1 | `systemd-resolved` deaktivieren | Port 53 freigeben |
| 2 | dnsmasq auf `127.0.0.1` starten | Lokaler Resolver |
| 3 | `/etc/resolv.conf` → `nameserver 127.0.0.1` | System auf lokales DNS zeigen |
| 4 | `chattr +i` auf `resolv.conf` | NetworkManager/DHCP können nicht überschreiben |
| 5 | `setcap cap_net_bind_service` auf dnsmasq-Binary | dnsmasq-User kann Port 53 binden (kein root nötig) |

Ab diesem Moment werden **alle** DNS-Anfragen des Systems ausschließlich über den lokalen dnsmasq aufgelöst.

---

## Aktiver Web-Filter (`write-dnsmasq`)

Wenn der Web-Filter aktiviert wird, schreibt der Daemon zwei Konfigurationsdateien:

### `/etc/dnsmasq.conf` (Basiskonfiguration)

```
listen-address=127.0.0.1
bind-interfaces
server=<upstream-dns>
no-resolv
no-poll
cache-size=1000
domain-needed
bogus-priv
conf-dir=/etc/dnsmasq.d/,*.conf
```

### `/etc/dnsmasq.d/life-parental-blocked.conf` (Blockliste)

Enthält alle gesperrten Domains als `local=/domain.tld/` → gibt **NXDOMAIN** zurück.

---

## DoH-Canary-Blocking — kritische Absicherung

```
local=/use-application-dns.net/    # Firefox canary
local=/dns-over-https.invalid/     # Chrome / Brave / Edge / Opera / Vivaldi canary
```

### Warum ist das notwendig?

Moderne Browser prüfen beim Start, ob ihre **DoH-Canary-Domain** erreichbar ist. Antwortet sie mit **NXDOMAIN**, deaktiviert der Browser **DNS-over-HTTPS automatisch** und verwendet das System-DNS.

**Ohne dieses Blocking** würde der Browser alle DNS-Anfragen verschlüsselt über Cloudflare oder Google DoH tunneln — der dnsmasq-Filter wäre vollständig umgangen.

| Browser | Canary-Domain |
|---------|--------------|
| Firefox | `use-application-dns.net` |
| Chrome, Brave, Edge, Opera, Vivaldi | `dns-over-https.invalid` |

---

## Upstream DNS: dns4eu

| Modus | IP | Beschreibung |
|-------|----|-------------|
| Protective (Standard, Web-Filter aktiv) | `86.54.11.1` | EU-Resolver mit Malware- und Phishing-Schutz |
| Unprotected (Web-Filter deaktiviert) | `86.54.11.100` | Neutral, ohne eigenen Filter |
| Initial Setup | `86.54.11.100` | Neutral — bis Web-Filter konfiguriert wird |

[dns4eu](https://dns4eu.eu) ist der offizielle EU-DNS-Resolver. Die Wahl ist datenschutzbewusst — kein Google DNS, kein Cloudflare.

---

## Absicherungskette (Zusammenfassung)

```
Browser
  │
  ▼
/etc/resolv.conf  (immutable via chattr +i)
  │  nameserver 127.0.0.1
  ▼
dnsmasq (lokal, Port 53)
  ├── Gesperrte Domains        →  NXDOMAIN
  ├── DoH-Canary-Domains       →  NXDOMAIN  (Browser deaktiviert DoH automatisch)
  └── Alle anderen Domains     →  dns4eu upstream (86.54.11.1 / 86.54.11.100)
```

---

## Filter deaktivieren (`remove-dnsmasq`)

Beim Deaktivieren des Web-Filters:
- `life-parental-blocked.conf` wird geleert (Domains nicht mehr geblockt)
- `dnsmasq.conf` wird auf Pass-Through zurückgesetzt
- `resolv.conf` wird auf den direkten Upstream-DNS umgeschrieben
- dnsmasq wird neu gestartet

---

## Bekannte Grenzen

Die einzige verbleibende Umgehungsmöglichkeit wäre ein Browser mit **hardcoded DoH**, der die Canary-Domains ignoriert (z.B. sehr alte oder exotische Browser-Versionen). Für alle Mainstream-Browser (Firefox, gesamte Chromium-Familie) ist der Mechanismus zuverlässig.
