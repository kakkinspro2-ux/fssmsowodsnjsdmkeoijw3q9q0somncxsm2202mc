# Fantacalcio – sito mobile

Sito mobile-first con login e schede giocatore.
Nessuna dipendenza esterna: serve solo **Node.js 18+**.

## Avvio

```bash
node server.js
```

Poi apri http://localhost:3000 (dal telefono, nella stessa rete Wi-Fi, usa `http://IP-DEL-PC:3000`).

## Utenti (niente registrazione)

Gli utenti si aggiungono a mano in `data/users.json` (il file viene creato al primo avvio con due esempi):

```json
[
  { "username": "mario", "password": "cambiami1" },
  { "username": "luigi", "password": "cambiami2" }
]
```

- Per aggiungere un utente basta una nuova riga `{ "username": "...", "password": "..." }`, separata dalla precedente con una virgola.
- Le modifiche valgono subito, **senza riavviare** il server.
- Lo username non distingue maiuscole/minuscole, la password sì.
- Le password sono in chiaro nel file: non condividerlo e non pubblicarlo online.

## Struttura

- `server.js` – server HTTP, API, sessioni
- `index.html`, `style.css`, `app.js` – interfaccia mobile
- `data/users.json` – credenziali
- `data/players.json` – schede dei giocatori
- `uploads/` – foto e loghi (si crea da solo)

## Funzioni

- Login con username + password
- Aggiunta giocatore: nome, età, foto, logo, descrizione, infortuni, avvertimenti
- Lista con ricerca, badge "Infortunato" / "Avvertimenti" / "Disponibile"
- Dettaglio giocatore; ognuno può eliminare solo i giocatori che ha aggiunto

## Pubblicazione online

- Usa HTTPS (es. dietro Nginx/Caddy) e avvia con `COOKIE_SECURE=1 node server.js`.
- Le sessioni sono in memoria: riavviando il server bisogna rifare il login.
- Fai backup della cartella `data/` e di `uploads/`.
