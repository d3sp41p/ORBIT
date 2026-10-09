/**
 * Wallet sign-in in the browser (spec: "Sign-in flow"). Phantom, Solflare and
 * other Solana wallets register through the Wallet Standard; the site asks
 * only to connect and to sign a text message, never a transaction.
 */
import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
} from "@wallet-standard/features";

export interface Me {
  wallet: string | null;
  admin: boolean;
}

export const NOBODY: Me = { wallet: null, admin: false };

const usable = (w: Wallet) =>
  StandardConnect in w.features &&
  SolanaSignMessage in w.features &&
  w.chains.some((c) => c.startsWith("solana:"));

/** Solana wallets installed in this browser that can sign messages. */
export const solanaWallets = (): Wallet[] => getWallets().get().filter(usable);

/** Wallet extensions register a moment after the page loads. */
export function onWalletsChange(cb: () => void): () => void {
  const api = getWallets();
  const off = [api.on("register", cb), api.on("unregister", cb)];
  return () => off.forEach((f) => f());
}

/** An error the visitor can read (from our API or from the wallet). */
export class SignInError extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new SignInError(j.error?.message ?? "Something went wrong, try again");
  return j;
}

/** Who is signed in right now (the session lives in an httpOnly cookie). */
export async function whoAmI(): Promise<Me> {
  try {
    return await call<Me>("/api/auth/me");
  } catch {
    return NOBODY;
  }
}

const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(""));

/** Connect the wallet, sign the one-time message, start a session. */
export async function signIn(w: Wallet): Promise<Me> {
  const connect = (w.features as StandardConnectFeature)[StandardConnect].connect;
  const sign = (w.features as SolanaSignMessageFeature)[SolanaSignMessage].signMessage;
  let account: WalletAccount | undefined;
  try {
    const { accounts } = await connect();
    account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
  } catch {
    throw new SignInError("The wallet did not connect");
  }
  if (!account) throw new SignInError("The wallet shared no account");
  const { nonce, message } = await call<{ nonce: string; message: string }>("/api/auth/nonce", {
    wallet: account.address,
  });
  let signature: Uint8Array;
  try {
    const [out] = await sign({ account, message: new TextEncoder().encode(message) });
    signature = out!.signature;
  } catch {
    throw new SignInError("The message was not signed");
  }
  return call<Me>("/api/auth/verify", {
    wallet: account.address,
    nonce,
    signature: toBase64(signature),
  });
}

export async function signOut(w?: Wallet | null): Promise<void> {
  await call("/api/auth/logout", {}).catch(() => undefined);
  if (w && StandardDisconnect in w.features)
    await (w.features as StandardDisconnectFeature)[StandardDisconnect].disconnect().catch(
      () => undefined,
    );
}

/** On a phone without an injected wallet: open this page inside the wallet app. */
export const openInWallet = {
  phantom: (url: string) =>
    `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  solflare: (url: string) =>
    `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
};
