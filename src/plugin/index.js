/**
 * Monzo Bank Pebble Plugin
 *
 * Runs inside the Pebble mobile companion app. Interfaces directly with Monzo's Developer API (api.monzo.com)
 * and exposes standard `finance/*` sources and actions to Pebble watchfaces, watchapps, and the Index assistant.
 */

var API_ROOT = 'https://api.monzo.com';
var TOKEN_KEY = 'monzo_access_token';
var REFRESH_TOKEN_KEY = 'monzo_refresh_token';
var CLIENT_ID_KEY = 'monzo_client_id';
var CLIENT_SECRET_KEY = 'monzo_client_secret';
var REDIRECT_URI_KEY = 'monzo_redirect_uri';
var SELECTED_ACC_KEY = 'monzo_selected_account';
var ACCOUNTS_CACHE_KEY = 'monzo_cached_accounts';
var BLOCKED_KEY = 'monzo.blocked.v1';
var REFRESH_MS = 60 * 1000;
var SOURCES = ['finance/account', 'finance/pot', 'finance/transaction', 'finance/configured'];
var REACH_HOSTS = ['api.monzo.com'];

var CURRENCY_SYMBOLS = {
  GBP: '£',
  EUR: '€',
  USD: '$'
};

function formatCurrency(minorUnits, currencyCode) {
  var code = currencyCode || 'GBP';
  var symbol = CURRENCY_SYMBOLS[code] || (code + ' ');
  var isNegative = minorUnits < 0;
  var absVal = Math.abs(minorUnits) / 100;
  var formattedNum = absVal.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return (isNegative ? '-' : '') + symbol + formattedNum;
}

function prettyAccountName(acc) {
  if (!acc) return 'Current Acc';
  if (acc.type === 'uk_retail') return 'Personal';
  if (acc.type === 'uk_retail_joint') return 'Joint';
  if (acc.type === 'uk_monzo_flex') return 'Flex';
  if (acc.type === 'uk_business') return 'Business';
  if (acc.description && !acc.description.startsWith('acc_') && acc.description.trim()) {
    return acc.description.trim();
  }
  return 'Monzo';
}

// ---------------------------------------------------------------- Network / Permissions

async function blockedHost() {
  var permissions = typeof Pebble !== 'undefined' && Pebble.permissions;
  if (permissions) {
    for (var i = 0; i < REACH_HOSTS.length; i++) {
      var state = await permissions.query('Internet/' + REACH_HOSTS[i]);
      if (state !== 'granted') return { host: REACH_HOSTS[i], sure: true };
    }
    return null;
  }
  return null;
}

async function checkReach() {
  var blocked = await blockedHost();
  try {
    if (blocked) localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked));
    else localStorage.removeItem(BLOCKED_KEY);
  } catch (e) {}
  return blocked;
}

// ---------------------------------------------------------------- Secure Token Storage

async function getStorageItem(key) {
  try {
    if (typeof Pebble !== 'undefined' && Pebble.secureStorage) {
      var val = await Pebble.secureStorage.getItem(key);
      if (val && val.trim()) return val.trim();
    }
  } catch (e) {
    console.warn('[MonzoPlugin] secureStorage getItem failed for ' + key + ':', e);
  }
  try {
    return (localStorage.getItem(key) || '').trim();
  } catch (e) {
    return '';
  }
}

async function setStorageItem(key, value) {
  var clean = (value || '').trim();
  try {
    if (typeof Pebble !== 'undefined' && Pebble.secureStorage) {
      if (clean) await Pebble.secureStorage.setItem(key, clean);
      else await Pebble.secureStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('[MonzoPlugin] secureStorage setItem failed for ' + key + ':', e);
  }
  try {
    if (clean) localStorage.setItem(key, clean);
    else localStorage.removeItem(key);
  } catch (e) {}
}

async function getAccessToken() {
  return await getStorageItem(TOKEN_KEY);
}

async function setAccessToken(token) {
  await setStorageItem(TOKEN_KEY, token);
}

async function getRefreshToken() {
  return await getStorageItem(REFRESH_TOKEN_KEY);
}

async function setRefreshToken(token) {
  await setStorageItem(REFRESH_TOKEN_KEY, token);
}

async function getOAuthCredentials() {
  return {
    clientId: await getStorageItem(CLIENT_ID_KEY),
    clientSecret: await getStorageItem(CLIENT_SECRET_KEY),
    redirectUri: await getStorageItem(REDIRECT_URI_KEY),
    refreshToken: await getStorageItem(REFRESH_TOKEN_KEY)
  };
}

async function setOAuthCredentials(clientId, clientSecret, redirectUri, refreshToken) {
  await setStorageItem(CLIENT_ID_KEY, clientId);
  await setStorageItem(CLIENT_SECRET_KEY, clientSecret);
  await setStorageItem(REDIRECT_URI_KEY, redirectUri);
  if (refreshToken !== undefined) {
    await setStorageItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

async function clearTokens() {
  await setStorageItem(TOKEN_KEY, '');
  await setStorageItem(REFRESH_TOKEN_KEY, '');
  await setStorageItem(CLIENT_ID_KEY, '');
  await setStorageItem(CLIENT_SECRET_KEY, '');
  await setStorageItem(REDIRECT_URI_KEY, '');
  try {
    localStorage.removeItem(SELECTED_ACC_KEY);
    localStorage.removeItem(ACCOUNTS_CACHE_KEY);
  } catch (e) {}
}

// ---------------------------------------------------------------- OAuth Token Refresh

var isRefreshing = false;
var refreshPromise = null;

async function refreshTokens() {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  isRefreshing = true;
  refreshPromise = (async function () {
    try {
      var creds = await getOAuthCredentials();
      if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
        console.log('[MonzoPlugin] Cannot refresh token: missing OAuth credentials or refresh token.');
        return null;
      }

      console.log('[MonzoPlugin] Refreshing Monzo access token using refresh token...');
      var params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('client_id', creds.clientId);
      params.append('client_secret', creds.clientSecret);
      params.append('refresh_token', creds.refreshToken);

      var res = await fetch(API_ROOT + '/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params.toString()
      });

      var text = await res.text();
      var json = null;
      try { json = JSON.parse(text); } catch (err) {}

      if (!res.ok || !json || !json.access_token) {
        console.error('[MonzoPlugin] Failed to refresh token:', res.status, text);
        return null;
      }

      console.log('[MonzoPlugin] Token refreshed successfully.');
      await setAccessToken(json.access_token);
      if (json.refresh_token) {
        await setRefreshToken(json.refresh_token);
      }
      return json.access_token;
    } catch (e) {
      console.error('[MonzoPlugin] Exception during token refresh:', e);
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// ---------------------------------------------------------------- Monzo API Client

async function monzoFetch(endpoint, method, body, tokenOverride, hasRetried) {
  var token = tokenOverride || await getAccessToken();
  if (!token) {
    // Attempt automatic refresh if we have OAuth refresh token
    if (!tokenOverride && !hasRetried) {
      var refreshed = await refreshTokens();
      if (refreshed) {
        return await monzoFetch(endpoint, method, body, refreshed, true);
      }
    }
    return { ok: false, status: 401, error: 'AUTH_REQUIRED', message: 'No access token available.' };
  }

  var url = API_ROOT + endpoint;
  var headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json'
  };
  var fetchOptions = {
    method: method || 'GET',
    headers: headers
  };

  if (body) {
    if (typeof body === 'object') {
      var params = new URLSearchParams();
      for (var k in body) {
        if (body.hasOwnProperty(k) && body[k] !== undefined && body[k] !== null) {
          params.append(k, String(body[k]));
        }
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = params.toString();
    } else {
      fetchOptions.body = body;
    }
  }

  try {
    var response = await fetch(url, fetchOptions);
    var text = await response.text();
    var json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (parseErr) {
      console.warn('[MonzoPlugin] Failed to parse JSON response:', text);
    }

    if (!response.ok) {
      // If 401 Unauthorized and we haven't retried yet, attempt refresh
      if (response.status === 401 && !tokenOverride && !hasRetried) {
        console.log('[MonzoPlugin] Got 401 Unauthorized, attempting token refresh...');
        var newToken = await refreshTokens();
        if (newToken) {
          return await monzoFetch(endpoint, method, body, newToken, true);
        }
      }

      var errCode = 'UNKNOWN';
      if (response.status === 401) errCode = 'AUTH_REQUIRED';
      else if (response.status === 403) errCode = 'PERMISSION_DENIED';
      else if (response.status === 429) errCode = 'RATE_LIMITED';
      else if (response.status >= 500) errCode = 'PLUGIN_UNAVAILABLE';

      var errMsg = (json && (json.message || json.error_description || json.error)) || ('HTTP ' + response.status);
      return { ok: false, status: response.status, error: errCode, message: errMsg, json: json };
    }

    return { ok: true, status: response.status, json: json };
  } catch (fetchErr) {
    console.error('[MonzoPlugin] Network request failed for ' + url + ':', fetchErr);
    var isDenied = fetchErr && fetchErr.name === 'NotAllowedError';
    return {
      ok: false,
      status: 0,
      error: isDenied ? 'PERMISSION_DENIED' : 'PLUGIN_UNAVAILABLE',
      message: isDenied ? 'Internet access to api.monzo.com was denied.' : (fetchErr.message || 'Network connection failed.')
    };
  }
}

async function apiWhoAmI(token) {
  return await monzoFetch('/ping/whoami', 'GET', null, token);
}

async function apiGetAccounts(token) {
  var res = await monzoFetch('/accounts', 'GET', null, token);
  if (!res.ok) return res;
  var raw = (res.json && res.json.accounts) || [];
  // Filter for open retail/joint/flex accounts
  var active = raw.filter(function (acc) {
    return !acc.closed && (acc.type === 'uk_retail' || acc.type === 'uk_retail_joint' || acc.type === 'uk_monzo_flex' || !acc.type);
  });
  return { ok: true, accounts: active.length ? active : raw };
}

async function apiGetBalance(accountId, token) {
  return await monzoFetch('/balance?account_id=' + encodeURIComponent(accountId), 'GET', null, token);
}

async function apiGetPots(accountId, token) {
  var url = '/pots' + (accountId ? '?current_account_id=' + encodeURIComponent(accountId) : '');
  var res = await monzoFetch(url, 'GET', null, token);
  if (!res.ok) return res;
  var raw = (res.json && res.json.pots) || [];
  var active = raw.filter(function (pot) {
    return !pot.deleted;
  });
  return { ok: true, pots: active };
}

async function apiGetTransactions(accountId, token) {
  var url = '/transactions?account_id=' + encodeURIComponent(accountId) + '&limit=10&expand[]=merchant';
  return await monzoFetch(url, 'GET', null, token);
}

// ---------------------------------------------------------------- Account Resolution

function getSelectedAccountId() {
  try {
    return localStorage.getItem(SELECTED_ACC_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setSelectedAccountId(id) {
  try {
    if (id) localStorage.setItem(SELECTED_ACC_KEY, id);
    else localStorage.removeItem(SELECTED_ACC_KEY);
  } catch (e) {}
}

async function resolveAccountAndToken() {
  var token = await getAccessToken();
  if (!token) return { token: null, account: null };

  var accRes = await apiGetAccounts(token);
  if (!accRes.ok || !accRes.accounts || !accRes.accounts.length) {
    return { token: token, account: null, error: accRes.error, message: accRes.message };
  }

  var selectedId = getSelectedAccountId();
  var primary = accRes.accounts.find(function (a) { return a.id === selectedId; }) || accRes.accounts[0];

  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(accRes.accounts));
  } catch (e) {}

  return { token: token, account: primary, allAccounts: accRes.accounts };
}

// ---------------------------------------------------------------- Source Handler

Pebble.registerSourceHandler(async function (request, respond) {
  console.log('[MonzoPlugin] Source request:', request.category, request.item);

  // 1. configured check
  if (request.category === 'finance' && request.item === 'configured') {
    var hasToken = (await getAccessToken()).length > 0;
    respond.data({
      instances: [{
        instanceId: 'configured',
        properties: {
          name: { shortText: { text: 'Monzo Bank' } },
          configured: { boolean: { value: hasToken }, shortText: { text: hasToken ? 'Connected' : 'Not configured' } }
        }
      }]
    });
    return;
  }

  if (request.category !== 'finance') {
    respond.error('INVALID_REQUEST', 'Unsupported category: ' + request.category);
    return;
  }

  var context = await resolveAccountAndToken();
  if (!context.token) {
    respond.error('AUTH_REQUIRED', 'Please connect your Monzo account in the plugin settings page.');
    return;
  }

  if (!context.account) {
    if (context.error === 'AUTH_REQUIRED') {
      respond.error('AUTH_REQUIRED', context.message || 'Monzo authorization has expired.');
    } else {
      respond.error(context.error || 'PLUGIN_UNAVAILABLE', context.message || 'No active Monzo accounts found.');
    }
    return;
  }

  var accounts = context.allAccounts || [context.account];
  var token = context.token;

  // 2. finance/account -> returns all accounts as instances!
  if (request.item === 'account') {
    var instances = [];

    // Order: put selected account first, then others
    var sortedAccounts = accounts.slice().sort(function (a, b) {
      if (a.id === context.account.id) return -1;
      if (b.id === context.account.id) return 1;
      return 0;
    });

    for (var i = 0; i < sortedAccounts.length; i++) {
      var acc = sortedAccounts[i];
      var balRes = await apiGetBalance(acc.id, token);
      if (balRes.ok) {
        var b = balRes.json;
        var spendVal = typeof b.spend_today === 'number' ? b.spend_today : 0;
        var balStr = formatCurrency(b.balance, b.currency);
        var totalBalStr = formatCurrency(b.total_balance, b.currency);
        var spendStr = formatCurrency(spendVal, b.currency);
        var pName = prettyAccountName(acc);

        instances.push({
          instanceId: acc.id,
          properties: {
            name: {
              shortText: { text: pName },
              longText: { text: acc.description ? (pName + ' (' + acc.description + ')') : pName }
            },
            account_type: {
              shortText: { text: pName }
            },
            balance: {
              numericValue: { value: b.balance / 100, unit: b.currency },
              shortText: { text: balStr },
              longText: { text: balStr }
            },
            total_balance: {
              numericValue: { value: b.total_balance / 100, unit: b.currency },
              shortText: { text: totalBalStr },
              longText: { text: totalBalStr }
            },
            spend_today: {
              numericValue: { value: Math.abs(spendVal) / 100, unit: b.currency },
              shortText: { text: spendStr },
              longText: { text: 'Spent today: ' + spendStr }
            },
            currency: {
              shortText: { text: b.currency || 'GBP' }
            },
            account_id: {
              shortText: { text: acc.id }
            }
          }
        });
      }
    }

    if (instances.length === 0) {
      respond.error('PLUGIN_UNAVAILABLE', 'Could not read account balances.');
      return;
    }

    respond.data({
      validUntilMs: Date.now() + REFRESH_MS,
      instances: instances
    });
    return;
  }

  // 3. finance/pot -> fetch pots across all accounts
  if (request.item === 'pot') {
    var potInstances = [];

    for (var a = 0; a < accounts.length; a++) {
      var curAcc = accounts[a];
      var potRes = await apiGetPots(curAcc.id, token);
      if (potRes.ok && potRes.pots) {
        for (var p = 0; p < potRes.pots.length; p++) {
          var pot = potRes.pots[p];
          var formatted = formatCurrency(pot.balance, pot.currency);
          potInstances.push({
            instanceId: pot.id,
            properties: {
              name: {
                shortText: { text: pot.name },
                longText: { text: pot.name }
              },
              balance: {
                numericValue: { value: pot.balance / 100, unit: pot.currency },
                shortText: { text: formatted },
                longText: { text: formatted }
              },
              currency: {
                shortText: { text: pot.currency || 'GBP' }
              },
              account_id: {
                shortText: { text: curAcc.id }
              }
            }
          });
        }
      }
    }

    respond.data({
      validUntilMs: Date.now() + (REFRESH_MS * 2),
      instances: potInstances
    });
    return;
  }

  // 4. finance/transaction
  if (request.item === 'transaction') {
    var txRes = await apiGetTransactions(context.account.id, token);
    if (!txRes.ok) {
      respond.error(txRes.error || 'PLUGIN_UNAVAILABLE', txRes.message || 'Failed to fetch transactions.');
      return;
    }

    var transactions = (txRes.json && txRes.json.transactions) || [];
    var txInstances = transactions.map(function (tx) {
      var merchantName = (tx.merchant && tx.merchant.name) || tx.description || 'Transaction';
      var formattedAmount = formatCurrency(tx.amount, tx.currency);
      var epochSeconds = Math.floor(new Date(tx.created).getTime() / 1000);

      return {
        instanceId: tx.id,
        properties: {
          name: {
            shortText: { text: merchantName },
            longText: { text: merchantName }
          },
          merchant: {
            shortText: { text: merchantName },
            longText: { text: merchantName }
          },
          amount: {
            numericValue: { value: tx.amount / 100, unit: tx.currency },
            shortText: { text: formattedAmount },
            longText: { text: formattedAmount }
          },
          created: {
            timestamp: { value: isNaN(epochSeconds) ? Math.floor(Date.now() / 1000) : epochSeconds }
          },
          category: {
            shortText: { text: tx.category || 'general' }
          },
          account_id: {
            shortText: { text: context.account.id }
          }
        }
      };
    });

    respond.data({
      validUntilMs: Date.now() + (REFRESH_MS * 2),
      instances: txInstances
    });
    return;
  }

  respond.error('INVALID_REQUEST', 'Unknown item: ' + request.item);
});

// ---------------------------------------------------------------- Action Handler

Pebble.registerActionHandler(async function (request, respond) {
  console.log('[MonzoPlugin] Action request:', request.action, request.args);

  var context = await resolveAccountAndToken();
  if (!context.token) {
    respond.error('AUTH_REQUIRED', 'Please connect your Monzo account in the settings page.');
    return;
  }

  var token = context.token;
  var args = request.args || {};
  var potId = args.pot_id;
  var amount = Number(args.amount);
  var accountId = args.account_id || (context.account && context.account.id);

  if (!potId || typeof potId !== 'string') {
    respond.error('INVALID_ARGS', 'pot_id is required.');
    return;
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    respond.error('INVALID_ARGS', 'amount must be a positive integer in pence.');
    return;
  }
  if (!accountId) {
    respond.error('INVALID_ARGS', 'account_id could not be determined.');
    return;
  }

  var dedupeId = 'pebble_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);

  if (request.action === 'deposit_pot') {
    var depositRes = await monzoFetch('/pots/' + encodeURIComponent(potId) + '/deposit', 'PUT', {
      source_account_id: accountId,
      amount: Math.round(amount),
      dedupe_id: dedupeId
    }, token);

    if (!depositRes.ok) {
      respond.error(depositRes.error || 'UNKNOWN', depositRes.message || 'Deposit failed.');
      return;
    }

    var potName = (depositRes.json && depositRes.json.name) || 'pot';
    var formattedDep = formatCurrency(amount, 'GBP');
    respond.ok({
      text: 'Deposited ' + formattedDep + ' into ' + potName + '.',
      refreshed: ['finance/pot', 'finance/account']
    });
    return;
  }

  if (request.action === 'withdraw_pot') {
    var withdrawRes = await monzoFetch('/pots/' + encodeURIComponent(potId) + '/withdraw', 'PUT', {
      destination_account_id: accountId,
      amount: Math.round(amount),
      dedupe_id: dedupeId
    }, token);

    if (!withdrawRes.ok) {
      respond.error(withdrawRes.error || 'UNKNOWN', withdrawRes.message || 'Withdrawal failed.');
      return;
    }

    var potNameW = (withdrawRes.json && withdrawRes.json.name) || 'pot';
    var formattedWith = formatCurrency(amount, 'GBP');
    respond.ok({
      text: 'Withdrew ' + formattedWith + ' from ' + potNameW + '.',
      refreshed: ['finance/pot', 'finance/account']
    });
    return;
  }

  respond.error('INVALID_REQUEST', 'Unknown action: ' + request.action);
});

// ---------------------------------------------------------------- Config Page Handler

Pebble.registerConfigHandler(async function (message, respond) {
  var type = message && message.type;
  console.log('[MonzoPlugin] Config handler message:', type);

  if (type === 'reach') {
    respond({ blocked: await checkReach().catch(function () { return null; }) });
    return;
  }

  if (type === 'status') {
    var token = await getAccessToken();
    var creds = await getOAuthCredentials();
    var hasOAuth = !!(creds.clientId && creds.clientSecret && creds.refreshToken);

    // If no access token but we have OAuth refresh token, try refreshing
    if (!token && hasOAuth) {
      token = await refreshTokens();
    }

    if (!token) {
      respond({
        configured: false,
        accounts: [],
        selectedAccountId: '',
        clientId: creds.clientId || '',
        redirectUri: creds.redirectUri || '',
        isOAuth: hasOAuth
      });
      return;
    }

    var pingRes = await apiWhoAmI(token);
    // If ping fails and we have OAuth, try refresh once
    if (!pingRes.ok && hasOAuth) {
      token = await refreshTokens();
      if (token) {
        pingRes = await apiWhoAmI(token);
      }
    }

    if (!pingRes.ok) {
      respond({
        configured: false,
        expired: true,
        error: pingRes.message || 'Token expired or invalid.',
        clientId: creds.clientId || '',
        redirectUri: creds.redirectUri || '',
        isOAuth: hasOAuth
      });
      return;
    }

    var accRes = await apiGetAccounts(token);
    var isPendingApproval = (!accRes.ok && (accRes.status === 403 || accRes.error === 'PERMISSION_DENIED'));
    var accounts = (accRes.ok && accRes.accounts) || [];
    var selected = getSelectedAccountId() || (accounts[0] && accounts[0].id) || '';
    if (selected && !getSelectedAccountId()) {
      setSelectedAccountId(selected);
    }

    var potCount = 0;
    if (selected) {
      var potsRes = await apiGetPots(selected, token);
      if (potsRes.ok && potsRes.pots) potCount = potsRes.pots.length;
    }

    respond({
      configured: !isPendingApproval && accounts.length > 0,
      pendingApproval: isPendingApproval,
      isOAuth: hasOAuth,
      userId: pingRes.json && pingRes.json.user_id,
      accounts: accounts,
      selectedAccountId: selected,
      potsCount: potCount,
      clientId: creds.clientId || '',
      redirectUri: creds.redirectUri || '',
      theme: (function () {
        try { return localStorage.getItem('monzo_theme') || 'light'; } catch (e) { return 'light'; }
      })()
    });
    return;
  }

  if (type === 'oauth_exchange') {
    var clientId = (message.clientId || '').trim();
    var clientSecret = (message.clientSecret || '').trim();
    var redirectUri = (message.redirectUri || '').trim();
    var code = (message.code || '').trim();

    if (!clientId || !clientSecret || !redirectUri || !code) {
      respond({ error: 'Client ID, Client Secret, Redirect URI, and Authorization Code are all required.' });
      return;
    }

    try {
      console.log('[MonzoPlugin] Exchanging OAuth authorization code for tokens...');
      var params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('redirect_uri', redirectUri);
      params.append('code', code);

      var res = await fetch(API_ROOT + '/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params.toString()
      });

      var text = await res.text();
      var json = null;
      try { json = JSON.parse(text); } catch (err) {}

      if (!res.ok || !json || !json.access_token) {
        var errDesc = (json && (json.message || json.error_description || json.error)) || ('HTTP ' + res.status);
        console.error('[MonzoPlugin] Token exchange failed:', errDesc);
        respond({ error: 'OAuth exchange failed: ' + errDesc });
        return;
      }

      await setOAuthCredentials(clientId, clientSecret, redirectUri, json.refresh_token || '');
      await setAccessToken(json.access_token);

      var testPing = await apiWhoAmI(json.access_token);
      var testAccs = await apiGetAccounts(json.access_token);

      var isPendingApproval = (!testAccs.ok && (testAccs.status === 403 || testAccs.error === 'PERMISSION_DENIED'));

      if (!testAccs.ok && !isPendingApproval) {
        respond({ error: 'Monzo API error: ' + (testAccs.message || ('HTTP ' + testAccs.status)) });
        return;
      }

      if (testAccs.ok && (!testAccs.accounts || !testAccs.accounts.length)) {
        respond({ error: 'OAuth connected, but no open retail or joint accounts found.' });
        return;
      }

      var defaultId = (testAccs.accounts && testAccs.accounts[0]) ? testAccs.accounts[0].id : '';
      if (defaultId) {
        setSelectedAccountId(defaultId);
        Pebble.refreshSources(SOURCES);
      }

      var potCount = 0;
      if (defaultId) {
        var potsRes = await apiGetPots(defaultId, json.access_token);
        if (potsRes.ok && potsRes.pots) potCount = potsRes.pots.length;
      }

      respond({
        configured: !isPendingApproval && !!defaultId,
        pendingApproval: isPendingApproval,
        isOAuth: true,
        userId: testPing.json && testPing.json.user_id,
        accounts: testAccs.accounts || [],
        selectedAccountId: defaultId,
        potsCount: potCount,
        clientId: clientId,
        redirectUri: redirectUri,
        message: isPendingApproval
          ? 'Credentials saved! Please open your Monzo app to approve the login request, then tap Check Approval.'
          : undefined
      });
      return;
    } catch (e) {
      console.error('[MonzoPlugin] Exception in oauth_exchange:', e);
      respond({ error: 'OAuth exchange exception: ' + (e.message || String(e)) });
      return;
    }
  }

  if (type === 'connect') {
    var inputToken = (message.token || '').trim();
    if (!inputToken) {
      respond({ error: 'Please enter a valid Monzo Access Token.' });
      return;
    }

    var testPing = await apiWhoAmI(inputToken);
    if (!testPing.ok) {
      respond({ error: testPing.message || 'Could not verify token with Monzo API.' });
      return;
    }

    var testAccs = await apiGetAccounts(inputToken);
    if (!testAccs.ok || !testAccs.accounts || !testAccs.accounts.length) {
      respond({ error: 'Token is valid, but no open retail or joint accounts were found.' });
      return;
    }

    await setAccessToken(inputToken);
    var defaultId = testAccs.accounts[0].id;
    setSelectedAccountId(defaultId);

    Pebble.refreshSources(SOURCES);
    respond({
      configured: true,
      isOAuth: false,
      userId: testPing.json && testPing.json.user_id,
      accounts: testAccs.accounts,
      selectedAccountId: defaultId
    });
    return;
  }

  if (type === 'selectAccount') {
    var newId = message.accountId;
    if (newId) {
      setSelectedAccountId(newId);
      Pebble.refreshSources(SOURCES);
      respond({ ok: true, selectedAccountId: newId });
    } else {
      respond({ error: 'Invalid account ID.' });
    }
    return;
  }

  if (type === 'setTheme') {
    var theme = (message && message.theme === 'dark') ? 'dark' : 'light';
    try { localStorage.setItem('monzo_theme', theme); } catch (e) {}
    Pebble.refreshSources(SOURCES);
    respond({ ok: true, theme: theme });
    return;
  }

  if (type === 'getTheme') {
    var saved = 'light';
    try { saved = localStorage.getItem('monzo_theme') || 'light'; } catch (e) {}
    respond({ ok: true, theme: saved });
    return;
  }

  if (type === 'unlink') {
    await clearTokens();
    Pebble.refreshSources(SOURCES);
    respond({ configured: false, ok: true });
    return;
  }

  respond({ error: 'Unknown message type: ' + type });
});
