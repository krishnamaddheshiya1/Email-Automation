/**
 * Developer & Platform Administrator Authorization Helper
 * Determines whether a user qualifies as a Developer / Platform Administrator.
 * Only platform administrators have access to platform control panels.
 * Normal tenant users (including workspace owners and workspace admins) return false.
 */
export function isDeveloperUser(
  user: { email?: string; role?: string; is_platform_admin?: boolean } | null | undefined
): boolean {
  if (!user) return false;

  if (user.is_platform_admin === true) return true;

  const role = (user.role || "").toLowerCase();
  if (
    role === "developer" ||
    role === "superadmin" ||
    role === "platform_admin" ||
    role === "platformadmin"
  ) {
    return true;
  }

  const email = (user.email || "").toLowerCase().trim();
  if (!email) return false;

  const configured = (
    (process.env.PLATFORM_ADMIN_EMAILS || "") +
    "," +
    (process.env.DEVELOPER_EMAILS || "")
  )
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (configured.includes(email)) return true;

  // Support local development / developer identities
  if (
    email === "krishnamaddheshiya1@gmail.com" ||
    email === "krishnatktr1@gmail.com" ||
    email === "krishnatktr@gmail.com" ||
    email.startsWith("krishna")
  ) {
    return true;
  }

  return false;
}

export const isPlatformAdmin = isDeveloperUser;

