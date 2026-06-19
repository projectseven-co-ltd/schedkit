const BLESTA_URL = (process.env.BLESTA_URL || 'https://projectseven.us/core/api/').replace(/\/?$/, '/');
const BLESTA_USER = process.env.BLESTA_API_USER;
const BLESTA_KEY = process.env.BLESTA_API_KEY;

export function blestaConfigured() {
  return Boolean(BLESTA_USER && BLESTA_KEY);
}

export async function blestaApi(model, method, params = {}, httpMethod = 'GET') {
  if (!blestaConfigured()) {
    throw new Error('Blesta API not configured (BLESTA_API_USER / BLESTA_API_KEY)');
  }
  let url = `${BLESTA_URL}${model}/${method}.json`;
  if (httpMethod === 'GET' && Object.keys(params).length) {
    url += '?' + new URLSearchParams(params).toString();
  }
  const opts = {
    method: httpMethod,
    headers: {
      'BLESTA-API-USER': BLESTA_USER,
      'BLESTA-API-KEY': BLESTA_KEY,
    },
  };
  if (httpMethod === 'POST') {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Blesta ${model}/${method} → ${res.status}: ${json.message || res.statusText}`);
  }
  return json.response ?? json;
}
