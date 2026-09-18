// Checks the SigV4 signer against the worked example in AWS's own
// documentation, since the real S3 endpoint cannot be reached from here.
//
//   node tests/sigv4.test.mjs

import { signRequest } from '../scripts/sigv4.mjs';

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  if (got === want) {
    console.log(`  ok  ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL  ${name}\n      got:  ${got}\n      want: ${want}`);
    fail += 1;
  }
};

// AWS's documented "GET Object" example, which signs a Range header too. The
// published signature below is for exactly this request.
const example = signRequest({
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  body: Buffer.alloc(0),
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
  contentType: '',
  extraHeaders: { range: 'bytes=0-9' },
  date: new Date('2013-05-24T00:00:00Z'),
});

check(
  'canonical request matches the documented example',
  example.canonicalRequest,
  [
    'GET',
    '/test.txt',
    '',
    'host:examplebucket.s3.amazonaws.com',
    'range:bytes=0-9',
    'x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'x-amz-date:20130524T000000Z',
    '',
    'host;range;x-amz-content-sha256;x-amz-date',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ].join('\n'),
);

// The signature check below is the authoritative one: it can only match AWS's
// published value if the canonical request, string to sign and signing key are
// all correct. So assert this one's shape rather than a hash constant.
const lines = example.stringToSign.split('\n');
check('string to sign has the four required lines', lines.length, 4);
check('it declares the algorithm', lines[0], 'AWS4-HMAC-SHA256');
check('it carries the request timestamp', lines[1], '20130524T000000Z');
check('it scopes to the date, region and service', lines[2], '20130524/us-east-1/s3/aws4_request');
check('it ends with a sha256 of the canonical request', /^[0-9a-f]{64}$/.test(lines[3]), true);

// The signature AWS publishes for that exact request.
check(
  'signature matches the value AWS publishes',
  example.signature,
  'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
);

// A session token has to be signed too, or S3 rejects temporary credentials.
const temporary = signRequest({
  method: 'PUT',
  host: 'tripo-data.example.com',
  path: '/bucket/some key.fbx',
  body: Buffer.from('mesh'),
  accessKeyId: 'ASIA_TEMP',
  secretAccessKey: 'secret',
  sessionToken: 'session-token-value',
  date: new Date('2026-09-18T10:00:00Z'),
});
check('a session token is part of the signed headers',
  /x-amz-security-token/.test(temporary.canonicalRequest), true);
check('the token is sent as a header',
  temporary.headers['x-amz-security-token'], 'session-token-value');
check('spaces in the key are encoded',
  /\/bucket\/some%20key\.fbx/.test(temporary.canonicalRequest), true);
check('the body hash is the payload, not the empty hash',
  temporary.canonicalRequest.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
