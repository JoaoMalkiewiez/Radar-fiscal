// Hosted adapter only. Local loopback guard remains unchanged.
import fs from "node:fs";
export const PRODUCTION_REF = "kokpxikvisheaxkicmop";
const deny = () => {
  throw Error("HOSTED_LAB_TARGET_DENIED");
};
export function validateHostedTarget(config, authorization) {
  // Explicit production deny precedes every positive allowlist decision.
  if (
    config?.projectRef === PRODUCTION_REF ||
    authorization?.projectRef === PRODUCTION_REF
  )
    deny();
  const ref = authorization?.projectRef;
  if (
    !authorization?.creationApproved ||
    authorization.projectRef !== "pkiowhcjmxfznhuhrxvj" ||
    !/^[a-z]{20}$/.test(ref || "") ||
    authorization.organizationId !== "hwjjvpmhopftkwcbscnx" ||
    authorization.projectName !== "radar-juridico-lab" ||
    authorization.plan !== "free" ||
    authorization.quotedMonthlyUSD !== 0 ||
    config?.projectRef !== ref ||
    config?.url !== `https://${ref}.supabase.co`
  )
    deny();
  return new URL(config.url);
}
export function loadAuthorization() {
  return JSON.parse(
    fs.readFileSync(new URL("./authorization.json", import.meta.url), "utf8"),
  );
}
export function hostedRequest(config, authorization, fetcher = fetch) {
  const origin = validateHostedTarget(config, authorization).origin;
  // Bind an immutable copy so later config mutation cannot retarget a pending run.
  const frozenConfig = { projectRef: config.projectRef, url: config.url };
  const frozenAuthorization = structuredClone(authorization);
  return async (pathname, options = {}) => {
    validateHostedTarget(frozenConfig, frozenAuthorization);
    if (
      typeof pathname !== "string" ||
      !/^\/(auth\/v1|rest\/v1|storage\/v1)\//.test(pathname) ||
      pathname.includes("\\") ||
      pathname.includes("#")
    )
      deny();
    const url = new URL(pathname, origin);
    if (
      url.origin !== origin ||
      !/^\/(auth\/v1|rest\/v1|storage\/v1)\//.test(url.pathname)
    )
      deny();
    try {
      // Never follow redirects to another project or emit a sensitive fetch URL.
      const response = await fetcher(url, {
        ...options,
        redirect: "manual",
        signal:
          options.signal ||
          AbortSignal.timeout(
            pathname.startsWith("/storage/") ? 300000 : 30000,
          ),
      });
      if (response.status >= 300 && response.status < 400)
        throw Error("REDIRECT_DENIED");
      return response;
    } catch {
      throw Error("HOSTED_LAB_REQUEST_FAILED");
    }
  };
}
