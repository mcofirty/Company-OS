/**
 * Assistant de connexion propriétaire (ADR-053), appelé par infra/deploy/set-login.sh.
 * Aucun secret en argument de ligne de commande (visible dans `ps`) : tout passe par stdin.
 *
 *   generate : stdin = mot de passe (une ligne)
 *              stdout = OWNER_PASSWORD_HASH=…, OWNER_TOTP_SECRET=…, OWNER_SESSION_SECRET=…
 *              stderr = QR code à scanner + clé à saisir à la main
 *   verify   : stdin = clé TOTP puis code (deux lignes) ; code de sortie 0 si le code est bon
 *   hash     : stdin = mot de passe ; stdout = OWNER_PASSWORD_HASH=… (changement de mot de passe)
 *
 * Développement : `pnpm --filter @company-os/db owner generate`.
 */
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import {
  generateTotpSecret,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  otpauthUri,
  verifyTotp,
} from '@company-os/policies';

async function readStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
}

const err = (s: string): void => void process.stderr.write(`${s}\n`);

async function main(): Promise<number> {
  const cmd = process.argv[2];
  const lines = await readStdin();
  if (cmd === 'generate' || cmd === 'hash') {
    const password = lines[0] ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      err(`Mot de passe trop court : ${MIN_PASSWORD_LENGTH} caractères minimum.`);
      return 2;
    }
    process.stdout.write(`OWNER_PASSWORD_HASH=${await hashPassword(password)}\n`);
    if (cmd === 'hash') return 0;
    const secret = generateTotpSecret();
    const uri = otpauthUri(secret, 'Propriétaire');
    err('');
    err('Scannez ce QR code avec une application d’authentification sur votre téléphone');
    err('(Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…) :');
    err('');
    err(await QRCode.toString(uri, { type: 'utf8', errorCorrectionLevel: 'M', margin: 2 }));
    err('Impossible de scanner ? Dans l’application : « Saisir une clé de configuration »');
    err(`  Compte : Living HQ   Clé : ${secret.replace(/(.{4})/g, '$1 ').trim()}`);
    err('  Type   : basé sur l’heure');
    err('');
    process.stdout.write(`OWNER_TOTP_SECRET=${secret}\n`);
    process.stdout.write(`OWNER_SESSION_SECRET=${randomBytes(32).toString('base64url')}\n`);
    return 0;
  }
  if (cmd === 'verify') {
    const [secret = '', code = ''] = lines;
    return verifyTotp(secret.trim(), code.trim(), Date.now()) !== null ? 0 : 1;
  }
  err('Usage : owner-cli.ts generate|verify|hash (données sur stdin)');
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    err(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
