# CodexTest · Calendario Unificato

Project test made with codex

Applicazione desktop per Windows 10 x64 che riunisce gli eventi dei calendari Google e Microsoft in una vista locale e pubblica un feed iCalendar su loopback per il widget Calendario di Lumabar.

## Cosa fa

- Collega più account Google e Microsoft, anche account Microsoft personali e aziendali/scolastici.
- Legge gli eventi da tutti i calendari selezionati in Google Calendar e Outlook, comprese festività, calendari condivisi supportati e riunioni Teams presenti nel calendario.
- Legge le Google Tasks aperte. Le attività con scadenza appaiono anche nel calendario e nel feed Lumabar come impegni di un'intera giornata; quelle senza scadenza restano nell'elenco Attività.
- Sincronizza ogni 15 minuti e quando si preme Sincronizza.
- Avvia il feed locale http://127.0.0.1:48537/calendar.ics, lo stesso indirizzo verificato nel widget Lumabar.
- Riduce la finestra nell'area di notifica quando la si chiude. L'icona del programma può essere mostrata sulla barra Lumabar aggiungendo il widget **Tray**.
- Conserva account, token OAuth, impostazioni e cache degli eventi nel vault cifrato dell'utente Windows tramite Electron safeStorage/DPAPI.

L'app non legge il contenuto dei messaggi Gmail o Outlook e non modifica eventi o attività. Un invito email compare se il provider lo mostra già nel relativo calendario. I dati non passano da un server del progetto: gli eventi vengono letti direttamente dai provider e l'URL del feed è associato solo a 127.0.0.1.

La sincronizzazione iniziale copre un anno nel passato e due anni nel futuro; espande gli eventi ricorrenti. I calendari Google non selezionati nell'account non vengono importati per impostazione iniziale, ma possono essere inclusi dalla sezione Account.

## Requisiti

- Windows 10 22H2 x64
- Node.js 22 o superiore e npm, per l'esecuzione da VS Code
- Lumabar con il widget Calendario configurato sull'indirizzo locale qui sopra

## Avvio da VS Code

1. Apri questa cartella in VS Code.
2. Esegui npm install.
3. Esegui npm start oppure usa il task **Avvia Calendario Unificato**.
4. Apri **Impostazioni** e inserisci i client ID OAuth descritti nella sezione successiva.
5. Torna a **Account**, collega gli account Google e Microsoft, quindi seleziona i calendari da includere.

La chiusura della finestra la nasconde nell'area di notifica. Per mostrare l'icona sulla barra Lumabar, aggiungi il widget **Tray** dal selettore dei widget. La preferenza di avvio automatico è attiva per impostazione iniziale e può essere cambiata nelle Impostazioni.

## Configurazione OAuth

L'app usa OAuth con browser di sistema e PKCE. Non inserire password nell'app. Le credenziali di registrazione si salvano nel vault cifrato locale e non devono essere aggiunte a Git.

### Google

1. In Google Cloud Console crea un progetto e abilita **Google Calendar API** e **Google Tasks API**.
2. Configura la schermata di consenso OAuth per uso esterno e aggiungi il tuo indirizzo tra gli utenti di test.
3. Crea un client OAuth di tipo **Desktop app**.
4. In **Impostazioni** inserisci il client ID e il client secret del client desktop.
5. Collega ciascun account Google che vuoi aggregare.

Permessi richiesti: calendar.calendarlist.readonly, calendar.events.readonly e tasks.readonly, oltre agli scope OIDC per identificare l'account. Non è richiesto accesso Gmail. Un'app OAuth Google in stato di test può richiedere di riautorizzare periodicamente i token; per un'app pubblica servono le procedure di verifica Google previste per gli scope sensibili.

### Microsoft Outlook personale e di lavoro

1. In Microsoft Entra crea una **App registration**.
2. Seleziona i tipi di account **Accounts in any organizational directory and personal Microsoft accounts**.
3. In **Authentication** aggiungi la piattaforma **Mobile and desktop applications** e usa il redirect desktop http://localhost.
4. Abilita i flussi client pubblici, se richiesto dalla configurazione.
5. In **API permissions** aggiungi i permessi delegati User.Read, Calendars.Read e Calendars.Read.Shared.
6. In **Impostazioni** inserisci l'Application (client) ID.

Il tenant common consente di accedere sia con account Microsoft personali sia con account di lavoro/scuola. Un'organizzazione può richiedere il consenso dell'amministratore. I permessi sono in sola lettura.

## Lumabar

Lumabar legge questo feed iCalendar in locale:

~~~text
http://127.0.0.1:48537/calendar.ics
~~~

Se l'indirizzo non è già salvato nel widget Calendario:

1. Apri la scheda Calendario di Lumabar.
2. Vai in **Calendars**.
3. Incolla l'URL sopra in **Paste a calendar's iCal link** e premi **Add**.

L'app resta in esecuzione in background per rendere il feed disponibile durante l'aggiornamento periodico di Lumabar. Il server ascolta solo su 127.0.0.1, non sulle interfacce di rete del PC.

## Creare l'installer

Da VS Code o da un terminale aperto in questa cartella:

~~~powershell
npm run dist:win
~~~

L'installer x64 viene generato in release/. Per provare l'output non installato:

~~~powershell
npm run package:dir
~~~

## Struttura

~~~text
src/
  main/       Processo Electron, OAuth, sincronizzazione, vault cifrato e server ICS
  renderer/   Interfaccia desktop locale
.vscode/      Task per avvio e packaging da VS Code
~~~

## Note di sicurezza

- Gli eventi vengono sincronizzati direttamente tra il PC e Google/Microsoft.
- Token OAuth e cache locale sono cifrati con le credenziali Windows dell'utente corrente.
- Il feed ICS è una risorsa locale senza autenticazione, raggiungibile solo dai processi sullo stesso PC.
- Gli ID client e le credenziali non sono inclusi nel repository.
- Rimuovere un account revoca i suoi token dalla cache locale dell'app e cancella i relativi dati sincronizzati da questa app. Per revocare il consenso OAuth, usa anche la pagina di sicurezza del provider.
