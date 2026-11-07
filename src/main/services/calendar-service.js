import crypto from 'node:crypto';
import { OAuthClient, refreshToken } from './oauth-client.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const MICROSOFT_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/tasks.readonly'
];
const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.Read',
  'Calendars.Read.Shared'
];

function accountId(provider, providerId, email) {
  return provider + ':' + crypto.createHash('sha256').update(String(providerId || email)).digest('hex').slice(0, 20);
}

function safeApiMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    if (payload.error?.message) return payload.error.message;
    if (payload.error_description) return payload.error_description;
    if (payload.message) return payload.message;
  }
  return 'HTTP ' + status;
}

function asIsoStart(value, allDay) {
  if (allDay) return String(value || '').slice(0, 10);
  return value || '';
}

function microsoftDate(value, allDay) {
  if (!value) return '';
  if (allDay) return String(value.dateTime || '').slice(0, 10);
  const dateTime = String(value.dateTime || '');
  if (/[zZ]|[+-]\d\d:\d\d$/.test(dateTime)) return dateTime;
  return dateTime + 'Z';
}

function dateRange() {
  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 1);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 2);
  return { start: start.toISOString(), end: end.toISOString() };
}

function nextDate(value) {
  const date = new Date(String(value || '').slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function accountLabel(account) {
  return account.email || account.displayName || account.provider;
}

export class CalendarService {
  constructor(store) {
    this.store = store;
  }

  state() {
    return this.store.getState();
  }

  getSnapshot() {
    const current = this.state();
    const calendars = current.calendars.map((calendar) => ({
      ...calendar,
      key: calendar.accountId + '|' + calendar.id,
      accountEmail: current.accounts.find((account) => account.id === calendar.accountId)?.email || '',
      enabled: current.calendarPreferences[calendar.accountId + '|' + calendar.id] ?? calendar.enabled ?? true
    }));
    return {
      accounts: current.accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.email,
        displayName: account.displayName,
        calendarCount: current.calendars.filter((calendar) => calendar.accountId === account.id).length
      })),
      calendars,
      events: current.events.map((event) => ({
        ...event,
        color: event.color || (event.provider === 'microsoft' ? '#2581bb' : '#ce654a')
      })),
      tasks: current.tasks,
      settings: {
        googleClientId: current.settings.googleClientId || '',
        googleClientSecret: current.settings.googleClientSecret || '',
        microsoftClientId: current.settings.microsoftClientId || '',
        autoStart: current.settings.autoStart !== false
      },
      lastSync: current.lastSync,
      errors: current.errors || [],
      feed: { ready: true, url: 'http://127.0.0.1:48537/calendar.ics' }
    };
  }

  getCalendarItems() {
    const current = this.state();
    const enabledCalendars = new Set(current.calendars
      .filter((calendar) => current.calendarPreferences[calendar.accountId + '|' + calendar.id] ?? calendar.enabled ?? true)
      .map((calendar) => calendar.accountId + '|' + calendar.id));
    const events = current.events.filter((event) => enabledCalendars.has(event.accountId + '|' + event.calendarId));
    const datedTasks = current.tasks.filter((task) => task.dueDate).map((task) => ({
      id: 'task:' + task.id,
      provider: 'google',
      accountId: task.accountId,
      calendarId: 'google-tasks:' + task.listId,
      calendarName: 'Google Tasks · ' + task.listName,
      title: task.title,
      start: task.dueDate,
      end: nextDate(task.dueDate),
      allDay: true,
      isTask: true,
      description: task.notes || '',
      color: '#8068ad'
    }));
    return events.concat(datedTasks);
  }

  async saveSettings(settings) {
    const current = this.state();
    current.settings = {
      ...current.settings,
      googleClientId: String(settings.googleClientId || '').trim(),
      googleClientSecret: String(settings.googleClientSecret || '').trim(),
      microsoftClientId: String(settings.microsoftClientId || '').trim(),
      autoStart: settings.autoStart !== false
    };
    await this.store.save();
  }

  async addAccount(provider, shell) {
    if (provider !== 'google' && provider !== 'microsoft') throw new Error('Provider non supportato.');
    const current = this.state();
    const clientId = provider === 'google'
      ? current.settings.googleClientId
      : current.settings.microsoftClientId;
    if (!clientId) {
      throw new Error('Inserisci prima l’identificativo OAuth in Impostazioni.');
    }
    if (provider === 'google' && !current.settings.googleClientSecret) {
      throw new Error('Inserisci anche il client secret del client Google Desktop.');
    }

    const oauthOptions = this.oauthOptions(provider, clientId);
    const oauthClient = new OAuthClient((url) => shell.openExternal(url));
    const token = await oauthClient.authorize(oauthOptions);
    token.expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
    const profile = await this.fetchProfile(provider, token.access_token);
    const id = accountId(provider, profile.id, profile.email);
    const existing = current.accounts.find((account) => account.id === id);
    const account = {
      id,
      provider,
      providerId: profile.id,
      email: profile.email || '',
      displayName: profile.displayName || profile.name || '',
      token: {
        access_token: token.access_token,
        refresh_token: token.refresh_token || existing?.token?.refresh_token || '',
        token_type: token.token_type || 'Bearer',
        expiresAt: token.expiresAt
      }
    };
    if (!account.token.refresh_token) {
      throw new Error('Il provider non ha restituito un refresh token. Rimuovi l’autorizzazione dell’app dal provider e riprova.');
    }
    if (existing) {
      current.accounts = current.accounts.map((item) => item.id === id ? account : item);
    } else {
      current.accounts.push(account);
    }
    current.errors = [];
    await this.store.save();
    await this.syncAccount(account);
    await this.store.save();
    return { id: account.id, email: account.email, displayName: account.displayName };
  }

  oauthOptions(provider, clientId) {
    const current = this.state();
    if (provider === 'google') {
      return {
        provider,
        clientId,
        clientSecret: current.settings.googleClientSecret,
        authorizationEndpoint: GOOGLE_AUTH,
        tokenEndpoint: GOOGLE_TOKEN,
        scopes: GOOGLE_SCOPES,
        extraParams: {
          access_type: 'offline',
          prompt: 'consent select_account',
          include_granted_scopes: 'true'
        }
      };
    }
    return {
      provider,
      clientId,
      authorizationEndpoint: MICROSOFT_AUTH,
      tokenEndpoint: MICROSOFT_TOKEN,
      scopes: MICROSOFT_SCOPES,
      extraParams: { prompt: 'select_account' }
    };
  }

  async fetchProfile(provider, accessToken) {
    const url = provider === 'google'
      ? GOOGLE_USERINFO
      : GRAPH_API + '/me?$select=id,displayName,mail,userPrincipalName';
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    const payload = await response.json();
    if (!response.ok) throw new Error('Lettura del profilo non riuscita: ' + safeApiMessage(payload, response.status));
    return {
      id: payload.sub || payload.id,
      email: payload.email || payload.mail || payload.userPrincipalName || '',
      displayName: payload.name || payload.displayName || ''
    };
  }

  async accessToken(account) {
    if (account.token?.access_token && Number(account.token.expiresAt) > Date.now() + 120000) {
      return account.token.access_token;
    }
    if (!account.token?.refresh_token) throw new Error('Token di rinnovo mancante per ' + accountLabel(account));
    const settings = this.state().settings;
    const options = this.oauthOptions(account.provider,
      account.provider === 'google' ? settings.googleClientId : settings.microsoftClientId);
    const refreshed = await refreshToken(options, account.token.refresh_token);
    account.token = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || account.token.refresh_token,
      token_type: refreshed.token_type || account.token.token_type || 'Bearer',
      expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000
    };
    await this.store.save();
    return account.token.access_token;
  }

  async authorizedGet(account, url, extraHeaders = {}) {
    let token = await this.accessToken(account);
    let response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, ...extraHeaders }
    });
    if (response.status === 401) {
      account.token.expiresAt = 0;
      token = await this.accessToken(account);
      response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token, ...extraHeaders }
      });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(safeApiMessage(payload, response.status));
    return payload;
  }

  async syncAll(options = {}) {
    const current = this.state();
    const accounts = current.accounts.slice();
    if (!accounts.length) {
      current.errors = [];
      await this.store.save();
      return { message: 'Collega un account per avviare la sincronizzazione.' };
    }
    const errors = [];
    for (const account of accounts) {
      try {
        await this.syncAccount(account);
      } catch (error) {
        errors.push((account.provider === 'google' ? 'Google' : 'Microsoft') + ' · ' + accountLabel(account) + ': ' + error.message);
      }
    }
    current.lastSync = new Date().toISOString();
    current.errors = errors;
    await this.store.save();
    if (!options.silent && errors.length) {
      return { message: 'Sincronizzazione completata con ' + errors.length + ' avviso/i.' };
    }
    return { message: errors.length ? 'Sync parziale: ' + errors.length + ' account da controllare.' : 'Sincronizzazione completata.' };
  }

  async syncAccount(account) {
    const result = account.provider === 'google'
      ? await this.syncGoogle(account)
      : await this.syncMicrosoft(account);
    const current = this.state();
    const oldCalendars = current.calendars.filter((calendar) => calendar.accountId !== account.id);
    current.calendars = oldCalendars.concat(result.calendars);
    current.events = current.events.filter((event) => event.accountId !== account.id).concat(result.events);
    current.tasks = current.tasks.filter((task) => task.accountId !== account.id).concat(result.tasks || []);
    const savedAccount = current.accounts.find((item) => item.id === account.id);
    if (savedAccount) savedAccount.token = account.token;
  }

  async syncGoogle(account) {
    const calendars = [];
    let nextCalendarPage = null;
    do {
      const url = new URL(GOOGLE_API + '/users/me/calendarList');
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('showHidden', 'true');
      if (nextCalendarPage) url.searchParams.set('pageToken', nextCalendarPage);
      const page = await this.authorizedGet(account, url.toString());
      for (const calendar of page.items || []) {
        const key = account.id + '|' + calendar.id;
        const preferred = this.state().calendarPreferences[key];
        calendars.push({
          accountId: account.id,
          provider: 'google',
          id: calendar.id,
          name: calendar.summary || calendar.id,
          color: calendar.backgroundColor || '#ce654a',
          enabled: preferred ?? calendar.selected !== false
        });
      }
      nextCalendarPage = page.nextPageToken || null;
    } while (nextCalendarPage);

    const events = [];
    const range = dateRange();
    for (const calendar of calendars) {
      if (calendar.enabled === false) continue;
      let nextPageToken = null;
      do {
        const url = new URL(GOOGLE_API + '/calendars/' + encodeURIComponent(calendar.id) + '/events');
        url.searchParams.set('maxResults', '2500');
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('timeMin', range.start);
        url.searchParams.set('timeMax', range.end);
        if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
        const page = await this.authorizedGet(account, url.toString());
        for (const event of page.items || []) {
          if (event.status === 'cancelled') continue;
          const allDay = Boolean(event.start?.date);
          events.push({
            id: account.id + ':' + calendar.id + ':' + event.id,
            accountId: account.id,
            provider: 'google',
            calendarId: calendar.id,
            calendarName: calendar.name,
            title: event.summary || '(Senza titolo)',
            start: asIsoStart(allDay ? event.start.date : event.start?.dateTime, allDay),
            end: asIsoStart(allDay ? event.end?.date : event.end?.dateTime, allDay),
            allDay,
            description: event.description || '',
            location: event.location || '',
            url: event.htmlLink || '',
            color: calendar.color
          });
        }
        nextPageToken = page.nextPageToken || null;
      } while (nextPageToken);
    }

    const tasks = await this.syncGoogleTasks(account);
    return { calendars, events, tasks };
  }

  async syncGoogleTasks(account) {
    const lists = [];
    let nextPageToken = null;
    do {
      const url = new URL(GOOGLE_TASKS_API + '/users/@me/lists');
      url.searchParams.set('maxResults', '100');
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
      const page = await this.authorizedGet(account, url.toString());
      lists.push(...(page.items || []));
      nextPageToken = page.nextPageToken || null;
    } while (nextPageToken);

    const tasks = [];
    for (const list of lists) {
      let pageToken = null;
      do {
        const url = new URL(GOOGLE_TASKS_API + '/lists/' + encodeURIComponent(list.id) + '/tasks');
        url.searchParams.set('maxResults', '100');
        url.searchParams.set('showCompleted', 'false');
        url.searchParams.set('showHidden', 'false');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const page = await this.authorizedGet(account, url.toString());
        for (const task of page.items || []) {
          if (task.status === 'completed' || task.deleted) continue;
          tasks.push({
            id: account.id + ':' + list.id + ':' + task.id,
            accountId: account.id,
            accountEmail: account.email,
            listId: list.id,
            listName: list.title || 'Attività',
            title: task.title || '(Senza titolo)',
            notes: task.notes || '',
            dueDate: task.due ? String(task.due).slice(0, 10) : '',
            updated: task.updated || ''
          });
        }
        pageToken = page.nextPageToken || null;
      } while (pageToken);
    }
    return tasks;
  }

  async syncMicrosoft(account) {
    const calendarPage = await this.authorizedGet(account,
      GRAPH_API + '/me/calendars?$top=100&$select=id,name,color,canEdit');
    const calendars = [];
    for (const calendar of calendarPage.value || []) {
      const key = account.id + '|' + calendar.id;
      calendars.push({
        accountId: account.id,
        provider: 'microsoft',
        id: calendar.id,
        name: calendar.name || 'Calendario Outlook',
        color: graphColor(calendar.color),
        enabled: this.state().calendarPreferences[key] ?? true
      });
    }

    const events = [];
    const range = dateRange();
    for (const calendar of calendars) {
      if (calendar.enabled === false) continue;
      const url = new URL(GRAPH_API + '/me/calendars/' + encodeURIComponent(calendar.id) + '/calendarView');
      url.searchParams.set('startDateTime', range.start);
      url.searchParams.set('endDateTime', range.end);
      url.searchParams.set('$top', '1000');
      url.searchParams.set('$select', 'id,subject,start,end,isAllDay,bodyPreview,location,webLink,isCancelled,showAs,organizer,onlineMeeting');
      let next = url.toString();
      while (next) {
        if (!next.startsWith(GRAPH_API + '/')) throw new Error('Graph ha restituito una pagina esterna non prevista.');
        const page = await this.authorizedGet(account, next, { Prefer: 'outlook.timezone="UTC"' });
        for (const event of page.value || []) {
          if (event.isCancelled) continue;
          const allDay = Boolean(event.isAllDay);
          events.push({
            id: account.id + ':' + calendar.id + ':' + event.id,
            accountId: account.id,
            provider: 'microsoft',
            calendarId: calendar.id,
            calendarName: calendar.name,
            title: event.subject || '(Senza titolo)',
            start: microsoftDate(event.start, allDay),
            end: microsoftDate(event.end, allDay),
            allDay,
            description: event.bodyPreview || '',
            location: event.location?.displayName || '',
            url: event.webLink || '',
            onlineMeetingUrl: event.onlineMeeting?.joinUrl || '',
            color: calendar.color
          });
        }
        next = page['@odata.nextLink'] || null;
      }
    }
    return { calendars, events, tasks: [] };
  }

  async removeAccount(accountIdValue) {
    const current = this.state();
    current.accounts = current.accounts.filter((account) => account.id !== accountIdValue);
    current.calendars = current.calendars.filter((calendar) => calendar.accountId !== accountIdValue);
    current.events = current.events.filter((event) => event.accountId !== accountIdValue);
    current.tasks = current.tasks.filter((task) => task.accountId !== accountIdValue);
    for (const key of Object.keys(current.calendarPreferences)) {
      if (key.startsWith(accountIdValue + '|')) delete current.calendarPreferences[key];
    }
    await this.store.save();
  }

  async setCalendarEnabled(key, enabled) {
    this.state().calendarPreferences[key] = Boolean(enabled);
    await this.store.save();
  }
}

function graphColor(value) {
  const colors = {
    lightBlue: '#4c94cc',
    lightGreen: '#53a57c',
    lightOrange: '#d28a4d',
    lightGray: '#8190a5',
    lightYellow: '#bea746',
    lightTeal: '#39a5a0',
    lightPink: '#ca7294',
    lightBrown: '#9a765f',
    lightRed: '#cf665d',
    maxColor: '#735cb3'
  };
  return colors[value] || '#2581bb';
}
