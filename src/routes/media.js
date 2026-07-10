// src/routes/media.js
// GET /media/users/<userId>/<file-key-suffix...>
// R2 objects are private by default — this is what actually serves them,
// gated by a valid session.

import { getSessionUser } from '../shared/auth.js';

export async function handleMedia(request, env, key) {
  if (!env.DB || !env.MEDIA) {
    return new Response('Not configured', { status: 500 });
  }

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return new Response('Unauthorized', { status: 401 });

  if (key.includes('voice-clip-')) {
    const parts = key.split('/');
    const ownerId = parts[1]; // users/<ownerId>/...
    if (ownerId !== viewer.id) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const object = await env.MEDIA.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=300');

  return new Response(object.body, { headers });
}
