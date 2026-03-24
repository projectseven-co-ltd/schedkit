// src/lib/tables.js — Table ID cache (populated at startup)

export const tables = {};

// Static table IDs (fallback / reference)
tables.tickets          = 'mh3shq07jve4boh';
tables.ticket_responders = 'mvmka9czpxr135k';
tables.ticket_replies   = 'mrnbdc0zi78ki2l';
tables.pushSubscriptions = 'mbvs3axseplv86g';
tables.signals          = 'm21ubw2908iz01s'; // recreated 2026-03-15 with org_id column
tables.alerts           = 'm00769mnao3ujmr'; // created 2026-03-24
tables.org_members      = 'mga9c2ltkvdo2iz';
tables.organizations    = 'mdtcor4xjn6a11d';
