/***** Channel routing config *****/

function getWebhooks() {
  const props = PropertiesService.getScriptProperties().getProperties();

  const DEFAULT_WEBHOOKS = {};

  DEFAULT_WEBHOOKS['General'] = props.WEBHOOK_GENERAL
  DEFAULT_WEBHOOKS['Alois Platform'] = props.WEBHOOK_ALOIS_PLATFORM
  DEFAULT_WEBHOOKS['Alois Lab'] = props.WEBHOOK_ALOIS_LAB
  DEFAULT_WEBHOOKS['Heads'] = props.WEBHOOK_HEADS
  DEFAULT_WEBHOOKS['Internal'] = props.WEBHOOK_INTERNAL
  DEFAULT_WEBHOOKS['Outreach'] = props.WEBHOOK_OUTREACH
  DEFAULT_WEBHOOKS['Simons Lab'] = props.WEBHOOK_SIMONS_LAB

  return map;
}

/***** Subject-code → channel mapping *****/
const CODE_TO_CHANNEL = {
  ALOIP: 'Alois Platform',
  ALOIL: 'Alois Lab',
  HEADS: 'Heads',
  INTER: 'Internal',
  OUTRE: 'Outreach',
  SIMON: 'Simons Lab',
  // add more codes here if you introduce new ones
};

/***** Settings *****/
const ARCHIVE_AFTER_SEND = true;   // set false to keep in Inbox
const BASE_LABEL = 'Huly';         // assumes this label already exists

/**
 * Main
 */
const QUERY = [
  'newer_than:2d',
  '(from:(noreply@huly.app) OR replyto:(noreply@huly.app))',
  '(-in:drafts)'
].join(' ');
const DEBUG = true;

function sendUnreadToDiscord() {
  const threads = GmailApp.search(QUERY, 0, 50);
  if (DEBUG) console.log(`Found ${threads.length} threads for QUERY: ${QUERY}`);

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      if (!msg.isUnread()) return;

      const from    = msg.getFrom();
      const subject = msg.getSubject() || '(no subject)';
      const date    = msg.getDate();
      const plain = (msg.getPlainBody() || '').toString();
      const html  = (msg.getBody() || '').toString();

      if (DEBUG) console.log(`Msg subject: "${subject}"  | unread=${msg.isUnread()}`);

      const link    = findPreferredLink(html, plain);
      const channel = detectChannelFromSubject(subject);
      if (DEBUG) console.log(`Detected channel: ${channel || 'none'}`);

      const snippet = (plain.replace(/\r?\n/g, ' ').trim() || '(no preview)').slice(0, 900);
      const embed = {
        title: subject,
        url: link || undefined,
        description: snippet,
        fields: [
          { name: 'From',   value: from,               inline: true },
          { name: 'Date',   value: date.toISOString(), inline: true },
          { name: 'Routed', value: channel || '—',     inline: false },
        ],
      };

      // Always send to General + specific channel. Resolve webhook URLs via
      // getWebhooks() so script properties (environment) can override values.
      const WEBHOOKS = getWebhooks();
      const targets = [];
      if (channel && WEBHOOKS[channel]) {
        targets.push(WEBHOOKS[channel]); // primary
      }
      targets.push(WEBHOOKS['General']); // always broadcast

      if (DEBUG) console.log(`Posting to ${targets.length} webhooks for channel: ${channel || 'unknown'}`);

      for (const url of targets) {
        const payload = {
          // bot name uses detected channel, not "General"
          username: `Huly Bot — ${channel}`,
          embeds: [embed],
          components: link ? [{
            type: 1,
            components: [{ type: 2, style: 5, label: 'View in Huly', url: link }]
          }] : []
        };

        try {
          const res = UrlFetchApp.fetch(url, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          });
          const code = res.getResponseCode();
          if (code < 200 || code >= 300) {
            console.warn(`Discord POST failed (${code}) for ${channel || 'General'}: ${res.getContentText()}`);
          } else if (DEBUG) {
            console.log(`Posted (${code}) to ${channel || 'General'}`);
          }
        } catch (e) {
          console.error(`Discord webhook error for ${channel || 'General'}: ${e && e.message}`);
        }
      }

      // Gmail housekeeping
      msg.markRead();
      labelHulyOn(thread); // keep your robust helper
      if (ARCHIVE_AFTER_SEND) thread.moveToArchive();
    });
  });
}

/** Label: Huly (assumes it already exists) */
function labelHulyOn(obj) {
  // Accepts GmailThread or GmailMessage
  const thr =
    obj && typeof obj.addLabel === 'function'      ? obj :
    obj && typeof obj.getThread === 'function'     ? obj.getThread() :
    null;

  if (!thr || typeof thr.addLabel !== 'function') {
    console.warn('labelHulyOn: invalid thread/message object');
    return;
  }

  const lbl = GmailApp.getUserLabelByName(BASE_LABEL);
  if (!lbl) {
    console.warn(`Label "${BASE_LABEL}" not found — skipping label.`);
    return;
  }
  thr.addLabel(lbl);
}

/** Detect channel by subject prefix code (e.g., "ALOIP-42 Something..."). */
function detectChannelFromSubject(subject) {
  const s = (subject || '').trim();

  // Match code at the very start, allowing optional brackets and a suffix like "-123 "
  // Examples matched: "ALOIP Something", "ALOIL-7 Update", "[ALOIP] foo"
  const codeMatch = s.match(/^\s*(?:\[(\w{4,6})\]|(\w{4,6}))\b/);
  if (!codeMatch) return null;

  const code = (codeMatch[1] || codeMatch[2] || '').toUpperCase();
  return CODE_TO_CHANNEL[code] || null;
}

/** Link extraction (prefers “View in Huly”) */
function findPreferredLink(html, plain) {
  const normalizedHtml = (html || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

  // 1) <a ...>View in Huly</a>
  const anchorRegex = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRegex.exec(normalizedHtml)) !== null) {
    const attrs = m[1] || '';
    const inner = stripTags(m[2] || '').trim();
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    const href = hrefMatch ? hrefMatch[1].trim() : '';
    if (/view\s+in\s+huly/i.test(inner) && isHttp(href)) return href;
  }

  // 2) first href anywhere
  const anyHref = normalizedHtml.match(/\bhref=["']([^"']+)["']/i);
  if (anyHref && isHttp(anyHref[1])) return anyHref[1];

  // 3) first raw URL in plain text
  const urlMatch = (plain || '').match(/https?:\/\/[^\s)>\]}]+/i);
  if (urlMatch) return urlMatch[0];

  return null;
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function isHttp(url) { return /^https?:\/\//i.test(url || ''); }
