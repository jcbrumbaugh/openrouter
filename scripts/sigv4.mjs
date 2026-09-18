// Minimal AWS Signature V4 for a single S3 PUT.
//
// Tripo's own SDK uses boto3 to push 3D models into S3 with temporary STS
// credentials; their /upload endpoint is images only and answers
// "This image file type is not supported" for a mesh. Rather than pull in the
// AWS SDK for one request, this signs it directly.
//
// Verified against the canonical example in AWS's SigV4 documentation - see
// tests/sigv4.test.mjs.

import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

function stamps(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function signRequest({
  method = 'PUT',
  host,
  path,
  body = Buffer.alloc(0),
  accessKeyId,
  secretAccessKey,
  sessionToken,
  region = 'us-east-1',
  service = 's3',
  contentType = 'application/octet-stream',
  extraHeaders = {},
  date = new Date(),
}) {
  const { amzDate, dateStamp } = stamps(date);
  const payloadHash = sha256(body);

  // Header names must be lowercase and sorted for the canonical request.
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  if (contentType) headers['content-type'] = contentType;
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value !== undefined && value !== null) headers[name.toLowerCase()] = value;
  }

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  // Each path segment is encoded, but the slashes between them are not.
  const canonicalPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const signingKey = ['aws4_request'].reduce(
    (key, step) => hmac(key, step),
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    signature,
    canonicalRequest,
    stringToSign,
  };
}
