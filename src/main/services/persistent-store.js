import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const initialState = () => ({
  settings: {
    googleClientId: '',
    googleClientSecret: '',
    microsoftClientId: '',
    autoStart: true
  },
  accounts: [],
  calendars: [],
  calendarPreferences: {},
  events: [],
  tasks: [],
  lastSync: null,
  errors: []
});

export class PersistentStore {
  constructor() {
    this.filePath = null;
    this.state = initialState();
  }

  async load() {
    this.filePath = path.join(app.getPath('userData'), 'calendar-vault.bin');
    try {
      const encrypted = await fs.readFile(this.filePath);
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('La cifratura Windows non è disponibile su questo profilo.');
      }
      const plaintext = safeStorage.decryptString(encrypted);
      this.state = { ...initialState(), ...JSON.parse(plaintext) };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.state.errors = ['Non è stato possibile leggere il vault locale cifrato: ' + error.message];
      }
    }
    return this.state;
  }

  getState() {
    return this.state;
  }

  async save() {
    if (!this.filePath) throw new Error('Archivio locale non inizializzato.');
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('La cifratura Windows non è disponibile: i dati non verranno salvati in chiaro.');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(this.state));
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = this.filePath + '.tmp';
    await fs.writeFile(temporaryPath, encrypted);
    await fs.rename(temporaryPath, this.filePath);
  }
}
