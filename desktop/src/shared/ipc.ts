/** Centralized IPC channel names shared by main, preload, and renderer. */
export const IPC = {
  // Passengers
  passengerList: 'passenger:list',
  passengerCreate: 'passenger:create',
  passengerUpdate: 'passenger:update',
  passengerDelete: 'passenger:delete',

  // Accounts
  accountList: 'account:list',
  accountCreate: 'account:create',
  accountUpdate: 'account:update',
  accountDelete: 'account:delete',
  accountSetPassword: 'account:setPassword',
  accountDeletePassword: 'account:deletePassword',
  accountTestLogin: 'account:testLogin',
  accountSyncTrips: 'account:syncTrips',

  // Flights
  flightList: 'flight:list',
  flightGet: 'flight:get',
  flightCreate: 'flight:create',
  flightUpdate: 'flight:update',
  flightDelete: 'flight:delete',

  // Pricing
  priceCheckOne: 'price:checkOne',
  priceCheckAll: 'price:checkAll',
  priceRecompute: 'price:recompute',

  // Settings
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsWarmScraperProfile: 'settings:warmScraperProfile',
  settingsSetSerpApiKey: 'settings:setSerpApiKey',
  settingsSerpApiUsage: 'settings:serpApiUsage',

  // Gmail email import
  emailStatus: 'email:status',
  emailSetCredentials: 'email:setCredentials',
  emailConnect: 'email:connect',
  emailDisconnect: 'email:disconnect',
  emailImport: 'email:import',

  // Monitoring
  monitorStart: 'monitor:start',
  monitorStop: 'monitor:stop',
  monitorStatus: 'monitor:status',

  // Export
  exportCsv: 'export:csv',

  // Reporting
  reportSavings: 'report:savings',
  reportTrends: 'report:trends',

  // System
  openExternal: 'system:openExternal',

  // Events (main → renderer)
  evtPriceUpdate: 'event:priceUpdate',
  evtAlert: 'event:alert',
  evtMonitorStatus: 'event:monitorStatus',
  evtEmailImportProgress: 'event:emailImportProgress',
  evtPriceCheckProgress: 'event:priceCheckProgress',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
