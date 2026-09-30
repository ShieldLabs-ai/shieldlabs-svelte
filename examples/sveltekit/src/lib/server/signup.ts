import { fail, type RequestEvent } from '@sveltejs/kit';

/** The signup form action of both pages. */
export async function signup({ request }: RequestEvent) {
  const data = await request.formData();
  const email = String(data.get('email') ?? '').trim();
  const requestId = String(data.get('requestId') ?? '');

  if (!email) {
    return fail(400, { email, message: 'Enter an email address.' });
  }

  // Before creating the account, read the verdict for requestId with a ShieldLabs server SDK
  // (https://github.com/ShieldLabs-ai/shieldlabs-node), for example:
  //
  //   const identification = await shieldlabs.identifications.get(requestId);
  //   const verdict = evaluateIdentification(identification, {
  //     isReplay: (id) => usedRequestIds.has(id),
  //   });
  //   if (!verdict.ok) return fail(403, { email, message: 'We could not verify this signup.' });
  //   usedRequestIds.add(requestId);
  //
  // A missing requestId means "unverified", never "clean". Accept each request ID once and only
  // within your freshness window (5 minutes here).
  return {
    email,
    message: requestId
      ? `The server received request ID ${requestId}.`
      : 'No request ID: the server treats this signup as unverified.',
  };
}
