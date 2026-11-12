/**
 * PebbleKit JS for Monzo Watchapp
 *
 * Subscribes to Monzo plugin sources (finance/account, finance/pot, finance/configured),
 * organizes multi-account data and pot associations, and sends structured payloads to the watch.
 */

var accountSubscription = null;
var potSubscription = null;
var configuredSubscription = null;

var cachedAccounts = [];
var cachedPots = [];

var currentTheme = (function () {
  try { return localStorage.getItem('monzo_theme') || 'light'; } catch (e) { return 'light'; }
})();

var currentFirstAccount = (function () {
  try { return localStorage.getItem('monzo_first_account') || ''; } catch (e) { return ''; }
})();

var isPluginConfigured = false;

var latestData = {
  KEY_ACCOUNT_COUNT: 0,
  KEY_STATUS: 'Ready'
};

function getAccountSummaries() {
  return cachedAccounts.map(function (acc) {
    var p = acc.properties || {};
    var name = (p.name && p.name.shortText && p.name.shortText.text) || acc.instanceId;
    var type = (p.account_type && p.account_type.shortText && p.account_type.shortText.text) || '';
    var bal = (p.balance && p.balance.shortText && p.balance.shortText.text) || '';
    return {
      id: acc.instanceId,
      name: name,
      type: type,
      balance: bal
    };
  });
}

function pushToWatch() {
  var themeVal = (currentTheme === 'dark') ? 1 : 0;
  if (cachedAccounts.length === 0) {
    var emptyPayload = {
      KEY_THEME: themeVal,
      KEY_ACCOUNT_COUNT: 2,
      KEY_STATUS: latestData.KEY_STATUS || 'Setup',
      KEY_ACC0_ID: 'acc_personal',
      KEY_ACC0_NAME: 'PERSONAL',
      KEY_ACC0_BALANCE: 'Connect',
      KEY_ACC0_SPEND: 'Open settings',
      KEY_ACC0_TOTAL: '£0.00',
      KEY_ACC0_POTS: 'No active savings pots',
      KEY_ACC1_ID: 'acc_joint',
      KEY_ACC1_NAME: 'JOINT',
      KEY_ACC1_BALANCE: 'Connect',
      KEY_ACC1_SPEND: 'Open settings',
      KEY_ACC1_TOTAL: '£0.00',
      KEY_ACC1_POTS: 'No active savings pots'
    };
    Pebble.sendAppMessage(emptyPayload, function () {
      console.log('[PKJS] Sent initial 2-account state to watch.');
    }, function (err) {
      console.warn('[PKJS] Failed to send initial state:', JSON.stringify(err));
    });
    return;
  }

  // Sort with user-selected first account at top if present
  var sortedAccounts = cachedAccounts.slice();
  if (currentFirstAccount) {
    var matchIdx = -1;
    for (var k = 0; k < sortedAccounts.length; k++) {
      if (sortedAccounts[k].instanceId === currentFirstAccount) {
        matchIdx = k;
        break;
      }
    }
    if (matchIdx > 0) {
      var matched = sortedAccounts.splice(matchIdx, 1)[0];
      sortedAccounts.unshift(matched);
    }
  }

  var num = Math.min(sortedAccounts.length, 4);
  var payload = {
    KEY_THEME: themeVal,
    KEY_ACCOUNT_COUNT: num,
    KEY_STATUS: latestData.KEY_STATUS || 'Updated'
  };

  for (var i = 0; i < num; i++) {
    var acc = sortedAccounts[i];
    var accId = acc.instanceId;
    var p = acc.properties || {};

    // Correlate pots for this account
    var accPots = cachedPots.filter(function (pot) {
      var potAccId = pot.properties && pot.properties.account_id && pot.properties.account_id.shortText && pot.properties.account_id.shortText.text;
      return !potAccId || potAccId === accId;
    });

    var potSummary = 'No pots';
    if (accPots.length > 0) {
      var firstPot = accPots[0];
      var potName = (firstPot.properties.name && firstPot.properties.name.shortText && firstPot.properties.name.shortText.text) || 'Pot';
      var potBal = (firstPot.properties.balance && firstPot.properties.balance.shortText && firstPot.properties.balance.shortText.text) || '£0.00';
      if (accPots.length === 1) {
        potSummary = potName + ': ' + potBal;
      } else {
        potSummary = accPots.length + ' pots (' + potName + ': ' + potBal + ')';
      }
    }

    var nameStr = (p.name && p.name.shortText && p.name.shortText.text) || ('Acc ' + (i + 1));
    var balStr = (p.balance && p.balance.shortText && p.balance.shortText.text) || '£0.00';
    var spendStr = (p.spend_today && p.spend_today.shortText && p.spend_today.shortText.text) || '£0.00';
    var totalStr = (p.total_balance && p.total_balance.shortText && p.total_balance.shortText.text) || balStr;

    payload['KEY_ACC' + i + '_ID'] = accId;
    payload['KEY_ACC' + i + '_NAME'] = nameStr.toUpperCase();
    payload['KEY_ACC' + i + '_BALANCE'] = balStr;
    payload['KEY_ACC' + i + '_SPEND'] = spendStr;
    payload['KEY_ACC' + i + '_TOTAL'] = totalStr;
    payload['KEY_ACC' + i + '_POTS'] = potSummary;
  }

  Pebble.sendAppMessage(payload, function () {
    console.log('[PKJS] Pushed ' + num + ' accounts to watchapp.');
  }, function (err) {
    console.warn('[PKJS] Failed to push accounts to watchapp:', JSON.stringify(err));
  });
}

function initSubscriptions() {
  if (typeof Pebble.subscribeToSource !== 'function') {
    console.warn('[PKJS] Pebble.subscribeToSource is not available.');
    latestData.KEY_STATUS = 'No plugin API';
    pushToWatch();
    return;
  }

  // 1. Subscribe to configured
  try {
    configuredSubscription = Pebble.subscribeToSource({
      category: 'finance',
      item: 'configured',
      onData: function (envelope) {
        var inst = envelope.instances && envelope.instances[0];
        var isConfigured = inst && inst.properties && inst.properties.configured &&
                           inst.properties.configured.boolean && inst.properties.configured.boolean.value;
        isPluginConfigured = !!isConfigured;
        if (!isConfigured) {
          cachedAccounts = [];
          latestData.KEY_STATUS = 'Setup';
          pushToWatch();
        }
      },
      onError: function (err) {
        isPluginConfigured = false;
        console.warn('[PKJS] configured error:', JSON.stringify(err));
      }
    });
  } catch (e) {
    console.error('[PKJS] Error subscribing to finance/configured:', e);
  }

  // 2. Subscribe to Monzo Accounts (receives all accounts as instances)
  try {
    accountSubscription = Pebble.subscribeToSource({
      category: 'finance',
      item: 'account',
      onData: function (envelope) {
        cachedAccounts = envelope.instances || [];
        if (cachedAccounts.length > 0) {
          isPluginConfigured = true;
        }
        latestData.KEY_STATUS = 'Updated';
        pushToWatch();
      },
      onError: function (err) {
        console.warn('[PKJS] Account subscription error:', JSON.stringify(err));
        if (err && err.code === 'AUTH_REQUIRED') {
          cachedAccounts = [];
          isPluginConfigured = false;
          latestData.KEY_STATUS = 'Sign in';
        } else {
          latestData.KEY_STATUS = 'Offline';
        }
        pushToWatch();
      }
    });
  } catch (e) {
    console.error('[PKJS] Error subscribing to finance/account:', e);
  }

  // 3. Subscribe to Monzo Pots
  try {
    potSubscription = Pebble.subscribeToSource({
      category: 'finance',
      item: 'pot',
      onData: function (envelope) {
        cachedPots = envelope.instances || [];
        pushToWatch();
      },
      onError: function (err) {
        console.warn('[PKJS] Pot subscription error:', JSON.stringify(err));
      }
    });
  } catch (e) {
    console.error('[PKJS] Error subscribing to finance/pot:', e);
  }
}

Pebble.addEventListener('ready', function () {
  console.log('[PKJS] PebbleKit JS ready. Initializing Monzo plugin subscriptions.');
  initSubscriptions();
});

Pebble.addEventListener('appmessage', function (e) {
  console.log('[PKJS] Received appmessage from watch:', JSON.stringify(e.payload));
  if (e.payload && e.payload.KEY_REQUEST_TYPE === 1) {
    pushToWatch();
  }
});

Pebble.addEventListener('configmessage', function (e) {
  var msg = (e && e.data) || {};
  console.log('[PKJS] Received configmessage:', JSON.stringify(msg));
  if (msg.type === 'getAppConfig') {
    if (typeof e.respond === 'function') {
      e.respond({
        theme: currentTheme,
        firstAccountId: currentFirstAccount,
        isConfigured: isPluginConfigured,
        pluginStatus: latestData.KEY_STATUS || 'Ready',
        accounts: getAccountSummaries()
      });
    }
  } else if (msg.type === 'setAppConfig') {
    if (msg.theme) {
      currentTheme = msg.theme;
      try { localStorage.setItem('monzo_theme', currentTheme); } catch (err) {}
    }
    if (msg.firstAccountId !== undefined) {
      currentFirstAccount = msg.firstAccountId;
      try { localStorage.setItem('monzo_first_account', currentFirstAccount); } catch (err) {}
    }
    pushToWatch();
    if (typeof e.respond === 'function') {
      e.respond({ ok: true });
    }
  }
});

Pebble.addEventListener('webviewclosed', function (e) {
  console.log('[PKJS] webviewclosed event:', e.response);
  if (!e.response) return;
  try {
    var config = JSON.parse(decodeURIComponent(e.response));
    if (config.theme) {
      currentTheme = config.theme;
      try { localStorage.setItem('monzo_theme', currentTheme); } catch (err) {}
    }
    if (config.firstAccountId !== undefined) {
      currentFirstAccount = config.firstAccountId;
      try { localStorage.setItem('monzo_first_account', currentFirstAccount); } catch (err) {}
    }
    pushToWatch();
  } catch (err) {
    console.warn('[PKJS] webviewclosed parse error:', err);
  }
});
