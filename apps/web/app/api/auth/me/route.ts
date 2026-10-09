import { fresh, isAdmin, sessionWallet } from "@/lib/session";

/** Who is signed in: {wallet, admin}; wallet is null for visitors. */
export async function GET() {
  try {
    const wallet = await sessionWallet();
    return fresh({ wallet, admin: isAdmin(wallet) });
  } catch {
    return fresh({ wallet: null, admin: false });
  }
}
