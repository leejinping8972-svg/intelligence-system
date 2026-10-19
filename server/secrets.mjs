import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import process from 'node:process';

const aad = Buffer.from('intelligence-server-database-v1');
export function encryptConfig(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.PROVIDER_CONFIG_ENCRYPTION_KEY, 'base64'),
    iv,
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
export function decryptConfig(record) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.PROVIDER_CONFIG_ENCRYPTION_KEY, 'base64'),
    Buffer.from(record.iv, 'base64'),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString(),
  );
}
