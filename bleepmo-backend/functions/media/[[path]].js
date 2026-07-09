// functions/media/[[path]].js
// GET /media/users/<userId>/<file-key-suffix...>
//
// R2 objects are private by default — this route is what actually serves
// them, and it requires a valid session. That's the "don't let randoms on
// the internet see people's faces and voice clips" gate.
//
// Current policy (adjust to taste as the product matures):
//   - Any logged-in user can view any other user's profile pictures
//     (they're meant to show up in the feed for everyone).
//   - Voice-verification clips are only servable to their owner, since
//     they're closer to an identity document than public content.

import { getSessionUser } from '../_shared/auth.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  if (!env.DB || !env.MEDIA) {
    return new Response('Not configured', { status: 500 });
  }

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return new Response('Unauthorized', { status: 401 });

  const pathParts = Array.isArray(params.path) ? params.path : [params.path];
  const key = pathParts.join('/'); // e.g. "users/<ownerId>/voice-clip-172..."

  if (key.includes('voice-clip-')) {
    const ownerId = pathParts[1]; // users/<ownerId>/...
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
