import { success } from "@/lib/response";
import { getInstanceInfo, mapSpcError } from "@/services/private-channels";
import type { AppContext } from "../context";

/** GET /instance — return the connected SPC instance's config + gateway health. */
export async function getPrivateChannelInstance(c: AppContext) {
  try {
    const instance = await getInstanceInfo(c.env);
    return success(c, { instance });
  } catch (error) {
    throw mapSpcError(error);
  }
}
