import { planetName, type CustomValues } from "@orbit/core";
import { adminRest } from "@/lib/admin-db";
import { apiError } from "@/lib/db";
import { fresh, isAdmin, sessionWallet } from "@/lib/session";

interface Report {
  wallet: string;
  reason: string | null;
  created_at: string;
}

/** Open name reports, one entry per planet with its current custom names. Admin only. */
export async function GET() {
  try {
    if (!isAdmin(await sessionWallet())) return apiError(403, "not_admin", "Admins only");
    const reports = await adminRest<Report[]>(
      "name_reports?resolved_at=is.null&select=wallet,reason,created_at&order=created_at.desc&limit=1000",
    );
    const wallets = [...new Set(reports.map((r) => r.wallet))];
    const custom = wallets.length
      ? await adminRest<(CustomValues & { wallet: string; hidden_by_admin: boolean })[]>(
          `planet_custom?wallet=in.(${wallets.join(",")})&select=wallet,name,species,capital,motto,hidden_by_admin`,
        )
      : [];
    const byWallet = new Map(custom.map((c) => [c.wallet, c]));
    const items = wallets.map((w) => {
      const rs = reports.filter((r) => r.wallet === w);
      const c = byWallet.get(w);
      return {
        wallet: w,
        stockName: planetName(w),
        custom: c ? { name: c.name, species: c.species, capital: c.capital, motto: c.motto } : null,
        hidden: c?.hidden_by_admin ?? false,
        reports: rs.length,
        reasons: rs.map((r) => r.reason).filter(Boolean),
        lastAt: new Date(rs[0]!.created_at).getTime(),
      };
    });
    return fresh({ items });
  } catch {
    return apiError(503, "unavailable", "Reports are not available right now");
  }
}
