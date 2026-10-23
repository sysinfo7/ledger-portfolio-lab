import { errorResponse, snapshotAllLiveAccounts } from "@/lib/paper-market";

export async function POST() {
  try {
    return Response.json(await snapshotAllLiveAccounts());
  } catch (error) {
    return errorResponse(error);
  }
}
