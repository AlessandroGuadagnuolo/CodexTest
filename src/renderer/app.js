const api = window.calendarApp;
const content = document.getElementById('content');
const title = document.getElementById('view-title');
const eyebrow = document.getElementById('view-eyebrow');
const syncLabel = document.getElementById('sync-label');
const feedStatus = document.getElementById('feed-status');
const feedDot = document.getElementById('feed-dot');
const toastElement = document.getElementById('toast');

let state = {
  accounts: [],
  calendars: [],
  events: [],
  tasks: [],
  settings: { autoStart: true },
  lastSync: null,
  errors: []
};
let currentView = 'calendar';
let selectedDate = new Date();
let toastTimer;

const monthNames = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const fullDate = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 3600);
}

function setState(nextState) {
  state = nextState || state;
  const feedReady = Boolean(state.feed?.ready);
  feedStatus.textContent = feedReady ? 'Feed locale attivo' : 'Feed non disponibile';
  feedDot.classList.toggle('ready', feedReady);
  feedDot.classList.toggle('error', Boolean(state.feed?.error));
  syncLabel.textContent = state.lastSync
    ? 'Aggiornato ' + new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(state.lastSync))
    : 'Non sincronizzato';
  render();
}

function safeDateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function eventDateKey(item) {
  if (item.allDay) return String(item.start).slice(0, 10);
  const date = new Date(item.start);
  return Number.isNaN(date.getTime()) ? String(item.start).slice(0, 10) : safeDateKey(date);
}

function nextDateKey(value) {
  const date = new Date(String(value).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  date.setDate(date.getDate() + 1);
  return safeDateKey(date);
}

function itemOccursOnDate(item, dateKey) {
  if (item.allDay) {
    const start = String(item.start || '').slice(0, 10);
    const end = String(item.end || '').slice(0, 10) || nextDateKey(start);
    return dateKey >= start && dateKey < end;
  }

  const start = new Date(item.start);
  const end = new Date(item.end);
  if (Number.isNaN(start.getTime())) return eventDateKey(item) === dateKey;
  if (Number.isNaN(end.getTime())) return safeDateKey(start) === dateKey;
  const dayStart = new Date(dateKey + 'T00:00:00');
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return start < dayEnd && end > dayStart;
}

function itemStartTime(item) {
  if (item.allDay) return 'Tutto il giorno';
  const date = new Date(item.start);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function itemEndTime(item) {
  if (item.allDay) return '';
  const date = new Date(item.end);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function selectedItems() {
  return state.events
    .concat(state.tasks.filter((task) => task.dueDate).map((task) => ({
      id: task.id,
      title: task.title,
      start: task.dueDate,
      end: nextDateKey(task.dueDate),
      allDay: true,
      isTask: true,
      calendarName: task.listName,
      color: '#8068ad'
    })))
    .filter((item) => itemOccursOnDate(item, safeDateKey(selectedDate)))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render() {
  const viewMeta = {
    calendar: ['IL TUO TEMPO, INSIEME', 'Calendario'],
    tasks: ['DA TENERE SOTTO CONTROLLO', 'Google Tasks'],
    accounts: ['LE TUE FONTI', 'Account e calendari'],
    settings: ['PREFERENZE LOCALI', 'Impostazioni']
  };
  eyebrow.textContent = viewMeta[currentView][0];
  title.textContent = viewMeta[currentView][1];
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === currentView);
  });
  content.replaceChildren();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'tasks') renderTasks();
  if (currentView === 'accounts') renderAccounts();
  if (currentView === 'settings') renderSettings();
}

function renderCalendar() {
  const layout = element('div', 'calendar-layout');
  const monthCard = element('section', 'card month-card');
  const toolbar = element('div', 'month-toolbar');
  toolbar.append(element('h2', '', capitalize(monthNames.format(selectedDate))));
  const actions = element('div', 'month-actions');
  actions.append(
    makeButton('‹', 'small-button month-arrow', () => changeMonth(-1)),
    makeButton('Oggi', 'small-button', () => { selectedDate = new Date(); render(); }),
    makeButton('›', 'small-button month-arrow', () => changeMonth(1))
  );
  toolbar.append(actions);
  monthCard.append(toolbar);

  const grid = element('div', 'month-grid');
  ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].forEach((day) => grid.append(element('div', 'weekday', day)));

  const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const todayKey = safeDateKey(new Date());
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = safeDateKey(date);
    const cell = element('button', 'day-cell');
    cell.type = 'button';
    cell.classList.toggle('outside', date.getMonth() !== selectedDate.getMonth());
    cell.classList.toggle('selected', key === safeDateKey(selectedDate));
    cell.classList.toggle('today', key === todayKey);
    cell.append(element('span', 'day-number', String(date.getDate())));
    const dayItems = state.events
      .concat(state.tasks.filter((task) => task.dueDate).map((task) => ({
        id: task.id, title: task.title, start: task.dueDate, end: nextDateKey(task.dueDate), allDay: true, isTask: true
      })))
      .filter((item) => itemOccursOnDate(item, key));
    dayItems.slice(0, 2).forEach((item) => {
      const line = element('span', 'day-event' + (item.isTask ? ' task' : ''), item.title);
      cell.append(line);
    });
    if (dayItems.length > 2) cell.append(element('span', 'day-more', '+' + (dayItems.length - 2) + ' altri'));
    cell.addEventListener('click', () => { selectedDate = date; render(); });
    grid.append(cell);
  }
  monthCard.append(grid);

  const agenda = element('section', 'card agenda-card');
  agenda.append(element('div', 'agenda-date', fullDate.format(selectedDate)));
  agenda.append(element('div', 'agenda-title', 'Impegni del giorno'));
  const list = element('div', 'event-list');
  const items = selectedItems();
  if (!items.length) {
    list.append(element('div', 'empty-state', state.accounts.length
      ? 'Nessun evento o attività con scadenza in questa giornata.'
      : 'Collega un account Google o Microsoft per visualizzare gli eventi.'));
    if (!state.accounts.length) list.append(makeButton('Collega un account', 'secondary-button', () => navigate('accounts')));
  } else {
    items.forEach((item) => list.append(createEventCard(item)));
  }
  agenda.append(list);
  layout.append(monthCard, agenda);
  content.append(layout);
}

function createEventCard(item) {
  const originClass = item.isTask ? 'task-item' : item.provider === 'microsoft' ? 'microsoft-item' : 'google-item';
  const card = element('article', 'event-item ' + originClass);
  const time = itemStartTime(item);
  const end = itemEndTime(item);
  card.append(element('div', 'event-time', end && end !== time ? time + ' – ' + end : time));
  card.append(element('div', 'event-name', item.title || '(Senza titolo)'));
  const meta = [item.calendarName, item.location].filter(Boolean).join(' · ');
  if (meta) card.append(element('div', 'event-meta', meta));
  if (item.isTask) card.append(element('span', 'event-badge', 'Google Task · scadenza'));
  return card;
}

function renderTasks() {
  const card = element('section', 'card page-card');
  card.append(element('h2', '', 'Attività Google Tasks'));
  card.append(element('p', '', 'Le attività con scadenza compaiono anche nel calendario e nel feed Lumabar come impegni di giornata. Quelle senza scadenza restano in questo elenco.'));
  const list = element('div', 'task-list');
  if (!state.tasks.length) {
    list.append(element('div', 'empty-state', state.accounts.some((account) => account.provider === 'google')
      ? 'Non ci sono attività aperte da mostrare.'
      : 'Collega un account Google per sincronizzare Google Tasks.'));
  } else {
    state.tasks.slice().sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).forEach((task) => {
      const row = element('div', 'task-row');
      const main = element('div', 'task-main');
      main.append(element('span', 'provider-mark google', '✓'));
      const text = element('div');
      text.append(element('strong', '', task.title || '(Senza titolo)'));
      text.append(element('span', '', task.listName + (task.accountEmail ? ' · ' + task.accountEmail : '')));
      main.append(text);
      const due = element('span', 'task-due', task.dueDate ? formatDate(task.dueDate) : 'Senza scadenza');
      row.append(main, due);
      list.append(row);
    });
  }
  card.append(list);
  content.append(card);
}

function renderAccounts() {
  const card = element('section', 'card page-card');
  const toolbar = element('div', 'toolbar-row');
  const intro = element('div');
  intro.append(element('h2', '', 'Account collegati'));
  intro.append(element('p', '', 'Aggiungi uno o più account Google o Microsoft. Verranno sincronizzati solo gli elementi in sola lettura.'));
  toolbar.append(intro);
  card.append(toolbar);

  const connectRow = element('div', 'settings-actions');
  connectRow.append(
    makeButton('＋ Google', 'primary-button', () => addAccount('google')),
    makeButton('＋ Microsoft', 'secondary-button', () => addAccount('microsoft'))
  );
  card.append(connectRow);
  if (state.errors?.length) {
    state.errors.forEach((error) => card.append(element('div', 'error-banner', error)));
  }

  const list = element('div', 'account-list');
  if (!state.accounts.length) {
    list.append(element('div', 'empty-state', 'Nessun account collegato. Configura prima gli identificativi OAuth in Impostazioni, poi aggiungi un account.'));
  } else {
    state.accounts.forEach((account) => {
      const row = element('div', 'account-row');
      const main = element('div', 'account-main');
      main.append(element('span', 'provider-mark ' + account.provider, account.provider === 'google' ? 'G' : 'M'));
      const info = element('div');
      info.append(element('strong', '', account.email || account.displayName || 'Account'));
      info.append(element('span', '', (account.provider === 'google' ? 'Google' : 'Microsoft') + ' · ' + (account.calendarCount || 0) + ' calendari'));
      main.append(info);
      const remove = makeButton('Rimuovi', 'small-danger', async () => {
        if (!window.confirm('Rimuovere questo account e i suoi dati sincronizzati da questa app?')) return;
        await api.removeAccount(account.id);
        showToast('Account rimosso');
      });
      row.append(main, remove);
      list.append(row);
    });
  }
  card.append(list);

  const sourceCard = element('section', 'card page-card spaced-card');
  sourceCard.append(element('h2', '', 'Calendari inclusi'));
  sourceCard.append(element('p', '', 'Per ogni account Google vengono letti i calendari che hai selezionato nel tuo account, comprese le festività. Puoi escludere un calendario qui.'));
  const sourceList = element('div', 'calendar-source-list');
  if (!state.calendars.length) {
    sourceList.append(element('div', 'empty-state', 'I calendari appariranno qui dopo la prima sincronizzazione.'));
  } else {
    state.calendars.forEach((calendar) => {
      const row = element('div', 'calendar-source-row');
      const main = element('div', 'source-main');
      main.append(element('span', 'provider-mark ' + calendar.provider, calendar.provider === 'google' ? 'G' : 'M'));
      const info = element('div');
      info.append(element('strong', '', calendar.name));
      info.append(element('span', '', calendar.accountEmail + ' · ' + (calendar.provider === 'google' ? 'Google Calendar' : 'Outlook')));
      main.append(info);
      const toggleLabel = element('label', 'source-toggle');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = calendar.enabled !== false;
      toggle.addEventListener('change', () => api.setCalendarEnabled(calendar.key, toggle.checked));
      toggleLabel.append(toggle, document.createTextNode('Includi'));
      row.append(main, toggleLabel);
      sourceList.append(row);
    });
  }
  sourceCard.append(sourceList);
  content.append(card, sourceCard);
}

function renderSettings() {
  const card = element('section', 'card page-card');
  card.append(element('h2', '', 'Connessioni e feed locale'));
  card.append(element('p', '', 'Configura le app OAuth personali. Gli identificativi e i token vengono conservati cifrati per il tuo utente Windows; non vengono inseriti nel repository.'));
  const form = element('div', 'field-grid');
  form.append(makeField('Google OAuth Client ID', 'googleClientId', state.settings.googleClientId || '', 'text'));
  form.append(makeField('Google OAuth Client Secret', 'googleClientSecret', state.settings.googleClientSecret || '', 'password'));
  form.append(makeField('Microsoft Application (client) ID', 'microsoftClientId', state.settings.microsoftClientId || '', 'text'));
  const info = element('div', 'field full');
  info.append(element('span', 'help-text', 'Google: crea credenziali OAuth di tipo Desktop app. Microsoft: abilita account personali e aziendali, aggiungi il redirect per app desktop http://localhost e usa i permessi delegati Calendars.Read e Calendars.Read.Shared.'));
  form.append(info);
  card.append(form);

  const actions = element('div', 'settings-actions');
  actions.append(makeButton('Salva credenziali', 'primary-button', async () => {
    const settings = {
      googleClientId: document.getElementById('googleClientId').value.trim(),
      googleClientSecret: document.getElementById('googleClientSecret').value.trim(),
      microsoftClientId: document.getElementById('microsoftClientId').value.trim(),
      autoStart: document.getElementById('autoStart').checked
    };
    await api.saveSettings(settings);
    showToast('Impostazioni salvate in modo cifrato');
  }));
  const startup = document.createElement('label');
  startup.className = 'source-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'autoStart';
  checkbox.checked = state.settings.autoStart !== false;
  startup.append(checkbox, document.createTextNode('Avvia con Windows e resta nell’area di notifica'));
  actions.append(startup);
  card.append(actions);

  const feed = element('section', 'card page-card spaced-card');
  feed.append(element('h2', '', 'Indirizzo iCalendar per Lumabar'));
  const url = element('p', 'feed-url', 'http://127.0.0.1:48537/calendar.ics');
  feed.append(url);
  feed.append(element('p', '', 'Il feed è disponibile solo su questo PC e include gli eventi selezionati e le Google Tasks con scadenza.'));
  if (state.feed?.error) feed.append(element('div', 'error-banner', state.feed.error));
  const copyActions = element('div', 'settings-actions');
  copyActions.append(makeButton('Copia indirizzo feed', 'secondary-button', async () => {
    await api.copyFeedUrl();
    showToast('Indirizzo copiato');
  }));
  feed.append(copyActions);
  content.append(card, feed);
}

function makeField(labelText, id, value, type) {
  const wrapper = element('div', 'field');
  const label = element('label', '', labelText);
  label.htmlFor = id;
  const input = document.createElement('input');
  input.id = id;
  input.type = type;
  input.value = value;
  input.autocomplete = 'off';
  wrapper.append(label, input);
  return wrapper;
}

function makeButton(text, className, action) {
  const button = element('button', className, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function formatDate(value) {
  const date = new Date(String(value).slice(0, 10) + 'T12:00:00');
  return Number.isNaN(date.getTime()) ? String(value) : shortDate.format(date);
}

function capitalize(value) {
  return value.charAt(0).toLocaleUpperCase('it-IT') + value.slice(1);
}

function changeMonth(delta) {
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + delta, 1);
  render();
}

function navigate(view) {
  currentView = view;
  render();
}

async function addAccount(provider) {
  try {
    const account = await api.addAccount(provider);
    showToast('Collegato: ' + (account.email || account.displayName || 'account'));
  } catch (error) {
    showToast(error.message || 'Accesso non completato');
  }
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', () => navigate(button.dataset.view));
});
document.getElementById('sync-button').addEventListener('click', async () => {
  syncLabel.textContent = 'Sincronizzazione…';
  const result = await api.sync();
  showToast(result?.message || 'Sincronizzazione completata');
});
api.onStateChanged(setState);
api.getState().then(setState).catch((error) => showToast(error.message));
render();
