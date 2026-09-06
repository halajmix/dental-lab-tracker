/**
 * The Supabase service-role key, read from the macOS Keychain.
 *
 * That key bypasses every RLS policy in the system, so a plaintext dotfile in
 * the home folder is the wrong place for it — anything running as this user
 * can read it, and it lands in every Time Machine and cloud sync unencrypted.
 * The Keychain is encrypted, ACL'd per-application, and unlocked by login.
 *
 * One-time setup (the key never passes through the shell's history if you
 * use -w with no value — `security` will prompt for it):
 *
 *   security add-generic-password -a "$USER" -s drcrown-service-key -w
 *
 * then delete the old file:  rm ~/.drcrown-backup-env
 *
 * The dotfile still works as a fallback so nothing breaks before you migrate,
 * but it warns each run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "drcrown-service-key";
const LEGACY = join(homedir(), ".drcrown-backup-env");

export function serviceKey() {
  try {
    const key = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (key) return key;
  } catch {
    /* not in the Keychain yet — fall through */
  }

  if (existsSync(LEGACY)) {
    const key = readFileSync(LEGACY, "utf8").match(/SERVICE_ROLE_KEY=(\S+)/)?.[1];
    if (key) {
      console.warn(
        "⚠ service key read from ~/.drcrown-backup-env (plaintext).\n" +
        `  Move it to the Keychain:  security add-generic-password -a "$USER" -s ${SERVICE} -w\n` +
        "  then:                     rm ~/.drcrown-backup-env"
      );
      return key;
    }
  }
  throw new Error(
    `No service-role key. Add it to the Keychain:\n` +
    `  security add-generic-password -a "$USER" -s ${SERVICE} -w`
  );
}
