import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';

// Never print private material or write it into the repository.
if (!process.argv[2])
  throw new Error(
    'Usage: node identity-keygen.mjs <private-directory-outside-repository>',
  );
const target = resolve(process.argv[2]);
const withinRepository = relative(resolve(import.meta.dirname, '..'), target);
if (!isAbsolute(withinRepository) && !withinRepository.startsWith('..'))
  throw new Error('Use a private directory outside the repository');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const jwk = {
  ...privateKey.export({ format: 'jwk' }),
  kid: randomUUID(),
  alg: 'RS256',
  use: 'sig',
};
await mkdir(target, { recursive: true });
const secret = randomBytes(32).toString('base64url');
await writeFile(
  resolve(target, 'identity.env'),
  [
    'IDENTITY_ENABLED=false',
    `IDENTITY_AI_CLIENT_SECRET=${secret}`,
    `IDENTITY_COOKIE_KEYS='${JSON.stringify([randomBytes(32).toString('base64url')])}'`,
    `IDENTITY_SIGNING_JWKS='${JSON.stringify({ keys: [jwk] })}'`,
    "IDENTITY_AI_ADMIN_USER_IDS='[]'",
    '',
  ].join('\n'),
  { mode: 0o600, flag: 'wx' },
);
await writeFile(
  resolve(target, 'chatviva-client.json'),
  JSON.stringify(
    {
      issuer: 'https://is.luckdate.com/api/identity',
      client_id: 'chatviva-admin',
      client_secret: secret,
      redirect_uri: 'https://ai.chatviva.com/api/auth/oidc/callback',
    },
    null,
    2,
  ),
  { mode: 0o600, flag: 'wx' },
);
process.stdout.write(
  'Private configuration generated. Keep both files private; enable only after integration approval.\n',
);
